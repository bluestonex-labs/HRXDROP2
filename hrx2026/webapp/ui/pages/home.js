/*
 * Home. Managers get the dashboard (team today, pending approvals, utilisation and the
 * four KPI tiles) above the cards everyone has: Quick Leave, Quick Timesheet and this
 * week's timesheet rings.
 */
sap.ui.define(["../core", "../service", "../data", "../picker", "./leave", "./timesheet"], function (hrx, svc, data, picker, leave, timesheet) {
	"use strict";

	var root, ql, $ = function (id) { return root.querySelector("#" + id); };
	var state = { assignments: [] };

	function render(el) {
		root = el;
		el.innerHTML =
			"<div id=\"managerDash\"><div class=\"kpis\" id=\"mgrKpis\"></div><div class=\"dash-grid\">" +
			"<div class=\"card team-today\"><div class=\"card-head\"><div class=\"card-title\">Team today</div><div style=\"display:flex;align-items:center;gap:12px\"><span class=\"card-hint\" id=\"ttDate\"></span><button class=\"btn ghost sm\" type=\"button\" data-go=\"teamcal\">Full view</button></div></div>" +
			"<div class=\"tt-scroll\"><table class=\"tt-table\"><thead><tr><th>Employee</th><th>Site</th><th>Status</th></tr></thead><tbody id=\"teamTodayBody\"></tbody></table></div></div>" +
			"<div class=\"dash-stack\"><div class=\"card\" id=\"pendingApprovalsCard\"><div class=\"card-head\"><div class=\"card-title\">Pending approvals</div><div class=\"card-hint\" id=\"pendingCount\"></div></div><div class=\"rows\" id=\"pendingList\"></div></div>" +
			"<div class=\"card\" id=\"utilCard\"><div class=\"card-head\"><div class=\"card-title\">Billable utilisation</div><div style=\"display:flex;align-items:center;gap:12px\"><span class=\"card-hint\">Year to date</span><button class=\"btn ghost sm\" type=\"button\" data-go=\"utilisation\">Full report</button></div></div><div class=\"card-body--padded\" id=\"utilBody\"></div></div></div></div></div>" +
			"<div class=\"section-head\" id=\"mgrOwnHead\"><div class=\"section-eyebrow\">For you</div><div class=\"section-title\">Book leave and log your time</div></div>" +
			"<div class=\"grid-3\" id=\"homeActionRow\" style=\"grid-template-columns:repeat(auto-fit,minmax(320px,1fr))\">" +
			"<div class=\"card\"><div class=\"card-head\"><div class=\"card-title\">Quick Leave</div></div><div class=\"card-body--padded has-action\">" +
			picker.html("ql", "Dates") +
			"<label class=\"f\">Leave type</label><select id=\"qlType\"></select>" +
			"<label class=\"f\">Duration</label><select id=\"qlDuration\"><option value=\"FULL\">Full day(s)</option><option value=\"AM\">Half day — AM</option><option value=\"PM\">Half day — PM</option></select>" +
			"<label class=\"f\">Comments</label><textarea rows=\"2\" placeholder=\"Optional\" id=\"qlComments\"></textarea>" +
			"<label class=\"f\">Approver</label><div class=\"hrx-approver\" id=\"qlApprover\" style=\"font-size:13px;font-weight:600;margin-bottom:14px;color:var(--ink)\">—</div>" +
			"<div class=\"card-spacer\"></div><button class=\"btn primary\" style=\"width:100%\" id=\"qlSubmitBtn\" type=\"button\">Request leave</button></div></div>" +
			"<div class=\"card\" id=\"quickTimesheetCard\"><div class=\"card-head\"><div class=\"card-title\">Quick Timesheet</div><div class=\"card-hint\" id=\"qtDateHint\">Today</div></div><div class=\"card-body--padded has-action\" id=\"quickTimesheetBody\"></div></div></div>" +
			"<div class=\"grid-2\" style=\"grid-template-columns:1fr\"><div class=\"card\"><div class=\"card-head\"><div class=\"card-title\">Timesheet</div><div class=\"card-hint\">This week</div></div><div class=\"card-body--padded\">" +
			"<div id=\"tsRings\" style=\"display:flex;justify-content:space-between;text-align:center;max-width:480px\"></div>" +
			"<div class=\"legend\" style=\"margin-top:16px;font-size:11.5px;color:var(--txt-2)\"><div><span class=\"dot\" style=\"background:var(--signal)\"></span>Missing</div><div><span class=\"dot\" style=\"background:var(--amber)\"></span>Action needed</div><div><span class=\"dot\" style=\"background:var(--mint)\"></span>Complete</div><div><span class=\"dot\" style=\"background:var(--ice)\"></span>On leave</div><div><span class=\"dot\" style=\"background:var(--line-soft)\"></span>Not due yet</div></div>" +
			"</div></div></div>";

		ql = picker.make(el, "ql");
		$("qlSubmitBtn").addEventListener("click", function () {
			var b = $("qlSubmitBtn");
			leave.submit(ql, $("qlType"), $("qlDuration").value, $("qlComments"), b).then(function (ok) { if (ok) { $("qlComments").value = ""; } });
		});
		$("pendingList").addEventListener("click", onDecide);
		$("quickTimesheetBody").addEventListener("click", onQuickTimesheet);
		hrx.on("pending", function () { if (root.classList.contains("on")) { loadManager(); } });
		hrx.on("time", function () { if (root.classList.contains("on")) { loadMine(); } });
	}

	function load() {
		var t = hrx.today();
		$("ttDate").textContent = hrx.DOW_FULL[t.getDay()] + ", " + t.getDate() + " " + hrx.MONTH_FULL[t.getMonth()] + " " + t.getFullYear();
		if (data.isManager()) { loadManager(); }
		loadMine();
	}

	/* ── manager dashboard ── */
	async function loadManager() {
		$("mgrKpis").innerHTML = hrx.kpi("neu", "ti-users", "Team in / working today", "…", "", "Loading") + hrx.kpi("neu", "ti-clipboard-check", "Timesheet compliance", "…", "", "Loading") + hrx.kpi("neu", "ti-alert-triangle", "Policy triggers this period", "…", "", "Loading") + hrx.kpi("neu", "ti-file-text", "Docs awaiting acknowledgement", "…", "", "Loading");
		var today = hrx.iso(hrx.today());
		try {
			var ix = await data.index();
			var r = await Promise.all([
				svc.fetchTeamCalendar(today, today),
				data.weekCompliance(hrx.monday(hrx.today())),
				data.sickness(),
				svc.leaveToApprove(),
				data.users()
			]);
			var active = {}; r[4].forEach(function (u) { active[u.EmployeeID] = u.IsActive !== false; });
			var people = (r[0].users || []).filter(function (u) { return active[u.EmpID] !== false; }).map(function (u) {
				var lv = (u.Leave || []).find(function (l) { return l.Date === today && l.LeaveID !== "BANKHOLIDAY" && l.StatusID === svc.STATUS.approved; });
				var bh = (u.Leave || []).find(function (l) { return l.Date === today && l.LeaveID === "BANKHOLIDAY"; });
				return { id: u.EmpID, name: u.Name, site: u.SiteID, leave: lv ? lv.LeaveType + (lv.AbsenceType !== "Full Day" ? " (" + lv.AbsenceType + ")" : "") : (bh ? bh.LeaveType : null) };
			});
			var trig = data.triggers(r[2]).filter(function (t) { return t.status === "open"; }).length;
			renderKpis(people, r[1], trig, ix);
			renderTeam(people);
			renderPending(data.groupLeaves(r[3]));
			loadUtil();
		} catch (e) {
			$("mgrKpis").innerHTML = "<div class=\"card\" style=\"grid-column:1/-1\">" + hrx.failed(e) + "</div>";
		}
	}
	function renderKpis(people, week, trig, ix) {
		var leaveN = people.filter(function (p) { return p.leave; }).length, work = people.length - leaveN;
		var sites = Object.keys(ix.site).map(function (s) { return people.filter(function (p) { return p.site === s && !p.leave; }).length + " " + ix.site[s].SiteDesc; });
		var pct = data.complianceOf(week);
		var tile = function (cls, icon, label, num, unit, sub, link, go) { return "<div class=\"kpi " + cls + "\"><div class=\"glyph " + cls + "\"><i class=\"ti " + icon + "\"></i></div><div class=\"klab\">" + label + "</div><div class=\"knum\">" + num + (unit ? "<span class=\"kunit\">" + unit + "</span>" : "") + "</div><div class=\"ksub\">" + sub + "</div><button class=\"btn ghost sm klink\" type=\"button\" data-go=\"" + go + "\">" + link + hrx.ICON.arrow + "</button></div>"; };
		$("mgrKpis").innerHTML =
			tile("neu", "ti-users", "Team in / working today", work, "of " + people.length, sites.join(" · ") + " · " + leaveN + " on leave", "Full view", "teamcal") +
			tile(pct >= 90 ? "ok" : "warn", "ti-clipboard-check", "Timesheet compliance", pct, "%", "This week, hours due so far", "View team", "tsreport") +
			tile(trig > 0 ? "crit" : "ok", "ti-alert-triangle", "Policy triggers this period", trig, "", "Sickness policy", "Review", "sickness") +
			tile("neu", "ti-file-text", "Docs awaiting acknowledgement", "—", "", "Service needed: Policies", "Details", "services");
	}
	function renderTeam(people) {
		var last = function (n) { return n.split(" ").slice(-1)[0]; };
		var rows = people.slice().sort(function (a, b) { return (b.leave ? 1 : 0) - (a.leave ? 1 : 0) || last(a.name).localeCompare(last(b.name)) || a.name.localeCompare(b.name); });
		$("teamTodayBody").innerHTML = rows.length ? rows.map(function (p) {
			return "<tr><td><div class=\"tt-person\"><span class=\"a\">" + data.face(p.id, p.name) + "</span>" + hrx.esc(p.name) + "</div></td><td>" + hrx.esc(data.siteName(p.site)) + "</td><td>" + (p.leave ? "<span class=\"pill info\">On leave · " + hrx.esc(p.leave) + "</span>" : "<span class=\"pill ok\">Working</span>") + "</td></tr>";
		}).join("") : "<tr><td colspan=\"3\" class=\"tbl-empty\">Nobody in your organisation yet</td></tr>";
	}
	var pending = [];
	function renderPending(groups) {
		pending = groups;
		$("pendingCount").textContent = groups.length + " pending";
		$("pendingList").innerHTML = groups.length ? groups.map(apprRow).join("") : "<div class=\"appr-empty\">Nothing waiting for approval</div>";
	}
	function apprRow(r) {
		return "<div class=\"appr-row\" data-id=\"" + r.id + "\"><div class=\"a\">" + data.face(r.empId, r.name) + "</div><div class=\"appr-main\"><div class=\"appr-name\">" + hrx.esc(r.name) + "</div><div class=\"appr-meta\">" + r.label + "</div><div class=\"appr-meta\">" + hrx.esc(r.type) + " · " + r.duration + (r.comment ? " · “" + hrx.esc(r.comment) + "”" : "") + "</div></div><div class=\"appr-days\">" + r.days + (r.days === 1 ? " day" : " days") + "</div><div class=\"appr-actions\"><button class=\"btn approve sm\" type=\"button\" data-act=\"approve\">" + hrx.ICON.check + "Approve</button><button class=\"btn reject sm\" type=\"button\" data-act=\"reject\">" + hrx.ICON.x + "Reject</button></div></div>";
	}
	function onDecide(e) {
		var btn = e.target.closest("button[data-act]"); if (!btn) { return; }
		var g = pending.find(function (x) { return x.id === btn.closest(".appr-row").dataset.id; });
		leave.decide(g, btn.dataset.act === "approve", btn);
	}
	async function loadUtil() {
		var body = $("utilBody");
		body.innerHTML = hrx.loading();
		try {
			var team = (await data.users()).filter(function (u) { return u.Manager_EmployeeID === data.me.EmployeeID && u.IsActive !== false; }).map(function (u) { return u.EmployeeID; });
			var y = hrx.today().getFullYear();
			var rows = await data.utilisation(y + "-01-01", hrx.iso(hrx.today()), team.length ? team : null);
			rows = rows.map(function (u) { return Object.assign({ pct: u.total ? Math.round(u.billable / u.total * 100) : 0 }, u); }).sort(function (a, b) { return a.pct - b.pct; });
			var tb = rows.reduce(function (a, u) { return a + u.billable; }, 0), tt = rows.reduce(function (a, u) { return a + u.total; }, 0);
			var onBill = rows.filter(function (u) { return u.billable > 0; }).length;
			body.innerHTML = rows.length ? "<div class=\"util-top\"><span class=\"util-big\">" + (tt ? Math.round(tb / tt * 100) : 0) + "%</span><span class=\"util-cap\">" + onBill + " of " + rows.length + " on billable projects</span></div>" +
				rows.map(function (u) {
					var st = hrx.utilState(u.pct);
					return "<div class=\"ub-row\"><div><div class=\"ub-name\">" + hrx.esc(u.name) + "</div><div class=\"ub-sub\">" + u.billable.toFixed(1) + " of " + u.total.toFixed(1) + " days billable</div></div>" + hrx.bar(u.pct, st, u.pct + "%") + "</div>";
				}).join("") : hrx.empty("No time booked this year", "Utilisation appears once your team books time.");
		} catch (e) { body.innerHTML = hrx.failed(e); }
	}

	/* ── for you ── */
	async function loadMine() {
		var me = data.me, mon = hrx.monday(hrx.today()), sMon = hrx.iso(mon), sSun = hrx.iso(hrx.addDays(mon, 6));
		$("qlApprover").textContent = me.Manager ? (me.Manager.FirstName + " " + me.Manager.LastName) : "No manager assigned";
		try {
			var r = await Promise.all([data.leaveTypes(), svc.fetchAssignments(sMon, sSun), svc.fetchUserDetails(sMon, sSun)]);
			leave.fillTypes($("qlType"), r[0]);
			state.assignments = r[1].Assignments || [];
			renderQuick();
			renderRings(r[1], r[2], mon);
		} catch (e) {
			$("quickTimesheetBody").innerHTML = hrx.failed(e);
			$("tsRings").innerHTML = hrx.failed(e);
		}
	}
	function todaysEntries() {
		var s = hrx.iso(hrx.today()), out = [];
		state.assignments.forEach(function (a) { (a.TimeLogEntries || []).forEach(function (t) { if (t.Date === s) { out.push({ a: a, t: t }); } }); });
		return out;
	}
	function renderQuick(bForce) {
		var body = $("quickTimesheetBody"), entries = todaysEntries();
		$("qtDateHint").textContent = "Today";
		if (entries.length && !bForce) {
			var total = entries.reduce(function (n, x) { return n + hrx.mins(x.t.Hours); }, 0);
			body.innerHTML = "<div class=\"qt-logged\"><div class=\"qt-icon\"><i class=\"ti ti-check\"></i></div><div class=\"qt-title\">Logged for today</div><div class=\"qt-sub\">" + hrx.DOW_FULL[hrx.today().getDay()] + ", " + hrx.ordinal(hrx.today().getDate()) + " " + hrx.MONTH_FULL[hrx.today().getMonth()] + " — " + hrx.hhmm(total) + " hrs</div>" +
				"<div class=\"qt-summary\">" + entries.map(function (x) { return "<div class=\"qt-summary-row\"><span>" + hrx.esc(x.a.ProjectDesc) + "</span><span>" + hrx.hhmm(hrx.mins(x.t.Hours)) + "</span></div>"; }).join("") +
				"<div class=\"qt-summary-row\"><span>Comment</span><span>" + hrx.esc(entries[entries.length - 1].t.Comment || "—") + "</span></div></div>" +
				"<button class=\"qt-reset-link\" id=\"qtMore\" type=\"button\">Log more time</button></div>";
			return;
		}
		var bookable = timesheet.bookable(state.assignments);
		body.innerHTML = "<label class=\"f\">Project</label><select id=\"qtProject\"><option value=\"\">Select a project…</option>" +
			bookable.map(function (a) { return "<option value=\"" + a.ProjectID + "\">" + hrx.esc(a.ClientDesc + " — " + a.ProjectDesc) + "</option>"; }).join("") + "</select>" +
			"<label class=\"f\">Time spent</label><input id=\"qtHours\" placeholder=\"e.g. 07:30\">" +
			"<label class=\"f\">Comment</label><textarea id=\"qtComment\" rows=\"2\" placeholder=\"What did you work on?\"></textarea>" +
			"<div class=\"card-spacer\"></div><button class=\"btn primary\" style=\"width:100%;margin-top:14px\" id=\"qtSaveBtn\" type=\"button\">Save</button>";
	}
	async function onQuickTimesheet(e) {
		if (e.target.closest("#qtMore")) { renderQuick(true); return; }
		var btn = e.target.closest("#qtSaveBtn"); if (!btn) { return; }
		var project = $("qtProject").value, mins = timesheet.parseTime($("qtHours").value), comment = $("qtComment").value.trim();
		if (!project) { hrx.toast("Select a project before saving.", "crit"); return; }
		if (!mins) { $("qtHours").classList.add("err"); hrx.toast("Enter the time you spent, e.g. 07:30, before saving.", "crit"); return; }
		if (mins > 24 * 60) { $("qtHours").classList.add("err"); hrx.toast("A day has 24 hours — enter a shorter time.", "crit"); return; }
		if (!comment) { $("qtComment").classList.add("err"); hrx.toast("Add a comment so your manager can see what you worked on.", "crit"); return; }
		btn.disabled = true; btn.textContent = "Saving…";
		try {
			await svc.saveTimesheetEntry([{ Project_ID: project, Employee_EmployeeID: data.me.EmployeeID, Date: hrx.iso(hrx.today()), Hours: hrx.hhmm(mins) + ":00", Comment: comment }]);
			hrx.toast("Time logged for today");
			hrx.emit("time");
		} catch (err) {
			hrx.toast(hrx.errText(err), "crit");
			btn.disabled = false; btn.textContent = "Save";
		}
	}
	function renderRings(oAsg, oDet, mon) {
		var perDay = {}, today = hrx.today(), ws = oDet.WorkSchedule || {}, target = ((parseFloat(oDet.Users && oDet.Users.targetHrsPerWeek) || 40) * 60) / 5;
		(oAsg.Assignments || []).forEach(function (a) { (a.TimeLogEntries || []).forEach(function (t) { perDay[t.Date] = (perDay[t.Date] || 0) + hrx.mins(t.Hours); }); });
		var html = "";
		for (var i = 0; i < 5; i++) {
			var d = hrx.addDays(mon, i), s = hrx.iso(d), m = perDay[s] || 0;
			var lv = (oDet.Leaves || []).filter(function (l) { return l.StartDate === s; }).reduce(function (n, l) { return n + data.dayValue(l.DayTime); }, 0);
			var bh = (oDet.BankHoliday || []).some(function (h) { return h.Date === s; });
			var works = ws[hrx.DOW_FULL[d.getDay()]] !== false;
			var due = bh || !works ? 0 : target * Math.max(0, 1 - lv);
			var svg;
			if ((lv >= 1 || bh) && !m) {
				svg = "<svg width=\"44\" height=\"44\" viewBox=\"0 0 44 44\"><circle cx=\"22\" cy=\"22\" r=\"18\" fill=\"var(--ice)\"/><path d=\"M15 22l4 4 9-9\" stroke=\"#fff\" stroke-width=\"2.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><div style=\"font-size:10px;color:var(--ice-deep);margin-top:2px;font-weight:600\">" + (bh ? "Holiday" : "Leave") + "</div>";
			} else if (d > today && !m) {
				svg = "<svg width=\"44\" height=\"44\" viewBox=\"0 0 44 44\"><circle cx=\"22\" cy=\"22\" r=\"18\" fill=\"none\" stroke=\"var(--line-soft)\" stroke-width=\"5\"/><text x=\"22\" y=\"26\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"var(--txt-3)\">–</text></svg>";
			} else {
				var st = m >= due && due > 0 ? "mint" : m > 0 ? "amber" : "signal";
				if (due === 0 && m > 0) { st = "mint"; }
				var frac = due ? Math.min(1, m / due) : 1, len = Math.max(1, 113 * frac);
				var hrs = Math.round(m / 30) / 2, lab = hrs + "h", fs = lab.length > 3 ? 9.5 : 11;
				svg = "<svg width=\"44\" height=\"44\" viewBox=\"0 0 44 44\"><circle cx=\"22\" cy=\"22\" r=\"18\" fill=\"none\" stroke=\"var(--" + st + "-soft)\" stroke-width=\"5\"/><circle cx=\"22\" cy=\"22\" r=\"18\" fill=\"none\" stroke=\"var(--" + st + ")\" stroke-width=\"5\" stroke-dasharray=\"" + (m ? len : 1) + " 113\" stroke-linecap=\"round\" transform=\"rotate(-90 22 22)\"/><text x=\"22\" y=\"26\" text-anchor=\"middle\" font-size=\"" + fs + "\" font-weight=\"700\" fill=\"var(--" + st + ")\">" + lab + "</text></svg>";
			}
			html += "<div class=\"tsring-day\"><div class=\"meta\" style=\"margin-bottom:6px\">" + hrx.DOW_ABBR[d.getDay()] + "</div>" + svg + "</div>";
		}
		$("tsRings").innerHTML = html;
	}

	return { render: render, load: load };
});
