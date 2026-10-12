/*
 * Manage Projects (managers): Projects and their commercials, and who is assigned at
 * which billing scheme and day rate (UserToProject, BillingScheme). Project areas,
 * client team and attachments have no HRX entity yet: those parts say which services
 * they need (../needed.js).
 */
sap.ui.define(["../core", "../service", "../data", "../md", "../needed"], function (hrx, svc, data, md, needed) {
	"use strict";

	var api, root, items = [], clients = [], people = [], schemes = [];
	var TYPES = [["T&M", "Time & materials"], ["FP", "Fixed price"], ["INT", "Internal"]];
	var open = function (p) { return p.IsTimeBookingAllowed !== false && p.IsActive !== false && (!p.EndDate || p.EndDate >= hrx.iso(hrx.today())); };
	var bookPill = function (p) { return open(p) ? hrx.pill("ok", "Booking open") : hrx.pill("warn", "Booking closed"); };
	var clientName = function (p) { return (p.ClientID && p.ClientID.ClientName) || ((clients.find(function (c) { return c.ID === p.ClientID_ID; }) || {}).ClientName) || "—"; };
	var userOpts = function () { return people.filter(function (u) { return u.IsActive !== false; }).map(function (u) { return [u.EmployeeID, u.name]; }); };
	var typeOpts = function (p) { return TYPES.concat(p && p.ProjectType && !TYPES.some(function (t) { return t[0] === p.ProjectType; }) ? [[p.ProjectType, p.ProjectType]] : []); };
	var day = function (v) { return v ? String(v).slice(0, 10) : ""; };

	async function reload() {
		var r = await Promise.all([svc.Projects.list({ $expand: "ClientID($select=ID,ClientName)", $orderby: "ProjectDesc" }), data.clients(), data.users(), data.billingSchemes()]);
		items = r[0]; clients = r[1]; people = r[2]; schemes = r[3];
		data.invalidate("projects");
	}
	var infoSpecs = function (p) { return [{ k: "ID", label: "Project key", type: "ro", val: p.ID }, { k: "ProjectDesc", label: "Project", req: true, val: p.ProjectDesc }, { k: "client", label: "Client", type: "ro", val: clientName(p) }, { k: "ProjectType", label: "Project type", type: "select", ph: "How will this project be charged?", opts: typeOpts(p), val: p.ProjectType }, { k: "Priority", label: "Priority", type: "select", ph: "How urgent is this project?", opts: ["Low", "Medium", "High"], val: p.Priority }, { k: "ProjectManagerID", label: "Project manager", type: "select", ph: "Who will manage this project?", opts: userOpts(), val: p.ProjectManagerID }]; };
	var comSpecs = function (p) { return [{ k: "PONumber", label: "PO number", val: p.PONumber }, { k: "POValue", label: "PO value", type: "number", min: 0, val: p.POValue, suffix: "GBP" }, { k: "TotBillableDays", label: "Billable days", type: "number", min: 0, val: p.TotBillableDays }, { k: "StartDate", label: "Start date", type: "date", val: day(p.StartDate) }, { k: "EndDate", label: "End date", type: "date", val: day(p.EndDate) }, { k: "IsTimeBookingAllowed", label: "Time booking allowed", type: "toggle", val: p.IsTimeBookingAllowed !== false }, { k: "IsActive", label: "Active", type: "toggle", val: p.IsActive !== false }]; };

	async function resTab(p) {
		var list = await svc.UserToProject.list({ $filter: "Project_ID eq " + p.ID, $expand: "Employee($select=EmployeeID,FirstName,LastName),BillingID($select=ID,BillingDesc)" });
		resTab.cache = list;
		return "<div class=\"sect-head\"><div class=\"t\">Resources assigned</div><button class=\"btn ghost sm\" type=\"button\" data-act=\"add\">" + hrx.ICON.userplus + "Assign resource</button></div>" +
			hrx.tbl([{ h: "Resource" }, { h: "Billing scheme" }, { h: "Rate", al: "right" }, { h: "Billable days", al: "right" }, { h: "Status" }, { h: "" }], list.map(function (r, i) {
				var e = r.Employee || {};
				return ["<b>" + hrx.esc(((e.FirstName || "") + " " + (e.LastName || "")).trim() || r.Employee_EmployeeID) + "</b><small class=\"tsub\">" + hrx.esc(day(r.StartDate) ? hrx.fmt(day(r.StartDate)) + " – " + (day(r.EndDate) ? hrx.fmt(day(r.EndDate)) : "open") : "") + "</small>", hrx.esc((r.BillingID && r.BillingID.BillingDesc) || "—"), r.DayRate && +r.DayRate ? hrx.gbp(r.DayRate, 0) + "/day" : "—", r.BillableDays || "—",
					r.IsActive !== false ? hrx.pill("ok", "Active") : hrx.pill("neu", "Released"),
					"<div class=\"rowacts\"><button class=\"icon-btn sm\" type=\"button\" data-act=\"edit\" data-i=\"" + i + "\" title=\"Edit assignment\">" + hrx.ICON.edit + "</button>" + (r.IsActive !== false ? "<button class=\"btn ghost sm\" type=\"button\" data-act=\"release\" data-i=\"" + i + "\">Release</button>" : "<button class=\"btn ghost sm\" type=\"button\" data-act=\"reactivate\" data-i=\"" + i + "\">Reactivate</button>") + "</div>"];
			}), "No resources assigned to this project");
	}
	var tabs = [
		{ k: "info", label: "Info", render: function (p) { return "<div class=\"fsec\">Basic information</div>" + hrx.form(infoSpecs(p)) + "<div style=\"margin-top:var(--gap)\">" + needed.strip("projectAreas", "Project areas are not shown.") + "</div><div class=\"fsec\">Commercials</div>" + hrx.form(comSpecs(p)); } },
		{ k: "res", label: "Resourcing", render: resTab },
		{ k: "team", label: "Client Team", render: function () { return needed.block("projectTeam"); } },
		{ k: "att", label: "Attachments", render: function () { return needed.block("projectAttachments"); } }
	];

	function assignDialog(p, o, a) {
		var isEdit = !!o, taken = (resTab.cache || []).filter(function (r) { return r.IsActive !== false; }).map(function (r) { return r.Employee_EmployeeID; });
		var specs = (isEdit ? [{ k: "who", label: "Resource", type: "ro", val: o.Employee ? (o.Employee.FirstName + " " + o.Employee.LastName) : o.Employee_EmployeeID, span2: true }, { k: "scheme", label: "Billing scheme", type: "ro", val: (o.BillingID && o.BillingID.BillingDesc) || "—" }]
			: [{ k: "emp", label: "Resource", type: "select", req: true, ph: "Select a resource", opts: userOpts().filter(function (u) { return taken.indexOf(u[0]) === -1; }), span2: true }, { k: "scheme", label: "Billing scheme", type: "select", req: true, ph: "Select a day rate", opts: schemes.map(function (s) { return [s.ID, s.BillingDesc + " · " + hrx.gbp(s.DayRate, 0)]; }) }])
			.concat([{ k: "rate", label: "Day rate", type: "number", min: 0, val: o ? o.DayRate : "", suffix: "GBP" }, { k: "days", label: "Billable days", type: "number", min: 0, val: o ? o.BillableDays : "" }, { k: "from", label: "Start date", type: "date", val: o ? day(o.StartDate) : hrx.iso(hrx.today()) }, { k: "till", label: "End date", type: "date", val: o ? day(o.EndDate) : day(p.EndDate) }]);
		hrx.modal({ title: isEdit ? "Edit assignment" : "Assign resource", cls: "wide", body: hrx.form(specs), confirm: { text: "Save", cls: "primary" },
			onOpen: function (bd) { var s = bd.querySelector("[data-k=\"scheme\"]"); if (s && s.tagName === "SELECT") { s.addEventListener("change", function () { var x = schemes.find(function (y) { return y.ID === s.value; }); if (x) { bd.querySelector("[data-k=\"rate\"]").value = x.DayRate; } }); } },
			onConfirm: async function (bd) {
				if (!hrx.validate(bd, specs)) { hrx.toast("This field is mandatory", "crit"); return false; }
				var v = hrx.read(bd), rate = String(v.rate || "0"), days = String(v.days || "0");
				var body = { DayRate: rate, Currency: "GBP", BillableDays: days, TotalCharge: String((parseFloat(rate) || 0) * (parseFloat(days) || 0)), StartDate: v.from ? v.from + "T00:00:00Z" : null, EndDate: v.till ? v.till + "T00:00:00Z" : null };
				try {
					if (isEdit) { await svc.UserToProject.update({ Employee_EmployeeID: o.Employee_EmployeeID, Project_ID: o.Project_ID, BillingID_ID: o.BillingID_ID }, body); }
					else { await svc.UserToProject.create(Object.assign({ Employee_EmployeeID: v.emp, Project_ID: p.ID, BillingID_ID: v.scheme, IsActive: true }, body)); }
					hrx.toast(isEdit ? "Assignment updated" : "Resource assigned"); a.detail();
				} catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
			} });
	}

	function render(el) {
		root = el;
		api = md(el, {
			title: "Projects", searchPh: "Search project, client or PO", addTip: "Add project", filterTip: "Filter projects", emptyList: "No projects match the current search and filters",
			items: function () { return items; }, reload: reload, key: function (p) { return p.ID; },
			search: function (p) { return [p.ProjectDesc, clientName(p), p.PONumber, p.ID].join(" "); },
			pass: function (p, f) { return (!f.client || p.ClientID_ID === f.client) && (!f.booking || (f.booking === "Open") === open(p)); },
			row: function (p) { return "<div class=\"main\"><div class=\"t\">" + hrx.esc(p.ProjectDesc) + "</div><div class=\"s\">" + hrx.esc(clientName(p)) + "</div><div class=\"s\">" + hrx.esc(data.projectTypeLabel(p.ProjectType)) + (p.PONumber ? " · " + hrx.esc(p.PONumber) : "") + "</div></div><div class=\"r\">" + bookPill(p) + "<div style=\"margin-top:4px\">" + (p.StartDate ? hrx.fmt(day(p.StartDate)) : "—") + " – " + (p.EndDate ? hrx.fmt(day(p.EndDate)) : "—") + "</div></div>"; },
			head: function (p) { return "<span class=\"logo-c big grad-av\">" + hrx.initials(p.ProjectDesc) + "</span><div><div class=\"nm\">" + hrx.esc(p.ProjectDesc) + "</div><div class=\"sub\">" + hrx.esc(clientName(p)) + " · " + hrx.esc(data.projectTypeLabel(p.ProjectType)) + "</div></div>" + bookPill(p); },
			tabs: tabs,
			footer: function (p, tab) { return tab === "info" ? "<div class=\"md-foot\" style=\"justify-content:flex-end\"><button class=\"btn primary\" type=\"button\" data-act=\"save\">Save</button></div>" : ""; },
			onAdd: function (a) {
				var specs = [{ k: "ProjectDesc", label: "Project", req: true, ph: "Project description", span2: true }, { k: "ClientID_ID", label: "Client", type: "select", req: true, ph: "Select a client", opts: clients.filter(function (c) { return c.IsActive !== false; }).map(function (c) { return [c.ID, c.ClientName]; }) }, { k: "ProjectType", label: "Project type", type: "select", req: true, ph: "How will this project be charged?", opts: TYPES }, { k: "ProjectManagerID", label: "Project manager", type: "select", ph: "Who will manage this project?", opts: userOpts() }, { k: "Priority", label: "Priority", type: "select", ph: "How urgent is this project?", opts: ["Low", "Medium", "High"] }];
				hrx.modal({ title: "New project", cls: "wide", body: hrx.form(specs), confirm: { text: "Create", cls: "primary" }, onConfirm: async function (bd) {
					if (!hrx.validate(bd, specs)) { hrx.toast("This field is mandatory", "crit"); return false; }
					var v = hrx.read(bd);
					try {
						var p = await svc.Projects.create({ OrgID_ID: data.orgId(), ClientID_ID: v.ClientID_ID, ProjectDesc: v.ProjectDesc, ProjectType: v.ProjectType, ProjectManagerID: v.ProjectManagerID || null, Priority: v.Priority || "Medium", StartDate: hrx.iso(hrx.today()), EndDate: "2999-12-31", IsTimeBookingAllowed: true, IsActive: true });
						await reload(); a.select(p.ID); hrx.toast("Project created");
					} catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
				} });
			},
			onFilter: function (st, a) {
				var specs = [{ k: "client", label: "Client", type: "select", opts: [["", "All clients"]].concat(clients.map(function (c) { return [c.ID, c.ClientName]; })), val: st.f.client || "" }, { k: "booking", label: "Time booking", type: "select", opts: [["", "All"], "Open", "Closed"], val: st.f.booking || "" }];
				hrx.modal({ title: "Filter projects", body: hrx.form(specs, 1), confirm: { text: "Apply", cls: "primary" }, onConfirm: function (bd) { st.f = hrx.read(bd); a.list(); } });
			},
			act: function (act, p, btn, a, tab) {
				var i = +btn.dataset.i;
				if (tab === "info" && act === "save") {
					var body = a.body(), v = hrx.read(body);
					if (!v.ProjectDesc) { body.querySelector("[data-k=\"ProjectDesc\"]").classList.add("err"); hrx.toast("This field is mandatory", "crit"); return; }
					if (v.StartDate && v.EndDate && v.EndDate < v.StartDate) { body.querySelector("[data-k=\"EndDate\"]").classList.add("err"); hrx.toast("The end date is before the start date", "crit"); return; }
					btn.disabled = true;
					svc.Projects.update({ ID: p.ID }, { ProjectDesc: v.ProjectDesc, ProjectType: v.ProjectType, Priority: v.Priority || null, ProjectManagerID: v.ProjectManagerID || null, PONumber: v.PONumber || null, POValue: v.POValue || null, TotBillableDays: v.TotBillableDays || null, StartDate: v.StartDate || null, EndDate: v.EndDate || null, IsTimeBookingAllowed: v.IsTimeBookingAllowed, IsActive: v.IsActive })
						.then(function () { hrx.toast("Project saved"); return reload(); }).then(function () { a.refresh(); }, function (e) { hrx.toast(hrx.errText(e), "crit"); }).then(function () { btn.disabled = false; });
					return;
				}
				if (tab === "res") {
					var o = (resTab.cache || [])[i];
					if (act === "add") { assignDialog(p, null, a); }
					else if (act === "edit") { assignDialog(p, o, a); }
					else if (act === "release" || act === "reactivate") {
						var nm = o.Employee ? o.Employee.FirstName + " " + o.Employee.LastName : o.Employee_EmployeeID, rel = act === "release";
						hrx.confirm(rel ? "Release resource" : "Reactivate resource", (rel ? "Release " : "Put ") + hrx.esc(nm) + (rel ? " from this project? They will no longer be able to book time to it." : " back on this project?"), rel ? "Release" : "Reactivate", async function () {
							try { await svc.UserToProject.update({ Employee_EmployeeID: o.Employee_EmployeeID, Project_ID: o.Project_ID, BillingID_ID: o.BillingID_ID }, { IsActive: !rel }); hrx.toast(rel ? "Resource released" : "Resource reactivated"); a.detail(); }
							catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
						}, rel);
					}
				}
			}
		});
	}
	async function load() {
		if (items.length) { return; }
		root.querySelector("[data-r=\"rows\"]").innerHTML = hrx.loading();
		try { await reload(); api.refresh(); }
		catch (e) { root.querySelector("[data-r=\"rows\"]").innerHTML = hrx.failed(e); }
	}
	return { render: render, load: load };
});
