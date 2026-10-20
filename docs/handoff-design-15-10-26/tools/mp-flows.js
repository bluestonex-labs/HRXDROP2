// Manage Projects against the local in-memory HRX service and the fake Document
// Management server (made-up @example.test users; the test service blocks all email).
// Search, add a project, save its info, assign / edit / release / re-assign a resource,
// and upload and delete an attachment.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-mp/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const SAM = "sam.evans@example.test";
const PDF = path.join(os.tmpdir(), "hrx-test-sow.pdf");
fs.writeFileSync(PDF, "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

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
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.ManageProjects$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "model", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, (s) => oView.getModel(s), vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
const tab = (oPage, sKey) => run(oPage, (s) => { model("mpView").setProperty("/selectedTab", s); ctrl().onTabSelect({ getParameter: () => s, getSource: () => ({ getSelectedKey: () => s }) }); }, sKey);
const assignments = (oPage) => run(oPage, () => (m("mpTabs").assignments || []).map((o) => o.FullName + "|" + o.DayRate + "|" + (o.statusText || o.Status || o.IsActive)));

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const oSam = await open(oBrowser, SAM, "manageprojects");

	// ── Search ──
	await run(oSam, () => { model("mpView").setProperty("/searchQuery", "croda"); ctrl().onSearch(); });
	await sleep(500);
	const aFound = await run(oSam, () => m("mp").projects.map((o) => o.ProjectDesc));
	check("Search: croda finds the Croda project only", aFound.length === 1 && /Croda UX Support/.test(aFound[0]), JSON.stringify(aFound));
	await run(oSam, () => { model("mpView").setProperty("/searchQuery", ""); ctrl().onSearch(); });

	// ── Add a project ──
	await run(oSam, () => ctrl().onOpenAddProject());
	await sleep(1000);
	await run(oSam, () => {
		const o = model("mpForm");
		o.setProperty("/ProjectDesc", "Nimbus Portal");
		o.setProperty("/ClientKey", m("mp").clients.find((c) => /Croda/.test(c.ClientDesc || c.ClientName || c.text || "")).ClientKey);
		o.setProperty("/ProjectTypeKey", "FXD");
		o.setProperty("/PriorityKey", m("mp").priorities[2].PriorityKey || m("mp").priorities[2].PriorityID);
		o.setProperty("/ProjectManagerID", "BSX000002");
	});
	await shot(oSam, "p-add");
	check("Project types read as the design's", JSON.stringify(await run(oSam, () => m("mp").projectTypes.map((o) => o.ProjectTypeDesc))).includes("Time & materials"), JSON.stringify(await run(oSam, () => m("mp").projectTypes.map((o) => o.ProjectTypeDesc))));
	await run(oSam, () => ctrl().onCreateProject());
	await sleep(4500);
	const oNimbus = ((await api(SAM, "Projects?$filter=ProjectDesc eq 'Nimbus Portal'")).value || [])[0];
	check("Add project saved Nimbus Portal (fixed price, Sam as manager)", oNimbus && oNimbus.ProjectType === "FXD" && oNimbus.ProjectManagerID === "BSX000002", JSON.stringify(oNimbus && { t: oNimbus.ProjectType, pm: oNimbus.ProjectManagerID, p: oNimbus.Priority }));
	check("The new project opens", (await run(oSam, () => m("mpDetail").ProjectDesc)) === "Nimbus Portal");

	// ── Info: PO and billable days ──
	await run(oSam, () => { model("mpDetail").setProperty("/PONumber", "PO 4500999"); model("mpDetail").setProperty("/POValue", "12000"); model("mpDetail").setProperty("/TotBillableDays", "24"); ctrl().onSaveProject(); });
	await sleep(4000);
	const oSaved = ((await api(SAM, "Projects?$filter=ProjectDesc eq 'Nimbus Portal'")).value || [])[0];
	check("Save: PO number, value and billable days", oSaved.PONumber === "PO 4500999" && oSaved.POValue === "12000" && oSaved.TotBillableDays === "24", JSON.stringify({ po: oSaved.PONumber, v: oSaved.POValue, d: oSaved.TotBillableDays }));

	// ── Resourcing: assign Tom, change his rate, release and re-assign ──
	await tab(oSam, "resourcing");
	await sleep(2000);
	await run(oSam, () => ctrl().onAddAssignment());
	await sleep(1000);
	await run(oSam, () => {
		const o = model("mpForm");
		o.setProperty("/EmpID", m("mpForm").resources.find((r) => /Tom/.test(r.FullName || r.FName || "")).EmpID);
		o.setProperty("/schemeKey", "UK");
		o.setProperty("/DayRate", "450");
		o.setProperty("/BillableDays", "10");
	});
	await shot(oSam, "p-assign");
	await run(oSam, () => ctrl().onSaveAssignment());
	await sleep(4000);
	let aRows = ((await api(SAM, "UserToProject?$filter=Project_ID eq " + oNimbus.ID)).value || []);
	check("Assign: Tom on Nimbus Portal at £450", aRows.length === 1 && Number(aRows[0].DayRate) === 450, JSON.stringify(aRows.map((o) => o.Employee_EmployeeID + " " + o.DayRate + " " + o.IsActive)));
	await run(oSam, () => {
		const oButton = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mpTabs") && /assignments/.test(o.getBindingContext("mpTabs").getPath()) && o.mEventRegistry.press && o.mEventRegistry.press.some((h) => h.oListener && h.fFunction === ctrl().onEditAssignment || /onEditAssignment/.test(String(h.fFunction))))[0]
			|| sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mpTabs") && /assignments/.test(o.getBindingContext("mpTabs").getPath()) && !o.getText())[0];
		oButton.firePress();
	});
	await sleep(1000);
	await run(oSam, () => { model("mpForm").setProperty("/DayRate", "480"); ctrl().onSaveAssignment(); });
	await sleep(4000);
	aRows = ((await api(SAM, "UserToProject?$filter=Project_ID eq " + oNimbus.ID)).value || []);
	check("Edit assignment: £480", aRows.length === 1 && Number(aRows[0].DayRate) === 480, JSON.stringify(aRows.map((o) => o.DayRate)));
	const pressRow = (sText) => run(oSam, (s) => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mpTabs") && /assignments/.test(o.getBindingContext("mpTabs").getPath()) && new RegExp(s, "i").test(o.getText()))[0].firePress(), sText);
	await pressRow("release");
	await sleep(1200);
	await shot(oSam, "p-release");
	await run(oSam, () => ctrl().onConfirmAction());
	await sleep(4000);
	aRows = ((await api(SAM, "UserToProject?$filter=Project_ID eq " + oNimbus.ID)).value || []);
	check("Release: Tom no longer active on it", aRows.length === 1 && aRows[0].IsActive === false, JSON.stringify(aRows.map((o) => o.IsActive + " " + o.EndDate)));
	await pressRow("re-?assign");
	await sleep(4000);
	aRows = ((await api(SAM, "UserToProject?$filter=Project_ID eq " + oNimbus.ID)).value || []);
	check("Re-assign: Tom active again", aRows.length === 1 && aRows[0].IsActive === true, JSON.stringify(aRows.map((o) => o.IsActive)));

	// ── Attachments ──
	await tab(oSam, "attachments");
	await sleep(1500);
	const oFile = await oSam.$("[id$=projectAttachmentUploader] input[type=file]");
	await oFile.uploadFile(PDF);
	await sleep(5000);
	let aFiles = await run(oSam, () => (m("mpTabs").attachments || []).map((o) => o.FileName || o.name || o.Name));
	check("Upload: the file is listed", aFiles.length === 1 && /hrx-test-sow/.test(aFiles[0]), JSON.stringify(aFiles));
	await shot(oSam, "p-attachments");
	await run(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mpTabs") && /attachments/.test(o.getBindingContext("mpTabs").getPath()) && o.mEventRegistry.press && o.mEventRegistry.press.some((h) => /onDeleteAttachment/.test(String(h.fFunction)) || /delete|trash/i.test(o.getIcon() + " " + (o.getTooltip() || "") + " " + o.aCustomStyleClasses)))[0].firePress());
	await sleep(1200);
	await run(oSam, () => ctrl().onConfirmAction());
	await sleep(4000);
	aFiles = await run(oSam, () => (m("mpTabs").attachments || []).length);
	check("Delete: the file is gone", aFiles === 0, String(aFiles));

	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
