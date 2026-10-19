// Documents and Policies to read against the local in-memory HRX service and the fake
// Document Management server (made-up @example.test users; the test service blocks all
// email). Sam publishes two documents from the top-bar "Upload document"; Kyle reads
// and acknowledges one; Sam sees who is still outstanding and sends a reminder.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-docs/";
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

// A one-page PDF to upload
const PDF = path.join(os.tmpdir(), "hrx-test-policy.pdf");
fs.writeFileSync(PDF, "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function open(oBrowser, sEmail, sRoute, sReady) {
	const oContext = await oBrowser.createBrowserContext();
	const oPage = await oContext.newPage();
	await oPage.setViewport({ width: 1440, height: 1052 });
	await oPage.authenticate({ username: sEmail, password: "" });
	oPage.errors = [];
	// The old services.xsodata is not part of the local test service: its metadata
	// failing to load is expected here and left out.
	oPage.on("pageerror", (e) => { if (!/ODataMetadata/.test(e.stack || "")) { oPage.errors.push((e.stack || e.message).split("\n").slice(0, 2).join(" <- ")); } });
	await oPage.goto("http://localhost:8088/test/flp.html#app-preview?email=" + sEmail + "&/" + sRoute, { waitUntil: "networkidle0", timeout: 90000 });
	await oPage.waitForSelector(sReady, { timeout: 60000 });
	await sleep(4000);
	return oPage;
}
// Runs fn in the page with byId(suffix) and m(view, model) (a view model's data).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const view = (s) => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && new RegExp("\\." + s + "$").test(o.getViewName()))[0];
	const m = (sView, sModel) => view(sView).getModel(sModel).getData();
	return new Function("byId", "view", "m", "vArg", "return (" + sFn + ")(vArg)")(byId, view, m, vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });

async function publish(oSam, sName, sCategory, bAck) {
	await oSam.click(".hrxTopBarAction");
	await sleep(1200);
	const oFile = await oSam.$("[id$=documentUploadFile] input[type=file]");
	await oFile.uploadFile(PDF);
	await sleep(600);
	await run(oSam, (a) => {
		const oModel = view("Documents").getModel("dmUpload");
		oModel.setProperty("/Name", a[0]);
		oModel.setProperty("/Category", a[1]);
		oModel.setProperty("/AckRequired", a[2]);
		view("Documents").getController().onUploadInput();
	}, [sName, sCategory, bAck]);
	await shot(oSam, "d-upload-" + sCategory);
	await run(oSam, () => byId("documentUploadDialog").getBeginButton().firePress());
	await sleep(4000);
}

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();

	// ── Sam publishes two documents ──
	const oSam = await open(oBrowser, SAM, "documents", ".hrxDmPanel");
	check("Documents has no upload button of its own (the top bar's)", await run(oSam, () => !document.querySelector(".hrxPageContent [class*=Upload].sapMBtn") && /upload/i.test(document.querySelector(".hrxTopBarAction").innerText)), await run(oSam, () => document.querySelector(".hrxTopBarAction").innerText));
	await publish(oSam, "Remote Working Policy", "Policy", true);
	await publish(oSam, "Company Away Day - Logistics", "Other", false);
	const aPolicies = (await api(SAM, "Policies")).value || [];
	check("Both documents saved in the service", aPolicies.length === 2, JSON.stringify(aPolicies.map((o) => o.Name + "|" + o.Category + "|" + o.AckRequired)));
	const aRows = await run(oSam, () => m("Documents", "dm").rows.map((o) => o.Name + "|" + o.ackText));
	check("Documents lists both", aRows.length === 2, JSON.stringify(aRows));
	await oSam.click(".hrxDmRow");
	await sleep(1500);
	const aOutstanding = await run(oSam, () => m("Documents", "dm").outstanding.map((o) => o.Name));
	check("Who hasn't acknowledged lists the staff", aOutstanding.length >= 5 && aOutstanding.includes("Kyle Barnfield"), JSON.stringify(aOutstanding));
	await shot(oSam, "d-documents");

	// ── Kyle reads and acknowledges the policy ──
	const oKyle = await open(oBrowser, KYLE, "policies", ".hrxPdCard");
	let aKyleRows = await run(oKyle, () => m("Policies", "pd").rows.map((o) => o.Name + "|" + (o.statusText || o.ackText || "")));
	check("Policies to read lists both", aKyleRows.length === 2, JSON.stringify(aKyleRows));
	await shot(oKyle, "d-policies-before");
	const iWindows = (await oBrowser.pages()).length;
	await run(oKyle, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().offsetParent && o.getBindingContext("pd") && /Remote Working/.test(o.getBindingContext("pd").getProperty("Name")) && /read/i.test(o.getText()))[0].firePress());
	await sleep(2500);
	check("Read opens the file", (await oBrowser.pages()).length > iWindows, (await oBrowser.pages()).map((p) => p.url()).slice(-1)[0]);
	await run(oKyle, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().offsetParent && /acknowledge/i.test(o.getText()))[0].firePress());
	await sleep(4000);
	const aAcks = (await api(SAM, "PolicyAcknowledgements")).value || [];
	check("Acknowledgement saved for Kyle", aAcks.length === 1 && aAcks[0].Employee_EmployeeID === "BSX000003", JSON.stringify(aAcks.map((o) => o.Employee_EmployeeID)));
	aKyleRows = await run(oKyle, () => m("Policies", "pd").rows.map((o) => o.Name + "|" + (o.statusText || o.ackText || "")));
	await shot(oKyle, "d-policies-after");
	check("Kyle: no page errors", oKyle.errors.length === 0, oKyle.errors.join(" / "));

	// ── Sam: Kyle is off the list; remind the rest ──
	await run(oSam, () => view("Documents").getController().onRefresh());
	await sleep(4000);
	await oSam.click(".hrxDmRow");
	await sleep(1500);
	const aLeft = await run(oSam, () => m("Documents", "dm").outstanding.map((o) => o.Name));
	check("Kyle no longer outstanding", !aLeft.includes("Kyle Barnfield") && aLeft.length === aOutstanding.length - 1, JSON.stringify(aLeft));
	const iBlockedBefore = blockedEmails();
	await run(oSam, () => sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getDomRef().closest(".hrxDmWhoFoot") && o.hasStyleClass("hrxPdBtnMail"))[0].firePress());
	await sleep(1500);
	await shot(oSam, "d-remind");
	await run(oSam, () => { const o = sap.ui.core.Element.registry.filter((x) => x.isA && x.isA("sap.m.Dialog") && x.isOpen())[0]; if (o) { o.getBeginButton().firePress(); } });
	await sleep(4000);
	check("Reminder emails were blocked, not sent", blockedEmails() > iBlockedBefore, (blockedEmails() - iBlockedBefore) + " blocked");
	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
