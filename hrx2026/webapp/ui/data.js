/*
 * Shared state: who is signed in, whether they are a manager, the reference data every
 * page needs (people, sites, leave types, clients, projects, billing schemes), and the
 * calculations several pages share (leave grouping, weekly compliance, utilisation,
 * sickness policy triggers). All of it comes from the HRX service.
 */
sap.ui.define(["./core", "./service", "./config"], function (hrx, svc, config) {
	"use strict";

	var cache = {};
	function once(k, f) { if (!cache[k]) { cache[k] = f().catch(function (e) { delete cache[k]; throw e; }); } return cache[k]; }

	var USER_TYPE = { S: "Staff", C: "Contractor" };
	var PROJECT_TYPE = { "T&M": "Time & materials", "FP": "Fixed price", "INT": "Internal" };
	var STATUS_KEY = {};
	STATUS_KEY[svc.STATUS.requested] = "pending";
	STATUS_KEY[svc.STATUS.approved] = "approved";
	STATUS_KEY[svc.STATUS.rejected] = "rejected";

	var data = {
		me: null,
		role: "employee",
		realManager: false,
		USER_TYPE: USER_TYPE,
		PROJECT_TYPE: PROJECT_TYPE,
		STATUS_KEY: STATUS_KEY,

		/** Signs the user in: getUserDetail resolves the token's email to an HRX employee. */
		init: async function () {
			var u = await svc.getUserDetail();
			data.me = u;
			data.me.name = (u.FirstName + " " + u.LastName).trim();
			var sEmail = (await data.signedInEmail()).toLowerCase();
			var people = await data.users();
			var mine = people.find(function (p) { return p.EmployeeID === u.EmployeeID; });
			data.me.WorkEmail = (mine && mine.WorkEmail) || sEmail;
			data.realManager = !!u.isManager || config.MANAGER_EXCEPTIONS.indexOf((data.me.WorkEmail || "").toLowerCase()) !== -1 ||
				people.some(function (p) { return p.Manager_EmployeeID === u.EmployeeID; });
			data.role = data.realManager || config.TEST_SHOW_ALL ? "manager" : "employee";
			return data.me;
		},
		isManager: function () { return data.role === "manager"; },

		/** The email the approuter signed the user in with (empty when there is no approuter, as in local runs). */
		signedInEmail: async function () {
			try {
				var r = await fetch(sap.ui.require.toUrl("bsx/hrx/hrx2026") + "/user-api/currentUser", { credentials: "include" });
				if (r.ok) { return (await r.json()).email || ""; }
			} catch (e) { /* local runs have no user API */ }
			return "";
		},

		/**
		 * Works out why getUserDetail could not resolve the signed-in user. The service
		 * looks the user up by the exact email in their login, so a record that differs
		 * only in upper/lower case is not found.
		 * @returns {Promise<object>} { email, match } - match is the HRX user with that email in any case, if any
		 */
		diagnoseSignIn: async function () {
			var sEmail = await data.signedInEmail(), match = null;
			if (sEmail) {
				try {
					var a = await svc.Users.list({ $select: "EmployeeID,FirstName,LastName,WorkEmail,IsActive", $filter: "tolower(WorkEmail) eq " + svc.q(sEmail.toLowerCase()) });
					match = a[0] || null;
				} catch (e) { /* the diagnosis is best effort */ }
			}
			return { email: sEmail, match: match };
		},

		/* ── reference data ── */
		users: function () {
			return once("users", function () {
				return svc.Users.list({ $select: "EmployeeID,FirstName,LastName,WorkEmail,MobileNo,UserType,BaseSite_ID,Manager_EmployeeID,TargetUtilization,TargetHrsPerWeek,BonusPercent,PercentRate,IsActive,OrgID_ID,ImageRootID,ImageObjectID", $orderby: "FirstName,LastName" })
					.then(function (a) { data._people = {}; a.forEach(function (p) { p.name = ((p.FirstName || "") + " " + (p.LastName || "")).trim(); data._people[p.EmployeeID] = p; }); return a; });
			});
		},
		/**
		 * Address of a profile picture or logo in SAP Document Management, the way hrx2023
		 * shows them: the approuter route /browser/* goes to the subaccount destination
		 * dms_service. Empty when nothing has been uploaded.
		 */
		photoUrl: function (sRootId, sObjectId) {
			if (!sObjectId) { return ""; }
			return sap.ui.require.toUrl("bsx/hrx/hrx2026") + "/browser/" + encodeURIComponent(sRootId || config.DMS_REPOSITORY) + "/root?cmisselector=content&objectId=" + encodeURIComponent(sObjectId);
		},
		/** the picture of an HRX employee, by employee ID (from the cached people list) */
		photoOf: function (sEmpId) { var p = data._people && data._people[sEmpId]; return p ? data.photoUrl(p.ImageRootID, p.ImageObjectID) : ""; },
		/** initials with the employee's picture over them, if they have one */
		face: function (sEmpId, sName) { return hrx.initials(sName) + hrx.photo(data.photoOf(sEmpId)); },
		sites: function () { return once("sites", function () { return svc.Sites.list({ $orderby: "SiteDesc" }); }); },
		leaveTypes: function () { return once("leaveTypes", function () { return svc.LeaveType.list({ $orderby: "LeaveCategoryDesc" }); }); },
		clients: function () { return once("clients", function () { return svc.Clients.list({ $orderby: "ClientName" }); }); },
		projects: function () { return once("projects", function () { return svc.Projects.list({ $expand: "ClientID($select=ID,ClientName)", $orderby: "ProjectDesc" }); }); },
		billingSchemes: function () { return once("billing", function () { return svc.BillingScheme.list({ $orderby: "BillingDesc" }); }); },
		orgId: function () { return data.me && data.me.OrgID_ID; },
		invalidate: function () { Array.prototype.forEach.call(arguments, function (k) { delete cache[k]; }); },

		// lookups after the lists above have loaded
		_byId: {},
		index: async function () {
			var r = await Promise.all([data.users(), data.sites(), data.projects(), data.clients()]);
			var ix = { user: {}, site: {}, project: {}, client: {} };
			r[0].forEach(function (x) { ix.user[x.EmployeeID] = x; });
			r[1].forEach(function (x) { ix.site[x.ID] = x; });
			r[2].forEach(function (x) { ix.project[x.ID] = x; });
			r[3].forEach(function (x) { ix.client[x.ID] = x; });
			data._byId = ix;
			return ix;
		},
		userName: function (id) { var u = data._byId.user && data._byId.user[id]; return u ? u.name : (id || ""); },
		siteName: function (id) { var s = data._byId.site && data._byId.site[id]; return s ? s.SiteDesc : (id || ""); },
		projectTypeLabel: function (t) { return PROJECT_TYPE[t] || t || "—"; },
		userTypeLabel: function (t) { return USER_TYPE[t] || t || "—"; },
		isBillable: function (p) { return !!p && p.ProjectType !== "INT"; },

		/* ── leave ── */
		durationLabel: function (sDayTime) { return sDayTime === "AM" ? "Half day — AM" : sDayTime === "PM" ? "Half day — PM" : "Full day"; },
		dayValue: function (sDayTime) { return sDayTime === "Full Day" ? 1 : 0.5; },
		/**
		 * Leave is stored one row per day; a request is the set of rows sharing a LeaveGrpID.
		 * @param {object[]} aRows Leaves rows, with LeaveCategoryId, Status and EmpID expanded or as ids
		 * @returns {object[]} one entry per request, newest first
		 */
		groupLeaves: function (aRows) {
			var m = {};
			aRows.forEach(function (r) {
				var k = r.LeaveGrpID || r.ID;
				var g = m[k] || (m[k] = { id: k, ids: [], rows: [], days: 0, dayTimes: {} });
				g.ids.push(r.ID); g.rows.push(r);
				g.days += data.dayValue(r.DayTime);
				g.dayTimes[r.DayTime] = 1;
				g.start = !g.start || r.StartDate < g.start ? r.StartDate : g.start;
				g.end = !g.end || r.StartDate > g.end ? r.StartDate : g.end;
				g.empId = r.EmpID_EmployeeID || (r.EmpID && r.EmpID.EmployeeID);
				g.name = r.EmpID && r.EmpID.FirstName ? (r.EmpID.FirstName + " " + r.EmpID.LastName) : data.userName(g.empId);
				g.type = (r.LeaveCategoryId && r.LeaveCategoryId.LeaveCategoryDesc) || r.LeaveCategoryDesc || "";
				g.statusId = r.Status_ID || (r.Status && r.Status.ID);
				g.status = STATUS_KEY[g.statusId] || (r.Status && r.Status.StatusDesc === "Requested" ? "pending" : (r.Status && r.Status.StatusDesc || "").toLowerCase());
				g.comment = r.RequesterComments || g.comment || "";
				g.note = r.ApproverComments || g.note || "";
				g.approver = r.ApproverID_EmployeeID || (r.ApproverID && r.ApproverID.EmployeeID);
			});
			return Object.keys(m).map(function (k) {
				var g = m[k], dt = Object.keys(g.dayTimes);
				g.duration = dt.length === 1 ? data.durationLabel(dt[0]) : "Mixed";
				g.label = hrx.rangeLabel(g.start, g.end);
				return g;
			}).sort(function (a, b) { return b.start.localeCompare(a.start); });
		},
		/**
		 * fetchUserLeave's answer (user with quota, days taken, bank holidays). If that function
		 * fails on the service, the same answer is read from WorkSchedule, Leaves and
		 * BankHolidays, and the failure is kept in .error.
		 * @param {object[]} [aLeaves] the user's Leaves rows (with LeaveCategoryId and Status), if already read
		 */
		userLeave: async function (aLeaves) {
			try {
				return await svc.fetchUserLeave();
			} catch (e) {
				var me = data.me, b = data.leaveBalance(null), emp = svc.q(me.EmployeeID);
				var r = await Promise.all([
					svc.WorkSchedule.list({ $filter: "EmployeeID_EmployeeID eq " + emp }).catch(function () { return []; }),
					aLeaves || svc.Leaves.list({ $filter: "EmpID_EmployeeID eq " + emp, $expand: "LeaveCategoryId($select=ID,LeaveCategoryDesc,isAccountable),Status($select=ID,StatusDesc)" }),
					me.BaseSite_ID ? svc.BankHolidays.list({ $filter: "Site_ID eq " + me.BaseSite_ID + " and Date ge " + b.from + " and Date le " + b.to }).catch(function () { return []; }) : []
				]);
				console.warn("[HRX] fetchUserLeave failed (" + hrx.errText(e) + "); leave balance worked out from WorkSchedule and Leaves instead");
				return {
					error: "fetchUserLeave: " + hrx.errText(e),
					user: { EmployeeID: me.EmployeeID, AnnualLeaveQuota: (r[0][0] || {}).AnnualLeaveQuota },
					availedLeaves: r[1].map(function (l) {
						var c = l.LeaveCategoryId || {};
						return { LeaveTypeID: c.ID, LeaveCategoryDesc: c.LeaveCategoryDesc, IsAccountable: c.isAccountable, Absence: l.DayTime, Date: l.StartDate,
							Status: l.Status_ID === svc.STATUS.rejected ? "Rejected" : ((l.Status && l.Status.StatusDesc) || "") };
					}),
					bankHolidays: r[2]
				};
			}
		},
		/**
		 * Quota, booked and remaining days for this leave year (April to March, as the
		 * service counts it), from fetchUserLeave. Booked counts requested and approved
		 * leave of the types that come off the allowance; rejected requests do not count.
		 */
		leaveBalance: function (oUserLeave) {
			var u = (oUserLeave && oUserLeave.user) || {};
			var quota = parseFloat(u.AnnualLeaveQuota) || 0;
			var d = hrx.today(), y0 = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
			var from = y0 + "-04-01", to = (y0 + 1) + "-03-31";
			var booked = ((oUserLeave && oUserLeave.availedLeaves) || []).filter(function (l) { return l.IsAccountable && l.Status !== "Rejected" && l.Date >= from && l.Date <= to; })
				.reduce(function (n, l) { return n + (l.Absence === "Full Day" ? 1 : 0.5); }, 0);
			return { quota: quota, booked: booked, remaining: quota - booked, from: from, to: to };
		},
		statusPill: function (s) { return s === "pending" ? hrx.pill("warn", "Requested") : s === "approved" ? hrx.pill("ok", "Approved") : hrx.pill("crit", "Rejected"); },

		/**
		 * Builds the per-day leave rows for a request, keeping only the dates the service
		 * says can be booked (working days, no bank holiday, no leave already taken).
		 */
		leaveRows: function (aDates, o) {
			var sDayTime = o.duration === "AM" ? "AM" : o.duration === "PM" ? "PM" : "Full Day";
			return aDates.map(function (d) {
				return { IsPaid: o.type !== "Unpaid", LeaveCategoryId_ID: o.typeId, NoOfDays: sDayTime === "Full Day" ? "1" : "0.5", StartDate: d, EndDate: d, DayTime: sDayTime,
					ApprovalRequired: true, ApproverID_EmployeeID: o.approver || null, RequesterComments: o.comment || null, EmpID_EmployeeID: o.emp };
			});
		},

		/* ── time ── */
		/**
		 * Weekly booking status for everyone active: hours booked this week against the
		 * hours due so far, after leave and bank holidays.
		 */
		weekCompliance: async function (dMonday) {
			var mon = hrx.iso(dMonday), sun = hrx.iso(hrx.addDays(dMonday, 6)), today = hrx.today();
			var r = await Promise.all([
				svc.TimeLog.list({ $select: "Employee_EmployeeID,Hours,Date", $filter: "Date ge " + mon + " and Date le " + sun }),
				svc.Leaves.list({ $select: "EmpID_EmployeeID,StartDate,DayTime,Status_ID", $filter: "StartDate ge " + mon + " and StartDate le " + sun + " and Status_ID eq " + svc.STATUS.approved }),
				svc.BankHolidays.list({ $select: "Site_ID,Date", $filter: "Date ge " + mon + " and Date le " + sun }),
				data.users()
			]);
			var booked = {}, off = {};
			r[0].forEach(function (t) { booked[t.Employee_EmployeeID] = (booked[t.Employee_EmployeeID] || 0) + hrx.mins(t.Hours); });
			r[1].forEach(function (l) { (off[l.EmpID_EmployeeID] = off[l.EmpID_EmployeeID] || {})[l.StartDate] = data.dayValue(l.DayTime); });
			return r[3].filter(function (u) { return u.IsActive !== false; }).map(function (u) {
				var weekly = (parseFloat(u.TargetHrsPerWeek) || 40) * 60, perDay = weekly / 5, target = 0, due = 0;
				for (var i = 0; i < 5; i++) {
					var d = hrx.addDays(dMonday, i), s = hrx.iso(d);
					var hol = r[2].some(function (h) { return h.Site_ID === u.BaseSite_ID && h.Date === s; });
					var lv = (off[u.EmployeeID] || {})[s] || 0;
					var mins = hol ? 0 : perDay * (1 - lv);
					target += mins;
					if (d <= today) { due += mins; }
				}
				var b = booked[u.EmployeeID] || 0;
				var st = b >= target && target > 0 ? "full" : b >= due ? "track" : b > 0 ? "under" : "none";
				if (target === 0) { st = "full"; }
				return { id: u.EmployeeID, name: u.name, site: u.BaseSite_ID, booked: b, target: target, due: due, state: st };
			});
		},
		complianceOf: function (aWeek) {
			if (!aWeek.length) { return 100; }
			return Math.round(aWeek.filter(function (w) { return w.state === "full" || w.state === "track"; }).length / aWeek.length * 100);
		},

		/**
		 * Billable and total days per person from TimeLog over a period; internal projects
		 * (ProjectType INT) are not billable.
		 */
		utilisation: async function (sFrom, sTo, aEmpIds) {
			var q = { $select: "Employee_EmployeeID,Project_ID,Hours", $filter: "Date ge " + sFrom + " and Date le " + sTo };
			if (aEmpIds) { q.$filter += " and " + svc.inList("Employee_EmployeeID", aEmpIds); }
			var r = await Promise.all([svc.TimeLog.list(q), data.index()]);
			var by = {};
			r[0].forEach(function (t) {
				var o = by[t.Employee_EmployeeID] || (by[t.Employee_EmployeeID] = { id: t.Employee_EmployeeID, billable: 0, total: 0, projects: {} });
				var d = hrx.mins(t.Hours) / 480, p = r[1].project[t.Project_ID];
				o.total += d;
				if (data.isBillable(p)) { o.billable += d; o.projects[p.ProjectDesc] = 1; }
			});
			return Object.keys(by).map(function (k) {
				var o = by[k];
				return { id: o.id, name: data.userName(o.id), billable: o.billable, total: o.total, projects: Object.keys(o.projects).sort() };
			});
		},

		/* ── sickness ── */
		SICK_RULE: "3 or more separate absences in a rolling 6 month period",
		sickness: async function () {
			var types = await data.leaveTypes();
			var sick = types.find(function (t) { return /sick/i.test(t.LeaveCategoryDesc); });
			if (!sick) { return []; }
			var from = hrx.iso(hrx.addDays(hrx.today(), -365));
			var rows = await svc.Leaves.list({ $filter: "LeaveCategoryId_ID eq " + sick.ID + " and StartDate ge " + from + " and Status_ID ne " + svc.STATUS.rejected, $expand: "EmpID($select=EmployeeID,FirstName,LastName)", $orderby: "StartDate desc" });
			return data.groupLeaves(rows);
		},
		triggers: function (aSick) {
			var from = hrx.iso(hrx.addDays(hrx.today(), -183)), by = {};
			aSick.forEach(function (a) { if (a.start >= from && a.start <= hrx.iso(hrx.today())) { (by[a.empId] = by[a.empId] || []).push(a); } });
			var st = data.triggerState();
			return Object.keys(by).filter(function (k) { return by[k].length >= 3; }).map(function (k) {
				var list = by[k], s = st[k] || { status: "open", note: "" };
				return { id: k, name: list[0].name, list: list, days: list.reduce(function (n, x) { return n + x.days; }, 0), status: s.status, note: s.note, from: list[list.length - 1].start, to: list[0].end };
			}).sort(function (a, b) { return a.name.localeCompare(b.name); });
		},
		// trigger follow-ups have no HRX entity yet: kept in this browser only
		triggerState: function () { try { return JSON.parse(localStorage.getItem("hrxTriggerState") || "{}"); } catch (e) { return {}; } },
		setTriggerState: function (id, o) { var s = data.triggerState(); s[id] = o; try { localStorage.setItem("hrxTriggerState", JSON.stringify(s)); } catch (e) { /* private window */ } }
	};
	return data;
});
