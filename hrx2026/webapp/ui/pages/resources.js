/*
 * Manage Resources (managers): HRX employees (Users) with their work schedule
 * (WorkSchedule), base site (Sites), manager, reward settings, leave taken (Leaves,
 * BankHolidays), assets (Assets, AssetAssignment) and profile picture (Documents).
 */
sap.ui.define(["../core", "../service", "../data", "../md"], function (hrx, svc, data, md) {
	"use strict";

	var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
	var DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
	var api, items = [], sites = [], root;
	var full = function (r) { return ((r.FirstName || "") + " " + (r.LastName || "")).trim(); };
	var sched = function (r) { var w = r.WorkSchedule || {}; return DAYS.filter(function (d) { return w[d]; }); };
	var siteOpts = function () { return sites.map(function (s) { return [s.ID, s.SiteDesc]; }); };
	var typeOpts = [["S", "Staff"], ["C", "Contractor"]];

	async function reload() {
		var r = await Promise.all([svc.Users.list({ $expand: "WorkSchedule,Manager($select=EmployeeID,FirstName,LastName,WorkEmail)", $orderby: "FirstName,LastName" }), data.sites()]);
		items = r[0]; sites = r[1];
		// every page reads people (and their pictures) from the shared list: refresh it
		data.invalidate("users");
		data.users();
		var mine = items.find(function (u) { return u.EmployeeID === data.me.EmployeeID; });
		if (mine && (mine.ImageObjectID !== data.me.ImageObjectID || full(mine) !== data.me.name)) {
			Object.assign(data.me, { ImageRootID: mine.ImageRootID, ImageObjectID: mine.ImageObjectID, FirstName: mine.FirstName, LastName: mine.LastName, name: full(mine) });
			hrx.emit("me");
		}
	}
	var infoSpecs = function (r) { return [{ k: "FirstName", label: "First name", req: true, val: r.FirstName, ph: "Enter first name" }, { k: "LastName", label: "Last name", val: r.LastName, ph: "Enter last name" }, { k: "WorkEmail", label: "Email", type: "ro", val: r.WorkEmail }, { k: "MobileNo", label: "Mobile", val: r.MobileNo, ph: "Enter mobile number" }, { k: "BaseSite_ID", label: "Location", type: "select", req: true, ph: "Select base location", opts: siteOpts(), val: r.BaseSite_ID }, { k: "UserType", label: "Resource type", type: "select", req: true, ph: "Select resource type", opts: typeOpts, val: r.UserType }, { k: "IsActive", label: "Active", type: "toggle", val: r.IsActive !== false }, { k: "pic", label: "Picture", type: "file", accept: "image/png,image/jpeg", hint: "jpg/png file only" + (r.ImageObjectID ? " · a picture is on file" : "") }]; };

	async function leaveTab(r) {
		var d = hrx.today(), y0 = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear(), from = y0 + "-04-01", to = (y0 + 1) + "-03-31";
		var x = await Promise.all([
			svc.Leaves.list({ $filter: "EmpID_EmployeeID eq " + svc.q(r.EmployeeID) + " and StartDate ge " + from + " and StartDate le " + to, $expand: "LeaveCategoryId($select=LeaveCategoryDesc,isAccountable),Status($select=ID,StatusDesc)" }),
			r.BaseSite_ID ? svc.BankHolidays.list({ $filter: "Site_ID eq " + r.BaseSite_ID + " and Date ge " + from + " and Date le " + to, $select: "ID" }) : Promise.resolve([])
		]);
		var groups = data.groupLeaves(x[0]);
		var taken = x[0].filter(function (l) { return l.LeaveCategoryId && l.LeaveCategoryId.isAccountable && l.Status_ID === svc.STATUS.approved; }).reduce(function (n, l) { return n + data.dayValue(l.DayTime); }, 0);
		var quota = parseFloat((r.WorkSchedule || {}).AnnualLeaveQuota) || 0;
		return "<div class=\"kpi-mini\"><div><div class=\"n\">" + quota + "</div><div class=\"l\">Annual quota (days)</div></div><div><div class=\"n\">" + taken + "</div><div class=\"l\">Leave taken (days)</div></div><div><div class=\"n ok\">" + (quota - taken) + "</div><div class=\"l\">Balance (days)</div></div><div><div class=\"n\">" + x[1].length + "</div><div class=\"l\">Bank holidays</div></div></div>" +
			hrx.tbl([{ h: "Date" }, { h: "Leave type" }, { h: "Status", al: "right" }], groups.map(function (g) { return [g.label, hrx.esc(g.type) + " · " + g.duration, data.statusPill(g.status)]; }), "No leave recorded for this resource this leave year");
	}
	async function assetsTab(r) {
		var a = await svc.AssetAssignment.list({ $filter: "EmployeeID_EmployeeID eq " + svc.q(r.EmployeeID), $expand: "AssetID" });
		return "<div class=\"sect-head\"><div class=\"t\">Assigned assets</div><button class=\"btn ghost sm\" type=\"button\" data-act=\"assign-asset\">" + hrx.ICON.plus + "Assign asset</button></div>" +
			hrx.tbl([{ h: "Asset" }, { h: "Serial number" }, { h: "Issued" }, { h: "" }], a.map(function (x) { var s = x.AssetID || {}; return ["<b>" + hrx.esc(s.Desc || "—") + "</b><small class=\"tsub\">" + hrx.esc([s.Feature1, s.Version].filter(Boolean).join(" · ")) + "</small>", "<span class=\"mono\">" + hrx.esc(s.SerialNumber || "—") + "</span>", x.DateOfIssue ? hrx.fmt(new Date(x.DateOfIssue)) : "—", "<div class=\"rowacts\"><button class=\"icon-btn sm del\" type=\"button\" data-act=\"unassign\" data-id=\"" + x.ID + "\" title=\"Return asset\">" + hrx.ICON.trash + "</button></div>"]; }), "No assets assigned");
	}

	var tabs = [
		{ k: "info", label: "Info", render: function (r) { return hrx.form(infoSpecs(r)); } },
		{ k: "mgr", label: "Manager", render: function (r) { var m = r.Manager; return hrx.form([{ k: "Manager_EmployeeID", label: "Manager", type: "select", ph: "Select manager", opts: items.filter(function (u) { return u.EmployeeID !== r.EmployeeID && u.IsActive !== false; }).map(function (u) { return [u.EmployeeID, full(u)]; }), val: r.Manager_EmployeeID }, { k: "am", label: "Assigned manager", type: "ro", val: m ? full(m) : "Not assigned" }, { k: "me", label: "Manager email", type: "ro", val: m ? m.WorkEmail : "" }]); } },
		{ k: "work", label: "Working Time", render: function (r) { var w = r.WorkSchedule || {}; return hrx.form([{ k: "TargetUtilization", label: "Target utilisation", type: "number", val: r.TargetUtilization || w.TargetUtilization, min: 0, suffix: "%" }, { k: "TargetHrsPerWeek", label: "Weekly target hours", val: r.TargetHrsPerWeek || w.TargetHrsPerWeek, ph: "HH:mm" }, { k: "days", label: "Work schedule", type: "chips", opts: DAYS, val: sched(r), span2: true }, { k: "AnnualLeaveQuota", label: "Annual leave quota (days)", type: "number", step: "0.5", min: 0, val: w.AnnualLeaveQuota }]); } },
		{ k: "reward", label: "Reward & Benefits", render: function (r) { return hrx.form([{ k: "BonusPercent", label: "Bonus", type: "number", min: 0, val: r.BonusPercent, suffix: "%" }, { k: "PercentRate", label: "Pension rate", type: "number", min: 0, val: r.PercentRate, suffix: "%" }]); } },
		{ k: "leave", label: "Leave Taken", render: leaveTab },
		{ k: "assets", label: "Assets", render: assetsTab }
	];

	async function save(r, tab, a) {
		var body = a.body(), v = hrx.read(body), k = { EmployeeID: r.EmployeeID };
		if (tab === "info") {
			if (!hrx.validate(body, infoSpecs(r))) { hrx.toast("Complete first name, location and resource type before saving.", "crit"); return; }
			if (v.pic) { var ext = (v.pic.name.split(".").pop() || "").toLowerCase(); if (["png", "jpg", "jpeg"].indexOf(ext) === -1) { hrx.toast("The file type *." + ext + " is not supported. Choose a png or jpg file.", "crit"); return; } }
			await svc.Users.update(k, { FirstName: v.FirstName, LastName: v.LastName, MobileNo: v.MobileNo || null, BaseSite_ID: v.BaseSite_ID, UserType: v.UserType, IsActive: v.IsActive });
			if (v.pic) { await svc.uploadDocument("User", r.EmployeeID, r.ImageObjectID || "", v.pic); }
		} else if (tab === "mgr") {
			await svc.Users.update(k, { Manager_EmployeeID: v.Manager_EmployeeID || null });
		} else if (tab === "work") {
			var ws = { TargetUtilization: String(v.TargetUtilization || ""), TargetHrsPerWeek: v.TargetHrsPerWeek || "40", AnnualLeaveQuota: String(v.AnnualLeaveQuota || "0") };
			DAYS.forEach(function (d) { ws[d] = v.days.indexOf(d) !== -1; });
			await svc.Users.update(k, { TargetUtilization: ws.TargetUtilization, TargetHrsPerWeek: ws.TargetHrsPerWeek });
			if (r.WorkSchedule) { await svc.WorkSchedule.update({ EmployeeID_EmployeeID: r.EmployeeID }, ws); }
			else { await svc.WorkSchedule.create(Object.assign({ EmployeeID_EmployeeID: r.EmployeeID }, ws)); }
		} else if (tab === "reward") {
			await svc.Users.update(k, { BonusPercent: v.BonusPercent === "" ? null : parseInt(v.BonusPercent, 10), PercentRate: v.PercentRate === "" ? null : parseInt(v.PercentRate, 10) });
		} else { return; }
		hrx.toast("Resource saved");
		await reload(); a.refresh();
	}

	function render(el) {
		root = el;
		api = md(el, {
			title: "Resources", searchPh: "Search name, email or location", addTip: "Add resource", filterTip: "Filter resources", emptyList: "No resources match the current search and filters",
			items: function () { return items; }, reload: reload, key: function (r) { return r.EmployeeID; },
			search: function (r) { return [full(r), r.WorkEmail, data.siteName(r.BaseSite_ID), r.EmployeeID].join(" "); },
			pass: function (r, f) { return (!f.type || r.UserType === f.type) && (!f.status || (f.status === "Active") === (r.IsActive !== false)) && (!f.site || r.BaseSite_ID === f.site); },
			row: function (r) { return "<span class=\"avatar-sm grad-av big\">" + hrx.initials(full(r)) + hrx.photo(data.photoUrl(r.ImageRootID, r.ImageObjectID)) + "</span><div class=\"main\"><div class=\"t\">" + hrx.esc(full(r)) + "</div><div class=\"s\">" + hrx.esc(r.WorkEmail) + "</div></div><div class=\"r\">" + hrx.pill(r.IsActive !== false ? "ok" : "warn", r.IsActive !== false ? "Active" : "Inactive") + "<div style=\"margin-top:3px\">" + data.userTypeLabel(r.UserType) + " · " + hrx.esc(data.siteName(r.BaseSite_ID)) + "</div></div>"; },
			head: function (r) { return "<span class=\"avatar-sm grad-av big\">" + hrx.initials(full(r)) + hrx.photo(data.photoUrl(r.ImageRootID, r.ImageObjectID)) + "</span><div><div class=\"nm\">" + hrx.esc(full(r)) + "</div><div class=\"sub\">" + data.userTypeLabel(r.UserType) + " · " + hrx.esc(data.siteName(r.BaseSite_ID)) + " · " + r.EmployeeID + "</div></div>" + hrx.pill(r.IsActive !== false ? "ok" : "warn", r.IsActive !== false ? "Active" : "Inactive"); },
			tabs: tabs,
			footer: function (r, tab) { return "<div class=\"md-foot\"><button class=\"btn danger\" type=\"button\" data-act=\"delete\">" + hrx.ICON.trash + "Delete</button>" + (tab === "leave" || tab === "assets" ? "" : "<button class=\"btn primary\" type=\"button\" data-act=\"save\">Save</button>") + "</div>"; },
			onAdd: function (a) {
				var specs = [{ k: "FirstName", label: "First name", req: true, ph: "Enter first name" }, { k: "LastName", label: "Last name", ph: "Enter last name" }, { k: "WorkEmail", label: "Email", req: true, ph: "resource@bluestonex.com", span2: true }, { k: "MobileNo", label: "Mobile", ph: "Enter mobile number" }, { k: "BaseSite_ID", label: "Location", type: "select", req: true, ph: "Select base location", opts: siteOpts() }, { k: "UserType", label: "Resource type", type: "select", req: true, ph: "Select resource type", opts: typeOpts }];
				hrx.modal({ title: "New resource", cls: "wide", body: hrx.form(specs), confirm: { text: "Create", cls: "primary" }, onConfirm: async function (bd) {
					if (!hrx.validate(bd, specs)) { hrx.toast("This field is mandatory", "crit"); return false; }
					var v = hrx.read(bd);
					if (!EMAIL.test(v.WorkEmail)) { bd.querySelector("[data-k=\"WorkEmail\"]").classList.add("err"); hrx.toast("Enter a valid email address", "crit"); return false; }
					try {
						var u = await svc.Users.create({ OrgID_ID: data.orgId(), FirstName: v.FirstName, LastName: v.LastName, WorkEmail: v.WorkEmail.toLowerCase(), MobileNo: v.MobileNo || null, BaseSite_ID: v.BaseSite_ID, UserType: v.UserType, IsActive: true, TargetUtilization: "80", TargetHrsPerWeek: "40",
							WorkSchedule: { Mo: true, Tu: true, We: true, Th: true, Fr: true, Sa: false, Su: false, AnnualLeaveQuota: "25", TargetUtilization: "80", TargetHrsPerWeek: "40:00" } });
						await reload(); a.select(u.EmployeeID); hrx.toast("Resource created");
					} catch (e) { hrx.toast(hrx.createErrText(e, "user"), "crit"); return false; }
				} });
			},
			onFilter: function (st, a) {
				var specs = [{ k: "type", label: "Resource type", type: "select", opts: [["", "All"]].concat(typeOpts), val: st.f.type || "" }, { k: "status", label: "Status", type: "select", opts: [["", "All"], "Active", "Inactive"], val: st.f.status || "" }, { k: "site", label: "Location", type: "select", opts: [["", "All locations"]].concat(siteOpts()), val: st.f.site || "" }];
				hrx.modal({ title: "Filter resources", body: hrx.form(specs, 1), confirm: { text: "Apply", cls: "primary" }, onConfirm: function (bd) { st.f = hrx.read(bd); a.list(); } });
			},
			act: function (act, r, btn, a, tab) {
				if (act === "delete") {
					hrx.confirm("Delete resource", "Are you sure you want to delete " + hrx.esc(full(r)) + "? Their leave and time stay in HRX, but they will no longer be able to sign in to it.", "Delete", async function () {
						try { await svc.Users.remove({ EmployeeID: r.EmployeeID }); a.st.sel = null; await reload(); a.refresh(); hrx.toast("Resource deleted"); }
						catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
					});
					return;
				}
				if (act === "save") {
					btn.disabled = true;
					save(r, tab, a).catch(function (e) { hrx.toast(hrx.errText(e), "crit"); }).then(function () { btn.disabled = false; });
					return;
				}
				if (act === "unassign") {
					hrx.confirm("Return asset", "Record this asset as returned by " + hrx.esc(full(r)) + "?", "Return", async function () {
						try { await svc.AssetAssignment.remove({ ID: btn.dataset.id }); hrx.toast("Asset returned"); a.detail(); }
						catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
					});
					return;
				}
				if (act === "assign-asset") { assignAsset(r, a); }
			}
		});
	}
	async function assignAsset(r, a) {
		try {
			var x = await Promise.all([svc.Assets.list({ $filter: "IsActive eq true", $orderby: "Desc" }), svc.AssetAssignment.list({ $select: "AssetID_ID" })]);
			var taken = {}; x[1].forEach(function (y) { taken[y.AssetID_ID] = 1; });
			var free = x[0].filter(function (s) { return !taken[s.ID]; });
			if (!free.length) { hrx.toast("Every active asset is already assigned", "crit"); return; }
			var specs = [{ k: "asset", label: "Asset", type: "select", req: true, ph: "Select an asset", opts: free.map(function (s) { return [s.ID, s.Desc + (s.SerialNumber ? " · " + s.SerialNumber : "")]; }), span2: true }, { k: "comment", label: "Comment", type: "textarea", ph: "Optional", span2: true }];
			hrx.modal({ title: "Assign asset — " + full(r), cls: "wide", body: hrx.form(specs), confirm: { text: "Assign", cls: "primary" }, onConfirm: async function (bd) {
				if (!hrx.validate(bd, specs)) { hrx.toast("Select an asset", "crit"); return false; }
				var v = hrx.read(bd);
				try { await svc.AssetAssignment.create({ AssetID_ID: v.asset, EmployeeID_EmployeeID: r.EmployeeID, DateOfIssue: new Date().toISOString(), Comment: v.comment || "Asset assigned" }); hrx.toast("Asset assigned"); a.detail(); }
				catch (e) { hrx.toast(hrx.errText(e), "crit"); return false; }
			} });
		} catch (e) { hrx.toast(hrx.errText(e), "crit"); }
	}
	async function load() {
		if (items.length) { return; }
		root.querySelector("[data-r=\"rows\"]").innerHTML = hrx.loading();
		try { await reload(); await data.index(); api.refresh(); }
		catch (e) { root.querySelector("[data-r=\"rows\"]").innerHTML = hrx.failed(e); }
	}
	return { render: render, load: load };
});
