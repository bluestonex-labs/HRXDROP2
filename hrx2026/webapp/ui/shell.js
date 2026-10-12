/*
 * The HRX frame: side rail, top bar, health strip, notifications, the "View as" switch,
 * and the page area. Pages are modules under ./pages; the UI5 router decides which one
 * is on screen, so deep links and the launchpad's back button keep working.
 */
sap.ui.define([
	"./core", "./service", "./data", "./config",
	"./pages/home", "./pages/timesheet", "./pages/leave", "./pages/teamcal", "./pages/mydocs", "./pages/explorer",
	"./pages/sickness", "./pages/leaveadmin", "./pages/documents", "./pages/tsreport", "./pages/utilisation",
	"./pages/resources", "./pages/clients", "./pages/projects", "./pages/services"
], function (hrx, svc, data, config, home, timesheet, leave, teamcal, mydocs, explorer, sickness, leaveadmin, documents, tsreport, utilisation, resources, clients, projects, services) {
	"use strict";

	var I = function (d) { return "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\">" + d + "</svg>"; };
	var NAV = [
		{ k: "dashboard", route: "home", label: "Home", page: home, icon: I("<rect x=\"3\" y=\"3\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"5\" rx=\"1.5\"/><rect x=\"14\" y=\"12\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"3\" y=\"16\" width=\"7\" height=\"5\" rx=\"1.5\"/>") },
		{ k: "timesheet", route: "timesheet", label: "My Timesheet", page: timesheet, icon: I("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 3\"/>") },
		{ k: "leave", route: "leave", label: "My Leave", page: leave, icon: I("<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 10h18\"/>") },
		{ k: "teamcal", route: "teamcal", label: "Team Calendar", page: teamcal, icon: I("<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4M7 14h3M7 17h3M14 14h3M14 17h3\"/>") },
		{ k: "mydocs", route: "mydocs", label: "Policies to read", page: mydocs, icon: I("<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6M16 13H8M16 17H8M10 9H8\"/>") },
		{ k: "expenses", soon: true, label: "Expenses", icon: I("<path d=\"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z\"/><path d=\"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11\"/>") },
		{ k: "explorer", route: "explorer", label: "App Explorer", page: explorer, icon: I("<rect x=\"4\" y=\"4\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"13\" y=\"4\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"4\" y=\"13\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"13\" y=\"13\" width=\"7\" height=\"7\" rx=\"1.5\"/>") },
		{ group: "Admin only" },
		{ k: "sickness", route: "sickness", label: "Sickness", admin: true, page: sickness, icon: I("<path d=\"M11 2v2M5 2v2\"/><path d=\"M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1\"/><path d=\"M8 15a6 6 0 0 0 12 0v-3\"/><circle cx=\"20\" cy=\"10\" r=\"2\"/>") },
		{ k: "leaveadmin", route: "leaveadmin", label: "Leave management", admin: true, page: leaveadmin, icon: I("<rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/><path d=\"m9 16 2 2 4-4\"/>") },
		{ k: "documents", route: "documents", label: "Documents", admin: true, page: documents, icon: I("<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>") },
		{ k: "tsreport", route: "tsreport", label: "Timesheet reporting", admin: true, page: tsreport, icon: I("<rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\"/><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><path d=\"M12 11h4M12 16h4M8 11h.01M8 16h.01\"/>") },
		{ k: "utilisation", route: "utilisation", label: "Utilisation", admin: true, page: utilisation, icon: I("<path d=\"M22 12h-4l-3 9L9 3l-3 9H2\"/>") },
		{ k: "resources", route: "resources", label: "Manage Resources", admin: true, page: resources, icon: I("<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75\"/>") },
		{ k: "clients", route: "clients", label: "Manage Clients", admin: true, page: clients, icon: I("<rect x=\"4\" y=\"2\" width=\"16\" height=\"20\" rx=\"2\"/><path d=\"M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01\"/>") },
		{ k: "projects", route: "projects", label: "Manage Projects", admin: true, page: projects, icon: I("<rect x=\"2\" y=\"7\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16\"/>") }
	];
	// pages reached from App Explorer, not from the rail
	var SUB = [
		{ k: "mybonus", route: "mybonus", label: "My Bonus", parent: "explorer", page: explorer.myBonus },
		{ k: "managebonus", route: "managebonus", label: "Manage Bonus", parent: "explorer", admin: true, page: explorer.manageBonus },
		{ k: "services", route: "services", label: "HRX services", parent: "explorer", page: services }
	];
	var ALL = NAV.filter(function (n) { return n.k && !n.soon; }).concat(SUB);

	var shell = {
		router: null,
		current: null,
		mount: function (el, oRouter) {
			shell.router = oRouter;
			hrx.root = el;
			hrx.go = shell.go;
			el.classList.add("hrx");
			el.innerHTML = shell.frame();
			shell.wire();
			return data.init().then(function () {
				shell.renderWho();
				shell.applyRole();
				shell.refreshHealth();
				shell.notifications.load();
				hrx.on("pending", function () { shell.refreshHealth(); shell.notifications.load(); });
				hrx.on("leave", function () { shell.refreshHealth(); });
				hrx.on("me", function () { shell.renderWho(); });
				hrx.on("time", function () { shell.refreshHealth(); shell.notifications.load(); });
				oRouter.attachRouteMatched(function (e) { shell.show(e.getParameter("name")); });
				oRouter.initialize();
			}, function (e) { return shell.signInFailed(el, e); });
		},

		/** Explains a failed sign-in: who the user is signed in as, and what HRX has (or lacks) for them. */
		signInFailed: async function (el, e) {
			el.querySelector("#pgTitle").textContent = "Sign-in failed";
			el.querySelector("#sideName").textContent = "Not signed in";
			el.querySelector("#healthStrip").innerHTML = "<span class=\"hpill crit\"><span class=\"hdot\"></span>Not signed in to HRX</span>";
			var box = el.querySelector(".scroll");
			box.innerHTML = "<div class=\"card\">" + hrx.loading("Checking your HRX record…") + "</div>";
			var d = await data.diagnoseSignIn(), title, text;
			if (e && e.status === 401) {
				title = "Your session has expired";
				text = "Reload the page to sign in again.";
			} else if (!d.email) {
				title = "You could not be signed in to HRX";
				text = "The HRX service could not identify you from your login (getUserDetail: " + hrx.errText(e) + ").";
			} else if (d.match && d.match.WorkEmail !== d.email) {
				title = "Your HRX record's email differs in case";
				text = "You are signed in as " + d.email + ". HRX has you as " + (d.match.FirstName + " " + d.match.LastName).trim() + " (" + d.match.EmployeeID + ") with the work email " + d.match.WorkEmail +
					". The HRX service matches emails exactly, so ask an HRX administrator to change that work email to " + d.email + ".";
			} else if (d.match) {
				title = "You could not be signed in to HRX";
				text = "You are signed in as " + d.email + ", which HRX knows as " + d.match.EmployeeID + ", but getUserDetail failed: " + hrx.errText(e);
			} else {
				title = "You are not set up in HRX yet";
				text = "You are signed in as " + d.email + ", but the HRX service has no employee with that work email (getUserDetail: " + hrx.errText(e) + "). Ask an HRX administrator to add you as an employee with exactly that work email.";
			}
			box.innerHTML = "<div class=\"card\">" + hrx.empty(title, text) + "</div>";
		},

		frame: function () {
			var nav = "<div class=\"nav-group\">Overview</div>";
			var admin = false;
			NAV.forEach(function (n) {
				if (n.group) { nav += "<div class=\"nav-admin\"><div class=\"nav-group\">" + n.group + "</div>"; admin = true; return; }
				if (n.soon) {
					nav += "<button class=\"soon\" type=\"button\" aria-disabled=\"true\" data-label=\"" + n.label + " — coming soon\" title=\"" + n.label + " — coming soon, in its own app\">" + n.icon + "<span class=\"nav-label\">" + n.label + "</span><span class=\"nav-soon\">Soon</span></button>";
					return;
				}
				nav += "<button type=\"button\" data-view=\"" + n.k + "\" data-label=\"" + n.label + "\">" + n.icon + "<span class=\"nav-label\">" + n.label + "</span></button>";
			});
			if (admin) { nav += "</div>"; }
			var views = ALL.map(function (n) { return "<div class=\"view\" id=\"view-" + n.k + "\"></div>"; }).join("");
			var collapsed = false;
			try { collapsed = sessionStorage.getItem("hrxNavCollapsed") === "1"; } catch (e) { /* no storage */ }
			return "<div class=\"app" + (collapsed ? " nav-collapsed" : "") + "\" id=\"app\" data-role=\"employee\">" +
				"<aside class=\"side\"><div class=\"brand\"><div class=\"brandmark\"><img class=\"brandimg\" src=\"" + sap.ui.require.toUrl("bsx/hrx/hrx2026/img/hrx-logo.png") + "\" alt=\"HRX\"/></div>" +
				"<button class=\"nav-toggle\" id=\"navToggle\" type=\"button\" title=\"Toggle navigation\"><svg class=\"icon-collapse\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M15 18l-6-6 6-6\"/></svg><svg class=\"icon-hamburger\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18M3 12h18M3 18h18\"/></svg></button></div>" +
				"<nav class=\"sidenav\">" + nav + "</nav>" +
				"<div class=\"side-foot\"><div class=\"side-avatar\" id=\"sideAvatar\">··</div><div class=\"side-who\"><b id=\"sideName\">Signing in…</b><span id=\"sideRoleLabel\"></span></div>" +
				"<button class=\"side-bell\" id=\"bellBtn\" type=\"button\" title=\"Notifications\" aria-label=\"Notifications\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\"/><path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\"/></svg><span class=\"bell-badge\" id=\"bellBadge\" hidden>0</span></button></div>" +
				(config.TEST_SHOW_ALL ? "<div class=\"role-demo\" id=\"roleDemo\"><span>View as (testing)</span><select id=\"roleToggle\"><option value=\"employee\">Employee</option><option value=\"manager\" selected>Manager</option></select></div>" : "") +
				"</aside>" +
				"<div class=\"nav-scrim\" id=\"navScrim\"></div>" +
				"<main class=\"main\"><div class=\"topbar\"><button class=\"nav-burger\" id=\"navBurger\" type=\"button\" title=\"Menu\" aria-label=\"Open navigation\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M3 6h18M3 12h18M3 18h18\"/></svg></button><div class=\"crumb\"><div class=\"eyebrow\">HR Suite</div><div class=\"pg-title\" id=\"pgTitle\">Home</div></div><div class=\"topbar-right\" id=\"topbarRight\"></div></div>" +
				"<div class=\"health-strip\" id=\"healthStrip\"><span class=\"hpill ok\"><span class=\"hdot\"></span>Loading…</span></div>" +
				"<div class=\"scroll\" id=\"scroll\">" + views + "</div></main></div>" +
				"<div class=\"modal-ov\"><div class=\"modal\" role=\"dialog\" aria-modal=\"true\"><div class=\"modal-head\"><div class=\"modal-title\"></div></div><div class=\"modal-body\"></div><div class=\"modal-foot\"></div></div></div>" +
				"<div class=\"toast-wrap\"></div>" +
				"<div class=\"notif-pop\" id=\"notifPop\" role=\"dialog\" aria-label=\"Notifications\"><div class=\"notif-head\"><div class=\"notif-title\">Notifications</div><div class=\"notif-count\" id=\"notifCount\"></div></div><div class=\"notif-list\" id=\"notifList\"></div><div class=\"notif-foot\"><button class=\"btn ghost\" id=\"notifMarkAll\" type=\"button\">Mark all as read</button><button class=\"btn ghost\" id=\"notifClose\" type=\"button\">Close</button></div></div>";
		},

		wire: function () {
			var root = hrx.root, app = root.querySelector("#app");
			root.querySelector(".sidenav").addEventListener("click", function (e) {
				var b = e.target.closest("button[data-view]"); if (b) { shell.closeDrawer(); shell.go(b.dataset.view); }
			});
			// phones and tablets: the side rail is a drawer, opened from the top bar
			root.querySelector("#navBurger").addEventListener("click", function () { app.classList.add("nav-open"); });
			root.querySelector("#navScrim").addEventListener("click", shell.closeDrawer);
			document.addEventListener("keydown", function (e) { if (e.key === "Escape") { shell.closeDrawer(); } });
			var fit = function () { if (shell.isNarrow()) { app.classList.remove("nav-collapsed"); } else { shell.closeDrawer(); } };
			window.addEventListener("resize", fit); fit();
			root.querySelector("#navToggle").addEventListener("click", function () {
				if (shell.isNarrow()) { shell.closeDrawer(); return; }
				app.classList.toggle("nav-collapsed");
				try { sessionStorage.setItem("hrxNavCollapsed", app.classList.contains("nav-collapsed") ? "1" : "0"); } catch (e) { /* no storage */ }
			});
			var sel = root.querySelector("#roleToggle");
			if (sel) {
				sel.addEventListener("change", function () {
					data.role = sel.value;
					shell.applyRole();
					shell.refreshHealth();
					shell.notifications.load();
					if (data.role === "employee" && shell.current && shell.current.admin) { shell.go("dashboard"); return; }
					if (shell.current && shell.current.page && shell.current.page.load) { shell.current.page.load(); }
				});
			}
			// any [data-go] link anywhere navigates
			root.addEventListener("click", function (e) { var g = e.target.closest("[data-go]"); if (g && !g.closest(".notif-pop")) { shell.go(g.dataset.go); } });
			shell.notifications.wire();
		},

		NARROW: "(max-width: 900px)",
		isNarrow: function () { return window.matchMedia(shell.NARROW).matches; },
		closeDrawer: function () { var a = hrx.root && hrx.root.querySelector("#app"); if (a) { a.classList.remove("nav-open"); } },

		go: function (k) {
			var n = ALL.find(function (x) { return x.k === k; });
			if (n) { shell.router.navTo(n.route); }
		},

		show: function (sRoute) {
			var n = ALL.find(function (x) { return x.route === sRoute; }) || ALL[0];
			if (n.admin && !data.isManager()) { shell.go("dashboard"); return; }
			var root = hrx.root;
			root.querySelectorAll(".sidenav button").forEach(function (b) { b.classList.toggle("on", b.dataset.view === (n.parent || n.k)); });
			root.querySelectorAll(".view").forEach(function (v) { v.classList.remove("on"); });
			var el = root.querySelector("#view-" + n.k);
			el.classList.add("on");
			root.querySelector("#pgTitle").textContent = n.label;
			shell.current = n;
			// page-level actions sit in the top bar, right of the title
			var tr = root.querySelector("#topbarRight");
			tr.querySelectorAll(".topbar-actions").forEach(function (a) { a.style.display = a.dataset.view === n.k ? "" : "none"; });
			if (!n.rendered) {
				n.rendered = true;
				n.page.render(el);
				var pa = el.querySelector(":scope > .page-actions");
				if (pa) { pa.dataset.view = n.k; pa.classList.add("topbar-actions"); tr.appendChild(pa); }
			}
			if (n.page.load) { n.page.load(); }
			root.querySelector("#scroll").scrollTop = 0;
		},

		renderWho: function () {
			var me = data.me, root = hrx.root;
			root.querySelector("#sideAvatar").innerHTML = hrx.esc(hrx.initials(me.name)) + hrx.photo(data.photoUrl(me.ImageRootID, me.ImageObjectID));
			root.querySelector("#sideName").textContent = me.name;
			shell.roleLabel();
		},
		roleLabel: function () {
			var me = data.me;
			hrx.root.querySelector("#sideRoleLabel").textContent = (data.realManager ? "Manager" : data.userTypeLabel(me.UserType)) + " · " + me.EmployeeID;
		},
		applyRole: function () {
			hrx.root.querySelector("#app").dataset.role = data.role;
			var sel = hrx.root.querySelector("#roleToggle");
			if (sel) { sel.value = data.role; }
		},

		/* ── health strip ── */
		refreshHealth: async function () {
			var strip = hrx.root.querySelector("#healthStrip");
			var mon = hrx.monday(hrx.today()), sMon = hrx.iso(mon), sSun = hrx.iso(hrx.addDays(mon, 6));
			var parts = [];
			try {
				var r = await Promise.all([
					svc.fetchAssignments(sMon, sSun),
					svc.fetchUserDetails(sMon, sSun),
					data.userLeave(),
					data.isManager() ? svc.leaveToApprove() : Promise.resolve([])
				]);
				var booked = 0;
				(r[0].Assignments || []).forEach(function (a) { (a.TimeLogEntries || []).forEach(function (t) { booked += hrx.mins(t.Hours); }); });
				var due = shell.dueMinutes(r[1], mon);
				var ok = booked >= due;
				parts.push("<span class=\"hpill " + (ok ? "ok" : "warn") + "\">" + (ok ? "<span class=\"hdot\"></span>Timesheet on track" : "<i class=\"ti ti-alert-triangle\" style=\"font-size:12px\"></i>Timesheet " + hrx.hhmm(due - booked) + " hrs behind") + "</span>");
				var n = data.groupLeaves(r[3] || []).length;
				if (data.isManager() && n) { parts.push("<span class=\"hpill warn\" id=\"hpApprovals\" data-go=\"leaveadmin\" style=\"cursor:pointer\"><i class=\"ti ti-alert-triangle\" style=\"font-size:12px\"></i>" + n + (n === 1 ? " approval pending" : " approvals pending") + "</span>"); }
				var bal = shell.leaveBalance(r[2]);
				parts.push("<span class=\"hpill ok\"><span class=\"hdot\"></span>Leave balance " + hrx.num(bal.remaining, bal.remaining % 1 ? 1 : 0) + " days</span>");
				strip.innerHTML = parts.join("");
			} catch (e) {
				strip.innerHTML = "<span class=\"hpill crit\"><span class=\"hdot\"></span>HRX service unavailable — " + hrx.esc(hrx.errText(e)) + "</span>";
			}
		},
		/** minutes due so far this week: working days up to today, less leave and bank holidays */
		dueMinutes: function (oDetails, mon) {
			var perDay = ((parseFloat(oDetails && oDetails.Users && oDetails.Users.targetHrsPerWeek) || 40) * 60) / 5, due = 0, today = hrx.today();
			var ws = (oDetails && oDetails.WorkSchedule) || {};
			for (var i = 0; i < 7; i++) {
				var d = hrx.addDays(mon, i), s = hrx.iso(d);
				if (d > today) { break; }
				var works = ws[hrx.DOW_FULL[d.getDay()]];
				if (works === undefined) { works = d.getDay() !== 0 && d.getDay() !== 6; }
				if (!works) { continue; }
				if ((oDetails.BankHoliday || []).some(function (h) { return h.Date === s; })) { continue; }
				var lv = (oDetails.Leaves || []).filter(function (l) { return l.StartDate === s; }).reduce(function (n, l) { return n + data.dayValue(l.DayTime); }, 0);
				due += perDay * Math.max(0, 1 - lv);
			}
			return due;
		},
		leaveBalance: function (oUserLeave) { return data.leaveBalance(oUserLeave); },

		/* ── notifications ── derived from live data; read state is kept in this browser */
		notifications: {
			items: [],
			readSet: function () { try { return JSON.parse(localStorage.getItem("hrxNotifRead") || "[]"); } catch (e) { return []; } },
			markRead: function (aIds) { var s = shell.notifications.readSet(); aIds.forEach(function (i) { if (s.indexOf(i) === -1) { s.push(i); } }); try { localStorage.setItem("hrxNotifRead", JSON.stringify(s.slice(-300))); } catch (e) { /* no storage */ } },
			load: async function () {
				var items = [], me = data.me, mon = hrx.monday(hrx.today());
				try {
					var r = await Promise.all([
						data.isManager() ? svc.leaveToApprove() : Promise.resolve([]),
						svc.Leaves.list({ $filter: "EmpID_EmployeeID eq " + svc.q(me.EmployeeID) + " and Status_ID ne " + svc.STATUS.requested + " and modifiedAt ge " + hrx.iso(hrx.addDays(hrx.today(), -14)) + "T00:00:00Z", $expand: "LeaveCategoryId($select=LeaveCategoryDesc)" }),
						svc.fetchAssignments(hrx.iso(mon), hrx.iso(hrx.addDays(mon, 6))),
						svc.fetchUserDetails(hrx.iso(mon), hrx.iso(hrx.addDays(mon, 6)))
					]);
					data.groupLeaves(r[0]).forEach(function (g) {
						items.push({ id: "appr:" + g.id, subject: "Leave request from " + g.name + ": " + g.type + ", " + g.label, sentAt: hrx.fmt(g.rows[0].createdAt ? new Date(g.rows[0].createdAt) : hrx.today()), target: "leaveadmin" });
					});
					data.groupLeaves(r[1].filter(function (l) { return l.WFFlag !== false; })).forEach(function (g) {
						items.push({ id: "dec:" + g.id + ":" + g.status, subject: "Your " + g.type.toLowerCase() + " request for " + g.label + " was " + (g.status === "approved" ? "approved" : "rejected"), sentAt: hrx.fmt(new Date(g.rows[0].modifiedAt)), target: "leave" });
					});
					var booked = 0; (r[2].Assignments || []).forEach(function (a) { (a.TimeLogEntries || []).forEach(function (t) { booked += hrx.mins(t.Hours); }); });
					var due = shell.dueMinutes(r[3], mon);
					if (booked < due) { items.push({ id: "ts:" + hrx.iso(mon) + ":" + hrx.iso(hrx.today()), subject: "Timesheet reminder: " + hrx.hhmm(due - booked) + " hrs still to log this week", sentAt: hrx.fmt(hrx.today()), target: "timesheet" }); }
				} catch (e) { console.warn("Notifications could not be loaded", e); }
				var read = shell.notifications.readSet();
				items.forEach(function (i) { i.unread = read.indexOf(i.id) === -1; });
				shell.notifications.items = items;
				shell.notifications.render();
			},
			render: function () {
				var root = hrx.root, list = root.querySelector("#notifList"), badge = root.querySelector("#bellBadge");
				var unread = shell.notifications.items.filter(function (i) { return i.unread; });
				badge.textContent = unread.length; badge.hidden = unread.length === 0;
				root.querySelector("#navBurger").classList.toggle("has-unread", unread.length > 0);
				root.querySelector("#notifCount").textContent = unread.length ? unread.length + " unread" : "";
				root.querySelector("#notifMarkAll").style.display = unread.length ? "" : "none";
				if (!unread.length) {
					list.innerHTML = "<div class=\"notif-empty\"><div class=\"notif-empty-t\">No new notifications</div><div class=\"notif-empty-s\">Reminders sent to you, such as a timesheet to complete or a leave decision, appear here.</div></div>";
					return;
				}
				list.innerHTML = unread.map(function (i) { return "<div class=\"notif-item" + (i.target ? " canopen" : "") + "\" data-id=\"" + hrx.esc(i.id) + "\"><span class=\"notif-dot\"></span><div class=\"notif-body\"><div class=\"notif-subj\" title=\"" + hrx.esc(i.subject) + "\">" + hrx.esc(i.subject) + "</div><div class=\"notif-time\">" + hrx.esc(i.sentAt) + "</div></div>" + (i.target ? "<i class=\"ti ti-chevron-right notif-chev\"></i>" : "") + "</div>"; }).join("");
			},
			wire: function () {
				var root = hrx.root, bell = root.querySelector("#bellBtn"), pop = root.querySelector("#notifPop");
				var place = function () {
					if (shell.isNarrow()) { pop.style.left = ""; pop.style.bottom = ""; return; }   // CSS docks it to the bottom of the screen
					pop.style.left = (root.querySelector(".side").getBoundingClientRect().right + 10) + "px"; pop.style.bottom = Math.max(12, window.innerHeight - bell.getBoundingClientRect().bottom - 8) + "px";
				};
				var close = function () { pop.classList.remove("open"); bell.classList.remove("open"); };
				bell.addEventListener("click", function (e) { e.stopPropagation(); if (pop.classList.contains("open")) { close(); } else { shell.notifications.render(); place(); shell.closeDrawer(); pop.classList.add("open"); bell.classList.add("open"); } });
				root.querySelector("#notifClose").addEventListener("click", close);
				root.querySelector("#notifMarkAll").addEventListener("click", function () { shell.notifications.markRead(shell.notifications.items.map(function (i) { return i.id; })); shell.notifications.items.forEach(function (i) { i.unread = false; }); shell.notifications.render(); });
				root.querySelector("#notifList").addEventListener("click", function (e) {
					var row = e.target.closest(".notif-item.canopen"); if (!row) { return; }
					var it = shell.notifications.items.find(function (i) { return i.id === row.dataset.id; });
					shell.notifications.markRead([it.id]); it.unread = false; shell.notifications.render(); close();
					shell.go(it.target);
				});
				document.addEventListener("click", function (e) { if (!pop.contains(e.target) && !bell.contains(e.target)) { close(); } });
				window.addEventListener("resize", function () { if (pop.classList.contains("open")) { place(); } });
			}
		}
	};
	return shell;
});
