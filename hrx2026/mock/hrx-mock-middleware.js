/*
 * UI5 server middleware for the /hrx service during local development.
 *
 * The deployed HRX CAP service only answers requests that carry an XSUAA token, which
 * the approuter adds on BTP. Run locally, this middleware stands in for it:
 *
 *  - with HRX_TOKEN set (a bearer token for the deployed service, e.g. copied from a
 *    signed-in browser session), every /hrx request is proxied to HRX_SERVICE_URL
 *    with that token, so the app runs against live data;
 *  - otherwise it answers from an in-memory copy of the service: the same entity sets,
 *    the same functions and actions and the same response shapes as the CAP handlers in
 *    bluestonex-labs/HRXService (srv/hrx-services.js), seeded by ./seed.js. Writes are
 *    kept until the dev server restarts.
 *
 * HRX_MOCK_USER picks who is signed in to the mock (default sam.evans@bluestonex.com).
 * HRX_DMS_TOKEN (a bearer token for SAP Document Management) makes /browser/* - the
 * profile pictures and logos - come from the real document store. Without it the mock
 * has no pictures, so everyone shows initials; it never makes pictures up.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { build, STATUS } = require("./seed");

const DEFAULT_SERVICE_URL = "https://bsx-tdd-tdd-bsx-hrx-srv.cfapps.eu10.hana.ondemand.com";
// SAP Document Management endpoint hrx2023 reads pictures from (its dms_service destination)
const DEFAULT_DMS_URL = "https://api-sdm-di.cfapps.eu10.hana.ondemand.com";

// ── model: keys and navigation properties per entity set ──
const KEYS = {
	Organisations: ["ID"], Sites: ["ID"], Contacts: ["ID", "ObjectType"], Users: ["EmployeeID"], Clients: ["ID"], Projects: ["ID"],
	Assets: ["ID"], AssetAssignment: ["ID"], WorkSchedule: ["EmployeeID_EmployeeID"], UserToProject: ["Employee_EmployeeID", "Project_ID", "BillingID_ID"],
	BillingScheme: ["ID"], TimeLog: ["ID"], BankHolidays: ["ID"], Leaves: ["ID"], LeaveType: ["ID"], Bonus: ["ID", "EmpID_EmployeeID", "Month", "Year"],
	ContactObjectTypes: ["Code"], Documents: ["objectID", "objectFolderID", "objectType"], LeaveStatus: ["ID"]
};
const one = (set, fk, pk) => ({ set, one: true, fk, pk: pk || KEYS[set][0] });
const many = (set, fk, pk) => ({ set, one: false, fk, pk });
const NAV = {
	Organisations: { LinkToSite: many("Sites", "OrgID_ID", "ID") },
	Sites: { OrgID: one("Organisations", "OrgID_ID") },
	Users: {
		OrgID: one("Organisations", "OrgID_ID"), BaseSite: one("Sites", "BaseSite_ID"), Manager: one("Users", "Manager_EmployeeID"),
		WorkSchedule: { set: "WorkSchedule", one: true, reverse: "EmployeeID_EmployeeID", pk: "EmployeeID" },
		AssignedAssets: many("AssetAssignment", "EmployeeID_EmployeeID", "EmployeeID"), ProjectAssignment: many("UserToProject", "Employee_EmployeeID", "EmployeeID"),
		LeavesTaken: many("Leaves", "EmpID_EmployeeID", "EmployeeID"), BonusRecieve: many("Bonus", "EmpID_EmployeeID", "EmployeeID")
	},
	Clients: { OrgID: one("Organisations", "OrgID_ID") },
	Projects: { OrgID: one("Organisations", "OrgID_ID"), ClientID: one("Clients", "ClientID_ID"), EmployeeAssignment: many("UserToProject", "Project_ID", "ID") },
	Assets: { AssignedAssets: many("AssetAssignment", "AssetID_ID", "ID") },
	AssetAssignment: { AssetID: one("Assets", "AssetID_ID"), EmployeeID: one("Users", "EmployeeID_EmployeeID") },
	WorkSchedule: { EmployeeID: one("Users", "EmployeeID_EmployeeID") },
	UserToProject: { Employee: one("Users", "Employee_EmployeeID"), Project: one("Projects", "Project_ID"), BillingID: one("BillingScheme", "BillingID_ID") },
	BillingScheme: { Org: one("Organisations", "Org_ID") },
	TimeLog: { Project: one("Projects", "Project_ID"), Employee: one("Users", "Employee_EmployeeID") },
	BankHolidays: { Org: one("Organisations", "Org_ID"), Site: one("Sites", "Site_ID") },
	Leaves: { EmpID: one("Users", "EmpID_EmployeeID"), LeaveCategoryId: one("LeaveType", "LeaveCategoryId_ID"), ApproverID: one("Users", "ApproverID_EmployeeID"), Status: one("LeaveStatus", "Status_ID") },
	LeaveType: { OrgID: one("Organisations", "OrgID_ID") },
	Bonus: { EmpID: one("Users", "EmpID_EmployeeID") }
};
const EXPOSED = Object.keys(KEYS).filter((k) => k !== "LeaveStatus");

// ── small OData URL parsers ──
function splitTop(s, sep) {
	const out = []; let depth = 0, quote = false, cur = "";
	for (const ch of s) {
		if (ch === "'") { quote = !quote; }
		if (!quote && ch === "(") { depth++; }
		if (!quote && ch === ")") { depth--; }
		if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ""; continue; }
		cur += ch;
	}
	if (cur) { out.push(cur); }
	return out;
}
function literal(v) {
	v = v.trim();
	if (v.startsWith("'")) { return v.slice(1, -1).replace(/''/g, "'"); }
	if (v === "true" || v === "false") { return v === "true"; }
	if (v === "null") { return null; }
	if (/^-?\d+(\.\d+)?$/.test(v)) { return Number(v); }
	return v; // dates, uuids
}
function parseParams(s) {
	const o = {};
	splitTop(s || "", ",").forEach((p) => { const i = p.indexOf("="); if (i > 0) { o[p.slice(0, i).trim()] = literal(decodeURIComponent(p.slice(i + 1))); } });
	return o;
}
function parseKey(set, s) {
	if (!s.includes("=")) { return { [KEYS[set][0]]: literal(decodeURIComponent(s)) }; }
	return parseParams(s);
}
function parseExpand(s) {
	return splitTop(s || "", ",").filter(Boolean).map((item) => {
		const i = item.indexOf("(");
		const name = (i < 0 ? item : item.slice(0, i)).trim();
		const opts = {};
		if (i >= 0) { splitTop(item.slice(i + 1, -1), ";").forEach((o) => { const j = o.indexOf("="); opts[o.slice(0, j)] = o.slice(j + 1); }); }
		return { name, opts };
	});
}

// $filter: a small recursive descent parser for eq/ne/gt/ge/lt/le, and/or/not and a few functions
function tokenize(s) {
	const re = /\s*('(?:[^']|'')*'|\(|\)|,|[A-Za-z_][\w/.]*(?=\()|[\w./:+-]+)/g;
	const out = []; let m;
	while ((m = re.exec(s))) { out.push(m[1]); }
	return out;
}
function parseFilter(s) {
	const t = tokenize(s); let i = 0;
	const peek = () => t[i], next = () => t[i++];
	function expr() { let l = and(); while (peek() === "or") { next(); const r = and(), a = l; l = (o) => a(o) || r(o); } return l; }
	function and() { let l = not(); while (peek() === "and") { next(); const r = not(), a = l; l = (o) => a(o) && r(o); } return l; }
	function not() { if (peek() === "not") { next(); const e = not(); return (o) => !e(o); } return cmp(); }
	function cmp() {
		const l = val();
		if (["eq", "ne", "gt", "ge", "lt", "le"].includes(peek())) {
			const op = next(), r = val();
			return (o) => {
				const a = l(o), b = r(o);
				switch (op) {
					case "eq": return a == b || (a == null && b == null); // eslint-disable-line eqeqeq
					case "ne": return !(a == b); // eslint-disable-line eqeqeq
					case "gt": return a > b; case "ge": return a >= b; case "lt": return a < b; default: return a <= b;
				}
			};
		}
		return l;
	}
	function val() {
		const tok = next();
		if (tok === "(") { const e = expr(); next(); return e; }
		if (t[i] === "(" && /^[a-z]+$/.test(tok)) {
			next(); const args = [];
			while (peek() !== ")") { args.push(val()); if (peek() === ",") { next(); } }
			next();
			const f = tok;
			return (o) => {
				const a = args.map((x) => x(o)), s0 = a[0] == null ? "" : String(a[0]);
				if (f === "contains") { return s0.toLowerCase().includes(String(a[1]).toLowerCase()); }
				if (f === "startswith") { return s0.startsWith(a[1]); }
				if (f === "endswith") { return s0.endsWith(a[1]); }
				if (f === "tolower") { return s0.toLowerCase(); }
				if (f === "toupper") { return s0.toUpperCase(); }
				return null;
			};
		}
		if (/^'/.test(tok) || /^-?\d/.test(tok) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tok) || ["true", "false", "null"].includes(tok)) { const v = literal(tok); return () => v; }
		return (o) => tok.split("/").reduce((x, k) => (x == null ? x : x[k]), o);
	}
	return expr();
}

// ── the service ──
function createService(today, sUser) {
	const { db, uuid } = build(today);
	const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	const now = () => new Date().toISOString();
	// like the CAP handlers: the signed-in email must match a WorkEmail exactly, case included
	const me = () => {
		const u = db.Users.find((x) => x.WorkEmail === sUser);
		if (!u) { throw httpError(500, "Employee doesn't exist"); }
		return u;
	};
	const byId = (set, k) => db[set].find((r) => r[KEYS[set][0]] === k);
	const user = (id) => byId("Users", id) || {};

	function expandRow(set, row, aExpand) {
		const o = Object.assign({}, row);
		aExpand.forEach(({ name, opts }) => {
			const nav = (NAV[set] || {})[name];
			if (!nav) { return; }
			let val;
			if (nav.reverse) { val = db[nav.set].find((r) => r[nav.reverse] === row[nav.pk]) || null; }
			else if (nav.one) { val = db[nav.set].find((r) => r[nav.pk] === row[nav.fk]) || null; }
			else { val = db[nav.set].filter((r) => r[nav.fk] === row[nav.pk]); }
			const sub = parseExpand(opts.$expand);
			const f = opts.$filter ? parseFilter(decodeURIComponent(opts.$filter)) : null;
			if (Array.isArray(val)) { val = val.filter((r) => !f || f(r)).map((r) => expandRow(nav.set, r, sub)); }
			else if (val) { val = expandRow(nav.set, val, sub); }
			o[name] = val;
		});
		return o;
	}
	function query(set, q) {
		const aExpand = parseExpand(q.get("$expand"));
		let rows = db[set].map((r) => expandRow(set, r, aExpand));
		if (q.get("$filter")) { const f = parseFilter(q.get("$filter")); rows = rows.filter((r) => { try { return f(r); } catch (e) { return false; } }); }
		const count = rows.length;
		if (q.get("$orderby")) {
			const ord = q.get("$orderby").split(",").map((x) => x.trim().split(/\s+/));
			rows.sort((a, b) => { for (const [k, dir] of ord) { const va = k.split("/").reduce((x, p) => x && x[p], a), vb = k.split("/").reduce((x, p) => x && x[p], b); if (va < vb) { return dir === "desc" ? 1 : -1; } if (va > vb) { return dir === "desc" ? -1 : 1; } } return 0; });
		}
		const skip = Number(q.get("$skip") || 0), top = q.has("$top") ? Number(q.get("$top")) : rows.length;
		rows = rows.slice(skip, skip + top);
		const out = { "@odata.context": "$metadata#" + set, value: rows };
		if (q.get("$count") === "true") { out["@odata.count"] = count; }
		return out;
	}

	// ── helpers lifted from the CAP handlers ──
	const minsOf = (h) => { if (!h) { return 0; } const p = String(h).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); };
	const statusDesc = (id) => (db.LeaveStatus.find((s) => s.ID === id) || {}).StatusDesc;
	const cat = (id) => db.LeaveType.find((c) => c.ID === id) || {};
	const financialYear = () => {
		const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
		return m > 3 ? [y + "-04-01", (y + 2) + "-03-31"] : [(y - 1) + "-04-01", (y + 1) + "-03-31"];
	};
	const holidays = (from, to, site) => db.BankHolidays.filter((h) => (!site || h.Site_ID === site) && h.Date >= from && h.Date <= to);
	const weekdaysInMonth = (m, y) => { let n = 0; const days = new Date(y, m, 0).getDate(); for (let i = 1; i <= days; i++) { const g = new Date(y, m - 1, i).getDay(); if (g !== 0 && g !== 6) { n++; } } return n; };
	const ws = (id) => db.WorkSchedule.find((w) => w.EmployeeID_EmployeeID === id) || {};

	const fn = {
		getUserDetail() {
			// the real handler reads FetchUser[0].EmployeeID before checking the lookup found anyone
			if (!db.Users.some((x) => x.WorkEmail === sUser)) { throw httpError(500, "Cannot read properties of undefined (reading 'EmployeeID')"); }
			const u = me();
			const m = user(u.Manager_EmployeeID);
			return {
				EmployeeID: u.EmployeeID, BaseSite_ID: u.BaseSite_ID, FirstName: u.FirstName, LastName: u.LastName, ImageRootID: u.ImageRootID, ImageObjectID: u.ImageObjectID,
				MobileNo: u.MobileNo, UserType: u.UserType, OrgID_ID: u.OrgID_ID,
				Manager: m.EmployeeID ? { EmployeeID: m.EmployeeID, FirstName: m.FirstName, LastName: m.LastName } : null,
				isManager: db.Users.some((x) => x.Manager_EmployeeID === u.EmployeeID)
			};
		},
		fetchAssignments({ FromDate, ToDate }) {
			const u = me();
			const d = new Date(), ms = iso(new Date(d.getFullYear(), d.getMonth(), 1)), me2 = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
			let actual = 0, month = 0;
			const Assignments = db.UserToProject.filter((a) => a.Employee_EmployeeID === u.EmployeeID).map((a) => {
				const p = byId("Projects", a.Project_ID), c = byId("Clients", p.ClientID_ID) || {};
				const mine = db.TimeLog.filter((t) => t.Project_ID === p.ID && t.Employee_EmployeeID === u.EmployeeID);
				const tot = mine.reduce((s, t) => s + minsOf(t.Hours), 0);
				const cur = p.ProjectType !== "INT" ? mine.filter((t) => t.Date >= ms && t.Date <= me2).reduce((s, t) => s + minsOf(t.Hours), 0) : 0;
				if (p.ProjectType !== "INT") { actual += tot; month += cur; }
				const bd = parseFloat(a.BillableDays);
				return {
					ProjectID: p.ID, Employee: u.EmployeeID, OrgID: p.OrgID_ID, ClientID: p.ClientID_ID, BillingID: a.BillingID_ID, ProjectType: p.ProjectType, ProjectDesc: p.ProjectDesc,
					ClientDesc: c.ClientName, ProjectManagerID: p.ProjectManagerID, PStartDate: p.StartDate, PEndDate: p.EndDate, Priority: p.Priority, PONumber: p.PONumber, POValue: p.POValue,
					PIsActive: p.IsActive, IsTimeBookingAllowed: p.IsTimeBookingAllowed, TotBillableDays: p.TotBillableDays, DayRate: a.DayRate, Currency: a.Currency, BillableDays: bd,
					BillableHrs: bd * 8, BillableMins: bd * 480, ProjectTypeText: bd > 0 ? "Billable" : "Non-Billable", TotalCharge: a.TotalCharge, UIsActive: a.IsActive,
					TotalBilledMin: tot, TotalBilledHrs: tot / 60, TotalBilledDays: tot / 480, CurrentMonthBilledMin: cur, CurrentMonthBilledHrs: cur / 60, CurrentMonthBilledDays: cur / 480,
					TimeLogEntries: mine.filter((t) => t.Date >= FromDate && t.Date <= ToDate).map((t) => ({ Project_ID: t.Project_ID, ID: t.ID, Employee: t.Employee_EmployeeID, Date: t.Date, Hours: t.Hours, Comment: t.Comment }))
				};
			});
			return [{ Assignments, UserTimeCalc: { ActualBilledMinutes: actual, ActualBilledHrs: actual / 60, ActualBilledDays: actual / 480, CurrentMonthActualBilledMinutes: month, CurrentMonthActualBilledHrs: month / 60, CurrentMonthActualBilledDays: month / 480 } }];
		},
		fetchUserDetails({ FromDate, ToDate }) {
			const u = me();
			const [y, m] = FromDate.split("-").map(Number);
			const bank = holidays(FromDate, ToDate, u.BaseSite_ID).map((h) => Object.assign({}, h, { Hours: "08:00" }));
			const working = weekdaysInMonth(m, y) - bank.length;
			const pct = parseFloat(u.PercentRate);
			const w = ws(u.EmployeeID);
			const lv = db.Leaves.filter((l) => l.EmpID_EmployeeID === u.EmployeeID && l.StartDate >= FromDate && l.StartDate <= ToDate && l.Status_ID !== STATUS.rejected)
				.map((l) => ({ EmpID_EmployeeID: l.EmpID_EmployeeID, IsPaid: l.IsPaid, LeaveCategoryId: { ID: l.LeaveCategoryId_ID, LeaveCategoryDesc: cat(l.LeaveCategoryId_ID).LeaveCategoryDesc }, NoOfDays: l.NoOfDays, StartDate: l.StartDate, EndDate: l.EndDate, DayTime: l.DayTime, Hours: l.DayTime === "Full Day" ? "08:00" : "04:00" }));
			return [{
				Users: { empID: u.EmployeeID, utilizationTargetPercentage: pct, utilizationTargetDays: working * pct / 100, utilizationTargetHrs: 8 * working * pct / 100, utilizationTargetMin: 480 * working * pct / 100, targetHrsPerWeek: u.TargetHrsPerWeek, noOfWorkingDays: working },
				BankHoliday: bank,
				WorkSchedule: { Monday: w.Mo, Tuesday: w.Tu, Wednesday: w.We, Thursday: w.Th, Friday: w.Fr, Saturday: w.Sa, Sunday: w.Su },
				Leaves: lv
			}];
		},
		fetchUserLeave() {
			const u = me(); const [from, to] = financialYear();
			const w = ws(u.EmployeeID);
			const availed = db.Leaves.filter((l) => l.EmpID_EmployeeID === u.EmployeeID && l.StartDate >= from && l.StartDate <= to).map((l) => {
				const c = cat(l.LeaveCategoryId_ID), a = user(l.ApproverID_EmployeeID);
				return { EmpID_EmployeeID: l.EmpID_EmployeeID, LeaveTypeID: c.ID, LeaveCategoryDesc: c.LeaveCategoryDesc, IsAccountable: c.isAccountable, Absence: l.DayTime, Date: l.StartDate, Status: statusDesc(l.Status_ID), ApproverName: a.FirstName + " " + a.LastName, ApproverWorkEmail: a.WorkEmail };
			});
			const d = new Date(), fy0 = d.getMonth() < 3 ? (d.getFullYear() - 1) + "-04-01" : d.getFullYear() + "-04-01", fy1 = d.getMonth() < 3 ? d.getFullYear() + "-03-31" : (d.getFullYear() + 1) + "-03-31";
			const used = availed.filter((l) => l.Date >= fy0 && l.Date <= fy1 && l.IsAccountable).reduce((s, l) => s + (l.Absence === "Full Day" ? 1 : 0.5), 0);
			return [{ user: { EmployeeID: u.EmployeeID, Name: u.FirstName + " " + u.LastName, ImageRootID: u.ImageRootID, ImageObjectID: u.ImageObjectID, AnnualLeaveQuota: w.AnnualLeaveQuota, noOfAvailedLeaves: used, balanceLeaves: parseFloat(w.AnnualLeaveQuota) - used },
				availedLeaves: availed, bankHolidays: holidays(from, to, u.BaseSite_ID).map((h) => ({ Site: { SiteDesc: (byId("Sites", h.Site_ID) || {}).SiteDesc }, Date: h.Date, Day: h.Day, HolidayDesc: h.HolidayDesc, Comments: h.Comments, Hours: "08:00" })) }];
		},
		fetchLeaveAnalytics() {
			const u = me(); const [from, to] = financialYear();
			const mine = db.Leaves.filter((l) => l.EmpID_EmployeeID === u.EmployeeID && l.StartDate >= from && l.StartDate <= to);
			return db.LeaveType.map((c) => ({ LeaveID: c.ID, LeaveType: c.LeaveCategoryDesc, Days: mine.filter((l) => l.LeaveCategoryId_ID === c.ID).reduce((s, l) => s + (l.DayTime === "Full Day" ? 1 : 0.5), 0) }));
		},
		leaveToApprove() {
			const u = me(); const [from, to] = financialYear();
			return db.Leaves.filter((l) => l.ApproverID_EmployeeID === u.EmployeeID && l.StartDate >= from && l.StartDate <= to && l.Status_ID === STATUS.requested).map((l) => {
				const e = user(l.EmpID_EmployeeID), a = user(l.ApproverID_EmployeeID), c = cat(l.LeaveCategoryId_ID);
				return { ID: l.ID, EmpID: { EmployeeID: e.EmployeeID, FirstName: e.FirstName, LastName: e.LastName, WorkEmail: e.WorkEmail }, IsPaid: l.IsPaid, NoOfDays: l.NoOfDays, StartDate: l.StartDate, EndDate: l.EndDate, DayTime: l.DayTime, ApprovalRequired: l.ApprovalRequired,
					ApproverID: { EmployeeID: a.EmployeeID, FirstName: a.FirstName, LastName: a.LastName, WorkEmail: a.WorkEmail }, Status: { ID: l.Status_ID, StatusDesc: statusDesc(l.Status_ID) },
					LeaveCategoryId: { ID: c.ID, LeaveCategoryDesc: c.LeaveCategoryDesc, isAccountable: c.isAccountable }, RequesterComments: l.RequesterComments, ApproverComments: l.ApproverComments, LeaveGrpID: l.LeaveGrpID };
			});
		},
		leaveDates(p) { return this.leaveDatesForTeamCalendar(Object.assign({}, p, { EmployeeID: me().EmployeeID })); },
		leaveDatesForTeamCalendar({ FromDate, ToDate, EmployeeID }) {
			const u = user(EmployeeID);
			if (!u.EmployeeID) { throw httpError(500, "No data available for loggedin user"); }
			const w = ws(EmployeeID), off = { 1: w.Mo, 2: w.Tu, 3: w.We, 4: w.Th, 5: w.Fr, 6: w.Sa, 0: w.Su };
			const dates = [];
			const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
			for (let d = new Date(FromDate + "T00:00:00"); iso(d) <= ToDate; d.setDate(d.getDate() + 1)) {
				if (!off[d.getDay()]) { continue; }
				const s = iso(d);
				if (holidays(s, s, u.BaseSite_ID).length) { continue; }
				if (db.Leaves.some((l) => l.EmpID_EmployeeID === EmployeeID && l.StartDate === s && l.Status_ID !== STATUS.rejected)) { continue; }
				dates.push({ date: s, displayDate: d.getDate() + " " + d.toLocaleString("en-GB", { month: "long" }) + " " + d.getFullYear(), day: d.getDay(), dayName: names[d.getDay()], availableSlot: "" });
			}
			return { msg: "Done", msgType: "S", dates };
		},
		fetchTeamCalendar({ FromDate, ToDate }) {
			const u = me();
			const users = db.Users.filter((x) => x.OrgID_ID === u.OrgID_ID).sort((a, b) => (a.FirstName + a.LastName).localeCompare(b.FirstName + b.LastName)).map((x) => {
				const isMgr = db.Users.some((y) => y.Manager_EmployeeID === x.EmployeeID);
				const lv = db.Leaves.filter((l) => l.EmpID_EmployeeID === x.EmployeeID && l.StartDate >= FromDate && l.StartDate <= ToDate && l.Status_ID !== STATUS.rejected).map((l) => {
					const a = user(l.ApproverID_EmployeeID), c = cat(l.LeaveCategoryId_ID);
					return { LeaveID: l.ID, RequesterID: x.EmployeeID, RequesterName: x.FirstName + " " + x.LastName, RequesterEmail: x.WorkEmail, ApproverID: a.EmployeeID, ApproverName: a.FirstName, ApproverEmail: a.WorkEmail, ApprovalRequired: l.ApprovalRequired, Date: l.StartDate, DisplayDate: l.StartDate, AbsenceType: l.DayTime, LeaveTypeID: c.ID, LeaveType: c.LeaveCategoryDesc, StatusID: l.Status_ID, Status: statusDesc(l.Status_ID), RequesterComments: l.RequesterComments, LeaveGrpID: l.LeaveGrpID, WFFlag: l.WFFlag };
				});
				holidays(FromDate, ToDate, x.BaseSite_ID).forEach((h) => lv.push({ LeaveID: "BANKHOLIDAY", RequesterID: "", Date: h.Date, AbsenceType: "Full Day", LeaveTypeID: "BANKHOLIDAY", LeaveType: h.HolidayDesc, StatusID: STATUS.approved, Status: "Approved", SiteID: h.Site_ID, RequesterComments: h.Comments }));
				return { EmpID: x.EmployeeID, Name: x.FirstName + " " + x.LastName, Email: x.WorkEmail.toUpperCase(), SiteID: x.BaseSite_ID, IsLoggedinUser: x.EmployeeID === u.EmployeeID, IsManager: isMgr, HasPendingLeaves: false, Leave: lv, workSchedule: Object.assign({}, ws(x.EmployeeID)), Picid: x.ImageRootID, Pic: x.ImageObjectID };
			});
			const mine = users.find((x) => x.IsLoggedinUser);
			return [{ users, loggedinUser: [{ EmpID: mine.EmpID, Name: mine.Name, Email: mine.Email, IsLoggedinUser: true, IsManager: mine.IsManager, HasPendingLeaves: db.Leaves.some((l) => l.ApproverID_EmployeeID === u.EmployeeID && l.Status_ID === STATUS.requested), SiteID: mine.SiteID }] }];
		},
		fetchMyBonus() {
			const u = me();
			if (!u.TargetUtilization || u.TargetUtilization === "0") { throw httpError(400, "Target Utilization is not maintained for your user ID"); }
			const d = new Date(), first = iso(new Date(d.getFullYear(), d.getMonth(), 1)), last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
			let working = 0;
			for (let x = new Date(first + "T00:00:00"); iso(x) <= last; x.setDate(x.getDate() + 1)) { if (x.getDay() && x.getDay() !== 6 && !holidays(iso(x), iso(x), u.BaseSite_ID).length) { working++; } }
			const billed = db.TimeLog.filter((t) => t.Employee_EmployeeID === u.EmployeeID && t.Date >= first && t.Date <= last && (byId("Projects", t.Project_ID) || {}).ProjectType !== "INT").reduce((s, t) => s + minsOf(t.Hours), 0) / 480;
			const M = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
			return { FirstName: u.FirstName, LastName: u.LastName, Email: u.WorkEmail, TargetUtilization: u.TargetUtilization, TargetBillableDays: working * Number(u.TargetUtilization) / 100, TotalWorkingDays: working, ActualBilledDays: billed, PercentUtilization: working ? billed / working * 100 : 0,
				BonusHistory: db.Bonus.filter((b) => b.EmpID_EmployeeID === u.EmployeeID).sort((a, b) => (b.Year * 100 + b.Month) - (a.Year * 100 + a.Month)).map((b) => ({ Month: M[b.Month], Year: b.Year, SubmittedOn: b.SubmittedOn, BonusReceived: b.BonusReceived, Currency: b.Currency })) };
		},
		fetchBonusHeader({ EmpID }) {
			const u = user(EmpID);
			if (!u.EmployeeID) { throw httpError(404, "Employee record doesn't exist"); }
			const M = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
			return [{ BonusPercent: u.BonusPercent, PensionRate: u.PercentRate, Bonus: db.Bonus.filter((b) => b.EmpID_EmployeeID === EmpID).sort((a, b) => (b.Year * 100 + b.Month) - (a.Year * 100 + a.Month)).slice(0, 3).map((b) => ({ Month: M[b.Month], Year: b.Year, BonusReceived: Number(b.BonusReceived), Currency: b.Currency })) }];
		},
		fetchBonusUserList({ month, year }) {
			if (!month || !year) { throw httpError(400, "Please provide valid parameters"); }
			const first = iso(new Date(year, month - 1, 1)), last = iso(new Date(year, month, 0));
			return [{ msgType: "S", UserList: db.Users.filter((x) => x.IsActive).map((x) => {
				let working = 0;
				const w = ws(x.EmployeeID), on = { 1: w.Mo, 2: w.Tu, 3: w.We, 4: w.Th, 5: w.Fr, 6: w.Sa, 0: w.Su };
				for (let d = new Date(first + "T00:00:00"); iso(d) <= last; d.setDate(d.getDate() + 1)) { if (on[d.getDay()] && !holidays(iso(d), iso(d), x.BaseSite_ID).length) { working++; } }
				const secs = db.TimeLog.filter((t) => t.Employee_EmployeeID === x.EmployeeID && t.Date >= first && t.Date <= last && (byId("Projects", t.Project_ID) || {}).ProjectType !== "INT").reduce((s, t) => s + minsOf(t.Hours) * 60, 0);
				return { UserID: x.EmployeeID, OrgID: x.OrgID_ID, Name: x.FirstName + " " + x.LastName, BaseSiteKey: x.BaseSite_ID, TargetUtilization: x.TargetUtilization, utilization: working ? Number((secs / (working * 28800) * 100).toFixed(1)) : 0, BonusPercent: x.BonusPercent, isBonusSubmitted: db.Bonus.some((b) => b.EmpID_EmployeeID === x.EmployeeID && b.Month === Number(month) && b.Year === Number(year)) };
			}) }];
		},
		fetchBonusList({ Month, Year, BaseSite, EmpID }) {
			if (!(Month && Year && BaseSite && EmpID)) { throw httpError(400, "Please provide valid parameters"); }
			const first = iso(new Date(Year, Month - 1, 1)), last = iso(new Date(Year, Month, 0));
			let working = 0;
			for (let d = new Date(first + "T00:00:00"); iso(d) <= last; d.setDate(d.getDate() + 1)) { if (d.getDay() && d.getDay() !== 6 && !holidays(iso(d), iso(d), BaseSite).length) { working++; } }
			let total = 0;
			const BillableProjects = db.UserToProject.filter((a) => a.Employee_EmployeeID === EmpID).map((a) => {
				const p = byId("Projects", a.Project_ID);
				if (!p || p.ProjectType === "INT") { return null; }
				const secs = db.TimeLog.filter((t) => t.Employee_EmployeeID === EmpID && t.Project_ID === p.ID && t.Date >= first && t.Date <= last).reduce((s, t) => s + minsOf(t.Hours) * 60, 0);
				total += secs;
				const days = secs ? (secs / 28800).toFixed(3) : 0;
				return { ProjectID: p.ID, ProjectDesc: p.ProjectDesc, DayRate: a.DayRate, Currency: a.Currency, ChargableDays: days, Revenue: (days * Number(a.DayRate)).toFixed(3) };
			}).filter(Boolean);
			const b = db.Bonus.find((x) => x.EmpID_EmployeeID === EmpID && x.Month === Number(Month) && x.Year === Number(Year));
			return [{ utilization: total && working ? (total / (working * 28800) * 100).toFixed(3) : 0, BillableProjects, isBonusSubmitted: !!b, BonusReceived: b ? b.BonusReceived : null, msgType: "S" }];
		}
	};
	const act = {
		saveTimesheetEntry({ timeLog }) {
			if (!timeLog || !timeLog.length) { throw httpError(400, "Please pass atleast one entry in the request"); }
			timeLog.forEach((t) => {
				if (t.ID) { const r = byId("TimeLog", t.ID); if (r) { Object.assign(r, t, { modifiedAt: now() }); return; } }
				db.TimeLog.push(Object.assign({ createdAt: now(), modifiedAt: now(), createdBy: sUser, modifiedBy: sUser }, t, { ID: uuid() }));
			});
			return timeLog;
		},
		deleteTimesheetEntry({ deleteEntry }) {
			const ids = (deleteEntry || []).map((x) => x.ID);
			db.TimeLog = db.TimeLog.filter((t) => !ids.includes(t.ID));
			return "Successfully Deleted";
		},
		createLeaveRequest({ userLog }) {
			const u = me(), grp = uuid();
			userLog.forEach((l) => db.Leaves.push(Object.assign({ ID: uuid(), createdAt: now(), modifiedAt: now(), createdBy: sUser, modifiedBy: sUser }, l, { EmpID_EmployeeID: u.EmployeeID, Status_ID: STATUS.requested, LeaveGrpID: grp })));
			return "Leave request created successfully";
		},
		createLeaveRequestForTeamCalendar({ userLog }) {
			const u = me(), grp = uuid();
			userLog.forEach((l) => db.Leaves.push(Object.assign({ ID: uuid(), createdAt: now(), modifiedAt: now(), createdBy: sUser, modifiedBy: sUser }, l, { ApproverID_EmployeeID: u.EmployeeID, Status_ID: STATUS.approved, LeaveGrpID: grp, ApprovalRequired: false })));
			return "Leave request created successfully";
		},
		actionOnLeave({ LeaveLog }) {
			return LeaveLog.map((x) => {
				const l = byId("Leaves", x.ID);
				if (l) { l.Status_ID = x.WFFlag ? STATUS.approved : STATUS.rejected; l.ApproverComments = x.ApproverComments || null; l.modifiedAt = now(); /* like the real handler: Status_ID only, WFFlag is left as it was */ }
				return [x.ID, x.WFFlag ? "Your leave request is approved" : "Your leave request is rejected"];
			});
		},
		submitBonus({ IBonus }) {
			(IBonus || []).forEach((b) => {
				const sEmp = (b.EmpID && b.EmpID.EmployeeID) || b.EmpID_EmployeeID;
				db.Bonus = db.Bonus.filter((x) => !(x.EmpID_EmployeeID === sEmp && x.Month === Number(b.Month) && x.Year === Number(b.Year)));
				db.Bonus.push({ ID: uuid(), EmpID_EmployeeID: sEmp, Month: Number(b.Month), Year: Number(b.Year), SubmittedOn: iso(new Date()), BonusReceived: String(b.BonusReceived), Currency: b.Currency || "GBP", createdAt: now(), modifiedAt: now() });
			});
			return "Bonus data has been saved successfully";
		}
	};

	// CRUD with the same validations as the CAP before-CREATE handlers
	const required = {
		Users: ["WorkEmail", "OrgID_ID"], Sites: ["OrgID_ID", "SiteDesc"], Clients: ["OrgID_ID", "ClientName"], Organisations: ["OrgDesc"],
		UserToProject: ["Employee_EmployeeID", "Project_ID", "BillingID_ID"], AssetAssignment: ["EmployeeID_EmployeeID", "AssetID_ID"], BillingScheme: ["Org_ID", "BillingDesc", "DayRate"],
		Projects: ["OrgID_ID", "ClientID_ID", "ProjectDesc", "ProjectType"]
	};
	const messages = {
		WorkEmail: "Please pass the Email in the request payload", OrgID_ID: "Please pass the org id in the request payload", SiteDesc: "Please pass the site name in the request payload",
		ClientName: "Please pass the client name in the request payload", OrgDesc: "Please pass the org name in the request payload", Employee_EmployeeID: "Please pass the employee id in the request payload",
		Project_ID: "Please pass the project id in the request payload", BillingID_ID: "Please pass the billing id in the request payload", EmployeeID_EmployeeID: "Please pass the employee id in the request payload",
		AssetID_ID: "Please pass the asset id in the request payload", Org_ID: "Please pass the org id in the request payload", BillingDesc: "Please pass the billing description in the request payload",
		DayRate: "Please pass the day rate in the request payload", ClientID_ID: "Please pass the client id in the request payload", ProjectDesc: "Please pass the project description in the request payload",
		ProjectType: "Please pass the project type in the request payload"
	};
	function create(set, body) {
		(required[set] || []).forEach((k) => { if (body[k] == null || String(body[k]).trim() === "") { throw httpError(500, messages[k]); } });
		const stamp = { createdAt: now(), createdBy: sUser, modifiedAt: now(), modifiedBy: sUser };
		const row = Object.assign({}, stamp, body);
		if (set === "Users") {
			if (db.Users.some((u) => (u.WorkEmail || "").toLowerCase() === body.WorkEmail.toLowerCase())) { const e = db.Users.find((u) => u.WorkEmail.toLowerCase() === body.WorkEmail.toLowerCase()); throw httpError(500, "Employee " + e.FirstName + " " + e.FirstName + " (" + e.EmployeeID + ") is already exist with the same Email ID"); }
			const n = Math.max(...db.Users.map((u) => Number(u.EmployeeID.replace(/\D/g, "")) || 0)) + 1;
			row.EmployeeID = "BSX" + String(n).padStart(6, "0");
			delete row.WorkSchedule;
			if (body.WorkSchedule) { db.WorkSchedule.push(Object.assign({}, stamp, body.WorkSchedule, { EmployeeID_EmployeeID: row.EmployeeID })); }
		} else if (KEYS[set].includes("ID") && !row.ID) { row.ID = uuid(); }
		if (set === "UserToProject" && db.UserToProject.some((a) => a.Employee_EmployeeID === row.Employee_EmployeeID && a.Project_ID === row.Project_ID && a.BillingID_ID === row.BillingID_ID)) { throw httpError(400, "Entity already exists"); }
		db[set].push(row);
		return row;
	}
	function find(set, key) {
		return db[set].find((r) => KEYS[set].every((k) => String(r[k]) === String(key[k])));
	}

	return { db, query, find, create, fn, act, expandRow, parseExpand, KEYS, uuid };
}

