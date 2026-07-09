import {
	assignDealCore
} from "./assignment.js";

function getFirstValue(value) {
	if (Array.isArray(value)) {
		return value[0];
	}

	if (value && typeof value === "object" && "value" in value) {
		return value.value;
	}

	return value;
}

function getBlockValue(body, key) {
	const blocks =
		body &&
		body.data &&
		body.data.blocks
			? body.data.blocks
			: body.blocks || {};

	const block = blocks[key];

	if (!block) {
		return null;
	}

	return getFirstValue(block.value);
}

function calculateLeadScore({ urgency, budget, decisionMaker }) {
	let score = 0;

	if (urgency === "cold") score += 10;
	if (urgency === "warm") score += 30;
	if (urgency === "hot") score += 50;

	if (budget === "no") score += 0;
	if (budget === "partial") score += 15;
	if (budget === "yes") score += 30;

	if (decisionMaker === "no") score += 0;
	if (decisionMaker === "influencer") score += 10;
	if (decisionMaker === "yes") score += 20;

	return score;
}

function getDealIdFromRequest(request, body) {
	const url = new URL(request.url);

	const fromQuery =
		url.searchParams.get("deal_id") ||
		url.searchParams.get("dealId") ||
		url.searchParams.get("selectedIds");

	if (fromQuery) {
		const first = String(fromQuery).split(",")[0];
		return Number(first);
	}

	if (body && body.deal_id) {
		return Number(body.deal_id);
	}

	if (body && body.selectedIds) {
		const first = Array.isArray(body.selectedIds)
			? body.selectedIds[0]
			: String(body.selectedIds).split(",")[0];

		return Number(first);
	}

	return null;
}

function jsonModalInitialData() {
	return Response.json({
		data: {
			blocks: {
				block_need_urgency: {
					value: "warm"
				},
				block_budget: {
					value: "partial"
				},
				block_decision_maker: {
					value: "influencer"
				},
				block_note: {
					value: ""
				}
			}
		}
	});
}

function jsonModalSuccessMessage(assignResult, score) {
	if (!assignResult.assigned) {
		return Response.json({
			error: {
				message: assignResult.message || "Deal was not assigned."
			}
		});
	}

	return Response.json({
		success: {
			type: "snackbar",
			message: `Lead score ${score}. Deal assigned to ${assignResult.assigned_user.name}.`
		}
	});
}

export async function handleJsonLeadScoringModal(request, env) {
	if (request.method === "GET") {
		return jsonModalInitialData();
	}

	if (request.method !== "POST") {
		return Response.json(
			{
				error: {
					message: "Method not allowed."
				}
			},
			{ status: 405 }
		);
	}

	const body = await request.json();

	const dealId = getDealIdFromRequest(request, body);

	if (!dealId) {
		return Response.json({
			error: {
				message: "Deal ID was not received from Pipedrive. Open this action from a deal detail page."
			}
		});
	}

	const urgency = getBlockValue(body, "block_need_urgency");
	const budget = getBlockValue(body, "block_budget");
	const decisionMaker = getBlockValue(body, "block_decision_maker");

	const score = calculateLeadScore({
		urgency,
		budget,
		decisionMaker
	});

	const assignResult = await assignDealCore({
		env,
		dealId,
		score
	});

	return jsonModalSuccessMessage(assignResult, score);
}

export async function getCustomLeadScoringPage(request) {
	const url = new URL(request.url);

	const rawDealId =
		url.searchParams.get("deal_id") ||
		url.searchParams.get("dealId") ||
		url.searchParams.get("selectedIds") ||
		"";

	const dealId = String(rawDealId).split(",")[0];

	const html = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Lead scoring</title>

	<script src="https://cdn.jsdelivr.net/npm/@pipedrive/app-extensions-sdk@0/dist/index.umd.js"></script>
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
			margin: 0 0 8px;
		}

		.description {
			color: #5f6b7a;
			line-height: 1.5;
			margin-bottom: 20px;
		}

		.debug {
			font-size: 12px;
			color: #6b7280;
			background: #f8fafc;
			border: 1px solid #e5e7eb;
			border-radius: 6px;
			padding: 8px;
			margin-bottom: 16px;
			word-break: break-all;
		}

		.field {
			margin-bottom: 16px;
		}

		label {
			display: block;
			font-weight: 600;
			margin-bottom: 6px;
		}

		select, textarea {
			width: 100%;
			box-sizing: border-box;
			padding: 9px;
			border: 1px solid #c8cdd4;
			border-radius: 6px;
			font-size: 14px;
		}

		textarea {
			min-height: 80px;
		}

		.scoreBox {
			background: #f4f7fb;
			border: 1px solid #e1e7f0;
			border-radius: 8px;
			padding: 12px;
			margin-bottom: 16px;
		}

		button {
			border: 0;
			border-radius: 6px;
			padding: 10px 14px;
			background: #317ae2;
			color: white;
			cursor: pointer;
			font-size: 14px;
		}

		button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}

		.status {
			margin-top: 12px;
			font-size: 14px;
		}

		.success {
			color: #0b7a3b;
		}

		.error {
			color: #c03535;
		}
	</style>
