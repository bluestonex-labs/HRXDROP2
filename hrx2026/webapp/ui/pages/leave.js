/*
 * My Leave: balance tiles, a new request, the leave calendar and every request made.
 * Also home of the leave actions Home and Leave management share: submit a request,
 * approve or reject one.
 */
sap.ui.define(["../core", "../service", "../data", "../picker"], function (hrx, svc, data, picker) {
	"use strict";

	var root, nlr, $ = function (id) { return root.querySelector("#" + id); };
	var st = { filter: "all", groups: [], month: null, balance: null, myLeave: [], holidays: [], analytics: [] };

	/* ── shared actions ── */
	function fillTypes(sel, types) {
		var cur = sel.value;
		sel.innerHTML = types.map(function (t) { return "<option value=\"" + t.ID + "\"" + (t.LeaveCategoryDesc === "Holiday" ? " selected" : "") + ">" + hrx.esc(t.LeaveCategoryDesc) + "</option>"; }).join("");
		if (cur && types.some(function (t) { return t.ID === cur; })) { sel.value = cur; }
	}

	/**
	 * Requests leave for the signed-in user over the picked range. The service decides
	 * which days count: leaveDates drops weekends, bank holidays and days already booked.
	 * @returns {Promise<boolean>} true when the request was created
	 */
	async function submit(oPicker, oTypeSel, sDuration, oComments, oBtn) {
		var range = oPicker.getRange();
		if (!range) { hrx.toast("Select a date range before requesting leave.", "crit"); return false; }
		var me = data.me, typeId = oTypeSel.value, type = oTypeSel.options[oTypeSel.selectedIndex].textContent;
		var label = oBtn.textContent; oBtn.disabled = true; oBtn.textContent = "Requesting…";
		try {
			var types = await data.leaveTypes(), oType = types.find(function (t) { return t.ID === typeId; }) || {};
			var r = await svc.leaveDates(hrx.iso(range.start), hrx.iso(range.end));
			var dates = ((r && r.dates) || []).map(function (d) { return d.date; });
			if (!dates.length) { hrx.toast("There are no days you can book in that range — weekends, bank holidays and days you already have leave are left out.", "crit"); return false; }
			var days = dates.length * (sDuration === "FULL" ? 1 : 0.5);
			if (oType.isAccountable) {
				var bal = st.balance || (await loadBalance());
				if (days > bal.remaining) { hrx.toast("That request is for " + days + " day(s), but you only have " + bal.remaining + " day(s) remaining.", "crit"); return false; }
			}
			await svc.createLeaveRequest(data.leaveRows(dates, { duration: sDuration, typeId: typeId, type: type, comment: oComments.value.trim(), approver: me.Manager && me.Manager.EmployeeID, emp: me.EmployeeID }));
			oPicker.reset();
			hrx.toast(type + " requested — " + days + (days === 1 ? " day" : " days") + " sent to " + (me.Manager ? me.Manager.FirstName + " " + me.Manager.LastName : "your manager") + " for approval");
			hrx.emit("leave"); hrx.emit("pending");
			return true;
		} catch (e) {
			hrx.toast(hrx.errText(e), "crit");
			return false;
		} finally { oBtn.disabled = false; oBtn.textContent = label; }
	}

	/** Approves a request, or asks for a note and rejects it. */
	function decide(g, bApprove, oBtn) {
		var run = async function (note) {
			if (oBtn) { oBtn.disabled = true; }
			try {
				await svc.actionOnLeave(g.ids.map(function (id) { return { ID: id, WFFlag: bApprove, ApproverComments: note || "" }; }));
				hrx.toast(bApprove ? "Leave approved for " + g.name : "Leave declined for " + g.name, bApprove ? "ok" : "crit");
				hrx.emit("pending");
				return true;
			} catch (e) { hrx.toast(hrx.errText(e), "crit"); if (oBtn) { oBtn.disabled = false; } return false; }
		};
		if (bApprove) { run(""); return; }
		hrx.modal({
			title: "Decline leave request",
			body: "<p class=\"modal-p\" style=\"margin-bottom:12px\">" + hrx.esc(g.name) + " · " + g.label + " · " + hrx.esc(g.type) + " (" + g.duration + ")</p><label class=\"f\">Note</label><textarea id=\"declineNote\" rows=\"3\" placeholder=\"Optional note for the employee\"></textarea>",
			confirm: { text: "Reject", cls: "danger" },
			onConfirm: function (b) { return run(b.querySelector("#declineNote").value.trim()); }
		});
	}

	async function loadBalance(aLeaves) {
		st.userLeave = await data.userLeave(aLeaves);
		st.balance = data.leaveBalance(st.userLeave);
		return st.balance;
	}
	/** days taken per leave type this leave year, as fetchLeaveAnalytics returns them */
	function analyticsFromLeaves(aLeaves) {
		var b = data.leaveBalance(null), by = {};
		aLeaves.forEach(function (l) {
			if (l.Status_ID === svc.STATUS.rejected || l.StartDate < b.from || l.StartDate > b.to) { return; }
			var t = (l.LeaveCategoryId && l.LeaveCategoryId.LeaveCategoryDesc) || "Leave";
			by[t] = (by[t] || 0) + (l.DayTime === "Full Day" ? 1 : 0.5);
		});
		return Object.keys(by).map(function (k) { return { LeaveType: k, Days: by[k] }; });
	}

	/* ── the page ── */
	function render(el) {
		root = el;
		el.innerHTML =
			"<div class=\"kpis\" id=\"lvKpis\" style=\"grid-template-columns:repeat(3,1fr)\"></div>" +
			"<div class=\"grid-2\" style=\"grid-template-columns:340px 1fr\">" +
			"<div class=\"card\"><div class=\"card-head featured\"><i class=\"ti ti-calendar-plus\"></i><div class=\"card-title\">New Leave Request</div></div><div class=\"card-body--padded has-action\">" +
			picker.html("nlr", "Dates") +
			"<label class=\"f\">Leave type</label><select id=\"nlrType\"></select>" +
			"<label class=\"f\">Duration</label><select id=\"nlrDuration\"><option value=\"FULL\">Full day(s)</option><option value=\"AM\">Half day — AM</option><option value=\"PM\">Half day — PM</option></select>" +
			"<label class=\"f\">Comments</label><textarea rows=\"3\" placeholder=\"Optional\" id=\"nlrComments\"></textarea>" +
			"<label class=\"f\">Approver</label><div id=\"nlrApprover\" style=\"font-size:13px;font-weight:600;margin-bottom:16px;color:var(--ink)\">—</div>" +
			"<div class=\"card-spacer\"></div><button class=\"btn primary\" style=\"width:100%\" id=\"requestLeaveBtn\" type=\"button\">Request leave</button></div></div>" +
			"<div class=\"card\"><div class=\"card-head\"><div class=\"card-title\">Leave Calendar</div></div><div class=\"card-body--padded\">" +
			"<div class=\"hrx-cal-head\"><button class=\"dp-nav\" id=\"calPrev\" type=\"button\">" + hrx.ICON.chl + "</button><div id=\"calTitle\" style=\"text-align:center;font-family:var(--disp);text-transform:uppercase;font-weight:800;color:var(--ink)\"></div><button class=\"dp-nav\" id=\"calNext\" type=\"button\">" + hrx.ICON.chr + "</button></div>" +
			"<div class=\"cal\" id=\"lvCal\"></div><div class=\"legend\" id=\"lvLegend\"></div></div></div></div>" +
			"<div class=\"tablecard mt-lg\"><div class=\"ttop\"><div class=\"ttop-title\">Leave Requests</div><div class=\"seg\" id=\"leaveFilter\"><button class=\"on\" data-filter=\"all\" type=\"button\">All</button><button data-filter=\"pending\" type=\"button\">Requested</button><button data-filter=\"approved\" type=\"button\">Approved</button><button data-filter=\"rejected\" type=\"button\">Rejected</button></div></div>" +
			"<div class=\"tscroll\"><table><thead><tr><th>Date</th><th>Leave Type</th><th>Status</th><th></th></tr></thead><tbody id=\"leaveReqBody\"></tbody></table></div></div>";
		nlr = picker.make(el, "nlr");
		var t = hrx.today(); st.month = new Date(t.getFullYear(), t.getMonth(), 1);
		$("requestLeaveBtn").addEventListener("click", function () {
			submit(nlr, $("nlrType"), $("nlrDuration").value, $("nlrComments"), $("requestLeaveBtn")).then(function (ok) { if (ok) { $("nlrComments").value = ""; } });
		});
		$("leaveFilter").addEventListener("click", function (e) {
			var b = e.target.closest("button"); if (!b) { return; }
			st.filter = b.dataset.filter;
			$("leaveFilter").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
			renderRequests();
		});
		$("calPrev").addEventListener("click", function () { st.month.setMonth(st.month.getMonth() - 1); renderCalendar(); });
		$("calNext").addEventListener("click", function () { st.month.setMonth(st.month.getMonth() + 1); renderCalendar(); });
		$("leaveReqBody").addEventListener("click", onCancel);
		hrx.on("leave", function () { if (root.classList.contains("on")) { load(); } });
		hrx.on("pending", function () { if (root.classList.contains("on")) { load(); } });
	}

	async function load() {
		var me = data.me;
		$("nlrApprover").textContent = me.Manager ? (me.Manager.FirstName + " " + me.Manager.LastName) : "No manager assigned";
		$("leaveReqBody").innerHTML = "<tr><td colspan=\"4\">" + hrx.loading() + "</td></tr>";
		// each call on its own, so one endpoint failing on the service does not blank the page
		var named = function (name, p) { return p.catch(function (e) { var x = new Error(name + ": " + hrx.errText(e)); x.status = e && e.status; throw x; }); };
		var leaves = named("Leaves", svc.Leaves.list({ $filter: "EmpID_EmployeeID eq " + svc.q(me.EmployeeID), $expand: "LeaveCategoryId($select=ID,LeaveCategoryDesc,isAccountable),Status($select=ID,StatusDesc)", $orderby: "StartDate desc" }));
		var r = await Promise.allSettled([
			named("LeaveType", data.leaveTypes()),
			leaves,
			named("Leave balance", leaves.catch(function () { return undefined; }).then(loadBalance)),
			named("fetchLeaveAnalytics", svc.fetchLeaveAnalytics())
		]);
		var val = function (i) { return r[i].status === "fulfilled" ? r[i].value : undefined; };
		var problems = r.filter(function (x) { return x.status === "rejected"; }).map(function (x) { return hrx.errText(x.reason); });
		if (st.userLeave && st.userLeave.error) { problems.push(st.userLeave.error + " (balance worked out from WorkSchedule and Leaves instead)"); }
		if (problems.length) { console.warn("[HRX] My Leave: " + problems.join(" | ")); }
		st.types = val(0) || [];
		fillTypes($("nlrType"), st.types);
		st.myLeave = val(1) || [];
		st.groups = data.groupLeaves(st.myLeave);
		st.holidays = (st.userLeave && st.userLeave.bankHolidays) || [];
		st.analytics = val(3) || analyticsFromLeaves(st.myLeave);
		if (r[2].status === "fulfilled") { renderKpis(); } else { $("lvKpis").innerHTML = "<div class=\"card\" style=\"grid-column:1/-1\">" + hrx.failed(r[2].reason) + "</div>"; }
		renderCalendar();
		if (r[1].status === "fulfilled") { renderRequests(); } else { $("leaveReqBody").innerHTML = "<tr><td colspan=\"4\">" + hrx.failed(r[1].reason) + "</td></tr>"; }
		if (r[0].status === "rejected") { hrx.toast("Leave types could not be loaded — " + hrx.errText(r[0].reason), "crit"); }
	}
	function fmtDays(n) { return String(Math.round(n * 2) / 2); }
	function renderKpis() {
		var b = st.balance, fy = "Leave year " + hrx.fmt(b.from) + " – " + hrx.fmt(b.to);
		$("lvKpis").innerHTML =
			hrx.kpi("neu", "ti-calendar-stats", "Annual quota", fmtDays(b.quota), "days", fy) +
			hrx.kpi(b.remaining > 0 ? "ok" : "crit", "ti-calendar-check", "Days remaining", "<span id=\"kpiDaysRemaining\">" + fmtDays(b.remaining) + "</span>", "days", "Available to book") +
			hrx.kpi("warn", "ti-calendar-event", "Days booked", "<span id=\"kpiDaysBooked\">" + fmtDays(b.booked) + "</span>", "days", "Requested + approved");
	}
	function renderCalendar() {
		var m = st.month, today = hrx.iso(hrx.today());
		$("calTitle").textContent = hrx.MONTH_FULL[m.getMonth()] + " " + m.getFullYear();
		var byDay = {};
		st.myLeave.forEach(function (l) { if (l.Status_ID !== svc.STATUS.rejected) { byDay[l.StartDate] = l; } });
		var hol = {}; st.holidays.forEach(function (h) { hol[h.Date] = h.HolidayDesc; });
		var h = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(function (d) { return "<div class=\"dow\">" + d + "</div>"; }).join("");
		var first = new Date(m.getFullYear(), m.getMonth(), 1), g0 = hrx.addDays(first, -((first.getDay() + 6) % 7));
		var weeks = Math.ceil((((first.getDay() + 6) % 7) + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);
		for (var i = 0; i < weeks * 7; i++) {
			var d = hrx.addDays(g0, i), s = hrx.iso(d), cls = "day", style = "", title = "";
			if (d.getMonth() !== m.getMonth()) { cls += " muted"; }
			if (d.getDay() === 0 || d.getDay() === 6) { cls += " weekend"; }
			if (s === today) { cls += " today"; }
			var l = byDay[s];
			if (l) {
				var c = hrx.LTYPE_COLOR[l.LeaveCategoryId && l.LeaveCategoryId.LeaveCategoryDesc] || "var(--ice)";
				var pend = l.Status_ID === svc.STATUS.requested;
				style = "background:color-mix(in srgb," + c + " 22%,#fff);color:var(--ink);border-color:" + c + ";font-weight:700" + (pend ? ";border-style:dashed" : "");
				title = (l.LeaveCategoryId ? l.LeaveCategoryId.LeaveCategoryDesc : "Leave") + (l.DayTime !== "Full Day" ? " (" + l.DayTime + ")" : "") + (pend ? " — requested" : " — approved");
			} else if (hol[s]) {
				style = "background:var(--frost-2);color:var(--txt-2)"; title = hol[s];
			}
			h += "<div class=\"" + cls + "\"" + (style ? " style=\"" + style + "\"" : "") + (title ? " title=\"" + hrx.esc(title) + "\"" : "") + ">" + d.getDate() + "</div>";
		}
		$("lvCal").innerHTML = h;
		var count = {}; (st.analytics || []).forEach(function (a) { count[a.LeaveType] = a.Days; });
		$("lvLegend").innerHTML = (st.types || []).map(function (t) {
			var n = count[t.LeaveCategoryDesc];
			return "<span><span class=\"dot\" style=\"background:" + (hrx.LTYPE_COLOR[t.LeaveCategoryDesc] || "var(--txt-3)") + "\"></span>" + hrx.esc(t.LeaveCategoryDesc) + (n ? " · " + n : "") + "</span>";
		}).join("") + "<span><span class=\"dot\" style=\"background:var(--frost-2);border:1px solid var(--line)\"></span>Bank holiday</span>";
	}
	function renderRequests() {
		var today = hrx.iso(hrx.today());
		var rows = st.groups.filter(function (g) { return st.filter === "all" || g.status === st.filter; });
		$("leaveReqBody").innerHTML = rows.length ? rows.map(function (g) {
			var canCancel = g.status === "pending" || (g.status === "approved" && g.start >= today);
			return "<tr class=\"leave-row show\" data-id=\"" + g.id + "\"><td>" + g.label + "</td><td><span class=\"ltype\"><span class=\"dot\" style=\"background:" + (hrx.LTYPE_COLOR[g.type] || "var(--txt-3)") + "\"></span>" + hrx.esc(g.type) + "<span class=\"dur\">" + g.duration + "</span>" + (g.days > 1 ? "<span class=\"dur\">" + g.days + " days</span>" : "") + "</span>" + (g.note ? "<small class=\"tsub\">Note: " + hrx.esc(g.note) + "</small>" : "") + "</td><td>" + data.statusPill(g.status) + "</td><td style=\"text-align:right\">" + (canCancel ? "<button class=\"btn ghost sm cancel-btn\" type=\"button\">Cancel</button>" : "") + "</td></tr>";
		}).join("") : "<tr><td colspan=\"4\" class=\"tbl-empty\">No leave requests to show</td></tr>";
	}
	function onCancel(e) {
		var b = e.target.closest(".cancel-btn"); if (!b) { return; }
		var g = st.groups.find(function (x) { return x.id === b.closest("tr").dataset.id; });
		hrx.confirm("Cancel leave request", "Cancel your " + hrx.esc(g.type.toLowerCase()) + " request for " + g.label + "? " + (g.status === "approved" ? "It has already been approved, so your manager will see it removed." : ""), "Cancel request", async function () {
			try {
				for (var i = 0; i < g.ids.length; i++) { await svc.Leaves.remove({ ID: g.ids[i] }); }
				hrx.toast("Leave request cancelled");
				hrx.emit("leave"); hrx.emit("pending");
			} catch (err) { hrx.toast(hrx.errText(err), "crit"); return false; }
		});
	}

	return { render: render, load: load, submit: submit, decide: decide, fillTypes: fillTypes };
});