/* ── Document Management stand-in: /browser/<repository>/root?cmisselector=content&objectId=<id> ── */
const uploads = {};   // objectId -> { type, body }
// the file part of a multipart/form-data body
function filePart(buf, sType) {
	const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(sType || ""); if (!m) { return null; }
	const b = Buffer.from("--" + (m[1] || m[2]));
	let i = buf.indexOf(b);
	while (i !== -1) {
		const next = buf.indexOf(b, i + b.length); if (next === -1) { break; }
		const part = buf.slice(i + b.length + 2, next - 2), sep = part.indexOf("\r\n\r\n");
		const head = part.slice(0, sep).toString("utf8");
		if (/filename=/i.test(head)) { return { type: (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || "application/octet-stream", body: part.slice(sep + 4) }; }
		i = next;
	}
	return null;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function readBody(req) {
	return new Promise((resolve) => {
		if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) { resolve(req.body); return; }
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			const buf = Buffer.concat(chunks);
			if ((req.headers["content-type"] || "").startsWith("application/json")) { try { resolve(JSON.parse(buf.toString("utf8") || "{}")); } catch (e) { resolve({}); } }
			else { resolve(buf); }
		});
	});
}

function send(res, status, body, headers) {
	const h = Object.assign({ "Content-Type": "application/json;odata.metadata=minimal", "OData-Version": "4.0", "x-csrf-token": "mock-csrf-token" }, headers || {});
	res.writeHead(status, h);
	res.end(body === undefined ? "" : (typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)));
}

