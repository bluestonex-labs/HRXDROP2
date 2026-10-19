// Sickness against the local in-memory HRX service (made-up @example.test users; the
// test service blocks all email). Sam records three absences for Kyle from the top-bar
// "Record sickness"; the third raises the policy trigger. Sam sends a follow-up, marks
// a return-to-work step done and dismisses the trigger with a reason.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-sickness/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
// Blocked by the test stand-in for nodemailer, or held back by the service's own dry run
const blockedEmails = () => (fs.readFileSync(LOG, "utf8").match(/\[email blocked|\[mail dry run\]/g) || []).length;
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const KYLE = "kyle.barnfield@example.test", SAM = "sam.evans@example.test";

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
	await sleep(4000);
	return oPage;
}
// Runs fn in the page with byId(suffix), ctrl() (the Sickness controller) and m(model) (a view model's data).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.Sickness$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	const button = (sClassOrText, sWithin) => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().offsetParent && (!sWithin || o.getDomRef().closest(sWithin)) && (o.hasStyleClass(sClassOrText) || new RegExp(sClassOrText, "i").test(o.getText())))[0];
	return new Function("byId", "ctrl", "m", "button", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, button, vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });

async function record(oSam, sFrom, sTo, sReason) {
	await oSam.click(".hrxTopBarAction");
	await sleep(1500);
	await run(oSam, (a) => {
		byId("skEmployee").setSelectedKey("BSX000003");
		byId("skDates").setDateValue(new Date(a[0] + "T00:00:00"));
		byId("skDates").setSecondDateValue(new Date(a[1] + "T00:00:00"));
		byId("skReason").setValue(a[2]);
		ctrl().getView().getModel("skForm").setProperty("/Reason", a[2]);
		ctrl().onRecordInput();
	}, [sFrom, sTo, sReason]);
	await sleep(400);
	await shot(oSam, "s-record-" + sFrom);
	await run(oSam, () => byId("recordSicknessDialog").getBeginButton().firePress());
	await sleep(4000);
}

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const oSam = await open(oBrowser, SAM, "sickness");
	check("Record sickness is the top bar's, not the page's", await run(oSam, () => /record sickness/i.test(document.querySelector(".hrxTopBarAction").innerText) && !document.querySelector(".hrxSick .hrxTopBarAction, [class*=hrxSickRecordBtn]")));

	// ── Three absences in six months ──
	await record(oSam, "2026-06-08", "2026-06-09", "Flu");
	await record(oSam, "2026-07-14", "2026-07-14", "Migraine");
	await record(oSam, "2026-09-21", "2026-09-22", "Back pain");
	const aSick = ((await api(SAM, "Leaves?$filter=EmpID_EmployeeID eq 'BSX000003'")).value || []);
	const iGroups = new Set(aSick.map((o) => o.LeaveGrpID)).size;
	check("Three absences saved as sick leave", iGroups === 3, aSick.length + " days in " + iGroups + " absences");
	let aTriggers = await run(oSam, () => m("sk").triggers.map((o) => o.Name + "|" + o.status + "|" + o.absences.length));
	check("The third raises Kyle's policy trigger", aTriggers.length === 1 && /Kyle Barnfield\|OPEN\|3/.test(aTriggers[0]), JSON.stringify(aTriggers));
	const aRtw = await run(oSam, () => m("sk").rtw.map((o) => o.Name + "|" + o.steps.length));
	check("A return to work is in progress", aRtw.length >= 1, JSON.stringify(aRtw));
	check("Alert: 1 policy trigger", /1 policy trigger/i.test(await run(oSam, () => m("skView").alert.text)), await run(oSam, () => m("skView").alert.text));
	await shot(oSam, "s-trigger");
	// STOP_AT_TRIGGER=1 leaves the open trigger in place (e.g. to compare the page with the design)
	if (process.env.STOP_AT_TRIGGER) {
		await oBrowser.close();
		return;
	}

	// ── Follow-up message ──
	const iBlockedBefore = blockedEmails();
	await run(oSam, () => button("follow-up", ".hrxSickStack").firePress());
	await sleep(1500);
	await shot(oSam, "s-message");
	check("Follow-up opens the message modal", await run(oSam, () => !!byId("sicknessMessageDialog") && byId("sicknessMessageDialog").isOpen()));
	await run(oSam, () => byId("sicknessMessageDialog").getBeginButton().firePress());
	await sleep(4000);
	check("Follow-up sent (dry run / blocked)", blockedEmails() > iBlockedBefore, (blockedEmails() - iBlockedBefore) + " held back");

	// ── A return-to-work step ──
	const iDoneBefore = ((await api(SAM, "ReturnToWorkSteps?$filter=Done eq true")).value || []).length;
	await run(oSam, () => {
		const oRtw = m("sk").rtw[0];
		const iStep = oRtw.steps.findIndex((o) => !o.done);
		const oButtons = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().offsetParent && o.getBindingContext("sk") && /\/steps\//.test(o.getBindingContext("sk").getPath()));
		const oButton = oButtons.filter((o) => o.getBindingContext("sk").getPath() === "/rtw/0/steps/" + iStep)[0];
		oButton.firePress();
	});
	await sleep(4000);
	const aDone = ((await api(SAM, "ReturnToWorkSteps")).value || []).filter((o) => o.Done || o.DoneOn || o.CompletedOn);
	check("Return-to-work step saved as done", aDone.length > iDoneBefore, aDone.length + " done");

	// ── Dismiss the trigger ──
	await run(oSam, () => button("dismiss", ".hrxSickStack").firePress());
	await sleep(1500);
	await run(oSam, () => { byId("skDismissReason").setValue("Spoken to Kyle; no pattern"); byId("skDismissReason").fireLiveChange({ value: "Spoken to Kyle; no pattern" }); });
	await sleep(300);
	await shot(oSam, "s-dismiss");
	await run(oSam, () => byId("dismissTriggerDialog").getBeginButton().firePress());
	await sleep(4000);
	const aReviews = ((await api(SAM, "SicknessReviews")).value || []);
	check("Dismissal saved with its reason", aReviews.some((o) => /DISMISS/i.test(o.Status) && /no pattern/.test(o.Note || "")), JSON.stringify(aReviews.map((o) => o.Status + " " + o.Note)));
	aTriggers = await run(oSam, () => m("sk").triggers.length);
	check("No open triggers left", aTriggers === 0, String(aTriggers));
	await shot(oSam, "s-dismissed");
	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));

	// ── Kyle: the absences are on My Leave as approved sick leave ──
	const oKyle = await open(oBrowser, KYLE, "leave");
	const aKyleRows = await oKyle.evaluate(() => {
		const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.Leave$/.test(o.getViewName()))[0];
		return oView.getModel("ml").getData().leaves.map((o) => o.DisplayRange + "|" + o.LeaveType + "|" + o.Status);
	});
	check("Kyle's My Leave shows the three sick absences", aKyleRows.filter((r) => /Sick\|Approved/.test(r)).length === 3, JSON.stringify(aKyleRows));
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
