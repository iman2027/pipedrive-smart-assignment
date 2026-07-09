import {
	getPipedriveDealsForOwner,
	updatePipedriveDealOwner
} from "./pipedrive.js";

async function getInstalledAccount(env) {
	const row = await env.DB.prepare(`
		SELECT *
		FROM oauth_tokens
		ORDER BY id DESC
		LIMIT 1
	`).first();

	if (!row) {
		throw new Error("No Pipedrive OAuth token found. Open /oauth/start first.");
	}

	return row;
}

async function getActiveCapacities(env, companyId) {
	const result = await env.DB.prepare(`
		SELECT
			pipedrive_user_id,
			user_name,
			daily_capacity,
			sort_order
		FROM user_capacities
		WHERE company_id = ?
		AND active = 1
		AND daily_capacity > 0
		ORDER BY sort_order ASC, user_name ASC
	`)
		.bind(companyId)
		.all();

	return result.results || [];
}

function getTodayStartLocalIso() {
	const now = new Date();

	const start = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		0,
		0,
		0,
		0
	);

	return start.toISOString();
}

function getDealAddTime(deal) {
	return deal.add_time || deal.addTime || null;
}

function getDealOwnerId(deal) {
	const ownerId =
		deal.owner_id ||
		deal.ownerId ||
		(deal.owner && deal.owner.id) ||
		null;

	return ownerId ? Number(ownerId) : null;
}

function isCreatedToday(deal, todayStartIso) {
	const addTime = getDealAddTime(deal);

	if (!addTime) {
		return false;
	}

	const dealTime = new Date(addTime).getTime();
	const todayStart = new Date(todayStartIso).getTime();

	return dealTime >= todayStart;
}

async function countTodayDealsForUser(env, userId, todayStartIso) {
	let count = 0;
	let cursor = null;
	let shouldContinue = true;

	const checkedDeals = [];

	while (shouldContinue) {
		const response = await getPipedriveDealsForOwner(env, userId, cursor);
		const deals = Array.isArray(response.data) ? response.data : [];

		for (const deal of deals) {
			const dealOwnerId = getDealOwnerId(deal);
			const createdToday = isCreatedToday(deal, todayStartIso);
			const counted = createdToday && dealOwnerId === Number(userId);

			checkedDeals.push({
				id: deal.id,
				title: deal.title,
				owner_id: dealOwnerId,
				add_time: getDealAddTime(deal),
				counted
			});

			if (!createdToday) {
				shouldContinue = false;
				break;
			}

			if (counted) {
				count++;
			}
		}

		const nextCursor =
			response.additional_data &&
			response.additional_data.pagination &&
			response.additional_data.pagination.next_cursor;

		if (!nextCursor || deals.length === 0) {
			shouldContinue = false;
		}

		cursor = nextCursor;
	}

	return {
		count,
		checkedDeals
	};
}

async function getLastAssignedUserId(env, companyId) {
	const row = await env.DB.prepare(`
		SELECT last_assigned_user_id
		FROM assignment_state
		WHERE company_id = ?
	`)
		.bind(companyId)
		.first();

	return row ? Number(row.last_assigned_user_id) : null;
}

async function updateLastAssignedUserId(env, companyId, userId) {
	await env.DB.prepare(`
		INSERT INTO assignment_state (
			company_id,
			last_assigned_user_id,
			updated_at
		)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(company_id)
		DO UPDATE SET
			last_assigned_user_id = excluded.last_assigned_user_id,
			updated_at = CURRENT_TIMESTAMP
	`)
		.bind(companyId, Number(userId))
		.run();
}

function buildRoundRobinCandidates(capacityRows, todayCounts) {
	return capacityRows.map(row => {
		const userId = Number(row.pipedrive_user_id);
		const assignedToday = todayCounts[userId] || 0;
		const dailyCapacity = Number(row.daily_capacity);
		const remaining = dailyCapacity - assignedToday;

		return {
			user_id: userId,
			user_name: row.user_name,
			daily_capacity: dailyCapacity,
			assigned_today: assignedToday,
			remaining,
			sort_order: Number(row.sort_order || 0)
		};
	});
}

function chooseRoundRobinAssignee(capacityRows, todayCounts, lastAssignedUserId) {
	const candidates = buildRoundRobinCandidates(capacityRows, todayCounts);
	const availableCandidates = candidates.filter(item => item.remaining > 0);

	if (availableCandidates.length === 0) {
		return {
			assignee: null,
			candidates
		};
	}

	const orderedUserIds = candidates.map(item => item.user_id);

	let startIndex = 0;

	if (lastAssignedUserId) {
		const lastIndex = orderedUserIds.indexOf(Number(lastAssignedUserId));

		if (lastIndex >= 0) {
			startIndex = (lastIndex + 1) % orderedUserIds.length;
		}
	}

	for (let offset = 0; offset < candidates.length; offset++) {
		const index = (startIndex + offset) % candidates.length;
		const candidate = candidates[index];

		if (candidate.remaining > 0) {
			return {
				assignee: candidate,
				candidates
			};
		}
	}

	return {
		assignee: null,
		candidates
	};
}

