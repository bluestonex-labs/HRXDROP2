/*
 * Manage Clients (managers): Clients with their base site (Sites), primary contact
 * (Contacts, object type C) and logo (Documents). Support team, SLA, licensed
 * components and application services have no HRX entity yet: those tabs say which
 * services they need (../needed.js).
 */
sap.ui.define(["../core", "../service", "../data", "../md", "../needed"], function (hrx, svc, data, md, needed) {
	"use strict";

	var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
	var api, root, items = [], contacts = [], sites = [];
	var init = function (n) { return String(n || "").split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase(); };
	var contactOf = function (c) { return contacts.find(function (x) { return x.ObjectID === c.ID && x.ObjectType === "C"; }) || null; };
	var siteLabel = function (c) { var s = sites.find(function (x) { return x.ID === c.BaseSite; }); return s ? s.SiteDesc : (c.BaseSite || ""); };

	async function reload() {
		var r = await Promise.all([svc.Clients.list({ $orderby: "ClientName" }), svc.Contacts.list({ $filter: "ObjectType eq 'C'" }), data.sites()]);
		items = r[0]; contacts = r[1]; sites = r[2];
		data.invalidate("clients");
	}
	var basicSpecs = function (c) { var k = contactOf(c) || {}; return { client: [{ k: "ID", label: "Client key", type: "ro", val: c.ID }, { k: "ClientName", label: "Name", req: true, val: c.ClientName }, { k: "BaseSite", label: "Location", type: "select", ph: "Client base site (optional)", opts: sites.map(function (s) { return [s.ID, s.SiteDesc]; }).concat(c.BaseSite && !sites.some(function (s) { return s.ID === c.BaseSite; }) ? [[c.BaseSite, c.BaseSite]] : []), val: c.BaseSite }, { k: "IsActive", label: "Active", type: "toggle", val: c.IsActive !== false }, { k: "logo", label: "Logo", type: "file", accept: "image/png,image/jpeg", hint: "jpg/png file only" + (c.LogoObjectID ? " · a logo is on file" : ""), span2: true }],
		contact: [{ k: "cn", label: "Contact name", type: "text", val: "", ph: "Not held by the HRX service", dis: true, hint: "Service needed: Contacts.FirstName, Contacts.LastName" }, { k: "WorkEmail", label: "Contact email", val: k.WorkEmail, ph: "client.contact@client.domain" }, { k: "ContactNo", label: "Contact phone", val: k.ContactNo, ph: "+44 1234 567890" }, { k: "MobileNo", label: "Contact mobile", val: k.MobileNo, ph: "Optional" }] }; };

	var tabs = [
		{ k: "basic", label: "Basic Info", render: function (c) { var s = basicSpecs(c); return "<div class=\"fsec\">Client</div>" + hrx.form(s.client) + "<div class=\"fsec\">Primary contact</div><div data-sec=\"contact\">" + hrx.form(s.contact) + "</div>"; } },
		{ k: "team", label: "Support Team", render: function () { return needed.block("clientTeam"); } },
		{ k: "sla", label: "SLA", render: function () { return needed.block("clientSla"); } },
		{ k: "comps", label: "Components", render: function () { return needed.block("clientComponents"); } },
		{ k: "apps", label: "Application Details", render: function () { return needed.block("clientApps"); } }
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
