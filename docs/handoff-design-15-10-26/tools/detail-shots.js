// Screenshots of the views a page only shows after a click: each detail tab of a client,
// a project and a resource, the Documents and Policies lists, and the report tabs.
// Run after local-hrx-service/seed-rich.js, so every tab has rows to show.
//   node detail-shots.js <out folder>
// Errors raised by the page (other than the old services.xsodata metadata, which the
// local test service does not have) are printed per view.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = (process.argv[2] || __dirname + "/shots-detail") + "/";
fs.mkdirSync(OUT, { recursive: true });
const SAM = "sam.evans@example.test";

async function open(oBrowser, sEmail, sRoute) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ")); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail + "&/" + sRoute, { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForFunction(() => { const t = document.querySelector(".hrxPageTitle"); return t && t.innerText.trim().length > 0; }, { timeout: 60000 });
	await sleep(4000);
	return oPage;
}
// Runs fn in the page with ctrl() (the view's controller) and model(name).
const run = (oPage, sView, fn, vArg) => oPage.evaluate((sViewName, sFn, vValue) => {
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && new RegExp("\\." + sViewName + "$").test(o.getViewName()))[0];
	return new Function("ctrl", "model", "vArg", "return (" + sFn + ")(vArg)")(() => oView.getController(), (s) => oView.getModel(s), vValue);
}, sView, fn.toString(), vArg);
const shot = async (oPage, sName) => {
	await sleep(1500);
	await oPage.screenshot({ path: OUT + sName + ".png", fullPage: true });
	console.log(sName + (oPage.errors.length ? "  ERRORS: " + oPage.errors.splice(0).join(" | ") : ""));
};
const selectTab = (oPage, sView, sModel, sKey) => run(oPage, sView, (a) => {
	model(a[0]).setProperty("/selectedTab", a[1]);
	const oController = ctrl();
	if (oController.onTabSelect) {
		oController.onTabSelect({ getParameter: () => a[1], getSource: () => ({ getSelectedKey: () => a[1] }) });
	}
}, [sModel, sKey]);

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });

	// ── Manage Clients: Croda, every tab ──
	let oPage = await open(oBrowser, SAM, "manageclients");
	await run(oPage, "ManageClients", () => ctrl()._showClient(model("mc").getProperty("/clients").find((o) => o.ClientDesc === "Croda").ClientKey));
	await sleep(2500);
	for (const sTab of ["basic", "team", "sla", "components", "services"]) {
		await selectTab(oPage, "ManageClients", "mcView", sTab);
		await shot(oPage, "mc-" + sTab);
	}

	// ── Manage Projects: Croda UX Support, every tab ──
	oPage = await open(oBrowser, SAM, "manageprojects");
	await run(oPage, "ManageProjects", () => {
		const oProject = model("mp").getProperty("/projects").find((o) => o.ProjectDesc === "Croda UX Support");
		return ctrl()._showProject({ ProjectKey: oProject.ProjectKey, ClientKey: oProject.ClientKey });
	});
	await sleep(2500);
	for (const sTab of ["info", "resourcing", "contacts", "attachments"]) {
		await selectTab(oPage, "ManageProjects", "mpView", sTab);
		await shot(oPage, "mp-" + sTab);
	}

	// ── Manage Resources: Kyle, every tab ──
	oPage = await open(oBrowser, SAM, "manageresources");
	await run(oPage, "ManageResources", () => ctrl()._showResource("BSX000003"));
	await sleep(2500);
	for (const sTab of ["info", "manager", "workingtime", "reward", "leave"]) {
		await selectTab(oPage, "ManageResources", "mrView", sTab);
		await shot(oPage, "mr-" + sTab);
	}

	// ── Lists and reports ──
	for (const [sRoute, sName] of [["documents", "documents"], ["policies", "policies-sam"], ["missingtimesheets", "missing"],
		["timesheetreporting", "tsr"], ["timesheetreporting?tab=util", "util"]]) {
		oPage = await open(oBrowser, SAM, sRoute);
		await shot(oPage, sName);
	}
	oPage = await open(oBrowser, "kyle.barnfield@example.test", "policies");
	await shot(oPage, "policies-kyle");

	await oBrowser.close();
})().catch((e) => { console.error(e); process.exit(1); });
