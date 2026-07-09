async function getBitcoinPrice() {
	const response = await fetch(
		"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true",
		{
			method: "GET",
			headers: {
				"Accept": "application/json",
				"User-Agent": "pipedrive-smart-assignment-app"
			}
		}
	);

	const text = await response.text();

	console.log("CoinGecko status:", response.status);
	console.log("CoinGecko response:", text);


	let data;

	try {
		data = JSON.parse(text);
	}
	catch(error) {
		throw new Error(
			"Invalid JSON from CoinGecko: " + text.substring(0,200)
		);
	}


	if (!response.ok) {
		throw new Error(
			"CoinGecko HTTP " +
			response.status +
			": " +
			text.substring(0,200)
		);
	}


	if (!data.bitcoin) {
		throw new Error(
			"Bitcoin data missing: " +
			JSON.stringify(data).substring(0,200)
		);
	}


	return {
		usd: data.bitcoin.usd,
		change24h: data.bitcoin.usd_24h_change,
		lastUpdatedAt: data.bitcoin.last_updated_at
	};
}

function formatUsd(value) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0
	}).format(Number(value || 0));
}

function formatPercent(value) {
	const number = Number(value || 0);

	return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatDateTimeFromUnix(timestamp) {
	if (!timestamp) {
		return "Unknown";
	}

	return new Date(Number(timestamp) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export async function getBitcoinJsonPanel() {
	try {
		const price = await getBitcoinPrice();

		return Response.json({
			data: [
				{
					id: "bitcoin-price",
					title: "Bitcoin price",
					subtitle: "Live BTC/USD market price",
					fields: [
						{
							key: "price",
							label: "BTC/USD",
							value: formatUsd(price.usd)
						},
						{
							key: "change_24h",
							label: "24h change",
							value: formatPercent(price.change24h)
						},
						{
							key: "last_updated",
							label: "Last updated",
							value: formatDateTimeFromUnix(price.lastUpdatedAt)
						}
					]
				}
			]
		});
	} catch (error) {
		return Response.json({
			data: [
				{
					id: "bitcoin-price-error",
					title: "Bitcoin price",
					subtitle: "Could not load price",
					fields: [
						{
							key: "error",
							label: "Error",
							value: error.message
						}
					]
				}
			]
		});
	}
}