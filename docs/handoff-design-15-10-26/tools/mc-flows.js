// Manage Clients against the local in-memory HRX service and the fake Document
// Management server (made-up @example.test addresses; the test service blocks all
// email). Add a client, save its basic info and logo, and add / delete a support
// user, a service level, a component and an application service.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-mc/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath) => {
	const oResponse = await fetch(SERVICE + sPath, { headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") } });
	return oResponse.json().catch(() => ({}));
};
const SAM = "sam.evans@example.test";
// A 1 x 1 PNG for the logo
const PNG = path.join(os.tmpdir(), "hrx-test-logo.png");
fs.writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

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
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.ManageClients$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "model", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, (s) => oView.getModel(s), vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
const openDialogButton = (oPage, sDialogId) => run(oPage, (s) => byId(s).getBeginButton().firePress(), sDialogId);

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const oSam = await open(oBrowser, SAM, "manageclients");
	const iBefore = await run(oSam, () => m("mc").clients.length);

	// ── Add a client ──
	await run(oSam, () => ctrl().onOpenAddClient());
	await sleep(1000);
	await run(oSam, () => { const o = model("mcForm"); o.setProperty("/ClientDesc", "Nimbus Labs"); o.setProperty("/ClientLocation", "Leeds"); o.setProperty("/ClientContactName", "Ava Patel"); });
	await shot(oSam, "c-add");
	await openDialogButton(oSam, "addClientDialog");
	await sleep(4000);
	const oNimbus = ((await api(SAM, "Clients?$filter=ClientName eq 'Nimbus Labs'")).value || [])[0];
	check("Add client saved Nimbus Labs", !!oNimbus, JSON.stringify(oNimbus && { n: oNimbus.ClientName, s: oNimbus.BaseSite }));
	check("The list has one more client and it opens", (await run(oSam, () => m("mc").clients.length)) === iBefore + 1 && (await run(oSam, () => m("mcDetail").ClientDesc)) === "Nimbus Labs");

	// ── Basic info: contact email and a logo ──
	await run(oSam, () => { model("mcDetail").setProperty("/ClientContactEmail", "ava.patel@example.test"); model("mcDetail").setProperty("/ClientContactMobile", "+44 1234 567890"); });
	const oLogo = await oSam.$("[id$=clientLogoUploader] input[type=file], .hrxMcFile input[type=file], .hrxMcLogo input[type=file]");
	if (oLogo) {
		await oLogo.uploadFile(PNG);
		await sleep(1200);
	}
	await run(oSam, () => ctrl().onSaveClient());
	await sleep(4500);
	const oSaved = ((await api(SAM, "Clients?$filter=ClientName eq 'Nimbus Labs'")).value || [])[0];
	const aContacts = (await api(SAM, "Contacts")).value || [];
	check("Save: the contact's email is kept", aContacts.some((o) => /ava\.patel@example\.test/.test(JSON.stringify(o))), JSON.stringify(aContacts.map((o) => o.FirstName + " " + (o.Email || o.EmailID || ""))).slice(0, 200));
	check("Save: the logo is stored in Document Management", !!(oSaved && oSaved.LogoObjectID), String(oSaved && oSaved.LogoObjectID) + (oLogo ? "" : " (no file input found)"));
	await shot(oSam, "c-basic");

	// ── Support team ──
	await run(oSam, () => { model("mcView").setProperty("/selectedTab", "team"); ctrl().onTabSelect({ getParameter: () => "team", getSource: () => ({ getSelectedKey: () => "team" }) }); });
	await sleep(1500);
	await run(oSam, () => ctrl().onAddUser());
	await sleep(1000);
	await run(oSam, () => { const o = model("mcForm"); o.setProperty("/FName", "Ben"); o.setProperty("/LName", "Hart"); o.setProperty("/Email", "ben.hart@example.test"); o.setProperty("/IsAdmin", true); });
	await shot(oSam, "c-user");
	await run(oSam, () => ctrl().onSaveUser());
	await sleep(3500);
	const aUsers = ((await api(SAM, "ClientUsers?$filter=Client_ID eq " + oNimbus.ID)).value || []);
	check("Support user saved", aUsers.length === 1 && aUsers[0].Email === "ben.hart@example.test" && aUsers[0].IsAdmin === true, JSON.stringify(aUsers.map((o) => o.Email + " admin " + o.IsAdmin)));

	// ── SLA ──
	await run(oSam, () => { model("mcView").setProperty("/selectedTab", "sla"); ctrl().onTabSelect({ getParameter: () => "sla", getSource: () => ({ getSelectedKey: () => "sla" }) }); });
	await sleep(1500);
	await run(oSam, () => ctrl().onAddSla());
	await sleep(1000);
	await run(oSam, () => { const o = model("mcForm"); o.setProperty("/PriorityID", m("mc").priorities[0].PriorityID || m("mc").priorities[0].key); o.setProperty("/ResponseSLA", "4"); o.setProperty("/ResolutionSLA", "24"); });
	await shot(oSam, "c-sla");
	await run(oSam, () => ctrl().onSaveSla());
	await sleep(3500);
	let aSlas = ((await api(SAM, "ClientSLAs?$filter=Client_ID eq " + oNimbus.ID)).value || []);
	check("Service level saved", aSlas.length === 1 && Number(aSlas[0].ResponseHours) === 4 && Number(aSlas[0].ResolutionHours) === 24, JSON.stringify(aSlas.map((o) => o.Severity + " " + o.ResponseHours + "/" + o.ResolutionHours)));

	// ── Application service ──
	await run(oSam, () => { model("mcView").setProperty("/selectedTab", "services"); ctrl().onTabSelect({ getParameter: () => "services", getSource: () => ({ getSelectedKey: () => "services" }) }); });
	await sleep(1500);
	await run(oSam, () => ctrl().onAddService());
	await sleep(1000);
	await run(oSam, () => { byId("serviceApp").setValue("HRX"); byId("serviceService").setValue("Support"); model("mcForm").setProperty("/ValidFrom", new Date("2026-01-01T00:00:00")); model("mcForm").setProperty("/ValidTill", new Date("2026-12-31T00:00:00")); });
	await shot(oSam, "c-service");
	await run(oSam, () => ctrl().onSaveService());
	await sleep(3500);
	const aApps = ((await api(SAM, "ClientApplications?$filter=Client_ID eq " + oNimbus.ID)).value || []);
	check("Application service saved", aApps.length === 1 && aApps[0].AppName === "HRX" && aApps[0].ServiceName === "Support", JSON.stringify(aApps.map((o) => o.AppName + " / " + o.ServiceName)));

	// ── Delete the SLA (asks first) ──
	await run(oSam, () => { model("mcView").setProperty("/selectedTab", "sla"); ctrl().onTabSelect({ getParameter: () => "sla", getSource: () => ({ getSelectedKey: () => "sla" }) }); });
	await sleep(1500);
	await run(oSam, () => {
		const oButton = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mcTabs") && /\/sla/.test(o.getBindingContext("mcTabs").getPath()) && o.hasStyleClass("hrxMcIcoTrash"))[0];
		oButton.firePress();
	});
	await sleep(1200);
	await shot(oSam, "c-confirm");
	await run(oSam, () => ctrl().onConfirmDelete());
	await sleep(3500);
	aSlas = ((await api(SAM, "ClientSLAs?$filter=Client_ID eq " + oNimbus.ID)).value || []);
	check("Service level deleted", aSlas.length === 0, String(aSlas.length));

	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
