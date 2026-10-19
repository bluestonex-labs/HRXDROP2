// My Timesheet against the local in-memory HRX service (made-up @example.test users).
// Kyle adds Croda UX Support to the week, books Tuesday with a comment, saves, moves
// between weeks, and deletes a project row he has not booked on.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-ts/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const KYLE = "kyle.barnfield@example.test";

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
// Runs fn in the page with byId(suffix), ctrl() (the page's controller), m(model) (a model's data) and model(name).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.Timesheet$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "model", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, (s) => oView.getModel(s), vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
const rowNames = (oPage) => run(oPage, () => m("ts").rows.map((o) => o.project));

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const oKyle = await open(oBrowser, KYLE, "timesheet");
	const sWeek = await run(oKyle, () => m("tsView").weekLabel || document.querySelector(".hrxTsWeekLabel, [class*=Week] .sapMText").innerText);
	check("The week opens with Kyle's projects", (await rowNames(oKyle)).length >= 1, sWeek + " " + JSON.stringify(await rowNames(oKyle)));

	// ── Add Croda UX Support ──
	await run(oKyle, () => ctrl().onOpenAddProjects());
	await sleep(1500);
	await shot(oKyle, "t-add");
	await run(oKyle, () => {
		const oTable = byId("addProjectsTable");
		const oItem = oTable.getItems().find((o) => /Croda UX/.test(JSON.stringify(o.getBindingContext(o.getBindingContext("ts") ? "ts" : undefined) ? o.getBindingContext(o.getBindingContext("ts") ? "ts" : undefined).getObject() : o.getCells().map((c) => c.getText && c.getText()))));
		oTable.setSelectedItem(oItem, true, true);
		ctrl().onConfirmAddProjects();
	});
	await sleep(2000);
	check("Add project(s): Croda UX Support is on the week", (await rowNames(oKyle)).some((s) => /Croda UX Support/.test(s)), JSON.stringify(await rowNames(oKyle)));

	// ── Tuesday 07:30 with a comment, then Save ──
	await run(oKyle, () => {
		const iRow = m("ts").rows.findIndex((o) => /Croda UX Support/.test(o.project));
		const oInput = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Input") && o.getBindingContext("ts") && o.getBindingContext("ts").getPath() === "/rows/" + iRow + "/days/1")[0];
		oInput.setValue("7:30");
		oInput.fireChange({ value: "7:30" });
		const oButton = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.hasStyleClass("hrxTsCommentButton") && o.getBindingContext("ts") && o.getBindingContext("ts").getPath() === "/rows/" + iRow + "/days/1")[0];
		oButton.firePress();
	});
	await sleep(1200);
	await shot(oKyle, "t-comment");
	await run(oKyle, () => { byId("timesheetCommentText").setValue("Usability test sessions"); byId("timesheetCommentText").fireLiveChange({ value: "Usability test sessions" }); ctrl().onSaveComment(); });
	await sleep(600);
	await run(oKyle, () => ctrl().onSave());
	await sleep(4500);
	const aBooked = ((await api(KYLE, "TimeLog?$filter=Date eq 2026-10-20")).value || []);
	check("Save: Tuesday 07:30 on Croda with its comment", aBooked.some((o) => /^07:30/.test(o.Hours) && /Usability/.test(o.Comment)), JSON.stringify(aBooked.map((o) => o.Hours + " " + o.Comment)));
	check("The week's total shows it", /07:30/.test(await oKyle.evaluate(() => document.querySelector(".hrxTimesheet").innerText)));
	await shot(oKyle, "t-saved");

	// ── Weeks ──
	await run(oKyle, () => ctrl().onNextWeek());
	await sleep(3000);
	const sNext = await run(oKyle, () => m("tsView").weekLabel || "");
	await run(oKyle, () => ctrl().onPreviousWeek());
	await sleep(3000);
	check("Next / previous week", sNext && sNext !== sWeek && (await run(oKyle, () => m("tsView").weekLabel || "")) === sWeek, sWeek + " → " + sNext);

	// ── Add then delete a project not booked on (BSX Internal cannot be deleted) ──
	check("Bluestonex's own project rows cannot be selected for deleting", await run(oKyle, () => m("ts").rows.filter((o) => /Bluestonex/i.test(o.client || o.ClientDesc || "") || o.deletable === false).every((o) => o.deletable === false)));
	await run(oKyle, () => ctrl().onNextWeek());
	await sleep(3000);
	await run(oKyle, () => ctrl().onOpenAddProjects());
	await sleep(1500);
	await run(oKyle, () => {
		const oTable = byId("addProjectsTable");
		oTable.setSelectedItem(oTable.getItems()[0], true, true);
		ctrl().onConfirmAddProjects();
	});
	await sleep(2000);
	const iBefore = (await rowNames(oKyle)).length;
	await run(oKyle, () => {
		const oTable = byId("timesheetTable");
		const oItem = oTable.getItems().find((o) => o.getBindingContext("ts") && o.getBindingContext("ts").getObject().deletable !== false && !o.isA("sap.m.GroupHeaderListItem"));
		oTable.setSelectedItem(oItem, true, true);
		ctrl().onDeleteProjects();
	});
	await sleep(1500);
	await shot(oKyle, "t-delete");
	await run(oKyle, () => { const o = sap.ui.core.Element.registry.filter((x) => x.isA && x.isA("sap.m.Dialog") && x.isOpen())[0]; if (o) { o.getBeginButton().firePress(); } });
	await sleep(3000);
	check("Delete project(s): the row goes", (await rowNames(oKyle)).length === iBefore - 1, iBefore + " → " + (await rowNames(oKyle)).length);
	check("Kyle: no page errors", oKyle.errors.length === 0, oKyle.errors.join(" / "));
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
