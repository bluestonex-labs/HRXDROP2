/*
 * HRX services: every endpoint of the HRX CAP service, where the app uses it, and a live
 * check of each read endpoint. Writes are not probed (they would change data); the
 * counters show how each one has fared in this session.
 */
sap.ui.define(["../core", "../service", "../data", "../needed"], function (hrx, svc, data, needed) {
	"use strict";

	var root, results = {};
	var E = function (name, kind, used, probe) { return { name: name, kind: kind, used: used, probe: probe }; };
	function endpoints() {
		var t = hrx.iso(hrx.today()), mon = hrx.monday(hrx.today()), sMon = hrx.iso(mon), sSun = hrx.iso(hrx.addDays(mon, 6)), me = data.me || {};
		var top = function (set) { return function () { return svc[set].list({ $top: 1 }); }; };
		return [
			E("Organisations", "Entity", "Org of new users, clients and projects", top("Organisations")),
			E("Sites", "Entity", "Locations everywhere; Team Calendar site filter", top("Sites")),
			E("Contacts", "Entity", "Manage Clients — primary contact", top("Contacts")),
			E("Users", "Entity", "Manage Resources; people lists on every page", top("Users")),
			E("Clients", "Entity", "Manage Clients; reporting customers", top("Clients")),
			E("Projects", "Entity", "Manage Projects; billable vs internal everywhere", top("Projects")),
			E("Assets", "Entity", "Manage Resources — Assets tab", top("Assets")),
			E("AssetAssignment", "Entity", "Manage Resources — Assets tab", top("AssetAssignment")),
			E("WorkSchedule", "Entity", "Manage Resources — Working Time", top("WorkSchedule")),
			E("UserToProject", "Entity", "Manage Projects — Resourcing; Timesheet reporting; Team Calendar project filter", top("UserToProject")),
			E("BillingScheme", "Entity", "Manage Projects — Assign resource", top("BillingScheme")),
			E("TimeLog", "Entity", "Timesheet reporting, Utilisation, Home compliance and utilisation", function () { return svc.TimeLog.list({ $top: 1, $filter: "Date le " + t }); }),
			E("BankHolidays", "Entity", "Compliance targets; Manage Resources — Leave Taken", top("BankHolidays")),
			E("Leaves", "Entity", "My Leave requests and cancel; Leave management; Sickness", top("Leaves")),
			E("LeaveType", "Entity", "Leave type pickers and colours", top("LeaveType")),
			E("Bonus", "Entity", "(read through fetchMyBonus / fetchBonusHeader)", top("Bonus")),
			E("ContactObjectTypes", "Entity", "Contact type code C (client)", top("ContactObjectTypes")),
			E("Documents", "Entity (media)", "Resource picture, client logo upload", null),
			E("getUserDetail", "Function", "Sign-in, manager check, approver", function () { return svc.getUserDetail(); }),
			E("fetchAssignments", "Function", "My Timesheet, Quick Timesheet, health strip", function () { return svc.fetchAssignments(sMon, sSun); }),
			E("fetchUserDetails", "Function", "My Timesheet targets, Home rings, health strip", function () { return svc.fetchUserDetails(sMon, sSun); }),
			E("fetchUserLeave", "Function", "My Leave balance, health strip", function () { return svc.fetchUserLeave(); }),
			E("fetchLeaveAnalytics", "Function", "My Leave calendar legend counts", function () { return svc.fetchLeaveAnalytics(); }),
			E("leaveDates", "Function", "Bookable days for a new request", function () { return svc.leaveDates(t, t); }),
			E("leaveDatesForTeamCalendar", "Function", "Record sickness; Team Calendar booking", function () { return svc.leaveDatesForTeamCalendar(t, t, me.EmployeeID); }),
			E("fetchTeamCalendar", "Function", "Team Calendar; Home team today", function () { return svc.fetchTeamCalendar(t, t); }),
			E("leaveToApprove", "Function", "Pending approvals, notifications", function () { return svc.leaveToApprove(); }),
			E("fetchMyBonus", "Function", "My Bonus", function () { return svc.fetchMyBonus(); }),
			E("fetchBonusHeader", "Function", "My Bonus — bonus and pension %", function () { return svc.fetchBonusHeader(me.EmployeeID); }),
			E("fetchBonusUserList", "Function", "Manage Bonus", function () { var d = hrx.today(); return svc.fetchBonusUserList(d.getMonth() + 1, d.getFullYear()); }),
			E("fetchBonusList", "Function", "Manage Bonus — review", function () { var d = hrx.today(); return svc.fetchBonusList(d.getMonth() + 1, d.getFullYear(), me.BaseSite_ID, me.EmployeeID); }),
			E("saveTimesheetEntry", "Action", "My Timesheet save, Quick Timesheet", null),
			E("deleteTimesheetEntry", "Action", "My Timesheet — clear a day, Delete Project(s)", null),
			E("createLeaveRequest", "Action", "New Leave Request, Quick Leave", null),
			E("createLeaveRequestForTeamCalendar", "Action", "Record sickness, Team Calendar booking", null),
			E("actionOnLeave", "Action", "Approve / reject leave", null),
			E("submitBonus", "Action", "Manage Bonus — submit", null)
		];
	}
	function render(el) {
		root = el;
		el.innerHTML = "<button class=\"btn ghost\" type=\"button\" data-go=\"explorer\" style=\"margin-bottom:var(--gap)\"><i class=\"ti ti-arrow-left\" style=\"vertical-align:-2px;margin-right:6px\"></i>Back to App Explorer</button>" +
			"<div class=\"kpis\" id=\"svKpis\"></div>" +
			"<div class=\"card\"><div class=\"card-head\"><div><div class=\"card-title\">Endpoints</div><div class=\"card-hint\" id=\"svHint\" style=\"margin-top:3px\"></div></div><button class=\"btn primary sm\" id=\"svRun\" type=\"button\">" + hrx.ICON.refresh + "Check again</button></div><div id=\"svTable\"></div></div>" +
			"<div class=\"section-head\"><div class=\"section-title\">Services needed to complete the app</div><div class=\"section-hint\">Parts of the design the HRX service has no endpoint for. The app shows no sample data for them: each place says which service it needs.</div></div>" +
			"<div class=\"card\">" + hrx.tbl([{ h: "Needed for" }, { h: "Where it shows" }, { h: "Today" }, { h: "Endpoints needed" }], Object.keys(needed.ALL).map(function (k) {
				var n = needed.ALL[k];
				return ["<b>" + hrx.esc(n.title) + "</b>", "<span class=\"projs\">" + hrx.esc(n.where) + "</span>", "<span class=\"projs\">" + hrx.esc(n.now) + "</span>", n.needs.length ? needed.list(k) : "<span class=\"projs\">—</span>"];
			})) + "</div>";
		el.querySelector("#svRun").addEventListener("click", run);
	}
	async function run() {
		var list = endpoints();
		root.querySelector("#svHint").textContent = "Checking against " + svc.BASE + " …";
		paint(list);
		await Promise.all(list.filter(function (e) { return e.probe; }).map(function (e) {
			var t0 = performance.now();
			return e.probe().then(function () { results[e.name] = { ok: true, ms: Math.round(performance.now() - t0) }; }, function (err) { results[e.name] = { ok: false, msg: hrx.errText(err), status: err.status }; }).then(function () { paint(list); });
		}));
		root.querySelector("#svHint").textContent = list.length + " endpoints · checked " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " · " + svc.BASE;
	}
	function paint(list) {
		var ok = 0, bad = 0;
		list.forEach(function (e) { var r = results[e.name]; if (r && r.ok) { ok++; } else if (r) { bad++; } });
		root.querySelector("#svKpis").innerHTML = hrx.kpi("neu", "ti-plug-connected", "Endpoints in use", list.length, "", "Entities, functions and actions") + hrx.kpi("ok", "ti-circle-check", "Reads answering", ok, "", "Live check") + hrx.kpi(bad ? "crit" : "ok", "ti-alert-triangle", "Reads failing", bad, "", bad ? "See the table" : "None") + hrx.kpi("neu", "ti-pencil", "Writes", list.filter(function (e) { return !e.probe; }).length, "", "Not probed — used by the pages");
		root.querySelector("#svTable").innerHTML = hrx.tbl([{ h: "Endpoint" }, { h: "Kind" }, { h: "Used by" }, { h: "Status", al: "right" }], list.map(function (e) {
			var r = results[e.name], log = svc.log.find(function (x) { return x.name === e.name; });
			var status = e.probe ? (r ? (r.ok ? hrx.pill("ok", "Working · " + r.ms + " ms") : "<span title=\"" + hrx.esc(r.msg) + "\">" + hrx.pill("crit", "Failed" + (r.status ? " · " + r.status : "")) + "</span>") : hrx.pill("neu", "Checking…"))
				: (log ? (log.failed ? hrx.pill("crit", log.ok + " ok · " + log.failed + " failed") : hrx.pill("ok", log.ok + " ok this session")) : hrx.pill("info", "Write — not probed"));
			return ["<b>" + e.name + "</b>", e.kind, "<span class=\"projs\">" + hrx.esc(e.used) + "</span>", status];
		}));
	}
	return { render: render, load: run };
});
