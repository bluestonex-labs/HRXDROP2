/*
 * Manage Clients (managers): Clients with their base site (Sites), primary contact
 * (Contacts, object type C) and logo (Documents). Support team, SLA, licensed
 * components and application services have no HRX entity yet: those tabs show the
 * prototype's sample data (../preview.js) and are not saved.
 */
sap.ui.define(["../core", "../service", "../data", "../md", "../preview"], function (hrx, svc, data, md, preview) {
	"use strict";

	var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
	var api, root, items = [], contacts = [], sites = [];
	var init = function (n) { return String(n || "").split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase(); };
	var contactOf = function (c) { return contacts.find(function (x) { return x.ObjectID === c.ID && x.ObjectType === "C"; }) || null; };
	var siteLabel = function (c) { var s = sites.find(function (x) { return x.ID === c.BaseSite; }); return s ? s.SiteDesc : (c.BaseSite || ""); };
	var yn = function (b) { return b ? hrx.pill("ok", "Yes") : hrx.pill("neu", "No"); };
	var actBtns = function (i) { return "<div class=\"rowacts\"><button class=\"icon-btn sm\" type=\"button\" data-act=\"edit\" data-i=\"" + i + "\" title=\"Edit\">" + hrx.ICON.edit + "</button><button class=\"icon-btn sm del\" type=\"button\" data-act=\"del\" data-i=\"" + i + "\" title=\"Delete\">" + hrx.ICON.trash + "</button></div>"; };
	var addrow = function (t, b) { return "<div class=\"sect-head\"><div class=\"t\">" + t + "</div>" + (b || "") + "</div>"; };
	var sevOpts = ["Very High", "High", "Medium", "Low"];

	async function reload() {
		var r = await Promise.all([svc.Clients.list({ $orderby: "ClientName" }), svc.Contacts.list({ $filter: "ObjectType eq 'C'" }), data.sites()]);
		items = r[0]; contacts = r[1]; sites = r[2];
		data.invalidate("clients");
	}
	var basicSpecs = function (c) { var k = contactOf(c) || {}; return { client: [{ k: "ID", label: "Client key", type: "ro", val: c.ID }, { k: "ClientName", label: "Name", req: true, val: c.ClientName }, { k: "BaseSite", label: "Location", type: "select", ph: "Client base site (optional)", opts: sites.map(function (s) { return [s.ID, s.SiteDesc]; }).concat(c.BaseSite && !sites.some(function (s) { return s.ID === c.BaseSite; }) ? [[c.BaseSite, c.BaseSite]] : []), val: c.BaseSite }, { k: "IsActive", label: "Active", type: "toggle", val: c.IsActive !== false }, { k: "logo", label: "Logo", type: "file", accept: "image/png,image/jpeg", hint: "jpg/png file only" + (c.LogoObjectID ? " · a logo is on file" : ""), span2: true }],
		contact: [{ k: "cn", label: "Contact name", type: "text", val: "", ph: "Not held by the HRX service", dis: true, hint: "Contacts has no name field yet" }, { k: "WorkEmail", label: "Contact email", val: k.WorkEmail, ph: "client.contact@client.domain" }, { k: "ContactNo", label: "Contact phone", val: k.ContactNo, ph: "+44 1234 567890" }, { k: "MobileNo", label: "Contact mobile", val: k.MobileNo, ph: "Optional" }] }; };
	var userSpecs = function (u) { return [{ k: "first", label: "First name", req: true, val: u.first, ph: "Enter first name" }, { k: "last", label: "Last name", val: u.last, ph: "Enter last name" }, { k: "email", label: "Email", req: true, val: u.email, ph: "user@client.domain", span2: true }, { k: "mobile", label: "Mobile", val: u.mobile, ph: "Enter mobile number" }, { k: "active", label: "Active", type: "toggle", val: u.active }, { k: "admin", label: "Administrator", type: "toggle", val: u.admin }]; };
	var slaSpecs = function (s) { return [{ k: "sev", label: "Severity", type: "select", req: true, ph: "Select a severity", opts: sevOpts, val: s.sev, span2: true }, { k: "resp", label: "Response time (hrs)", type: "number", req: true, min: 0, val: s.resp }, { k: "res", label: "Resolution time (hrs)", type: "number", req: true, min: 0, val: s.res }]; };
	var compSpecs = function (c) { return [{ k: "sw", label: "Software", type: "select", req: true, ph: "Select software", opts: ["SAP S/4HANA", "SAP ECC", "SAP BTP", "SAP Fiori", "SAP SuccessFactors"], val: c.sw }, { k: "comp", label: "Component", req: true, val: c.comp, ph: "Select component" }, { k: "sub", label: "Sub-component", val: c.sub, ph: "Select sub-component" }, { k: "sys", label: "System number", val: c.sys }, { k: "from", label: "Valid from", type: "date", val: c.from }, { k: "till", label: "Valid till", type: "date", val: c.till }, { k: "install", label: "Install date", type: "date", val: c.install }, { k: "ver", label: "SAP version", val: c.ver }, { k: "obj", label: "Object cost", type: "number", min: 0, val: c.obj, suffix: "GBP" }, { k: "sup", label: "Support cost", type: "number", min: 0, val: c.sup, suffix: "GBP" }, { k: "supported", label: "In support", type: "toggle", val: c.supported }, { k: "cloud", label: "Cloud customer", type: "toggle", val: c.cloud }, { k: "show", label: "Show warning", type: "toggle", val: c.show }, { k: "warn", label: "Warning message", val: c.warn, span2: true }, { k: "hard", label: "Hard message", val: c.hard, span2: true }]; };
	var appSpecs = function (a) { return [{ k: "app", label: "App", type: "select", req: true, ph: "Select an app", opts: ["Maextro Monitor", "HRX", "TimesheetX", "Blueskyx"], val: a.app }, { k: "svc", label: "Service", type: "select", req: true, ph: "Select a service", opts: ["Support", "Hosting", "Monitoring", "Licence"], val: a.svc }]; };
	var strip = function (w) { return "<div style=\"margin-bottom:var(--gap)\">" + hrx.previewStrip(w) + "</div>"; };

	var tabs = [
		{ k: "basic", label: "Basic Info", render: function (c) { var s = basicSpecs(c); return "<div class=\"fsec\">Client</div>" + hrx.form(s.client) + "<div class=\"fsec\">Primary contact</div><div data-sec=\"contact\">" + hrx.form(s.contact) + "</div>"; } },
		{ k: "team", label: "Support Team", render: function (c) { var x = preview.clientOf(c.ClientName); return strip("Client support users are sample data.") + addrow("Users", "<button class=\"btn ghost sm\" type=\"button\" data-act=\"add\">" + hrx.ICON.userplus + "Add user</button>") + hrx.tbl([{ h: "User" }, { h: "Email" }, { h: "Status" }, { h: "Admin" }, { h: "" }], x.users.map(function (u, i) { return ["<b>" + hrx.esc(u.first + " " + u.last) + "</b>", hrx.esc(u.email), hrx.pill(u.active ? "ok" : "warn", u.active ? "Active" : "Inactive"), yn(u.admin), actBtns(i)]; }), "No support users for this client"); } },
		{ k: "sla", label: "SLA", render: function (c) { var x = preview.clientOf(c.ClientName); return strip("Service levels are sample data.") + addrow("Service levels", "<button class=\"btn ghost sm\" type=\"button\" data-act=\"add\">" + hrx.ICON.plus + "Add service level</button>") + hrx.tbl([{ h: "Severity" }, { h: "Response", al: "right" }, { h: "Resolution", al: "right" }, { h: "" }], x.sla.map(function (s, i) { return ["<b>" + s.sev + "</b>", s.resp + " hrs", s.res + " hrs", actBtns(i)]; }), "No service levels defined"); } },
		{ k: "comps", label: "Components", render: function (c) { var x = preview.clientOf(c.ClientName); return strip("Licensed components are sample data.") + addrow("Licensed components", "<button class=\"btn ghost sm\" type=\"button\" data-act=\"add\">" + hrx.ICON.plus + "Add component</button>") + hrx.tbl([{ h: "Software" }, { h: "Validity" }, { h: "Status" }, { h: "Costs", al: "right" }, { h: "" }], x.comps.map(function (y, i) { return ["<b>" + hrx.esc(y.sw) + "</b><small class=\"tsub\">" + hrx.esc([y.comp, y.sub, y.sys].filter(Boolean).join(" · ")) + "</small>", "<span class=\"nowrap\">" + (y.from ? hrx.fmt(y.from) : "—") + " – " + (y.till ? hrx.fmt(y.till) : "—") + "</span>", "<div class=\"flags\">" + (y.supported ? hrx.pill("ok", "In support") : hrx.pill("warn", "Out of support")) + (y.cloud ? hrx.pill("info", "Cloud") : "") + (y.show ? hrx.pill("warn", "Warning") : "") + (y.hard ? hrx.pill("crit", "Hard stop") : "") + "</div>", "<span class=\"nowrap\">" + hrx.gbp(y.obj, 0) + " / " + hrx.gbp(y.sup, 0) + "</span><small class=\"tsub\">Object / support</small>", actBtns(i)]; }), "No licensed components"); } },
		{ k: "apps", label: "Application Details", render: function (c) { var x = preview.clientOf(c.ClientName); return strip("Apps and services are sample data.") + addrow("Apps and services", "<button class=\"btn ghost sm\" type=\"button\" data-act=\"add\">" + hrx.ICON.plus + "Add service</button>") + hrx.tbl([{ h: "App" }, { h: "Service" }, { h: "Validity" }, { h: "" }], x.apps.map(function (a, i) { return ["<b>" + hrx.esc(a.app) + "</b>", hrx.esc(a.svc), "<span class=\"nowrap\">" + hrx.fmt(a.from) + " – " + hrx.fmt(a.till) + "</span>", actBtns(i)]; }), "No apps or services assigned"); } }
	];

	async function saveBasic(c, a) {
		var body = a.body(), v = hrx.read(body);
		if (!v.ClientName) { body.querySelector("[data-k=\"ClientName\"]").classList.add("err"); hrx.toast("Enter a client name before saving.", "crit"); return; }
		if (v.logo) { var ext = (v.logo.name.split(".").pop() || "").toLowerCase(); if (["png", "jpg", "jpeg"].indexOf(ext) === -1) { hrx.toast("The file type *." + ext + " is not supported. Choose a png or jpg file.", "crit"); return; } }
		if (v.WorkEmail && !EMAIL.test(v.WorkEmail)) { body.querySelector("[data-k=\"WorkEmail\"]").classList.add("err"); hrx.toast("Enter a valid email address", "crit"); return; }
		await svc.Clients.update({ ID: c.ID }, { ClientName: v.ClientName, BaseSite: v.BaseSite || null, IsActive: v.IsActive });
		var k = contactOf(c), payload = { WorkEmail: v.WorkEmail || null, ContactNo: v.ContactNo || null, MobileNo: v.MobileNo || null };
		if (k) { await svc.Contacts.update({ ID: k.ID, ObjectType: "C" }, payload); }
		else if (v.WorkEmail || v.ContactNo || v.MobileNo) { await svc.Contacts.create(Object.assign({ ObjectType: "C", ObjectID: c.ID, ContactType: "Primary", IsActive: true }, payload)); }
		if (v.logo) { await svc.uploadDocument("Client", c.ID, c.LogoObjectID || "", v.logo); }
		hrx.toast("Client saved");
		await reload(); a.refresh();
	}

	function render(el) {
		root = el;
		api = md(el, {
			title: "Clients", searchPh: "Search name, location or contact", addTip: "Add client", emptyList: "No clients match the current search",
			items: function () { return items; }, reload: reload, key: function (c) { return c.ID; },
			search: function (c) { var k = contactOf(c) || {}; return [c.ClientName, siteLabel(c), k.WorkEmail, c.ID].join(" "); },
			row: function (c) { var k = contactOf(c) || {}; return "<span class=\"logo-c\">" + init(c.ClientName) + hrx.photo(data.photoUrl(c.LogoRootID, c.LogoObjectID)) + "</span><div class=\"main\"><div class=\"t\">" + hrx.esc(c.ClientName) + "</div><div class=\"s\">" + hrx.esc(c.ID) + "</div></div><div class=\"r\">" + hrx.esc(siteLabel(c)) + "<div>" + hrx.esc(k.WorkEmail || "") + "</div></div>"; },
			head: function (c) { return "<span class=\"logo-c big\">" + init(c.ClientName) + hrx.photo(data.photoUrl(c.LogoRootID, c.LogoObjectID)) + "</span><div><div class=\"nm\">" + hrx.esc(c.ClientName) + "</div><div class=\"sub\">" + hrx.esc(c.ID) + (siteLabel(c) ? " · " + hrx.esc(siteLabel(c)) : "") + "</div></div>" + (c.IsActive === false ? hrx.pill("warn", "Inactive") : ""); },
			tabs: tabs,
			footer: function (c, tab) { return tab === "basic" ? "<div class=\"md-foot\" style=\"justify-content:flex-end\"><button class=\"btn primary\" type=\"button\" data-act=\"save\">Save</button></div>" : ""; },
			onAdd: function (a) {
				var specs = [{ k: "ClientName", label: "Name", req: true, ph: "Client name", span2: true }, { k: "BaseSite", label: "Location", type: "select", ph: "Client base site (optional)", opts: sites.map(function (s) { return [s.ID, s.SiteDesc]; }) }, { k: "WorkEmail", label: "Contact email", ph: "Optional" }];
				hrx.modal({ title: "New client", cls: "wide", body: hrx.form(specs), confirm: { text: "Create", cls: "primary" }, onConfirm: async function (bd) {
					var v = hrx.read(bd);
					if (!v.ClientName) { bd.querySelector("[data-k=\"ClientName\"]").classList.add("err"); hrx.toast("Enter a client name before saving.", "crit"); return false; }
					if (v.WorkEmail && !EMAIL.test(v.WorkEmail)) { bd.querySelector("[data-k=\"WorkEmail\"]").classList.add("err"); hrx.toast("Enter a valid email address", "crit"); return false; }
					try {
						var c = await svc.Clients.create({ OrgID_ID: data.orgId(), ClientName: v.ClientName, BaseSite: v.BaseSite || null, IsActive: true });
						if (v.WorkEmail) { await svc.Contacts.create({ ObjectType: "C", ObjectID: c.ID, ContactType: "Primary", WorkEmail: v.WorkEmail, IsActive: true }); }
						await reload(); a.select(c.ID); hrx.toast("Client created");
					} catch (e) { hrx.toast(hrx.createErrText(e, "client"), "crit"); return false; }
				} });
			},
			act: function (act, c, btn, a, tab) {
				if (tab === "basic" && act === "save") { btn.disabled = true; saveBasic(c, a).catch(function (e) { hrx.toast(hrx.errText(e), "crit"); }).then(function () { btn.disabled = false; }); return; }
				var x = preview.clientOf(c.ClientName), i = +btn.dataset.i;
				var lists = { team: ["users", userSpecs, { first: "", last: "", email: "", mobile: "", active: true, admin: false }, "user", "Support User", false, "User"], sla: ["sla", slaSpecs, { sev: "", resp: "", res: "" }, "service level", "Service Level", false, "Service level"], comps: ["comps", compSpecs, { sw: "", comp: "", sub: "", from: "", till: "", supported: true, sys: "", install: "", ver: "", obj: 0, sup: 0, cloud: false, show: false, warn: "", hard: "" }, "component", "Component", true, "Component"], apps: ["apps", appSpecs, { app: "", svc: "", from: hrx.iso(hrx.today()), till: hrx.today().getFullYear() + "-12-31" }, "service", "App Service", false, "Service"] }[tab];
				if (!lists) { return; }
				var key = lists[0], specs = lists[1], blank = lists[2], noun = lists[3], Title = lists[4], wide = lists[5], Noun = lists[6];
				var edit = function (title, sp, done) { hrx.modal({ title: title, cls: wide ? "wide" : "", body: hrx.previewStrip("") + hrx.form(sp), confirm: { text: "Save", cls: "primary" }, onConfirm: function (bd) { if (!hrx.validate(bd, sp)) { hrx.toast("This field is mandatory", "crit"); return false; } var v = hrx.read(bd); if (v.email !== undefined && !EMAIL.test(v.email)) { bd.querySelector("[data-k=\"email\"]").classList.add("err"); hrx.toast("Enter a valid email address", "crit"); return false; } done(v); } }); };
				var norm = function (o) { if (key === "sla") { o.resp = +o.resp; o.res = +o.res; } if (key === "comps") { o.obj = +o.obj || 0; o.sup = +o.sup || 0; } return o; };
				if (act === "add") { edit("New " + Title, specs(blank), function (v) { x[key].push(norm(Object.assign({}, blank, v))); hrx.toast(Noun + " added (preview)"); a.detail(); }); }
				else if (act === "edit") { var o = x[key][i]; edit("Edit " + Title, specs(o), function (v) { norm(Object.assign(o, v)); hrx.toast(Noun + " updated (preview)"); a.detail(); }); }
				else if (act === "del") { hrx.confirm("Delete " + noun, "Are you sure you want to delete this " + noun + "?", "Delete", function () { x[key].splice(i, 1); hrx.toast(Noun + " deleted (preview)"); a.detail(); }); }
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
