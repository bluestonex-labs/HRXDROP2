// My Leave against the local in-memory HRX service (made-up @example.test users; the
// test service blocks all email). Kyle books a two-day request and a half day, edits
// the half day, filters the table and cancels the two days.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-leave/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const KYLE = "kyle.barnfield@example.test";

async function open(oBrowser, sEmail) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	// The old services.xsodata is not part of the local test service: its metadata
	// failing to load is expected here and left out.
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ")); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail + "&/leave", { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForFunction(() => document.querySelector(".hrxMyLeave .hrxLeaveTable"), { timeout: 60000 });
	await sleep(4000);
	return oPage;
}
// Runs fn in the page with byId(suffix), ctrl() (the Leave controller) and m(name) (a view model's data).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.Leave$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
const rows = (oPage) => run(oPage, () => m("ml").leaves.map((o) => o.DisplayRange + "|" + o.LeaveType + "|" + o.DurationText + "|" + o.Status + "|" + (o.cancellable ? "cancel" : "")));

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const oKyle = await open(oBrowser, KYLE);
	check("Page loads with Kyle's quota", await run(oKyle, () => m("mlView").kpis.quota === "25"), await run(oKyle, () => JSON.stringify(m("mlView").kpis)));

	// ── A two-day request: Mon 2 – Tue 3 Nov, full days ──
	await run(oKyle, () => byId("leaveDatesInput").fireValueHelpRequest());
	await sleep(900);
	check("Dates opens the design's date picker", await run(oKyle, () => !!document.querySelector(".hrxMyLeavePicker .hrxLeavePicker")));
	const pick = (sLabel) => run(oKyle, (s) => {
		const oButton = byId("leavePickerGrid").getItems().filter((o) => o.getText() === s && o.getEnabled() && !/muted/.test(o.getDomRef().getAttribute("data-cell") || ""))[0];
		oButton.firePress();
		return true;
	}, sLabel);
	await run(oKyle, () => ctrl().onPickerNext());
	await sleep(400);
	await pick("2");
	await sleep(300);
	await shot(oKyle, "l1-picker");
	await pick("3");
	await sleep(1500);
	check("Range picked: 2 days", await run(oKyle, () => m("mlForm").NoOfDays === 2), await run(oKyle, () => m("mlForm").NoOfDays + " / " + byId("leaveDatesInput").getValue()));
	await run(oKyle, () => byId("leaveSubmit").firePress());
	await sleep(4000);
	const aTwo = ((await api(KYLE, "Leaves?$filter=StartDate ge 2026-11-02 and StartDate le 2026-11-03")).value || []);
	check("Two days saved, one request (shared LeaveGrpID)", aTwo.length === 2 && aTwo[0].LeaveGrpID && aTwo[0].LeaveGrpID === aTwo[1].LeaveGrpID, JSON.stringify(aTwo.map((o) => o.StartDate + " " + o.LeaveGrpID)));
	let aRows = await rows(oKyle);
	check("Table: one row \"2 – 3 Nov 2026\", Requested, with Cancel", aRows.some((r) => /^2 – 3 Nov 2026\|Holiday\|Full day\|Requested\|cancel$/.test(r)), JSON.stringify(aRows));
	await shot(oKyle, "l2-requested");

	// ── A half day: Thu 5 Nov, morning ──
	await run(oKyle, () => byId("leaveDatesInput").fireValueHelpRequest());
	await sleep(900);
	await run(oKyle, () => ctrl().onPickerNext());
	await sleep(400);
	await pick("5");
	await sleep(300);
	await pick("5");
	await sleep(1500);
	await run(oKyle, () => {
		const oSelect = byId("leaveDuration");
		const oItem = oSelect.getItems().filter((o) => o.getKey() === "A")[0];
		oSelect.setSelectedItem(oItem);
		oSelect.fireChange({ selectedItem: oItem });
	});
	await sleep(500);
	check("Half day — AM counts 0.5", await run(oKyle, () => m("mlForm").NoOfDays === 0.5), String(await run(oKyle, () => m("mlForm").NoOfDays)));
	await run(oKyle, () => byId("leaveSubmit").firePress());
	await sleep(4000);
	const aHalf = ((await api(KYLE, "Leaves?$filter=StartDate eq 2026-11-05")).value || []);
	check("Half day saved as AM", aHalf.length === 1 && aHalf[0].DayTime === "AM", JSON.stringify(aHalf.map((o) => o.DayTime)));

	// ── Edit the half day: afternoon instead ──
	await run(oKyle, () => {
		const oItem = byId("myLeaveTable").getItems().filter((o) => /5 Nov 2026/.test(o.getBindingContext("ml").getProperty("DisplayRange")))[0];
		oItem.firePress();
	});
	await sleep(1200);
	await shot(oKyle, "l3-edit");
	check("Row opens the edit modal", await run(oKyle, () => !!document.querySelector(".sapMDialog.hrxModal") && /5 Nov 2026/.test(document.querySelector(".sapMDialog.hrxModal").innerText)));
	await run(oKyle, () => {
		const oSelect = byId("editLeaveAbsence");
		oSelect.setSelectedKey("PM");
		oSelect.fireChange({ selectedItem: oSelect.getSelectedItem() });
		byId("editLeaveSave").firePress();
	});
	await sleep(4000);
	const aEdited = ((await api(KYLE, "Leaves?$filter=StartDate eq 2026-11-05")).value || []);
	check("Edit saved: PM", aEdited.length === 1 && aEdited[0].DayTime === "PM", JSON.stringify(aEdited.map((o) => o.DayTime)));

	// ── Filter ──
	await run(oKyle, () => { const o = byId("leaveStatusFilter"); o.setSelectedKey("Approved"); o.fireSelectionChange({ item: o.getItems()[2] }); });
	await sleep(500);
	check("Filter Approved: nothing", (await rows(oKyle)).length === 0, JSON.stringify(await rows(oKyle)));
	await run(oKyle, () => { const o = byId("leaveStatusFilter"); o.setSelectedKey("Requested"); o.fireSelectionChange({ item: o.getItems()[1] }); });
	await sleep(500);
	check("Filter Requested: both requests", (await rows(oKyle)).length === 2, JSON.stringify(await rows(oKyle)));

	// ── Cancel the two days ──
	await run(oKyle, () => {
		const oItem = byId("myLeaveTable").getItems().filter((o) => /2 – 3 Nov/.test(o.getBindingContext("ml").getProperty("DisplayRange")))[0];
		oItem.getCells()[3].firePress();
	});
	await sleep(1200);
	await shot(oKyle, "l4-cancel");
	check("Cancel asks first", await run(oKyle, () => /2 – 3 Nov 2026/.test((document.querySelector(".sapMDialog.hrxModal") || {}).innerText || "")));
	await run(oKyle, () => byId("cancelLeaveConfirm").firePress());
	await sleep(4000);
	const aGone = ((await api(KYLE, "Leaves?$filter=StartDate ge 2026-11-02 and StartDate le 2026-11-03")).value || []);
	check("Cancel removed both days", aGone.length === 0, String(aGone.length));
	aRows = await rows(oKyle);
	check("Table: only the half day left", aRows.length === 1 && /5 Nov 2026/.test(aRows[0]), JSON.stringify(aRows));

	check("Kyle: no page errors", oKyle.errors.length === 0, oKyle.errors.join(" / "));
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
