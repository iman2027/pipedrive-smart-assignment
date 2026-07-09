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
			daily_capacity
		FROM user_capacities
		WHERE company_id = ?
		AND active = 1
		AND daily_capacity > 0
		ORDER BY user_name ASC
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

    while (shouldContinue) {
        const response = await getPipedriveDealsForOwner(env, userId, cursor);
        const deals = Array.isArray(response.data) ? response.data : [];

        for (const deal of deals) {
            if (isCreatedToday(deal, todayStartIso)) {
                count++;
            } else {
                shouldContinue = false;
                break;
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

    return count;
}

function chooseAssignee(capacityRows, todayCounts) {
    const candidates = capacityRows
        .map(row => {
            const userId = Number(row.pipedrive_user_id);
            const assignedToday = todayCounts[userId] || 0;
            const dailyCapacity = Number(row.daily_capacity);
            const remaining = dailyCapacity - assignedToday;

            return {
                user_id: userId,
                user_name: row.user_name,
                daily_capacity: dailyCapacity,
                assigned_today: assignedToday,
                remaining
            };
        })
        .filter(item => item.remaining > 0)
        .sort((a, b) => {
            if (a.assigned_today !== b.assigned_today) {
                return a.assigned_today - b.assigned_today;
            }

            if (a.remaining !== b.remaining) {
                return b.remaining - a.remaining;
            }

            return a.user_id - b.user_id;
        });

    return candidates[0] || null;
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

	for (const row of capacities) {
		const userId = Number(row.pipedrive_user_id);
		todayCounts[userId] = await countTodayDealsForUser(env, userId, todayStartIso);
	}

	const assignee = chooseAssignee(capacities, todayCounts);

	if (!assignee) {
		return {
			success: true,
			assigned: false,
			message: "All users have reached their daily capacity. Deal was not assigned.",
			today_counts: todayCounts
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
			pipedrive_response: updateResponse
		};
	}

	await logAssignment(env, account.company_id, dealId, assignee, score);

	return {
		success: true,
		assigned: true,
		assigned_user: {
			id: assignee.user_id,
			name: assignee.user_name
		},
		score,
		today_counts: todayCounts,
		pipedrive_response: updateResponse,
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