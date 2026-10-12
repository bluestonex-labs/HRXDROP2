/*
 * Sickness (managers). Absences are the Sick leave held in the HRX service (Leaves);
 * policy triggers are worked out from them. Recording an absence books approved Sick
 * leave for the employee (leaveDatesForTeamCalendar + createLeaveRequestForTeamCalendar).
 * Trigger follow-ups and the return-to-work checklist have no HRX entity yet, so they
 * are kept in this browser only.
 */
sap.ui.define(["../core", "../service", "../data", "../picker", "../needed"], function (hrx, svc, data, picker, needed) {
	"use strict";

	var root, $ = function (id) { return root.querySelector("#" + id); };
	var expanded = {}, sick = [], rtw = null;
	var REC = "Hold an informal wellbeing conversation and record the outcome. Consider a formal attendance review if a fourth instance occurs before the period ends.";
	// the return-to-work process, step by step
	var RTW_STEPS = ["Absence recorded and categorised", "Fit note received and filed", "Return-to-work conversation held", "Wellbeing support options discussed", "Outcome recorded and trigger reviewed"];
	var dur = function (d) { return d + (d === 1 ? " day" : " days"); }, first = function (n) { return n.split(" ")[0]; };

	function rtwState() { try { return JSON.parse(localStorage.getItem("hrxRtw") || "null"); } catch (e) { return null; } }
	function saveRtw() { try { localStorage.setItem("hrxRtw", JSON.stringify(rtw)); } catch (e) { /* no storage */ } }

	function render(el) {
		root = el;
		el.innerHTML = "<div class=\"page-actions\"><button class=\"btn primary\" id=\"sickRecord\" type=\"button\">" + hrx.ICON.plus + "Record sickness</button></div>" +
			"<div class=\"alerts\">" + needed.strip("sickness") + "</div>" + "<div id=\"sickAlert\" class=\"alerts\"></div>" +
			"<div class=\"section-head\"><div class=\"section-title\">Policy triggers — action required</div><div class=\"section-hint\">" + data.SICK_RULE + "</div></div><div id=\"trigList\" class=\"stack\"></div>" +
			"<div class=\"section-head\"><div class=\"section-title\">Return-to-work in progress</div><div class=\"section-hint\">Checklist progress is kept in this browser until the HRX service has ReturnToWork.</div></div><div id=\"rtwList\" class=\"rtw-grid\"></div>" +
			"<div class=\"card\" id=\"sickAllCard\" style=\"margin-top:var(--gap)\"><div class=\"card-head toggle\" data-toggle=\"all\" role=\"button\" tabindex=\"0\"><div class=\"card-lead\"><span class=\"chev\">" + hrx.ICON.chr + "</span><div class=\"card-title\">All sickness — last 12 months</div></div><div class=\"card-hint\" id=\"sickCount\"></div></div><div id=\"sickTable\"></div></div>";
		el.addEventListener("click", function (e) { var t = e.target.closest("[data-toggle]"); if (!t) { return; } expanded[t.dataset.toggle] = !expanded[t.dataset.toggle]; paint(); });
		el.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card-head.toggle")) { e.preventDefault(); e.target.click(); } });
		$("trigList").addEventListener("click", onTrigger);
		$("rtwList").addEventListener("click", onRtw);
		el.querySelector("#sickRecord").addEventListener("click", record);
	}
	async function load() {
		$("trigList").innerHTML = "<div class=\"card\">" + hrx.loading() + "</div>";
		try { await data.index(); sick = await data.sickness(); paint(); }
		catch (e) { $("trigList").innerHTML = "<div class=\"card\">" + hrx.failed(e) + "</div>"; }
	}
	function paint() {
		var trigs = data.triggers(sick), open = trigs.filter(function (t) { return t.status === "open"; }).length;
		$("sickAlert").innerHTML = open ? hrx.alert("crit", hrx.ICON.xc, open + (open === 1 ? " policy trigger" : " policy triggers") + " this period") : hrx.alert("ok", hrx.ICON.okc, "No policy triggers this period");
		$("trigList").innerHTML = trigs.length ? trigs.map(function (t) {
			var pill = t.status === "open" ? hrx.pill("crit", "Open") : t.status === "actioned" ? hrx.pill("ok", "Actioned") : hrx.pill("neu", "Dismissed");
			var hk = "hist:" + t.id;
			return "<div class=\"card trig" + (t.status !== "open" ? " done" : "") + "\" data-id=\"" + t.id + "\"><div class=\"trig-head\"><span class=\"avatar-sm grad-av big\">" + data.face(t.id, t.name) + "</span><div><div class=\"nm\">" + hrx.esc(t.name) + "</div><div class=\"sub\">" + hrx.rangeLabel(t.from, t.to) + "</div></div>" + pill + "</div>" +
				"<div class=\"trig-body\"><div class=\"trig-rule\">" + data.SICK_RULE + "</div><div class=\"trig-sum\">" + t.list.length + " instances · " + t.days.toFixed(1) + " days total</div>" +
				"<button class=\"trig-toggle" + (expanded[hk] ? " open" : "") + "\" type=\"button\" data-toggle=\"" + hk + "\"><span class=\"chev\">" + hrx.ICON.chr + "</span><span>Absence history</span><span class=\"trig-count\">" + t.list.length + " absences</span></button>" +
				(expanded[hk] ? hrx.tbl([{ h: "Date" }, { h: "Duration", al: "center" }, { h: "Reason" }], t.list.map(function (a) { return [hrx.fmtRange(a.start, a.end), dur(a.days), hrx.esc(a.comment || "—")]; })) : "") +
				"<div class=\"trig-lbl\">Recommended action</div><p class=\"trig-rec\">" + REC + "</p>" +
				(t.status === "open" ? "<div class=\"trig-acts\"><button class=\"btn ghost sm\" type=\"button\" data-act=\"msg\">" + hrx.ICON.mail + "Send follow-up message</button><button class=\"btn ghost sm\" type=\"button\" data-act=\"dismiss\">Dismiss — already spoken to " + hrx.esc(first(t.name)) + "</button></div>"
					: (t.status === "dismissed" ? "<div class=\"trig-note\">Dismissed — " + hrx.esc(t.note) + "</div>" : "<div class=\"trig-note\">Follow-up message drafted in your mail app and noted against this trigger.</div>")) +
				"</div></div>";
		}).join("") : "<div class=\"card\">" + hrx.empty("No policy triggers this period") + "</div>";

		// return-to-work: open for anyone with sickness in the last 30 days, until marked complete
		var st = rtwState() || {}, recent = hrx.iso(hrx.addDays(hrx.today(), -30)), by = {};
		sick.filter(function (a) { return a.end >= recent; }).forEach(function (a) { if (!by[a.empId]) { by[a.empId] = a; } });
		rtw = st;
		var list = Object.keys(by).filter(function (k) { return !(st[k] && st[k].complete === by[k].id); }).map(function (k) { return { id: k, g: by[k], steps: (st[k] && st[k].grp === by[k].id && st[k].steps) || [true, false, false, false, false] }; });
		$("rtwList").innerHTML = list.length ? list.map(function (r) {
			var p = data._byId.user[r.id] || {};
			return "<div class=\"card rtw\" data-id=\"" + r.id + "\" data-grp=\"" + r.g.id + "\"><div class=\"card-head\"><div class=\"person\"><span class=\"avatar-sm grad-av\">" + data.face(r.id, r.g.name) + "</span><div><b>" + hrx.esc(r.g.name) + "</b><small>Off sick " + r.g.label + "</small></div></div>" + hrx.pill("warn", "In progress") + "</div>" +
				"<div class=\"card-body--padded\"><div class=\"trig-lbl\" style=\"margin-top:0\">Process steps</div><div class=\"steps\">" + RTW_STEPS.map(function (s, i) { var done = r.steps[i]; return "<div class=\"step" + (done ? " done" : "") + "\"><span class=\"step-i\">" + (done ? hrx.ICON.check : "") + "</span><span class=\"step-t\">" + s + "</span>" + (done ? "" : "<button class=\"btn ghost sm\" type=\"button\" data-act=\"step\" data-i=\"" + i + "\">Mark done</button>") + "</div>"; }).join("") + "</div>" +
				"<div class=\"rtw-foot\"><a class=\"btn ghost sm\" href=\"mailto:" + hrx.esc(p.WorkEmail || "") + "?subject=Return to work\">" + hrx.ICON.mail + "Email</a><button class=\"btn primary sm\" type=\"button\" data-act=\"complete\">Mark RTW complete</button></div></div></div>";
		}).join("") : "<div class=\"card\" style=\"grid-column:1/-1\">" + hrx.empty("No return-to-work processes are open", "Anyone off sick in the last 30 days appears here.") + "</div>";

		$("sickCount").textContent = sick.length + " absences";
		$("sickTable").innerHTML = hrx.tbl([{ h: "Employee" }, { h: "Date" }, { h: "Duration", al: "center" }, { h: "Reason" }, { h: "Status", al: "right" }], sick.map(function (a) {
			return ["<div class=\"person\"><span class=\"avatar-sm\">" + data.face(a.empId, a.name) + "</span><b>" + hrx.esc(a.name) + "</b></div>", hrx.fmtRange(a.start, a.end), dur(a.days), hrx.esc(a.comment || "—"), a.status === "pending" ? hrx.pill("warn", "Requested") : hrx.pill("ok", "Recorded")];
		}), "No sickness recorded in the last 12 months");
		$("sickAllCard").classList.toggle("open", !!expanded.all); $("sickTable").style.display = expanded.all ? "" : "none";
	}
	function onTrigger(e) {
		var b = e.target.closest("[data-act]"); if (!b) { return; }
		var t = data.triggers(sick).find(function (x) { return x.id === b.closest(".trig").dataset.id; });
		var p = data._byId.user[t.id] || {};
		if (b.dataset.act === "msg") {
			var body = "Hi " + first(t.name) + ",\n\nI can see there have been " + t.list.length + " separate absences recorded in the current period. Nothing to worry about — I'd just like a short, informal chat to check how you're doing and whether there's anything we can do to support you.\n\nLet me know a time that suits.\n\nThanks";
			hrx.modal({ title: "Send message — " + t.name, cls: "wide", body: "<div class=\"strip warn\">" + hrx.ICON.tri + "<span>The HRX service cannot send mail, so this opens in your mail app addressed to " + hrx.esc(p.WorkEmail || t.name) + ".</span></div><div class=\"fld\" style=\"margin-top:16px\"><label class=\"f\">Message<span class=\"req\">*</span></label><textarea id=\"fuMsg\" rows=\"9\">" + hrx.esc(body) + "</textarea></div>", confirm: { text: "Send message", cls: "primary" },
				onConfirm: function (bd) {
					var m = bd.querySelector("#fuMsg").value.trim();
					if (!m) { bd.querySelector("#fuMsg").classList.add("err"); hrx.toast("Enter a message before sending", "crit"); return false; }
					window.location.href = "mailto:" + encodeURIComponent(p.WorkEmail || "") + "?subject=" + encodeURIComponent("Checking in") + "&body=" + encodeURIComponent(m);
					data.setTriggerState(t.id, { status: "actioned", note: "" }); hrx.toast("Message opened in your mail app"); paint();
				} });
		} else {
			hrx.modal({ title: "Dismiss policy trigger", body: "<div class=\"strip warn\">" + hrx.ICON.tri + "<span>A reason is required — dismissals are auditable</span></div><div class=\"fld\" style=\"margin-top:16px\"><label class=\"f\">Reason<span class=\"req\">*</span></label><textarea id=\"dsReason\" rows=\"4\" placeholder=\"Record why this trigger is being dismissed\"></textarea></div>", confirm: { text: "Dismiss trigger", cls: "primary" },
				onConfirm: function (bd) { var r = bd.querySelector("#dsReason"); if (!r.value.trim()) { r.classList.add("err"); hrx.toast("A reason is required — dismissals are auditable", "crit"); return false; } data.setTriggerState(t.id, { status: "dismissed", note: r.value.trim() }); hrx.toast("Trigger dismissed for " + first(t.name)); paint(); } });
		}
	}
	function onRtw(e) {
		var b = e.target.closest("[data-act]"); if (!b) { return; }
		var card = b.closest(".rtw"), id = card.dataset.id, grp = card.dataset.grp;
		var s = rtwState() || {}, cur = s[id] && s[id].grp === grp ? s[id] : { grp: grp, steps: [true, false, false, false, false] };
		if (b.dataset.act === "step") { cur.steps[+b.dataset.i] = true; s[id] = cur; rtw = s; saveRtw(); hrx.toast("Step marked complete"); paint(); return; }
		var out = cur.steps.filter(function (x) { return !x; }).length;
		if (out) { hrx.toast(out + " step(s) still outstanding", "crit"); return; }
		cur.complete = grp; s[id] = cur; rtw = s; saveRtw(); hrx.toast("Return to work marked complete for " + data.userName(id)); paint();
	}
	async function record() {
		var people = (await data.users()).filter(function (u) { return u.IsActive !== false; }), types = await data.leaveTypes();
		var sickType = types.find(function (t) { return /sick/i.test(t.LeaveCategoryDesc); });
		if (!sickType) { hrx.toast("The HRX service has no Sick leave type", "crit"); return; }
		var pk = null;
		hrx.modal({ title: "Record a sickness absence", cls: "wide overflowing", confirm: { text: "Record sickness", cls: "primary" },
			body: "<div class=\"fld\"><label class=\"f\">Employee<span class=\"req\">*</span></label><select id=\"skEmp\"><option value=\"\">Select an employee</option>" + people.map(function (p) { return "<option value=\"" + p.EmployeeID + "\">" + hrx.esc(p.name) + "</option>"; }).join("") + "</select></div>" +
				"<div class=\"fld\">" + picker.html("sk", "Dates", true, "Select dates") + "</div>" +
				"<div class=\"fld\"><label class=\"f\">Duration</label><select id=\"skDur\"><option value=\"FULL\">Full day(s)</option><option value=\"AM\">Half day — AM</option><option value=\"PM\">Half day — PM</option></select></div>" +
				"<div class=\"fld\"><label class=\"f\">Reason<span class=\"req\">*</span></label><input id=\"skReason\" placeholder=\"e.g. Cold / flu, Migraine, Back pain\" maxlength=\"255\"></div>" +
				"<div class=\"strip\" id=\"skStrip\">" + hrx.ICON.info + "<span>Pick the dates to count the working days</span></div>",
			onOpen: function (bd, ok) {
				ok.disabled = true;
				var chk = function () { ok.disabled = !(bd.querySelector("#skEmp").value && pk && pk.getRange() && bd.querySelector("#skReason").value.trim()); };
				pk = picker.make(bd, "sk", { allowPast: true, onPick: function (r) { var n = hrx.workdays(r.start, r.end); bd.querySelector("#skStrip span").textContent = n ? n + " working " + (n === 1 ? "day" : "days") + " — weekends and bank holidays are not counted" : "No working days in that range"; chk(); } });
				["skEmp", "skReason"].forEach(function (i) { bd.querySelector("#" + i).addEventListener("input", chk); });
			},
			onConfirm: async function (bd) {
				var r = pk.getRange(), emp = bd.querySelector("#skEmp").value;
				try {
					var ok = await svc.leaveDatesForTeamCalendar(hrx.iso(r.start), hrx.iso(r.end), emp);
					var dates = ((ok && ok.dates) || []).map(function (d) { return d.date; });
					if (!dates.length) { hrx.toast("No working days in that range that are free of leave for " + data.userName(emp), "crit"); return false; }
					await svc.createLeaveRequestForTeamCalendar(data.leaveRows(dates, { duration: bd.querySelector("#skDur").value, typeId: sickType.ID, type: "Sick", comment: bd.querySelector("#skReason").value.trim(), emp: emp }));
					hrx.toast("Sickness recorded — " + dates.length + " working " + (dates.length === 1 ? "day" : "days"));
					hrx.emit("leave"); load();
				} catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
			} });
	}
	return { render: render, load: load };
});