</head>
<body>
	<h1>Lead scoring - Custom modal</h1>

	<div class="description">
		This is a custom iframe modal. The button inside this iframe calls our Worker API.
		The Worker then updates the deal owner in Pipedrive.
	</div>

	<div class="debug">
		Deal ID: <strong id="debugDealId">${dealId || "not received"}</strong>
	</div>

	<input type="hidden" id="dealId" value="${dealId}">

	<div class="field">
		<label>Need urgency</label>
		<select id="urgency">
			<option value="cold">Cold - no clear timeline</option>
			<option value="warm" selected>Warm - may buy this month</option>
			<option value="hot">Hot - wants to buy now</option>
		</select>
	</div>

	<div class="field">
		<label>Budget</label>
		<select id="budget">
			<option value="no">No / unknown</option>
			<option value="partial" selected>Partially clear</option>
			<option value="yes">Yes, confirmed</option>
		</select>
	</div>

	<div class="field">
		<label>Decision maker</label>
		<select id="decisionMaker">
			<option value="no">No</option>
			<option value="influencer" selected>Influencer</option>
			<option value="yes">Decision maker</option>
		</select>
	</div>

	<div class="field">
		<label>Qualification note</label>
		<textarea id="note" placeholder="Optional note"></textarea>
	</div>

	<div class="scoreBox">
		Calculated score: <strong id="score">55</strong>
	</div>

	<button id="assignButton">Score and assign deal</button>

	<div id="status" class="status"></div>

	<script>
		let sdk = null;
		let Command = null;

		async function initSdk() {
			try {
				const params = new URLSearchParams(window.location.search);
				const id = params.get("id");

				if (!window.AppExtensionsSDK) {
					throw new Error("AppExtensionsSDK was not loaded.");
				}

				if (id) {
					sdk = await new window.AppExtensionsSDK({
						identifier: id
					}).initialize({
						size: {
							width: 600,
							height: 650
						}
					});
				} else {
					sdk = await new window.AppExtensionsSDK().initialize({
						size: {
							width: 600,
							height: 650
						}
					});
				}

				Command = window.AppExtensionsSDK.Command;

				console.log("Pipedrive SDK initialized");
			} catch (error) {
				console.error("SDK init failed", error);
			}
		}

		const sdkReady = initSdk();

		function calculateScore() {
			let score = 0;

			const urgency = $("#urgency").val();
			const budget = $("#budget").val();
			const decisionMaker = $("#decisionMaker").val();

			if (urgency === "cold") score += 10;
			if (urgency === "warm") score += 30;
			if (urgency === "hot") score += 50;

			if (budget === "no") score += 0;
			if (budget === "partial") score += 15;
			if (budget === "yes") score += 30;

			if (decisionMaker === "no") score += 0;
			if (decisionMaker === "influencer") score += 10;
			if (decisionMaker === "yes") score += 20;

			$("#score").text(score);

			return score;
		}

		function setStatus(message, type) {
			$("#status")
				.removeClass("success error")
				.addClass(type || "")
				.text(message || "");
		}

		$(document).on("change", "select", calculateScore);

		$(document).on("click", "#assignButton", async function () {
			const dealId = Number($("#dealId").val());
			const score = calculateScore();

			if (!dealId) {
				setStatus("Deal ID was not received. Open this modal from a deal page.", "error");
				return;
			}

			$("#assignButton").prop("disabled", true);
			setStatus("Assigning deal...", "");

			try {
				await sdkReady;

				const response = await fetch("/api/assign", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						deal_id: dealId,
						score
					})
				});

				const data = await response.json();

				if (!response.ok || !data.success || !data.assigned) {
					throw new Error(data.message || data.error || "Deal was not assigned.");
				}

setStatus("Assigned to " + data.assigned_user.name + ". Closing modal...", "success");

if (sdk && Command) {
	try {
		await sdk.execute(Command.SHOW_SNACKBAR, {
			message: "Deal assigned by Smart Assignment App to " + data.assigned_user.name + "."
		});
	} catch (error) {
		console.log("Snackbar failed", error);
	}

	setTimeout(async function () {
		try {
			await sdk.execute(Command.CLOSE_MODAL);
		} catch (error) {
			console.log("Close modal failed", error);
		}
	}, 1800);
}


			} catch (error) {
				setStatus(error.message, "error");
			} finally {
				$("#assignButton").prop("disabled", false);
			}
		});

		$(function () {
			calculateScore();
		});
	</script>
</body>
</html>`;

	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store"
		}
	});
}