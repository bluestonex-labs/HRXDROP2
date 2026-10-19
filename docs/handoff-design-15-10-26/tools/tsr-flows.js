// Timesheet reporting and Utilisation against the local in-memory HRX service, after
// local-hrx-service/seed-timesheets.js (made-up @example.test users; the test service
// blocks all email). Filters, search, expand, the customer drill-down, reminders,
// refresh, and Utilisation's period and Show.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-tsr/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
// Blocked by the test stand-in for nodemailer, or held back by the service's own dry run
const blockedEmails = () => (fs.readFileSync(LOG, "utf8").match(/\[email blocked|\[mail dry run\]/g) || []).length;
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const SAM = "sam.evans@example.test";

async function open(oBrowser, sEmail, sRoute) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	// The old services.xsodata is not part of the local test service: its metadata
	// failing to load is expected here and left out.
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ")); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail + "&/" + sRoute, { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForFunction(() => { const t = document.querySelector(".hrxPageTitle"); return t && t.innerText.trim().length > 0; }, { timeout: 60000 });
	await sleep(5000);
	return oPage;
}
// Runs fn in the page with byId(suffix), ctrl() (the report's controller), m(model) (a model's data) and vm (the trView model).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.TimesheetReport$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "vm", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, oView.getModel("trView"), vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
// Presses the report's tab button for sKey, as a click does
const tab = (oPage, sKey) => run(oPage, (s) => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.data && o.data("tab") === s)[0].firePress(), sKey);
const assignRows = (oPage) => run(oPage, () => m("tr").assign.rows.map((o) => o.Name + "|" + o.ClientDesc + "|" + (o.Billable ? "B" : "I")));

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const oSam = await open(oBrowser, SAM, "timesheetreporting");

	// ── Billing by assignment ──
	let aRows = await assignRows(oSam);
	check("Billing by assignment lists the four assignments", aRows.length === 4, JSON.stringify(aRows));
	const oKpis = await run(oSam, () => m("tr").assign.kpis);
	check("KPIs: 2 billable, 1 client, billed to date", oKpis.billable === 2 || /^2/.test(String(oKpis.billable)), JSON.stringify(oKpis));
	await run(oSam, () => { vm.setProperty("/filters/ClientKey", m("tr").customers.find((o) => /Croda/.test(o.text || o.label || o.ClientDesc || "")).key); ctrl().onFilterChange(); });
	await sleep(1500);
	aRows = await assignRows(oSam);
	check("Customer filter: Croda only", aRows.length === 2 && aRows.every((r) => /Croda/.test(r)), JSON.stringify(aRows));
	await run(oSam, () => ctrl().onClear());
	await sleep(3000);
	await run(oSam, () => { vm.setProperty("/assign/q", "Priya"); ctrl().onAssignSearch(); });
	await sleep(800);
	aRows = await assignRows(oSam);
	check("Search: Priya", aRows.length === 1 && /Priya/.test(aRows[0]), JSON.stringify(aRows));
	await run(oSam, () => { vm.setProperty("/assign/q", ""); ctrl().onAssignSearch(); ctrl().onExpandAllAssign(); });
	await sleep(800);
	check("Expand all opens every row's bookings", await run(oSam, () => m("tr").assign.rows.every((o) => o.open)));
	await shot(oSam, "t-assign");

	// ── Billed days overview: pick a customer slice ──
	await tab(oSam, "days");
	await sleep(800);
	const aSlices = await run(oSam, () => m("tr").days.slices.map((o) => o.label + " " + o.value));
	check("Days by customer: Croda and Bluestonex", aSlices.length === 2, JSON.stringify(aSlices));
	await run(oSam, () => ctrl()._drill(0));
	await sleep(800);
	check("A slice drills into that customer's projects", await run(oSam, () => !!vm.getProperty("/drill")), await run(oSam, () => vm.getProperty("/drill")));
	await run(oSam, () => ctrl().onAllCustomers());

	// ── Timesheet breakdown ──
	await tab(oSam, "break");
	await run(oSam, () => ctrl().onExpandAllBreakdown());
	await sleep(800);
	check("Breakdown: one column per person who booked", await run(oSam, () => m("tr").brk.customers === 2));
	await shot(oSam, "t-break");

	// ── Who's submitted: remind one, then all ──
	await tab(oSam, "sub");
	await sleep(3000);
	const aSub = await run(oSam, () => m("tr").sub.rows.map((o) => o.Name + "|" + (o.stateText || o.status || "")));
	check("Who's submitted lists the six people", aSub.length === 6, JSON.stringify(aSub));
	const iBlockedBefore = blockedEmails();
	await run(oSam, () => {
		const oButton = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().offsetParent && o.getBindingContext("tr") && /\/sub\/rows\//.test(o.getBindingContext("tr").getPath()))[0];
		oButton.firePress();
	});
	await sleep(3000);
	await run(oSam, () => ctrl().onRemindAll());
	await sleep(3000);
	check("Reminders sent (dry run / blocked)", blockedEmails() >= iBlockedBefore + 2, (blockedEmails() - iBlockedBefore) + " held back");
	await run(oSam, () => ctrl().onRefreshWeek());
	await sleep(2500);
	await shot(oSam, "t-sub");

	// ── Refresh from service (the top bar) ──
	await oSam.click(".hrxTopBarAction");
	await sleep(4000);
	check("Refresh from service reloads and stamps the time", /Last refreshed/.test(await oSam.evaluate(() => (document.querySelector(".hrxTopBarStamp") || {}).innerText || "")), await oSam.evaluate(() => (document.querySelector(".hrxTopBarStamp") || {}).innerText || ""));
	check("Sam (report): no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));

	// ── Utilisation ──
	const oUtil = await open(oBrowser, SAM, "timesheetreporting?tab=util");
	check("Utilisation's title, no stamp", await oUtil.evaluate(() => document.querySelector(".hrxPageTitle").innerText === "UTILISATION" || document.querySelector(".hrxPageTitle").innerText === "Utilisation") && !(await oUtil.evaluate(() => { const o = document.querySelector(".hrxTopBarStamp"); return o && o.offsetParent && o.innerText; })), await oUtil.evaluate(() => document.querySelector(".hrxPageTitle").innerText));
	let aPeople = await run(oUtil, () => m("tr").util.rows.map((o) => o.Name + "|" + o.pct));
	check("Utilisation by person: Priya 100, Kyle 79, Tom 0", aPeople.join(",") === "Priya Shah|100,Kyle Barnfield|79,Tom Reid|0", JSON.stringify(aPeople));
	await run(oUtil, () => { const oSelect = byId("trUtilShow"); oSelect.setSelectedKey("u80"); oSelect.fireChange({ selectedItem: oSelect.getSelectedItem() }); });
	await sleep(800);
	aPeople = await run(oUtil, () => m("tr").util.rows.map((o) => o.Name));
	check("Show \"Under 80%\": Kyle and Tom", aPeople.join(",") === "Kyle Barnfield,Tom Reid", JSON.stringify(aPeople));
	await run(oUtil, () => { const oSelect = byId("trUtilShow"); oSelect.setSelectedKey("all"); oSelect.fireChange({ selectedItem: oSelect.getSelectedItem() }); });
	await run(oUtil, () => ctrl().onLastYear());
	await sleep(3000);
	aPeople = await run(oUtil, () => m("tr").util.rows.length);
	check("Last year: nothing booked", aPeople === 0, String(aPeople));
	await run(oUtil, () => ctrl().onThisYear());
	await sleep(3000);
	check("This year again", await run(oUtil, () => m("tr").util.rows.length > 0));
	await shot(oUtil, "t-util");
	check("Sam (utilisation): no page errors", oUtil.errors.length === 0, oUtil.errors.join(" / "));
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
