// Manage Resources against the local in-memory HRX service (made-up @example.test users;
// the test service blocks all email). Search, filter, add a resource, edit and save one,
// switch a resource off, book leave on someone's behalf, and approve / decline their
// requests from Leave taken.
// HRX_SERVICE_LOG names the service's log (the output of run-service.sh).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOTS || __dirname + "/shots-mr/";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (sName, bOk, sDetail) => { results.push({ name: sName, ok: !!bOk }); console.log((bOk ? "PASS " : "FAIL ") + sName + (sDetail ? " — " + sDetail : "")); };
const SERVICE = "http://localhost:4004/hrx/";
const api = async (sUser, sPath, oInit) => {
	const oResponse = await fetch(SERVICE + sPath, Object.assign({ headers: { Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64"), "Content-Type": "application/json" } }, oInit || {}));
	return oResponse.json().catch(() => ({}));
};
const LOG = process.env.HRX_SERVICE_LOG || __dirname + "/../hrxservice-test/service.log";
const realEmails = () => (fs.readFileSync(LOG, "utf8").match(/Message sent: </g) || []).length;
const SAM = "sam.evans@example.test", KYLE = "kyle.barnfield@example.test";
const APPROVED = "e7ab02da-d0d3-11ee-b96f-325096b39f47";

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
// Runs fn in the page with byId(suffix), ctrl() (the page's controller), m(model) (a view model's data) and model(name).
const run = (oPage, fn, vArg) => oPage.evaluate((sFn, vValue) => {
	const byId = (s) => sap.ui.core.Element.registry.filter((o) => o.getId && o.getId().endsWith(s) && o.getDomRef && o.getDomRef())[0];
	const oView = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.ui.core.mvc.XMLView") && /\.ManageResources$/.test(o.getViewName()))[0];
	const m = (s) => oView.getModel(s).getData();
	return new Function("byId", "ctrl", "m", "model", "vArg", "return (" + sFn + ")(vArg)")(byId, () => oView.getController(), m, (s) => oView.getModel(s), vValue);
}, fn.toString(), vArg);
const shot = (oPage, sName) => oPage.screenshot({ path: OUT + sName + ".png", clip: { x: 0, y: 52, width: 1440, height: 1000 } });
const names = (oPage) => run(oPage, () => m("mr").resources.map((o) => o.FullName || (o.FName + " " + o.LName)));

(async () => {
	const oBrowser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const iRealBefore = realEmails();
	const oSam = await open(oBrowser, SAM, "manageresources");
	let aNames = await names(oSam);
	check("Lists the six resources", aNames.length === 6, JSON.stringify(aNames));

	// ── Search and filter ──
	await run(oSam, () => { model("mrView").setProperty("/searchQuery", "priya"); ctrl().onSearch(); });
	await sleep(500);
	check("Search: priya", (await names(oSam)).join() === "Priya Shah", JSON.stringify(await names(oSam)));
	await run(oSam, () => { model("mrView").setProperty("/searchQuery", ""); ctrl().onSearch(); ctrl().onOpenFilter(); });
	await sleep(1000);
	await shot(oSam, "r-filter");
	await run(oSam, () => {
		const sAurangabad = m("mr").sites.find((o) => /Aurangabad/.test(o.SiteLabel || o.SiteName || "")).SiteID;
		model("mrView").setProperty("/filterDraft/site", sAurangabad);
		ctrl().onConfirmFilter();
	});
	await sleep(500);
	check("Filter by location: Aurangabad", (await names(oSam)).join() === "Priya Shah", JSON.stringify(await names(oSam)));
	await run(oSam, () => { ctrl().onOpenFilter(); model("mrView").setProperty("/filterDraft/site", ""); ctrl().onConfirmFilter(); });
	await sleep(500);

	// ── Add a resource ──
	await run(oSam, () => ctrl().onOpenAddResource());
	await sleep(1000);
	await run(oSam, () => {
		const oNew = model("mrNew");
		oNew.setProperty("/FName", "Jordan");
		oNew.setProperty("/LName", "Lee");
		oNew.setProperty("/Email", "jordan.lee@example.test");
		oNew.setProperty("/JobTitle", "Analyst");
		oNew.setProperty("/BaseSiteKey", m("mr").sites.find((o) => /Oswestry/.test(o.SiteLabel || o.SiteName || "")).SiteID);
		oNew.setProperty("/UserTypeKey", m("mr").userTypes[0].UserTypeKey);
	});
	await shot(oSam, "r-add");
	await run(oSam, () => byId("newResourceConfirm").firePress());
	await sleep(5000);
	const oJordan = ((await api(SAM, "Users?$filter=WorkEmail eq 'jordan.lee@example.test'")).value || [])[0];
	check("Add saved Jordan Lee, Analyst", oJordan && oJordan.FirstName === "Jordan" && oJordan.JobTitle === "Analyst", JSON.stringify(oJordan && { n: oJordan.FirstName, t: oJordan.JobTitle, a: oJordan.IsActive }));
	check("The new resource opens", await run(oSam, () => (m("mrDetail").Email || "") === "jordan.lee@example.test"), await run(oSam, () => m("mrDetail").Email));

	// ── Switch Jordan off ──
	await run(oSam, () => { model("mrDetail").setProperty("/Active", false); ctrl().onActiveChange({ getParameter: () => false, getSource: () => byId("resourceActiveSwitch") || null }); });
	await sleep(3000);
	const oJordanOff = ((await api(SAM, "Users?$filter=WorkEmail eq 'jordan.lee@example.test'")).value || [])[0];
	check("Active switch saved Jordan as inactive", oJordanOff && oJordanOff.IsActive === false, String(oJordanOff && oJordanOff.IsActive));

	// ── Edit Kyle ──
	await run(oSam, () => ctrl()._showResource("BSX000003"));
	await sleep(2500);
	await run(oSam, () => { model("mrDetail").setProperty("/JobTitle", "Senior Developer"); model("mrDetail").setProperty("/TargetUtilization", 85); ctrl().onSave(); });
	await sleep(3500);
	const oKyle = ((await api(SAM, "Users?$filter=EmployeeID eq 'BSX000003'&$expand=WorkSchedule")).value || [])[0];
	check("Save: Kyle's job title and target utilisation", oKyle.JobTitle === "Senior Developer" && String(oKyle.WorkSchedule && oKyle.WorkSchedule.TargetUtilization) === "85", oKyle.JobTitle + " / " + (oKyle.WorkSchedule && oKyle.WorkSchedule.TargetUtilization));

	// ── Book leave for Kyle: Thu 12 – Fri 13 Nov ──
	await run(oSam, () => { model("mrView").setProperty("/selectedTab", "leave"); ctrl().onOpenBookLeave(); });
	await sleep(1500);
	await run(oSam, () => {
		const oDates = byId("resourceBookLeaveDates");
		oDates.setDateValue(new Date("2026-11-12T00:00:00"));
		oDates.setSecondDateValue(new Date("2026-11-13T00:00:00"));
		ctrl().onBookLeaveDatesChange({ getSource: () => oDates, getParameter: (s) => (s === "from" ? oDates.getDateValue() : oDates.getSecondDateValue()) });
	});
	await sleep(2500);
	await shot(oSam, "r-book");
	await run(oSam, () => ctrl().onConfirmBookLeave());
	await sleep(4000);
	const aBooked = (await api(SAM, "Leaves?$filter=StartDate ge 2026-11-12 and StartDate le 2026-11-13 and EmpID_EmployeeID eq 'BSX000003'")).value || [];
	check("Book leave: two days for Kyle, approved", aBooked.length === 2 && aBooked.every((o) => o.Status_ID === APPROVED), JSON.stringify(aBooked.map((o) => o.StartDate + " " + o.Status_ID)));

	// ── Kyle asks for two days; Sam approves one and declines the other ──
	const sHoliday = (await api(KYLE, "LeaveType?$filter=LeaveCategoryDesc eq 'Holiday'")).value[0].ID;
	for (const sDate of ["2026-11-23", "2026-11-24"]) {
		await api(KYLE, "createLeaveRequest", { method: "POST", body: JSON.stringify({ userLog: [{ LeaveCategoryId_ID: sHoliday, StartDate: sDate, EndDate: sDate, DayTime: "Full Day", NoOfDays: "1", IsPaid: true, ApprovalRequired: true, ApproverID_EmployeeID: "BSX000002", RequesterComments: "Test" }] }) });
	}
	await run(oSam, () => ctrl()._showResource("BSX000003"));
	await sleep(2500);
	await run(oSam, () => model("mrView").setProperty("/selectedTab", "leave"));
	await sleep(800);
	await shot(oSam, "r-leave");
	const pressOn = (sDate, sClass) => run(oSam, (a) => {
		const oButton = sap.ui.core.Element.registry.filter((o) => o.isA && o.isA("sap.m.Button") && o.getDomRef() && o.getBindingContext("mrLeave") && o.getBindingContext("mrLeave").getProperty("Date") === a[0] && new RegExp(a[1], "i").test(o.getText() + " " + (o.getTooltip() || "") + " " + o.getIcon()))[0];
		oButton.firePress();
		return true;
	}, [sDate, sClass]);
	await pressOn("2026-11-23", "approve|accept");
	await sleep(3500);
	await pressOn("2026-11-24", "reject|decline");
	await sleep(1200);
	await shot(oSam, "r-decline");
	await run(oSam, () => { model("mrDecline").setProperty("/note", "Too many off that week"); ctrl().onConfirmDeclineLeave(); });
	await sleep(3500);
	const aDecided = (await api(SAM, "Leaves?$filter=StartDate ge 2026-11-23 and StartDate le 2026-11-24&$orderby=StartDate")).value || [];
	check("Approve and decline saved", aDecided.length === 2 && aDecided[0].Status_ID === APPROVED && aDecided[1].Status_ID !== APPROVED && /Too many/.test(aDecided[1].ApproverComments || ""), JSON.stringify(aDecided.map((o) => o.StartDate + " " + o.Status_ID + " " + o.ApproverComments)));

	check("Sam: no page errors", oSam.errors.length === 0, oSam.errors.join(" / "));
	check("No real email sent", realEmails() === iRealBefore && realEmails() === 0, realEmails() + " 'Message sent: <' lines");
	await oBrowser.close();
	console.log(results.filter((r) => r.ok).length + "/" + results.length + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
