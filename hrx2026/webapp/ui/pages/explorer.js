/*
 * App Explorer, and the apps it opens: My Bonus (fetchMyBonus, fetchBonusHeader) and
 * Manage Bonus (fetchBonusUserList, fetchBonusList, submitBonus).
 */
sap.ui.define(["../core", "../service", "../data"], function (hrx, svc, data) {
	"use strict";

	var back = "<button class=\"btn ghost\" type=\"button\" data-go=\"explorer\" style=\"margin-bottom:var(--gap)\"><i class=\"ti ti-arrow-left\" style=\"vertical-align:-2px;margin-right:6px\"></i>Back to App Explorer</button>";

	var explorer = {
		render: function (el) {
			el.innerHTML = "<div class=\"grid-3\">" +
				"<div class=\"app-card\" data-go=\"mybonus\"><div class=\"t\">My Bonus</div><div class=\"s\">View your bonus information and history</div></div>" +
				"<div class=\"app-card hrx-mgr-only\" data-go=\"managebonus\"><div class=\"t\">Manage Bonus</div><div class=\"s\">Manage employee bonuses</div></div>" +
				"<div class=\"app-card\" data-go=\"services\"><div class=\"t\">HRX services</div><div class=\"s\">Which HRX service endpoints this app uses, and whether they answer</div></div></div>";
		}
	};

	/* ── My Bonus ── */
	explorer.myBonus = (function () {
		var root, open = {};
		return {
			render: function (el) {
				root = el;
				el.innerHTML = back + "<div class=\"kpis\" id=\"mbKpis\"></div><div class=\"tablecard\"><div class=\"ttop\"><div class=\"ttop-title\">Bonus History</div><div class=\"ttop-meta\" id=\"mbMeta\"></div></div><div class=\"tscroll\"><table class=\"bonus-table asg\"><thead><tr><th class=\"c-chev\"></th><th>Year</th><th>GDP</th><th class=\"obj-head\">Personal objectives</th><th class=\"obj-head\">Company objectives</th><th>Annual Feedback</th></tr></thead><tbody id=\"bonusTableBody\"></tbody></table></div>" +
					"<div class=\"cmt-note\"><i class=\"ti ti-info-circle\" style=\"color:var(--ice-deep)\"></i>Objectives and annual feedback need a service the HRX service doesn't have yet (BonusObjectives); the bonus paid each month is real.</div></div>";
				el.querySelector("#bonusTableBody").addEventListener("click", function (e) { var r = e.target.closest("tr.asg-row"); if (!r) { return; } open[r.dataset.k] = !open[r.dataset.k]; explorer.myBonus.paint(); });
			},
			load: async function () {
				var me = data.me;
				root.querySelector("#mbMeta").textContent = me.name + " · " + me.EmployeeID;
				root.querySelector("#bonusTableBody").innerHTML = "<tr><td colspan=\"6\">" + hrx.loading() + "</td></tr>";
				try {
					var r = await Promise.all([svc.fetchMyBonus(), svc.fetchBonusHeader(me.EmployeeID).catch(function () { return {}; })]);
					var h = r[0] || {}, hd = r[1] || {};
					var pct = Number(h.PercentUtilization || (h.TotalWorkingDays ? h.ActualBilledDays / h.TotalWorkingDays * 100 : 0));
					var month = hrx.MONTH_FULL[hrx.today().getMonth()] + " " + hrx.today().getFullYear();
					root.querySelector("#mbKpis").innerHTML =
						hrx.kpi("neu", "ti-target-arrow", "Target billable days", hrx.num(h.TargetBillableDays), "", month + " · " + (h.TargetUtilization || 0) + "% target") +
						hrx.kpi(Number(h.ActualBilledDays) >= Number(h.TargetBillableDays) ? "ok" : "warn", "ti-clock-hour-4", "Actual billed days", hrx.num(h.ActualBilledDays), "", "of " + hrx.num(h.TotalWorkingDays, 0) + " working days") +
						hrx.kpi(hrx.utilState(pct), "ti-chart-bar", "Utilisation", Math.round(pct), "%", month) +
						hrx.kpi("neu", "ti-coin-pound", "Bonus / pension", (hd.BonusPercent != null ? hd.BonusPercent : "—") + "<span class=\"kunit\">%</span> · " + (hd.PensionRate != null ? hd.PensionRate : "—") + "<span class=\"kunit\">%</span>", "", "From your HRX record");
					explorer.myBonus.rows = h.BonusHistory || [];
					explorer.myBonus.paint();
				} catch (e) { root.querySelector("#bonusTableBody").innerHTML = "<tr><td colspan=\"6\">" + hrx.failed(e) + "</td></tr>"; }
			},
			paint: function () {
				var M = hrx.MONTH_FULL, by = {};
				(explorer.myBonus.rows || []).forEach(function (b) {
					var m = M.indexOf(b.Month), y0 = m >= 3 ? b.Year : b.Year - 1, k = y0 + "/" + String(y0 + 1).slice(2);
					(by[k] = by[k] || []).push(b);
				});
				var keys = Object.keys(by).sort().reverse();
				root.querySelector("#bonusTableBody").innerHTML = keys.length ? keys.map(function (k) {
					var list = by[k], tot = list.reduce(function (n, b) { return n + (parseFloat(b.BonusReceived) || 0); }, 0), cur = list[0].Currency || "GBP";
					var row = "<tr class=\"asg-row" + (open[k] ? " open" : "") + "\" data-k=\"" + k + "\"><td class=\"c-chev\"><span class=\"chev\">" + hrx.ICON.chr + "</span></td><td>FY " + k + "<small class=\"tsub\">" + list.length + (list.length === 1 ? " month" : " months") + "</small></td><td class=\"mono\" style=\"color:var(--ink)\">" + (cur === "GBP" ? hrx.gbp(tot) : hrx.num(tot) + " " + cur) + "</td><td class=\"obj-cell\"><span class=\"noack\">—</span></td><td class=\"obj-cell\"><span class=\"noack\">—</span></td><td><button class=\"btn ghost sm\" type=\"button\" disabled title=\"Annual feedback is not in the HRX service yet\">Open</button></td></tr>";
					if (open[k]) {
						row += "<tr class=\"asg-sub\"><td></td><td colspan=\"5\">" + hrx.tbl([{ h: "Month" }, { h: "Submitted" }, { h: "Bonus", al: "right" }], list.map(function (b) { return [b.Month + " " + b.Year, b.SubmittedOn ? hrx.fmt(b.SubmittedOn) : "—", (b.Currency === "GBP" || !b.Currency ? hrx.gbp(b.BonusReceived) : hrx.num(b.BonusReceived) + " " + b.Currency)]; })) + "</td></tr>";
					}
					return row;
				}).join("") : "<tr><td colspan=\"6\" class=\"tbl-empty\">No bonus has been paid to you yet</td></tr>";
			}
		};
	}());

	/* ── Manage Bonus ── */
	explorer.manageBonus = (function () {
		var root, list = [];
		var $ = function (id) { return root.querySelector("#" + id); };
		return {
			render: function (el) {
				root = el;
				var t = hrx.today(), prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
				el.innerHTML = back + "<div class=\"fbar\"><div class=\"fg\"><label>Month</label><select id=\"mgbMonth\">" + hrx.MONTH_FULL.map(function (m, i) { return "<option value=\"" + (i + 1) + "\"" + (i === prev.getMonth() ? " selected" : "") + ">" + m + "</option>"; }).join("") + "</select></div>" +
					"<div class=\"fg\"><label>Year</label><select id=\"mgbYear\">" + [t.getFullYear() - 1, t.getFullYear()].map(function (y) { return "<option" + (y === prev.getFullYear() ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></div>" +
					"<div class=\"fg grow\"><label>Search</label><div class=\"md-search\" style=\"width:auto;flex:none\"><span class=\"si\">" + hrx.ICON.search + "</span><input id=\"mgbQ\" placeholder=\"Search employee\"></div></div></div>" +
					"<div class=\"kpis\" id=\"mgbKpis\" style=\"grid-template-columns:repeat(3,1fr)\"></div><div class=\"card\"><div class=\"card-head\"><div><div class=\"card-title\">Employees</div><div class=\"card-hint\" id=\"mgbHint\" style=\"margin-top:3px\"></div></div></div><div id=\"mgbTable\"></div></div>";
				$("mgbMonth").addEventListener("change", explorer.manageBonus.load);
				$("mgbYear").addEventListener("change", explorer.manageBonus.load);
				$("mgbQ").addEventListener("input", explorer.manageBonus.paint);
				$("mgbTable").addEventListener("click", function (e) { var b = e.target.closest("[data-emp]"); if (b) { explorer.manageBonus.open(b.dataset.emp); } });
			},
			load: async function () {
				$("mgbTable").innerHTML = hrx.loading();
				try {
					await data.index();
					var r = await svc.fetchBonusUserList(+$("mgbMonth").value, +$("mgbYear").value);
					list = (r && r.UserList) || [];
					explorer.manageBonus.paint();
				} catch (e) { $("mgbTable").innerHTML = hrx.failed(e); }
			},
			paint: function () {
				var q = $("mgbQ").value.trim().toLowerCase(), period = hrx.MONTH_FULL[+$("mgbMonth").value - 1] + " " + $("mgbYear").value;
				var rows = list.filter(function (u) { return !q || (u.Name || "").toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return (b.utilization || 0) - (a.utilization || 0); });
				var met = list.filter(function (u) { return Number(u.utilization) >= Number(u.TargetUtilization || 0) && Number(u.TargetUtilization) > 0; }).length;
				var avg = list.length ? list.reduce(function (n, u) { return n + Number(u.utilization || 0); }, 0) / list.length : 0;
				$("mgbKpis").innerHTML = hrx.kpi("neu", "ti-users", "Employees", list.length, "", period) + hrx.kpi(met ? "ok" : "warn", "ti-target-arrow", "Met utilisation target", met, "of " + list.length, "Eligible for bonus") + hrx.kpi(hrx.utilState(avg), "ti-chart-bar", "Average utilisation", Math.round(avg), "%", period);
				$("mgbHint").textContent = rows.length + " employees · " + period;
				$("mgbTable").innerHTML = hrx.tbl([{ h: "Employee" }, { h: "Utilisation" }, { h: "Target", al: "right" }, { h: "Bonus", al: "right" }, { h: "", al: "right" }], rows.map(function (u) {
					var pct = Number(u.utilization || 0), tgt = Number(u.TargetUtilization || 0), st = tgt && pct >= tgt ? "ok" : pct >= tgt * 0.6 ? "warn" : "crit";
					return ["<div class=\"person\"><span class=\"avatar-sm\">" + data.face(u.UserID, u.Name) + "</span><div><b>" + hrx.esc(u.Name) + "</b><small>" + hrx.esc(data.siteName(u.BaseSiteKey || (data._byId.user[u.UserID] || {}).BaseSite_ID)) + "</small></div></div>",
						"<div class=\"ack-bar\">" + hrx.bar(tgt ? pct / tgt * 100 : pct, st, pct.toFixed(1) + "%") + "</div>", tgt ? tgt + "%" : "—",
						u.isBonusSubmitted ? hrx.pill("ok", "Submitted") : hrx.pill("neu", "Not submitted"),
						"<button class=\"btn ghost sm\" type=\"button\" data-emp=\"" + u.UserID + "\">Review</button>"];
				}), "Nobody to show for this month");
			},
			open: async function (sEmp) {
				var u = list.find(function (x) { return x.UserID === sEmp; }) || {}, m = +$("mgbMonth").value, y = +$("mgbYear").value;
				var site = u.BaseSiteKey || (data._byId.user[sEmp] || {}).BaseSite_ID;
				try {
					var r = await svc.fetchBonusList(m, y, site, sEmp);
					var proj = (r && r.BillableProjects) || [], rev = proj.reduce(function (n, p) { return n + Number(p.Revenue || 0); }, 0);
					hrx.modal({
						title: "Bonus — " + u.Name + ", " + hrx.MONTH_FULL[m - 1] + " " + y, cls: "wide",
						body: "<div class=\"kpi-mini\"><div><div class=\"n\">" + Number(r.utilization || 0).toFixed(1) + "%</div><div class=\"l\">Utilisation</div></div><div><div class=\"n\">" + hrx.gbp(rev, 0) + "</div><div class=\"l\">Revenue billed</div></div><div><div class=\"n " + (r.isBonusSubmitted ? "ok" : "") + "\">" + (r.isBonusSubmitted ? hrx.gbp(r.BonusReceived || 0, 0) : "—") + "</div><div class=\"l\">Bonus submitted</div></div></div>" +
							hrx.tbl([{ h: "Billable project" }, { h: "Days", al: "right" }, { h: "Day rate", al: "right" }, { h: "Revenue", al: "right" }], proj.map(function (p) { return [hrx.esc(p.ProjectDesc), hrx.num(p.ChargableDays), hrx.gbp(p.DayRate, 0), hrx.gbp(p.Revenue, 0)]; }), "No billable time this month") +
							"<div class=\"fld\" style=\"margin-top:16px\"><label class=\"f\">Bonus awarded<span class=\"req\">*</span></label><div class=\"sfx\"><input id=\"bonusAmt\" type=\"number\" min=\"0\" value=\"" + (r.BonusReceived || "") + "\"><span>GBP</span></div><div class=\"fhint\">Submitting emails " + hrx.esc(u.Name) + " that a bonus has been awarded.</div></div>",
						confirm: { text: "Submit bonus", cls: "primary" },
						onConfirm: async function (b) {
							var amt = b.querySelector("#bonusAmt").value.trim();
							if (!amt || Number(amt) < 0) { b.querySelector("#bonusAmt").classList.add("err"); hrx.toast("Enter the bonus amount", "crit"); return false; }
							try { await svc.submitBonus([{ EmpID: { EmployeeID: sEmp }, Month: m, Year: y, BonusReceived: String(amt), Currency: "GBP" }]); hrx.toast("Bonus submitted for " + u.Name); explorer.manageBonus.load(); }
							catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
						}
					});
				} catch (e) { hrx.toast(hrx.errText(e), "crit"); }
			}
		};
	}());

	return explorer;
});
