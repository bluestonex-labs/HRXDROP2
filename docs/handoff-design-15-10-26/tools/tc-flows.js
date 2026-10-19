// Team Calendar against the local in-memory HRX service (made-up @example.test users;
// the test service blocks all email). Checks each action reaches the service.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-tc/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk, detail: sDetail || "" }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath, oInit) => {
	const oResponse = await fetch(SERVICE + sPath, Object.assign({ headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64"), "Content-Type": "application/json" } }, oInit || {}));
	return oResponse.json().catch(() => ({}));
};
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
const blockedEmails = () => (fs.readFileSync(LOG, "utf8").match(/\[email blocked|\[mail dry run\]/g) || []).length;
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const SAM = "sam.evans@example.test", KYLE = "kyle.barnfield@example.test";

async function open(oBrowser, sEmail) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	// The old services.xsodata is not part of the local test service: its metadata
	// failing to load is expected here and left out.
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push(e.message); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail + "&/teamcalendar", { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForFunction(() => document.querySelector(".hrxTcHead"), { timeout: 60000 });
	await sleep(3000);
	return oPage;
}
const state = (oPage) => oPage.evaluate(() => {
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /TeamCalendar/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return {
		manager: m("tcView").isManager, team: m("tcView").team, week: m("tcView").weekLabel,
		rows: m("tl").rows.map((r) => r.Name + "|" + r.dates + "|" + r.status),
		chips: m("tl").chips.map((c) => c.text + " " + c.count),
		people: m("tc").people.map((p) => p.Name + "|" + p.pendingCount + "|" + p.cells.map((c) => c.pills.map((x) => x.text + (x.pending ? "(h)" : "")).join("+")).join(","))
	};
});
const press = (oPage, fnFind) => oPage.evaluate(fnFind);

// The week of 19 October 2026: Kyle asks for Wednesday 21st, and Thursday 22nd -
// Friday 23rd as one request that Sam approves.
async function seed() {
	const sType = (await api(KYLE, "LeaveType?$filter=LeaveCategoryDesc eq 'Holiday'")).value[0].ID;
	const fnDay = (sDate) => ({ LeaveCategoryId_ID: sType, StartDate: sDate, EndDate: sDate, DayTime: "Full Day", NoOfDays: "1", IsPaid: true, ApprovalRequired: true, ApproverID_EmployeeID: "BSX000002", RequesterComments: "Test" });
	await api(KYLE, "createLeaveRequest", { method: "POST", body: JSON.stringify({ userLog: [fnDay("2026-10-21")] }) });
	await api(KYLE, "createLeaveRequest", { method: "POST", body: JSON.stringify({ userLog: [fnDay("2026-10-22"), fnDay("2026-10-23")] }) });
	const aApprove = (await api(SAM, "Leaves?$filter=StartDate ge 2026-10-22 and StartDate le 2026-10-23")).value.map((o) => ({ ID: o.ID, WFFlag: true, ApproverComments: "" }));
	await api(SAM, "actionOnLeave", { method: "POST", body: JSON.stringify({ LeaveLog: aApprove }) });
}

(async () => {
	await seed();
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const oSam = await open(oBrowser, "sam.evans@example.test");
	let s = await state(oSam);
	check("Manager on My team", s.manager && s.team === "mine", s.team);
	check("Team leave: Kyle's pending request", s.rows.length === 1 && /Kyle Barnfield\|21 Oct 2026\|REQ/.test(s.rows[0]), JSON.stringify(s.rows));
	check("Chips: Pending 1, Approved 1", s.chips[0] === "Pending 1" && s.chips[1] === "Approved 1", JSON.stringify(s.chips));
	check("Week label", s.week === "19th - 25th October", s.week);
	const sKyle = s.people.find((p) => p.startsWith("Kyle"));
	check("Grid: Kyle pending hatched Wed, approved Thu and Fri", /,Holiday\(h\),Holiday,Holiday,/.test(sKyle), sKyle);
	check("Grid: only Sam's reports", s.people.length === 3 && !s.people.some((p) => /Alex|Dan/.test(p)), JSON.stringify(s.people.map((p) => p.split("|")[0])));
	await oSam.screenshot({ path: OUT + "f1-manager.png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });

	// Pill -> pop-over -> Approve
	await press(oSam, () => sap.ui.core.Element.registry.filter((o) => o.hasStyleClass && o.hasStyleClass("hrxTcp") && o.getDomRef() && o.getDomRef().getAttribute("data-pending") === "yes")[0].firePress());
	await sleep(1500);
	const sPop = await oSam.evaluate(() => (document.querySelector(".hrxTlPop") || {}).innerText || "");
	check("Pill opens the request", /Kyle Barnfield/.test(sPop) && /21 Oct 2026/.test(sPop) && /APPROVE/i.test(sPop), sPop.replace(/\s+/g, " ").slice(0, 140));
	await oSam.screenshot({ path: OUT + "f2-popover.png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
	const iBlockedBefore = blockedEmails();
	await press(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.hasStyleClass("hrxTcBtnApprove") && o.getDomRef() && o.getDomRef().closest(".hrxTlPop") && o.getDomRef().offsetParent)[0].firePress());
	await sleep(3500);
	const aStatus = (await api("sam.evans@example.test", "Leaves?$filter=StartDate eq 2026-10-21")).value.map((o) => o.Status_ID);
	check("Approve saved in the service", aStatus[0] === "e7ab02da-d0d3-11ee-b96f-325096b39f47", JSON.stringify(aStatus));
	check("Its email was blocked, not sent", blockedEmails() === iBlockedBefore + 1, (blockedEmails() - iBlockedBefore) + " blocked");
	s = await state(oSam);
	check("Chips after approving: Pending 0, Approved 2", s.chips[0] === "Pending 0" && s.chips[1] === "Approved 2", JSON.stringify(s.chips));

	// A new request from Kyle, rejected from the table with a note
	const sType = (await api("kyle.barnfield@example.test", "LeaveType?$filter=LeaveCategoryDesc eq 'Holiday'")).value[0].ID;
	await api("kyle.barnfield@example.test", "createLeaveRequest", { method: "POST", body: JSON.stringify({ userLog: [{ LeaveCategoryId_ID: sType, StartDate: "2026-10-27", EndDate: "2026-10-27", DayTime: "PM", NoOfDays: "0.5", IsPaid: true, ApprovalRequired: true, ApproverID_EmployeeID: "BSX000002", RequesterComments: "Dentist" }] }) });
	await oSam.evaluate(() => { const v = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /TeamCalendar/.test(o.getViewName()))[0]; v.getController().onRefresh(); });
	await sleep(3500);
	s = await state(oSam);
	check("New request appears in Team leave", s.rows.some((r) => /27 Oct 2026\|REQ/.test(r)), JSON.stringify(s.rows));
	await press(oSam, () => { const t = sap.ui.core.Element.registry.filter((o) => o.getId && /teamLeaveTable$/.test(o.getId()))[0]; t.getItems()[0].getCells()[5].getItems()[1].firePress(); });
	await sleep(1200);
	await oSam.screenshot({ path: OUT + "f3-reject-dialog.png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
	await press(oSam, () => {
		const a = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.TextArea") && o.getDomRef() && o.getDomRef().closest(".sapMDialog"))[0]; a.setValue("Short-staffed that afternoon");
		sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getText() === "Reject" && o.getDomRef() && o.getDomRef().closest(".sapMDialog"))[0].firePress();
	});
	await sleep(3500);
	const oRejected = (await api("sam.evans@example.test", "Leaves?$filter=StartDate eq 2026-10-27")).value[0];
	check("Reject saved with the note", oRejected.Status_ID === "e7ab06f4-d0d3-11ee-bc32-325096b39f47" && oRejected.ApproverComments === "Short-staffed that afternoon", oRejected.Status_ID + " / " + oRejected.ApproverComments);

	// Week navigation
	await press(oSam, () => sap.ui.core.Element.registry.filter((o) => o.hasStyleClass && o.hasStyleClass("hrxTcIconBtn"))[1].firePress());
	await sleep(2500);
	s = await state(oSam);
	check("Next week", s.week === "26th October - 1st November", s.week);
	await press(oSam, () => sap.ui.core.Element.registry.filter((o) => o.hasStyleClass && o.hasStyleClass("hrxTcIconBtn"))[0].firePress());
	await sleep(2500);

	// Select resource(s): tick Priya
	await press(oSam, () => sap.ui.core.Element.registry.filter((o) => o.getId && /teamCalResources$/.test(o.getId()))[0].fireValueHelpRequest());
	await sleep(1200);
	await oSam.screenshot({ path: OUT + "f4-resources.png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
	await press(oSam, () => { const c = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.CheckBox") && o.getDomRef() && o.getDomRef().closest(".hrxTcResourcesPop") && /Priya/.test(o.getParent().getDomRef().innerText))[0]; c.setSelected(true); c.fireSelect({ selected: true }); });
	await sleep(800);
	s = await state(oSam);
	const sResourcesText = await oSam.evaluate(() => sap.ui.core.Element.registry.filter((o) => o.getId && /teamCalResources$/.test(o.getId()))[0].getValue());
	check("Ticking Priya shows only Priya", s.people.length === 1 && s.people[0].startsWith("Priya") && sResourcesText === "1 selected", JSON.stringify(s.people.map((p) => p.split("|")[0])) + " / " + sResourcesText);
	await oSam.keyboard.press("Escape");

	// Team: Everyone
	await press(oSam, () => { const t = sap.ui.core.Element.registry.filter((o) => o.getId && /teamCalTeam$/.test(o.getId()))[0]; t.setSelectedKey("all"); t.fireChange({ selectedItem: t.getSelectedItem() }); });
	await sleep(1200);
	s = await state(oSam);
	check("Everyone: the whole organisation", s.people.length === 6, JSON.stringify(s.people.map((p) => p.split("|")[0])));
	check("No app errors (manager)", oSam.errors.length === 0, oSam.errors.join(" | "));

	// Employee
	const oKyle = await open(oBrowser, "kyle.barnfield@example.test");
	s = await state(oKyle);
	const bCard = await oKyle.evaluate(() => sap.ui.core.Element.registry.filter((o) => o.getId && /teamLeaveCard$/.test(o.getId()))[0].getVisible());
	check("Employee: no Team leave card, no Team filter", !s.manager && !bCard, "manager=" + s.manager + " card=" + bCard);
	check("Employee: approved leave shown, nothing hatched", s.people.every((p) => !/\(h\)/.test(p)) && s.people.some((p) => /Holiday,Holiday/.test(p)), JSON.stringify(s.people.filter((p) => /Holiday/.test(p))));
	await oKyle.screenshot({ path: OUT + "f5-employee.png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
	check("No app errors (employee)", oKyle.errors.length === 0, oKyle.errors.join(" | "));
	check("No real email sent during the test", realEmails() === iRealBefore, (realEmails() - iRealBefore) + " real");

	console.log("\n" + results.filter((r) => r.ok).length + "/" + results.length + " passed");
	await oBrowser.close();
})().catch((e) => { console.error(e); process.exit(1); });
