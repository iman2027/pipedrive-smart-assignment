import {
	getPipedriveUsers
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

function normalizeUsers(pipedriveResponse) {
	const users = Array.isArray(pipedriveResponse.data)
		? pipedriveResponse.data
		: [];

	return users
		.filter(user => user.active_flag !== false)
		.map(user => ({
			id: user.id,
			name: user.name || user.email || `User ${user.id}`,
			email: user.email || null
		}));
}

export async function getSettingsPage() {
	const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Smart Assignment Settings</title>

	<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>

	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 24px;
			color: #17233c;
			background: #ffffff;
		}

		h1 {
			font-size: 20px;
			margin-bottom: 8px;
		}

		.description {
			color: #5f6b7a;
			margin-bottom: 24px;
			line-height: 1.5;
		}

		table {
			width: 100%;
			border-collapse: collapse;
			margin-bottom: 16px;
		}

		th, td {
			text-align: left;
			border-bottom: 1px solid #e6e8ec;
			padding: 10px;
		}

		th {
			font-size: 13px;
			color: #5f6b7a;
			font-weight: 600;
		}

		select, input {
			width: 100%;
			box-sizing: border-box;
			padding: 8px;
			border: 1px solid #c8cdd4;
			border-radius: 6px;
			font-size: 14px;
		}

		.actions {
			display: flex;
			gap: 8px;
			align-items: center;
		}

		button {
			border: 0;
			border-radius: 6px;
			padding: 9px 14px;
			cursor: pointer;
			font-size: 14px;
		}

		.primary {
			background: #317ae2;
			color: white;
		}

		.secondary {
			background: #eef2f7;
			color: #17233c;
		}

		.danger {
			background: #fff0f0;
			color: #c03535;
		}

		.status {
			margin-top: 12px;
			font-size: 14px;
		}

		.status.success {
			color: #0b7a3b;
		}

		.status.error {
			color: #c03535;
		}
	</style>
</head>
<body>

	<h1>Smart Assignment Settings</h1>

	<div class="description">
		Set daily deal assignment capacity for Pipedrive users.
		The app will assign new deals only to users who still have remaining capacity today.
	</div>

	<table>
		<thead>
			<tr>
				<th style="width: 55%">User</th>
				<th style="width: 25%">Daily capacity</th>
				<th style="width: 20%">Action</th>
			</tr>
		</thead>
		<tbody id="capacityRows"></tbody>
	</table>

	<div class="actions">
		<button class="secondary" id="addRow">+ Add user</button>
		<button class="primary" id="saveSettings">Save settings</button>
	</div>

	<div id="status" class="status"></div>

	<script>
		let users = [];
		let capacities = [];

		function setStatus(message, type) {
			$("#status")
				.removeClass("success error")
				.addClass(type || "")
				.text(message || "");
		}

		function buildUserOptions(selectedUserId) {
			const selected = String(selectedUserId || "");

			return [
				'<option value="">Select user</option>',
				...users.map(user => {
					const isSelected = String(user.id) === selected ? "selected" : "";
					const label = user.email ? user.name + " (" + user.email + ")" : user.name;

					return '<option value="' + user.id + '" ' + isSelected + '>' + escapeHtml(label) + '</option>';
				})
			].join("");
		}

		function escapeHtml(value) {
			return String(value)
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll('"', "&quot;")
				.replaceAll("'", "&#039;");
		}

		function renderRows() {
			const rows = capacities.map(item => {
				return \`
					<tr>
						<td>
							<select class="userSelect">
								\${buildUserOptions(item.pipedrive_user_id)}
							</select>
						</td>
						<td>
							<input class="capacityInput" type="number" min="0" step="1" value="\${item.daily_capacity || 0}">
						</td>
						<td>
							<button class="danger deleteRow">Delete</button>
						</td>
					</tr>
				\`;
			});

			$("#capacityRows").html(rows.join(""));
		}

		async function loadData() {
			setStatus("Loading settings...", "");

			const [usersResponse, capacitiesResponse] = await Promise.all([
				fetch("/api/users"),
				fetch("/api/capacities")
			]);

			const usersData = await usersResponse.json();
			const capacitiesData = await capacitiesResponse.json();

			if (!usersResponse.ok || !usersData.success) {
				throw new Error("Could not load Pipedrive users.");
			}

			if (!capacitiesResponse.ok || !capacitiesData.success) {
				throw new Error("Could not load capacities.");
			}

			users = usersData.data
				.filter(user => user.active_flag !== false)
				.map(user => ({
					id: user.id,
					name: user.name || user.email || "User " + user.id,
					email: user.email || null
				}));

			capacities = capacitiesData.data || [];

			if (capacities.length === 0) {
				capacities.push({
					pipedrive_user_id: "",
					daily_capacity: 10
				});
			}

			renderRows();
			setStatus("", "");
		}

		function collectRows() {
			const result = [];

			$("#capacityRows tr").each(function () {
				const userId = Number($(this).find(".userSelect").val());
				const dailyCapacity = Number($(this).find(".capacityInput").val());

				if (!userId) {
					return;
				}

				if (Number.isNaN(dailyCapacity) || dailyCapacity < 0) {
					throw new Error("Daily capacity must be zero or greater.");
				}

				const user = users.find(item => Number(item.id) === userId);

				result.push({
					pipedrive_user_id: userId,
					user_name: user ? user.name : "",
					daily_capacity: dailyCapacity
				});
			});

			const ids = result.map(item => item.pipedrive_user_id);
			const uniqueIds = new Set(ids);

			if (ids.length !== uniqueIds.size) {
				throw new Error("Each user can only be selected once.");
			}

			return result;
		}

		$(document).on("click", "#addRow", function () {
			capacities.push({
				pipedrive_user_id: "",
				daily_capacity: 10
			});

			renderRows();
		});

		$(document).on("click", ".deleteRow", function () {
			const index = $(this).closest("tr").index();
			capacities.splice(index, 1);
			renderRows();
		});

		$(document).on("click", "#saveSettings", async function () {
			try {
				setStatus("Saving...", "");

				const rows = collectRows();

				const response = await fetch("/api/capacities", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						items: rows
					})
				});

				const data = await response.json();

				if (!response.ok || !data.success) {
					throw new Error(data.message || "Could not save settings.");
				}

				capacities = data.data;
				renderRows();

				setStatus("Settings saved successfully.", "success");
			} catch (error) {
				setStatus(error.message, "error");
			}
		});

		loadData().catch(error => {
			setStatus(error.message, "error");
		});
	</script>

</body>
</html>`;

	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8"
		}
	});
}

