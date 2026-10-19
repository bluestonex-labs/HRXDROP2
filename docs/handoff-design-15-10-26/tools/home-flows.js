// Home against the local in-memory HRX service (made-up @example.test users; the test
// service blocks all email). Kyle requests leave and books time from Quick Leave /
// Quick Timesheet; Sam approves one request and rejects another from Pending approvals.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-home/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
const blockedEmails = () => (fs.readFileSync(LOG, "utf8").match(/\[email blocked/g) || []).length;
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const KYLE = "kyle.barnfield@example.test", SAM = "sam.evans@example.test";

async function open(oBrowser, sEmail) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	// The old services.xsodata (client SLAs, licences...) is not part of the local test
	// service, so its metadata failing to load is expected here and left out.
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ")); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail, { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForFunction(() => document.querySelector(".hrxHomePage"), { timeout: 60000 });
	await sleep(4000);
	return oPage;
}
// Runs fn in the page with byId(suffix) -> the control whose id ends in suffix, and home() -> the Home model's data.
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oHome = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.Home$/.test(o.getViewName()))[0];
	const home = () => oHome.getModel("home").getData();
	return new Function("byId", "home", "oHome", "vArg", "return (" + sFn + ")(vArg)")(byId, home, oHome, vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const iBlockedBefore = blockedEmails();

	// ── Kyle (employee): no manager dashboard; Quick Leave for Mon 26 and Tue 27 Oct ──
	const oKyle = await open(oBrowser, KYLE);
	check("Employee: no manager dashboard", await run(oKyle, () => !document.querySelector("[id$=managerDash]") || !document.querySelector("[id$=managerDash]").offsetParent));
	await run(oKyle, () => byId("qlDates").fireValueHelpRequest());
	await sleep(800);
	check("Dates opens the design's date picker", await run(oKyle, () => !!document.querySelector(".hrxHomeDatePop .hrxHomeDp") && document.querySelector(".hrxHomeDatePop").offsetParent !== null));
	await shot(oKyle, "h1-date-popover");
	const pickDay = (sDay) => run(oKyle, (s) => {
		const oButton = sap.ui.core.Element.registry.filter((o) => o.hasStyleClass && o.hasStyleClass("hrxHomeDpDay") && o.getText() === s && o.getDomRef() && o.getDomRef().getAttribute("data-muted") === "false")[0];
		oButton.firePress();
		return true;
	}, sDay);
	await pickDay("26");
	await sleep(300);
	await pickDay("27");
	await sleep(1200);
	const oForm = await run(oKyle, () => home().quickLeave);
	check("Range picked: 2 days", (oForm.dates || []).length === 2, oForm.rangeText + " / " + JSON.stringify((oForm.dates || []).map((d) => d.date)));
	await run(oKyle, () => { home(); oHome.getModel("home").setProperty("/quickLeave/Comments", "Test leave from home-flows"); });
	await run(oKyle, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest("[id$=quickLeaveCard]") && o.hasStyleClass("hrxHomeFormSubmit"))[0].firePress());
	await sleep(4000);
	const aKyleLeaves = (await api(KYLE, "Leaves?$filter=StartDate ge 2026-10-26 and StartDate le 2026-10-27&$orderby=StartDate")).value || [];
	check("Request leave saved 2 days in the service", aKyleLeaves.length === 2, JSON.stringify(aKyleLeaves.map((o) => o.StartDate + " " + o.DayTime)));
	check("Quick Leave cleared after saving", !(await run(oKyle, () => home().quickLeave.rangeText)));

	// ── Kyle: Quick Timesheet, today, 07:30 on Croda UX Support ──
	const sProject = await run(oKyle, () => {
		const oSelect = byId("qtProject") || sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Select") && o.getDomRef() && o.getDomRef().closest(".hrxHomeCard") && /project/i.test(o.getId()))[0];
		const oItem = oSelect.getItems().filter((o) => /Croda/.test(o.getText()))[0];
		oSelect.setSelectedItem(oItem);
		oSelect.fireChange({ selectedItem: oItem });
		return oItem.getText();
	});
	await run(oKyle, () => { byId("qtHours").setValue("07:30"); byId("qtHours").fireChange({ value: "07:30" }); oHome.getModel("home").setProperty("/quick/comment", "UX review"); });
	await shot(oKyle, "h2-quick-timesheet");
	await run(oKyle, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.hasStyleClass("hrxHomeSaveBtn"))[0].firePress());
	await sleep(4000);
	const aTime = (await api(KYLE, "TimeLog?$filter=Date eq 2026-10-19")).value || [];
	check("Quick Timesheet saved 07:30 on " + sProject, aTime.some((o) => /^07:30/.test(o.Hours)), JSON.stringify(aTime.map((o) => o.Hours + " " + o.Comment)));
	const sStrip = await run(oKyle, () => [...document.querySelectorAll(".hrxHealthStrip .hrxHealthText, .hrxHealthText")].map((e) => e.innerText).join(" | "));
	check("Employee strip: timesheet first, no approvals pill", /^(Timesheet on track|[0-9:]+ hrs still)/.test(sStrip) && !/approval/.test(sStrip), sStrip);
	check("Kyle: no page errors", oKyle.errors.length === 0, oKyle.errors.join(" / "));

	// ── Sam (manager): both days are one pending approval; approve it ──
	const oSam = await open(oBrowser, SAM);
	let aApprovals = await run(oSam, () => home().approvals.map((o) => o.RequesterName + "|" + o.rangeLabel + "|" + o.daysLabel));
	check("Pending approvals: Kyle's request", aApprovals.length === 1 && /Kyle Barnfield/.test(aApprovals[0]), JSON.stringify(aApprovals));
	const sSamStrip = await run(oSam, () => [...document.querySelectorAll(".hrxHealthText")].map((e) => e.innerText).join(" | "));
	check("Manager strip: timesheet, 1 approval pending, leave balance", /approval pending/.test(sSamStrip) && /Leave balance/.test(sSamStrip), sSamStrip);
	await shot(oSam, "h3-manager");
	await run(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest(".hrxHomeApprRow, [class*=Appr]") && /approve/i.test(o.getText()))[0].firePress());
	await sleep(4000);
	const aAfter = ((await api(SAM, "Leaves?$filter=StartDate ge 2026-10-26 and StartDate le 2026-10-27")).value || []).map((o) => o.Status_ID);
	check("Approve saved both days", aAfter.length === 2 && aAfter.every((s) => s === "e7ab02da-d0d3-11ee-b96f-325096b39f47"), JSON.stringify(aAfter));
	aApprovals = await run(oSam, () => home().approvals.length);
	check("Pending approvals empty after approving", aApprovals === 0, String(aApprovals));

	// ── Kyle asks for Wed 28 Oct; Sam rejects it with a note ──
	await oKyle.reload({ waitUntil: "networkidle0" });
	await oKyle.waitForFunction(() => document.querySelector(".hrxHomePage"), { timeout: 60000 });
	await sleep(4000);
	await run(oKyle, () => byId("qlDates").fireValueHelpRequest());
	await sleep(800);
	await pickDay("28");
	await sleep(300);
	await pickDay("28");
	await sleep(1200);
	await run(oKyle, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest("[id$=quickLeaveCard]") && o.hasStyleClass("hrxHomeFormSubmit"))[0].firePress());
	await sleep(4000);
	await run(oSam, () => oHome.getController().onRefresh());
	await sleep(4000);
	await run(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest(".hrxHomeApprRow, [class*=Appr]") && /reject/i.test(o.getText()))[0].firePress());
	await sleep(1200);
	await shot(oSam, "h4-reject-dialog");
	check("Reject opens the design's modal", await run(oSam, () => !!document.querySelector(".sapMDialog.hrxModal")));
	await run(oSam, () => {
		const oDialog = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Dialog") && o.isOpen())[0];
		oDialog.getContent()[0].getItems()[2].setValue("Busy week, sorry");
		oDialog.getBeginButton().firePress();
	});
	await sleep(4000);
	const aRejected = (await api(SAM, "Leaves?$filter=StartDate eq 2026-10-28")).value || [];
	check("Reject saved with the note", aRejected.length === 1 && aRejected[0].Status_ID !== "e7ab02da-d0d3-11ee-b96f-325096b39f47" && /Busy week/.test(aRejected[0].ApproverComments || ""), JSON.stringify(aRejected.map((o) => o.Status_ID + " " + o.ApproverComments)));

	// ── Dashboard links ──
	await run(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest(".hrxHomeTeamCard"))[0].firePress());
	await sleep(3000);
	check("Team today 'Full view' opens Team Calendar", /teamcalendar/.test(await oSam.evaluate(() => location.hash)), await oSam.evaluate(() => location.hash));
	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));

	check("Leave emails were blocked, not sent", blockedEmails() > iBlockedBefore, (blockedEmails() - iBlockedBefore) + " blocked");
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