function proxy(req, res, sBase, sToken) {
	const target = new URL(req.originalUrl || req.url, sBase);
	const headers = Object.assign({}, req.headers, { host: target.host, authorization: "Bearer " + sToken });
	delete headers.cookie;
	const p = https.request(target, { method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
	p.on("error", (e) => send(res, 502, { error: { code: "502", message: e.message } }));
	req.pipe(p);
}

module.exports = function ({ log, options }) {
	const cfg = (options && options.configuration) || {};
	const sMount = cfg.mountPath || "/hrx";
	const sToken = process.env.HRX_TOKEN;
	const sBase = process.env.HRX_SERVICE_URL || cfg.serviceUrl || DEFAULT_SERVICE_URL;
	const bForceMock = cfg.mode === "mock";
	// SAP Document Management, for real profile pictures and logos (/browser/*)
	const sDmsToken = process.env.HRX_DMS_TOKEN;
	const sDmsUrl = process.env.HRX_DMS_URL || cfg.dmsUrl || DEFAULT_DMS_URL;
	if (sDmsToken) { log.info("/browser (pictures) is proxied to " + sDmsUrl + " with the bearer token from HRX_DMS_TOKEN"); }
	if (sToken && !bForceMock) {
		log.info("/hrx is proxied to " + sBase + " with the bearer token from HRX_TOKEN");
		return (req, res, next) => {
			if (req.path.startsWith(sMount + "/") || req.path === sMount) { proxy(req, res, sBase, sToken); return; }
			if (sDmsToken && req.path.startsWith("/browser/")) { proxy(req, res, sDmsUrl, sDmsToken); return; }
			next();
		};
	}
	const sUser = process.env.HRX_MOCK_USER || cfg.user || "sam.evans@bluestonex.com";
	const svc = createService(new Date(), sUser);
	const sMetadata = fs.readFileSync(path.join(__dirname, "..", "webapp", "localService", "hrx", "metadata.xml"), "utf8");
	log.info("/hrx is served by the local mock, signed in as " + sUser);

	return async function (req, res, next) {
		const u = new URL(req.originalUrl || req.url, "http://localhost");
		// the approuter's user API, which tells the app who is signed in
		// pictures: only real ones. Uploaded files are kept and served back; with
		// HRX_DMS_TOKEN set, anything else is fetched from SAP Document Management itself;
		// otherwise there is no picture and the app shows initials.
		const pic = /^\/browser\/[^/]+\/root$/.exec(u.pathname);
		if (pic && u.searchParams.get("cmisselector") === "content") {
			const id = u.searchParams.get("objectId") || "";
			if (uploads[id]) { send(res, 200, uploads[id].body, { "Content-Type": uploads[id].type, "Cache-Control": "no-cache" }); return; }
			if (sDmsToken) { proxy(req, res, sDmsUrl, sDmsToken); return; }
			send(res, 404, { exception: "objectNotFound", message: "No picture for " + id });
			return;
		}
		if (u.pathname === "/user-api/currentUser") { send(res, 200, { email: sUser, name: sUser, scopes: [] }, { "Content-Type": "application/json" }); return; }
		if (!u.pathname.startsWith(sMount)) { next(); return; }
		const rest = decodeURIComponent(u.pathname.slice(sMount.length)).replace(/^\//, "");
		const q = u.searchParams;
		try {
			if (rest === "" || rest === "/") {
				send(res, 200, { "@odata.context": "$metadata", value: EXPOSED.map((n) => ({ name: n, url: n })) });
				return;
			}
			if (rest === "$metadata") { send(res, 200, sMetadata, { "Content-Type": "application/xml" }); return; }
			const m = /^(\w+)(?:\((.*)\))?(?:\/(\w+))?$/.exec(rest);
			if (!m) { throw httpError(404, "Not found: " + rest); }
			const [, name, args, prop] = m;
			// unbound functions and actions
			if (svc.fn[name]) {
				const v = svc.fn[name](parseParams(args));
				send(res, 200, { "@odata.context": "$metadata#Edm.String", value: v });
				return;
			}
			if (svc.act[name]) {
				if (req.method !== "POST") { throw httpError(405, "Use POST for " + name); }
				const v = svc.act[name](await readBody(req));
				send(res, 200, { "@odata.context": "$metadata#Edm.String", value: v });
				return;
			}
			if (!EXPOSED.includes(name)) { throw httpError(404, "Entity set " + name + " not found"); }
			if (args === undefined) {
				if (req.method === "GET") { send(res, 200, svc.query(name, q)); return; }
				if (req.method === "POST") { const row = svc.create(name, await readBody(req)); send(res, 201, row); return; }
				throw httpError(405, "Method not allowed");
			}
			const key = parseParams(args.includes("=") ? args : svc.KEYS[name][0] + "=" + args);
			if (name === "Documents" && prop === "content") {
				const body = await readBody(req);
				const file = filePart(Buffer.isBuffer(body) ? body : Buffer.from(""), req.headers["content-type"]);
				if (!file) { throw httpError(400, "Please upload the file"); }
				const doc = { objectID: key.objectID, objectFolderID: "doc-" + Date.now().toString(36), objectType: key.objectType, mediatype: file.type, size: file.body.length };
				if (key.objectFolderID) { delete uploads[key.objectFolderID]; }
				uploads[doc.objectFolderID] = { type: file.type, body: file.body };
				const set = { User: "Users", Client: "Clients", Site: "Sites", Org: "Organisations" }[key.objectType];
				if (!set) { throw httpError(400, "Please pass the valid object type"); }
				const target = set === "Users" ? svc.db.Users.find((x) => x.EmployeeID === key.objectID) : svc.db[set].find((x) => x.ID === key.objectID);
				if (target) { target[set === "Users" ? "ImageObjectID" : "LogoObjectID"] = doc.objectFolderID; target[set === "Users" ? "ImageRootID" : "LogoRootID"] = "0dc65852-e10f-4a43-8cab-43397e9739e4"; }
				svc.db.Documents.push(doc);
				send(res, 200, { value: "Successfully uploaded" });
				return;
			}
			const row = svc.find(name, key);
			if (req.method === "GET") {
				if (!row) { throw httpError(404, "Not found"); }
				send(res, 200, Object.assign({ "@odata.context": "$metadata#" + name + "/$entity" }, svc.expandRow(name, row, svc.parseExpand(q.get("$expand")))));
				return;
			}
			if (req.method === "PATCH" || req.method === "PUT") {
				const body = await readBody(req);
				if (!row) {
					if (req.method === "PUT" || name === "WorkSchedule") { const created = svc.create(name, Object.assign({}, key, body)); send(res, 201, created); return; }
					throw httpError(404, "Not found");
				}
				if (name === "Users" && body.WorkSchedule) {
					const w = svc.db.WorkSchedule.find((x) => x.EmployeeID_EmployeeID === row.EmployeeID);
					if (w) { Object.assign(w, body.WorkSchedule); } else { svc.db.WorkSchedule.push(Object.assign({ EmployeeID_EmployeeID: row.EmployeeID }, body.WorkSchedule)); }
					delete body.WorkSchedule;
				}
				Object.assign(row, body, { modifiedAt: new Date().toISOString(), modifiedBy: sUser });
				send(res, 200, row);
				return;
			}
			if (req.method === "DELETE") {
				if (!row) { throw httpError(404, "Not found"); }
				svc.db[name] = svc.db[name].filter((r) => r !== row);
				if (name === "Users") { svc.db.WorkSchedule = svc.db.WorkSchedule.filter((w) => w.EmployeeID_EmployeeID !== row.EmployeeID); }
				send(res, 204);
				return;
			}
			throw httpError(405, "Method not allowed");
		} catch (e) {
			send(res, e.status || 500, { error: { code: String(e.status || 500), message: e.message } });
		}
	};
};