export async function getCapacities(env) {
	const account = await getInstalledAccount(env);

	const rows = await env.DB.prepare(`
		SELECT
			pipedrive_user_id,
			user_name,
			daily_capacity
		FROM user_capacities
		WHERE company_id = ?
		AND active = 1
		ORDER BY sort_order ASC, user_name ASC
		`)
		.bind(account.company_id)
		.all();

	return Response.json({
		success: true,
		data: rows.results || []
	});
}

export async function saveCapacities(request, env) {
	const account = await getInstalledAccount(env);
	const body = await request.json();

	const items = Array.isArray(body.items)
		? body.items
		: [];

	const seen = new Set();

	for (const item of items) {
		const userId = Number(item.pipedrive_user_id);
		const capacity = Number(item.daily_capacity);

		if (!userId) {
			return Response.json(
				{
					success: false,
					message: "Invalid user selected."
				},
				{ status: 400 }
			);
		}

		if (seen.has(userId)) {
			return Response.json(
				{
					success: false,
					message: "Duplicate user selected."
				},
				{ status: 400 }
			);
		}

		if (!Number.isInteger(capacity) || capacity < 0) {
			return Response.json(
				{
					success: false,
					message: "Daily capacity must be zero or greater."
				},
				{ status: 400 }
			);
		}

		seen.add(userId);
	}

	await env.DB.prepare(`
		UPDATE user_capacities
		SET active = 0,
			updated_at = CURRENT_TIMESTAMP
		WHERE company_id = ?
	`)
		.bind(account.company_id)
		.run();

	for (let index = 0; index < items.length; index++) {
		const item = items[index];

		await env.DB.prepare(`
		INSERT INTO user_capacities (
			company_id,
			pipedrive_user_id,
			user_name,
			daily_capacity,
			sort_order,
			active,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT(company_id, pipedrive_user_id)
		DO UPDATE SET
			user_name = excluded.user_name,
			daily_capacity = excluded.daily_capacity,
			sort_order = excluded.sort_order,
			active = 1,
			updated_at = CURRENT_TIMESTAMP
	`)
			.bind(
				account.company_id,
				Number(item.pipedrive_user_id),
				item.user_name || "",
				Number(item.daily_capacity),
				index
			)
			.run();
	}

	const rows = await env.DB.prepare(`
		SELECT
			pipedrive_user_id,
			user_name,
			daily_capacity
		FROM user_capacities
		WHERE company_id = ?
		AND active = 1
		ORDER BY sort_order ASC, user_name ASC
	`)
		.bind(account.company_id)
		.all();

	return Response.json({
		success: true,
		data: rows.results || []
	});
}