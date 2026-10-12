/*
 * Seed data for the local HRX service mock.
 *
 * Every record follows the bsx.hrx CDS model of the deployed CAP service
 * (bluestonex-labs/HRXService, db/hrx.cds) field for field, so the app reads the mock
 * exactly as it reads the real service. Dates are generated relative to the day the
 * mock starts, so every page always has a current week, a current month and a year
 * to date to show.
 */
"use strict";

const ORG_ID = "bf63d3f1-99a7-4faf-833d-f0a708826ed2";
const SITE_UK = "6ca831c7-db64-43b8-b604-dbdbbcca620c";
const SITE_IN = "c78267ca-8c4d-4ae1-b4f7-8316769100cf";

const STATUS = {
	requested: "e7ab05aa-d0d3-11ee-b777-325096b39f47",
	approved: "e7ab02da-d0d3-11ee-b96f-325096b39f47",
	rejected: "e7ab06f4-d0d3-11ee-bc32-325096b39f47"
};

// deterministic pseudo random numbers, so the mock looks the same on every start
let nSeed = 20260713;
function rnd() {
	nSeed = (nSeed * 1103515245 + 12345) % 2147483648;
	return nSeed / 2147483648;
}
let nUuid = 0;
function uuid() {
	nUuid++;
	const h = (n, l) => n.toString(16).padStart(l, "0").slice(-l);
	return h(0x5eed0000 + nUuid, 8) + "-" + h(nUuid * 7919, 4) + "-4" + h(nUuid, 3) + "-8" + h(nUuid * 31, 3) + "-" + h(nUuid * 2654435761, 12);
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function build(oToday) {
	const today = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate());
	const year = today.getFullYear();
	const stamp = addDays(today, -30).toISOString();   // seeded rows look a month old
	const managed = () => ({ createdAt: stamp, createdBy: "mock", modifiedAt: stamp, modifiedBy: "mock" });
	const monday = addDays(today, -((today.getDay() + 6) % 7));

	const db = {};

	db.Organisations = [{ ID: ORG_ID, OrgDesc: "Bluestonex", OrgLocation: "Oswestry", LogoRootID: null, LogoObjectID: null, IsActive: true, ...managed() }];

	db.Sites = [
		{ ID: SITE_UK, OrgID_ID: ORG_ID, SiteDesc: "Oswestry", SiteLocation: "UK", LogoRootID: null, LogoObjectID: null, SiteContactName: "Dan Barton", SiteContactMobile: null, SiteContactEmail: "dan.barton@bluestonex.com", Capacity: "40", IsActive: true, ...managed() },
		{ ID: SITE_IN, OrgID_ID: ORG_ID, SiteDesc: "Aurangabad", SiteLocation: "India", LogoRootID: null, LogoObjectID: null, SiteContactName: "Altaf Khan", SiteContactMobile: null, SiteContactEmail: "altaf.khan@bluestonex.com", Capacity: "25", IsActive: true, ...managed() }
	];

	db.ContactObjectTypes = [{ Code: "O", name: "Org Contacts" }, { Code: "S", name: "Site Contacts" }, { Code: "C", name: "Client Contacts" }];

	db.LeaveStatus = [
		{ ID: STATUS.requested, OrgID_ID: ORG_ID, StatusDesc: "Requested" },
		{ ID: STATUS.approved, OrgID_ID: ORG_ID, StatusDesc: "Approved" },
		{ ID: STATUS.rejected, OrgID_ID: ORG_ID, StatusDesc: "Rejected" }
	];

	const LT = {};
	db.LeaveType = [["Compassionate", false], ["Holiday", true], ["Maternity", false], ["Paternity", false], ["Sick", false], ["Unpaid", false]].map(([sDesc, bAcc]) => {
		const o = { ID: uuid(), OrgID_ID: ORG_ID, LeaveCategoryDesc: sDesc, isAccountable: bAcc, ...managed() };
		LT[sDesc] = o.ID;
		return o;
	});

	// ── People ──
	const osw = ["Aditi Arora", "Alice Galais", "Andrew Walker", "Bala Subramanian", "Carol Barton", "Christine Williams", "Dan Barton", "Jack Roberts", "Kyle Barnfield", "Nick Sullivan", "Richard Henry", "Sam Evans", "Steve Tomkins", "Tina Porter", "Inaya Farooqui", "Jacob Ellwood", "Helen Marsh", "Oliver Grant", "Megan Price", "Tom Hughes", "Laura Bennett", "Callum Reid", "Emma Doyle", "Ryan Walsh", "Sophie Turner", "Daniel Cross", "Hannah Fraser"];
	const aur = ["Altaf Khan", "Aman Verma", "Burhanuddin Taheri", "Chandru Ranganathan", "Sabarinathan Chandrasekar", "Yuvaraj Kumar", "Feroz Khan", "Gaurav Kumar", "Mamoon Farooqui", "Namir Khan", "Shubhada Kolte", "Vikash Kumar", "Rohan Deshmukh", "Sneha Patil", "Imran Shaikh", "Ananya Joshi"];
	const emailOf = (n) => n.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".") + "@bluestonex.com";
	let nEmp = 20;
	const byName = {};
	db.Users = [];
	db.WorkSchedule = [];
	osw.map((n) => [n, SITE_UK]).concat(aur.map((n) => [n, SITE_IN])).forEach(([sName, sSite]) => {
		const aParts = sName.split(" ");
		if (nEmp === 52) { nEmp++; }
		const sId = sName === "Sam Evans" ? "BSX000052" : "BSX" + String(nEmp++).padStart(6, "0");
		const bContract = ["Helen Marsh", "Rohan Deshmukh"].includes(sName);
		const oUser = {
			EmployeeID: sId, OrgID_ID: ORG_ID, FirstName: aParts[0], LastName: aParts.slice(1).join(" "), WorkEmail: emailOf(sName),
			MobileNo: null, TelephoneNo: null, UserType: bContract ? "C" : "S", BaseSite_ID: sSite, Manager_EmployeeID: null,
			TargetUtilization: "80", TargetHrsPerWeek: "40", BonusPercent: 10, PercentRate: 80, ImageRootID: null, ImageObjectID: null,
			IsActive: sName !== "Jacob Ellwood", ...managed()
		};
		db.Users.push(oUser);
		byName[sName] = oUser;
		db.WorkSchedule.push({ EmployeeID_EmployeeID: sId, Mo: true, Tu: true, We: true, Th: true, Fr: true, Sa: false, Su: false, AnnualLeaveQuota: "25", TargetUtilization: "80", TargetHrsPerWeek: "40:00", ...managed() });
	});
	const U = (n) => byName[n].EmployeeID;
	// reporting lines: Dan runs the UK, Altaf runs India, Sam leads the delivery team
	const samTeam = ["Christine Williams", "Kyle Barnfield", "Vikash Kumar", "Jack Roberts", "Tina Porter", "Inaya Farooqui", "Andrew Walker", "Nick Sullivan", "Megan Price", "Tom Hughes"];
	db.Users.forEach((u) => {
		const n = u.FirstName + " " + u.LastName;
		if (n === "Dan Barton") { return; }
		if (samTeam.includes(n)) { u.Manager_EmployeeID = U("Sam Evans"); return; }
		u.Manager_EmployeeID = u.BaseSite_ID === SITE_IN && n !== "Altaf Khan" ? U("Altaf Khan") : U("Dan Barton");
	});
	["Dan Barton", "Richard Henry", "Tina Porter", "Jack Roberts"].forEach((n) => { byName[n].TargetUtilization = "60"; byName[n].BonusPercent = 15; byName[n].PercentRate = 60; });

	// ── Clients and projects ──
	const clientNames = [["Allglass", SITE_UK], ["Allwyn", SITE_UK], ["Arla Foods", SITE_UK], ["Babcock International", SITE_UK], ["BAE Applied Intelligence", SITE_UK], ["BBC", SITE_UK], ["Bluestonex Consulting Ltd", SITE_UK], ["BluestoneX India sales and Marketing", SITE_IN], ["Brake Bros", SITE_UK], ["British Council", SITE_UK], ["Carlsberg Group", SITE_UK], ["Croda", SITE_UK], ["NATS", SITE_UK], ["Princes Foods", SITE_UK], ["XP Power", SITE_UK]];
	const C = {};
	db.Clients = clientNames.map(([n, s]) => { const o = { ID: uuid(), OrgID_ID: ORG_ID, ClientName: n, BaseSite: s, LogoRootID: null, LogoObjectID: null, IsActive: true, ...managed() }; C[n] = o.ID; return o; });
	db.Contacts = [
		["Allwyn", "Mark Biegel", "mark.biegel@allwyn.example", "+44 1923 000000"], ["Arla Foods", "Eli Holmgaard", "eli.holmgaard@arla.example", "+45 8900 0000"],
		["BBC", "Guy Midgley", "guy.midgley@bbc.example", "+44 20 0000 0000"], ["Bluestonex Consulting Ltd", "Dan Barton", "dan.barton@bluestonex.com", "+44 1691 000000"],
		["Brake Bros", "Chris Whinfrey", "chris.whinfrey@brakes.example", "+44 1476 000000"], ["Babcock International", "Gareth Pryce", "gareth.pryce@babcock.example", "+44 1234 567890"]
	].map(([c, n, e, p]) => ({ ID: uuid(), ObjectType: "C", ObjectID: C[c], ContactType: "Primary", ContactNo: p, MobileNo: null, WorkEmail: e, PersonalEmail: null, IsActive: true, ...managed() }));

	db.BillingScheme = [["Standard day rate", "450"], ["Senior day rate", "650"], ["Contractor day rate", "525"], ["UX Consultant", "475"], ["Internal (no charge)", "0"]]
		.map(([d, r]) => ({ ID: uuid(), Org_ID: ORG_ID, BillingDesc: d, SkillID: null, DayRate: r, Currency: "GBP", ...managed() }));
	const BS = (d) => db.BillingScheme.find((b) => b.BillingDesc === d).ID;

	const P = {};
	db.Projects = [];
	const proj = (sName, sClient, sType, sStart, sEnd, o) => {
		const p = Object.assign({ ID: uuid(), OrgID_ID: ORG_ID, ClientID_ID: C[sClient], ProjectDesc: sName, ProjectType: sType, StartDate: sStart, EndDate: sEnd, Priority: "Medium", PONumber: null, POValue: null, IsTimeBookingAllowed: sEnd >= iso(today), ProjectManagerID: U("Dan Barton"), TotBillableDays: null, IsActive: true, ...managed() }, o || {});
		db.Projects.push(p);
		P[sName] = p.ID;
	};
	proj("Babcock Maextro Support", "Babcock International", "TNM", "2020-04-01", "2999-12-31", { PONumber: "PO 4500123", POValue: "48000", TotBillableDays: "80" });
	proj("BAE Maextro Support", "BAE Applied Intelligence", "TNM", "2020-04-01", "2999-12-31");
	proj("Blueskyx Pre-Sales", "Bluestonex Consulting Ltd", "INT", "2020-04-01", "2999-12-31");
	proj("Bluestonex - Maextro Plant Maintenance", "Bluestonex Consulting Ltd", "INT", "2021-02-05", "2022-02-04", { IsActive: false });
	proj("BSX Graduate Training", "Bluestonex Consulting Ltd", "INT", "2022-11-01", "2023-11-01", { IsActive: false });
	proj("BSX Internal Development", "Bluestonex Consulting Ltd", "INT", "2020-04-01", "2099-03-31");
	proj("AWS Migration", "Bluestonex Consulting Ltd", "INT", year + "-03-02", year + "-12-18");
	proj("Carlsberg UX Support", "Carlsberg Group", "TNM", (year - 1) + "-09-01", year + "-12-31", { PONumber: "PO 4500310", POValue: "61500", TotBillableDays: "130", Priority: "High", ProjectManagerID: U("Sam Evans") });
	proj("CR5", "Carlsberg Group", "FXD", year + "-01-05", year + "-12-30", { PONumber: "PO 4500311", POValue: "52000", TotBillableDays: "100" });
	proj("CR6 Event Processing", "Carlsberg Group", "FXD", year + "-02-02", year + "-11-27", { PONumber: "PO 4500312", POValue: "64000", TotBillableDays: "120" });
	proj("Croda UX Support", "Croda", "TNM", (year - 1) + "-10-01", year + "-12-31", { PONumber: "PO 4500401", POValue: "60000", TotBillableDays: "125", ProjectManagerID: U("Sam Evans") });
	proj("Maextro Croda - Material Extensions", "Croda", "TNM", year + "-01-12", year + "-12-30", { PONumber: "PO 4500402", POValue: "45000", TotBillableDays: "100" });
	proj("Maextro PAD", "Croda", "TNM", year + "-01-12", year + "-12-30", { PONumber: "PO 4500403", POValue: "41000", TotBillableDays: "90" });
	proj("NATS Timesheet Development", "NATS", "TNM", (year - 1) + "-11-03", year + "-12-18", { PONumber: "PO 4500377", POValue: "37050", TotBillableDays: "57", ProjectManagerID: U("Sam Evans") });
	proj("Engineering CR3", "Princes Foods", "FXD", year + "-01-19", year + "-12-28", { PONumber: "PO 4500501", POValue: "38000", TotBillableDays: "80" });
	proj("Maextro Material Master", "XP Power", "TNM", year + "-02-09", year + "-12-04", { PONumber: "PO 4500601", POValue: "36000", TotBillableDays: "80" });

	// who works on what: [person, project, billing scheme, share of a working day]
	const plan = [
		["Sam Evans", "BSX Internal Development", "Internal (no charge)", 0.3], ["Sam Evans", "NATS Timesheet Development", "Senior day rate", 0.4], ["Sam Evans", "Carlsberg UX Support", "Senior day rate", 0.3],
		["Christine Williams", "Carlsberg UX Support", "UX Consultant", 0.4], ["Christine Williams", "Croda UX Support", "UX Consultant", 0.35], ["Christine Williams", "BSX Internal Development", "Internal (no charge)", 0.25],
		["Dan Barton", "NATS Timesheet Development", "Senior day rate", 0.35], ["Dan Barton", "BSX Internal Development", "Internal (no charge)", 0.35], ["Dan Barton", "Blueskyx Pre-Sales", "Internal (no charge)", 0.3],
		["Kyle Barnfield", "CR5", "Contractor day rate", 0.3], ["Kyle Barnfield", "CR6 Event Processing", "Contractor day rate", 0.35], ["Kyle Barnfield", "Engineering CR3", "Contractor day rate", 0.25], ["Kyle Barnfield", "BSX Internal Development", "Internal (no charge)", 0.1],
		["Vikash Kumar", "Maextro Croda - Material Extensions", "Standard day rate", 0.3], ["Vikash Kumar", "Maextro PAD", "Standard day rate", 0.3], ["Vikash Kumar", "Maextro Material Master", "Standard day rate", 0.3], ["Vikash Kumar", "AWS Migration", "Internal (no charge)", 0.1],
		["Andrew Walker", "Babcock Maextro Support", "Standard day rate", 0.7], ["Andrew Walker", "BSX Internal Development", "Internal (no charge)", 0.3],
		["Nick Sullivan", "BAE Maextro Support", "Standard day rate", 0.5], ["Nick Sullivan", "AWS Migration", "Internal (no charge)", 0.5],
		["Megan Price", "Croda UX Support", "UX Consultant", 0.6], ["Megan Price", "BSX Internal Development", "Internal (no charge)", 0.4],
		["Tom Hughes", "BSX Internal Development", "Internal (no charge)", 1],
		["Jack Roberts", "Blueskyx Pre-Sales", "Internal (no charge)", 1], ["Tina Porter", "BSX Internal Development", "Internal (no charge)", 1],
		["Altaf Khan", "Maextro Material Master", "Standard day rate", 0.5], ["Altaf Khan", "AWS Migration", "Internal (no charge)", 0.5],
		["Gaurav Kumar", "CR6 Event Processing", "Standard day rate", 0.6], ["Gaurav Kumar", "BSX Internal Development", "Internal (no charge)", 0.4],
		["Feroz Khan", "BSX Internal Development", "Internal (no charge)", 1], ["Mamoon Farooqui", "Maextro PAD", "Standard day rate", 0.6], ["Mamoon Farooqui", "BSX Internal Development", "Internal (no charge)", 0.4]
	];
	db.UserToProject = plan.map(([n, p, b]) => {
		const oScheme = db.BillingScheme.find((x) => x.ID === BS(b));
		const oProj = db.Projects.find((x) => x.ID === P[p]);
		return { Employee_EmployeeID: U(n), Project_ID: P[p], BillingID_ID: oScheme.ID, DayRate: oScheme.DayRate, Currency: "GBP", BillableDays: oProj.ProjectType === "INT" ? "0" : "60", TotalCharge: String(Number(oScheme.DayRate) * 60), StartDate: oProj.StartDate + "T00:00:00Z", EndDate: oProj.EndDate + "T00:00:00Z", IsActive: true, ...managed() };
	});

	// ── Bank holidays ──
	const bh = (site, m, d, desc) => { const dt = new Date(year, m - 1, d); return { ID: uuid(), Org_ID: ORG_ID, Site_ID: site, Date: iso(dt), Day: DAY_NAMES[dt.getDay()], HolidayDesc: desc, Comments: null, ...managed() }; };
	db.BankHolidays = [
		bh(SITE_UK, 1, 1, "New Year's Day"), bh(SITE_UK, 4, 3, "Good Friday"), bh(SITE_UK, 4, 6, "Easter Monday"), bh(SITE_UK, 5, 4, "Early May bank holiday"), bh(SITE_UK, 5, 25, "Spring bank holiday"), bh(SITE_UK, 8, 31, "Summer bank holiday"), bh(SITE_UK, 12, 25, "Christmas Day"), bh(SITE_UK, 12, 28, "Boxing Day (substitute)"),
		bh(SITE_IN, 1, 26, "Republic Day"), bh(SITE_IN, 3, 4, "Holi"), bh(SITE_IN, 8, 15, "Independence Day"), bh(SITE_IN, 10, 2, "Gandhi Jayanti"), bh(SITE_IN, 10, 20, "Diwali"), bh(SITE_IN, 12, 25, "Christmas Day")
	];
	const isHoliday = (sSite, sDate) => db.BankHolidays.some((h) => h.Site_ID === sSite && h.Date === sDate);

	// ── Leave ──  one row per day, grouped by LeaveGrpID, exactly as createLeaveRequest stores it
	db.Leaves = [];
	const leave = (sName, sType, fromOffset, nDays, sStatus, o) => {
		const oUser = byName[sName];
		const sGrp = uuid();
		let d = addDays(today, fromOffset), nAdded = 0, nGuard = 0;
		while (nAdded < nDays && nGuard++ < 60) {
			const sDate = iso(d);
			if (d.getDay() !== 0 && d.getDay() !== 6 && !isHoliday(oUser.BaseSite_ID, sDate)) {
				const sDayTime = (o && o.dayTime) || "Full Day";
				db.Leaves.push({
					ID: uuid(), EmpID_EmployeeID: oUser.EmployeeID, IsPaid: sType !== "Unpaid", LeaveCategoryId_ID: LT[sType], NoOfDays: sDayTime === "Full Day" ? "1" : "0.5",
					StartDate: sDate, EndDate: sDate, DayTime: sDayTime, ApprovalRequired: true, ApproverID_EmployeeID: oUser.Manager_EmployeeID || U("Dan Barton"),
					Status_ID: STATUS[sStatus], RequesterComments: (o && o.comment) || null, ApproverComments: (o && o.note) || null, LeaveGrpID: sGrp, WFFlag: sStatus !== "requested", ...managed()
				});
				nAdded++;
			}
			d = addDays(d, 1);
		}
	};
	// Sam's own leave
	leave("Sam Evans", "Holiday", 9, 2, "requested", { comment: "Family visit" });
	leave("Sam Evans", "Holiday", 40, 5, "requested");
	leave("Sam Evans", "Holiday", -230, 4, "approved");
	leave("Sam Evans", "Holiday", -150, 3, "approved");
	leave("Sam Evans", "Sick", -110, 1, "approved", { dayTime: "PM" });
	leave("Sam Evans", "Unpaid", -200, 1, "rejected", { note: "Clashes with the Croda go-live" });
	leave("Sam Evans", "Compassionate", -175, 1, "approved");
	// waiting on Sam's approval
	leave("Christine Williams", "Holiday", 23, 5, "requested", { comment: "Summer break" });
	leave("Kyle Barnfield", "Holiday", 30, 1, "requested", { dayTime: "PM" });
	leave("Megan Price", "Holiday", 14, 3, "requested");
	// out today
	leave("Inaya Farooqui", "Sick", 0, 2, "approved");
	leave("Richard Henry", "Holiday", -1, 4, "approved");
	leave("Carol Barton", "Holiday", 0, 1, "approved");
	// the rest of the year
	leave("Dan Barton", "Holiday", 20, 5, "approved");
	leave("Dan Barton", "Compassionate", -90, 2, "approved");
	leave("Dan Barton", "Holiday", 45, 1, "requested", { dayTime: "PM" });
	leave("Christine Williams", "Holiday", -60, 5, "approved");
	leave("Vikash Kumar", "Holiday", -40, 3, "approved");
	leave("Gaurav Kumar", "Holiday", 3, 2, "approved");
	leave("Andrew Walker", "Holiday", 1, 1, "approved");
	// sickness that crosses the policy trigger: 3 separate absences in 6 months
	leave("Jack Roberts", "Sick", -16, 3, "approved", { comment: "Stomach upset" });
	leave("Jack Roberts", "Sick", -70, 1, "approved", { comment: "Migraine" });
	leave("Jack Roberts", "Sick", -130, 2, "approved", { comment: "Cold / flu" });
	leave("Tina Porter", "Sick", -30, 2, "approved", { comment: "Cold / flu" });
	leave("Tina Porter", "Sick", -80, 2, "approved", { comment: "Back pain" });
	leave("Tina Porter", "Sick", -150, 1, "approved", { comment: "Migraine" });
	leave("Yuvaraj Kumar", "Sick", -45, 1, "approved", { comment: "Headache" });
	leave("Kyle Barnfield", "Sick", -100, 2, "approved", { comment: "Cold / flu" });

	// ── Time bookings ── weekdays from 1 January to today, for everyone on a plan
	const comments = {
		"BSX Internal Development": ["Sprint planning and backlog refinement", "Built the shared component library for the HR suite", "Code review and pairing"],
		"NATS Timesheet Development": ["Reviewed approval flow design with the client product owner", "Built the timesheet approval service", "UAT defect fixes"],
		"Carlsberg UX Support": ["Reworked the order tracking screen after client feedback", "Usability test sessions and write-up"],
		"Croda UX Support": ["Prototyped the batch release dashboard for review", "Design system updates"],
		"CR5": ["Fixed the pricing condition lookup defect raised in UAT", "Regression testing"],
		"CR6 Event Processing": ["Built the event queue retry handler and added unit tests", "Integration testing with the event mesh"],
		"Engineering CR3": ["Reconciled the bill of materials export against the spec"],
		"Maextro PAD": ["Configured plant asset hierarchy and loaded test data"],
		"Maextro Croda - Material Extensions": ["Extended the material master with the new classification fields"],
		"Maextro Material Master": ["Migrated material records and checked the results"],
		"Blueskyx Pre-Sales": ["Prepared the solution outline and effort estimate", "Client demo preparation"],
		"AWS Migration": ["Moved the build pipeline to the new account", "Infrastructure as code review"],
		"Babcock Maextro Support": ["Support ticket triage", "Monitoring alert follow-up"],
		"BAE Maextro Support": ["Support ticket triage"]
	};
	const projName = {}; db.Projects.forEach((p) => { projName[p.ID] = p.ProjectDesc; });
	const people = [...new Set(plan.map((x) => x[0]))];
	// how much of this week each person has booked so far (the rest of the year is complete)
	const weekBooked = { "Sam Evans": 0.6, "Kyle Barnfield": 0.5, "Megan Price": 0, "Tom Hughes": 0.4, "Nick Sullivan": 0.8 };
	db.TimeLog = [];
	const toHours = (n) => { const m = Math.round(n * 60 / 15) * 15; return pad(Math.floor(m / 60)) + ":" + pad(m % 60) + ":00"; };
	people.forEach((sName) => {
		const oUser = byName[sName];
		const aPlan = plan.filter((x) => x[0] === sName);
		const isOff = (sDate) => db.Leaves.some((l) => l.EmpID_EmployeeID === oUser.EmployeeID && l.StartDate === sDate && l.Status_ID === STATUS.approved && l.DayTime === "Full Day");
		const aWeekDays = [];
		for (let d = new Date(year, 0, 1); d <= today; d = addDays(d, 1)) {
			if (d.getDay() === 0 || d.getDay() === 6) { continue; }
			const sDate = iso(d);
			if (isHoliday(oUser.BaseSite_ID, sDate) || isOff(sDate)) { continue; }
			if (d >= monday) { aWeekDays.push(new Date(d)); continue; }
			aPlan.forEach(([, p, , share]) => {
				const n = 8 * share * (0.8 + rnd() * 0.4);
				if (n < 0.5) { return; }
				const aC = comments[p] || ["Project work"];
				db.TimeLog.push({ ID: uuid(), Project_ID: P[p], Employee_EmployeeID: oUser.EmployeeID, Date: sDate, Hours: toHours(Math.min(n, 8)), Comment: aC[Math.floor(rnd() * aC.length)], ...managed() });
			});
		}
		// this week: book the first days in full, as far as the person has got
		const nShare = sName in weekBooked ? weekBooked[sName] : 1;
		const nDays = Math.round(5 * nShare);
		aWeekDays.slice(0, nDays).forEach((d) => {
			aPlan.forEach(([, p, , share]) => {
				const aC = comments[p] || ["Project work"];
				db.TimeLog.push({ ID: uuid(), Project_ID: P[p], Employee_EmployeeID: oUser.EmployeeID, Date: iso(d), Hours: toHours(8 * share), Comment: aC[0], ...managed() });
			});
		});
	});

	// ── Bonus ──
	db.Bonus = [];
	[["Sam Evans", 12], ["Christine Williams", 6], ["Kyle Barnfield", 4], ["Vikash Kumar", 4]].forEach(([n, nMonths]) => {
		for (let i = 1; i <= nMonths; i++) {
			const d = new Date(year, today.getMonth() - i, 1);
			db.Bonus.push({ ID: uuid(), EmpID_EmployeeID: U(n), Month: d.getMonth() + 1, Year: d.getFullYear(), SubmittedOn: iso(new Date(d.getFullYear(), d.getMonth() + 1, 5)), BonusReceived: String(150 + Math.round(rnd() * 25) * 10), Currency: "GBP", ...managed() });
		}
	});

	// ── Assets ──
	db.Assets = [
		["MacBook Pro (14-inch, M3, 2024)", "Chip : Apple M3 Pro", "L0Y4LL9HWR"], ["MacBook Pro (13-inch, M1, 2022)", "Chip : Apple M1", "C02FK1ABQ05D"],
		["Dell Latitude 7440", "Intel Core i7", "7G4K2Y3"], ["iPhone 15", "128 GB", "F2LXK9QWN7"], ["LG UltraFine 27\" monitor", "4K UHD", "305NTQD8L172"]
	].map(([d, f, s]) => ({ ID: uuid(), Desc: d, Feature1: f, Feature2: "", Feature3: "", Feature4: "", Feature5: "", Version: "", SerialNumber: s, Comment: "", IsActive: true, ...managed() }));
	db.AssetAssignment = [
		[0, "Sam Evans", -400], [3, "Sam Evans", -200], [1, "Christine Williams", -500], [2, "Kyle Barnfield", -300]
	].map(([i, n, off]) => ({ ID: uuid(), AssetID_ID: db.Assets[i].ID, EmployeeID_EmployeeID: U(n), DateOfIssue: addDays(today, off).toISOString(), Comment: "Asset assigned", ...managed() }));

	db.Documents = [];

	return { db, STATUS, ORG_ID, uuid };
}

module.exports = { build, STATUS, ORG_ID };