async function logAssignment(env, companyId, dealId, assignee, score) {
	await env.DB.prepare(`
		INSERT INTO assignment_logs (
			company_id,
			deal_id,
			assigned_user_id,
			assigned_user_name,
			score
		)
		VALUES (?, ?, ?, ?, ?)
	`)
		.bind(
			companyId,
			Number(dealId),
			assignee.user_id,
			assignee.user_name || "",
			Number(score || 0)
		)
		.run();
}

async function getLatestAssignments(env, companyId) {
	const result = await env.DB.prepare(`
		SELECT
			deal_id,
			assigned_user_id,
			assigned_user_name,
			score,
			created_at
		FROM assignment_logs
		WHERE company_id = ?
		ORDER BY id DESC
		LIMIT 10
	`)
		.bind(companyId)
		.all();

	return result.results || [];
}

export async function buildAssignmentSummary(env) {
	const account = await getInstalledAccount(env);
	const capacities = await getActiveCapacities(env, account.company_id);
	const todayStartIso = getTodayStartLocalIso();

	const todayCounts = {};
	const users = [];

	for (const row of capacities) {
		const userId = Number(row.pipedrive_user_id);
		const result = await countTodayDealsForUser(env, userId, todayStartIso);

		todayCounts[userId] = result.count;

		users.push({
			user_id: userId,
			user_name: row.user_name,
			daily_capacity: Number(row.daily_capacity),
			assigned_today: result.count,
			remaining: Number(row.daily_capacity) - result.count,
			sort_order: Number(row.sort_order || 0)
		});
	}

	const lastAssignedUserId = await getLastAssignedUserId(env, account.company_id);
	const latestAssignments = await getLatestAssignments(env, account.company_id);

	const choice = chooseRoundRobinAssignee(
		capacities,
		todayCounts,
		lastAssignedUserId
	);

	return {
		success: true,
		company_id: account.company_id,
		company_name: account.company_name,
		today_start_iso: todayStartIso,
		last_assigned_user_id: lastAssignedUserId,
		next_available_user: choice.assignee
			? {
				id: choice.assignee.user_id,
				name: choice.assignee.user_name
			}
			: null,
		users,
		latest_assignments: latestAssignments
	};
}

export async function getAssignmentSummary(env) {
	const summary = await buildAssignmentSummary(env);

	return Response.json(summary);
}

export async function assignDealCore({ env, dealId, score }) {
	if (!dealId) {
		return {
			success: false,
			assigned: false,
			message: "deal_id is required."
		};
	}

	const account = await getInstalledAccount(env);

	const capacities = await getActiveCapacities(env, account.company_id);

	if (capacities.length === 0) {
		return {
			success: true,
			assigned: false,
			message: "No user capacity is configured."
		};
	}

	const todayStartIso = getTodayStartLocalIso();
	const todayCounts = {};
	const debugCounts = {};

	for (const row of capacities) {
		const userId = Number(row.pipedrive_user_id);
		const result = await countTodayDealsForUser(env, userId, todayStartIso);

		todayCounts[userId] = result.count;

		debugCounts[userId] = {
			user_name: row.user_name,
			daily_capacity: Number(row.daily_capacity),
			counted_today: result.count,
			remaining: Number(row.daily_capacity) - result.count,
			checked_deals: result.checkedDeals
		};
	}

	const lastAssignedUserId = await getLastAssignedUserId(
		env,
		account.company_id
	);

	const choice = chooseRoundRobinAssignee(
		capacities,
		todayCounts,
		lastAssignedUserId
	);

	const assignee = choice.assignee;

	if (!assignee) {
		return {
			success: true,
			assigned: false,
			message: "All users have reached their daily capacity. Deal was not assigned.",
			today_counts: todayCounts,
			candidates: choice.candidates,
			last_assigned_user_id: lastAssignedUserId,
			debug_counts: debugCounts
		};
	}

	const updateResponse = await updatePipedriveDealOwner(
		env,
		dealId,
		assignee.user_id
	);

	const updatedOwnerId =
		updateResponse &&
		updateResponse.data &&
		Number(updateResponse.data.owner_id);

	if (updatedOwnerId !== Number(assignee.user_id)) {
		return {
			success: false,
			assigned: false,
			message: "Pipedrive returned success, but deal owner was not changed.",
			expected_owner_id: Number(assignee.user_id),
			actual_owner_id: updatedOwnerId,
			pipedrive_response: updateResponse,
			debug_counts: debugCounts
		};
	}

	await logAssignment(env, account.company_id, dealId, assignee, score);

	await updateLastAssignedUserId(
		env,
		account.company_id,
		assignee.user_id
	);

	return {
		success: true,
		assigned: true,
		assigned_user: {
			id: assignee.user_id,
			name: assignee.user_name
		},
		score,
		today_counts: todayCounts,
		candidates: choice.candidates,
		last_assigned_user_id: lastAssignedUserId,
		next_round_robin_user_id: assignee.user_id,
		pipedrive_response: updateResponse,
		debug_counts: debugCounts,
		message: "Deal assigned successfully."
	};
}

export async function assignDeal(request, env) {
	const body = await request.json();

	const dealId = Number(body.deal_id);
	const score = Number(body.score || 0);

	const result = await assignDealCore({
		env,
		dealId,
		score
	});

	const status = result.success ? 200 : 400;

	return Response.json(result, { status });
}