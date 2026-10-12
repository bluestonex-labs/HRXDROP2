/*
 * Shared helpers for every HRX page: formatting, icons, form builders, tables, KPI
 * tiles, the modal and toasts. Ported from the HRX Drop 2 prototype so every page
 * produces the prototype's markup, and so its stylesheet applies unchanged.
 */
sap.ui.define([], function () {
	"use strict";

	var S = function (d, sw) {
		return "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"" + (sw || 2) + "\" stroke-linecap=\"round\" stroke-linejoin=\"round\">" + d + "</svg>";
	};
	var ICON = {
		x: S("<path d=\"M18 6 6 18M6 6l12 12\"/>"),
		check: S("<path d=\"M20 6 9 17l-5-5\"/>"),
		xc: S("<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m15 9-6 6M9 9l6 6\"/>", 1.9),
		tri: S("<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4M12 17h.01\"/>", 1.9),
		info: S("<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\"/>", 1.9),
		okc: S("<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m9 12 2 2 4-4\"/>", 1.9),
		arrow: S("<path d=\"M5 12h14M13 6l6 6-6 6\"/>"),
		plus: S("<path d=\"M12 5v14M5 12h14\"/>"),
		filter: S("<path d=\"M22 3H2l8 9.46V19l4 2v-8.54z\"/>"),
		refresh: S("<path d=\"M21 12a9 9 0 1 1-3-6.7L21 8\"/><path d=\"M21 3v5h-5\"/>"),
		search: S("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m21 21-4.3-4.3\"/>"),
		expand: S("<path d=\"M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7\"/>"),
		mail: S("<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"m3 7 9 6 9-6\"/>"),
		trash: S("<path d=\"M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/>"),
		edit: S("<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z\"/>"),
		upload: S("<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12\"/>"),
		download: S("<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3\"/>"),
		eye: S("<path d=\"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>"),
		userplus: S("<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M19 8v6M22 11h-6\"/>"),
		doc: S("<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6M16 13H8M16 17H8\"/>"),
		cal: S("<rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/>"),
		back: S("<path d=\"M19 12H5M12 19l-7-7 7-7\"/>"),
		chl: S("<path d=\"m15 18-6-6 6-6\"/>"),
		chr: S("<path d=\"m9 18 6-6-6-6\"/>")
	};

	var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	var MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	var DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	var DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

	// Leave type colours, keyed by the service's LeaveCategoryDesc
	var LTYPE_COLOR = {
		"Compassionate": "var(--amber)",
		"Holiday": "#85B7EB",
		"Maternity": "var(--mint)",
		"Paternity": "var(--magenta)",
		"Sick": "var(--signal)",
		"Unpaid": "#991b1b"
	};

	function ordinal(n) {
		if (n >= 11 && n <= 13) { return n + "th"; }
		switch (n % 10) { case 1: return n + "st"; case 2: return n + "nd"; case 3: return n + "rd"; default: return n + "th"; }
	}

	var hrx = {
		ICON: ICON,
		MONTH_ABBR: MONTH_ABBR,
		MONTH_FULL: MONTH_FULL,
		DOW_ABBR: DOW_ABBR,
		DOW_FULL: DOW_FULL,
		LTYPE_COLOR: LTYPE_COLOR,
		ordinal: ordinal,
		root: null,
		_h: {},
		on: function (e, f) { (this._h[e] = this._h[e] || []).push(f); },
		emit: function (e, arg) { (this._h[e] || []).forEach(function (f) { try { f(arg); } catch (err) { console.error(err); } }); },

		today: function () { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
		esc: function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); },
		iso: function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
		parse: function (s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); },
		addDays: function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; },
		monday: function (d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; },
		fmt: function (s) { var d = typeof s === "string" ? hrx.parse(s) : s; return d.getDate() + " " + MONTH_ABBR[d.getMonth()] + " " + d.getFullYear(); },
		fmtRange: function (a, b) { return a === b ? hrx.fmt(a) : hrx.fmt(a) + " – " + hrx.fmt(b); },
		rangeLabel: function (a, b) {
			a = typeof a === "string" ? hrx.parse(a) : a; b = typeof b === "string" ? hrx.parse(b) : b;
			if (a.getTime() === b.getTime()) { return a.getDate() + " " + MONTH_ABBR[a.getMonth()] + " " + a.getFullYear(); }
			if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) { return a.getDate() + " – " + b.getDate() + " " + MONTH_ABBR[a.getMonth()] + " " + a.getFullYear(); }
			if (a.getFullYear() === b.getFullYear()) { return a.getDate() + " " + MONTH_ABBR[a.getMonth()] + " – " + b.getDate() + " " + MONTH_ABBR[b.getMonth()] + " " + b.getFullYear(); }
			return hrx.fmt(a) + " – " + hrx.fmt(b);
		},
		weekLabel: function (monday) {
			var sunday = hrx.addDays(monday, 6);
			var label = monday.getMonth() === sunday.getMonth()
				? ordinal(monday.getDate()) + " - " + ordinal(sunday.getDate()) + " " + MONTH_FULL[monday.getMonth()]
				: ordinal(monday.getDate()) + " " + MONTH_FULL[monday.getMonth()] + " - " + ordinal(sunday.getDate()) + " " + MONTH_FULL[sunday.getMonth()];
			if (monday.getFullYear() !== hrx.today().getFullYear() || sunday.getFullYear() !== monday.getFullYear()) { label += " " + sunday.getFullYear(); }
			return label;
		},
		workdays: function (a, b) { var n = 0; var c = new Date(a); while (c <= b) { var g = c.getDay(); if (g !== 0 && g !== 6) { n++; } c.setDate(c.getDate() + 1); } return n; },
		hash: function (s) { var h = 5381; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; } return h; },
		/**
		 * A picture laid over an avatar's initials. When there is no picture, or it cannot
		 * be loaded (no document, no access), the image removes itself and the initials show.
		 */
		photo: function (sUrl) { return sUrl ? "<img class=\"hrx-photo\" src=\"" + hrx.esc(sUrl) + "\" alt=\"\" loading=\"lazy\" onerror=\"this.remove()\">" : ""; },
		initials: function (n) { return String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase(); },
		pill: function (k, t) { return "<span class=\"pill " + k + "\">" + hrx.esc(t) + "</span>"; },
		num: function (n, d) { return Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); },
		gbp: function (n, d) { return "£" + hrx.num(n, d == null ? 2 : d); },
		// "07:30:00" or "07:30" <-> minutes
		mins: function (h) { if (!h) { return 0; } var p = String(h).split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); },
		hhmm: function (m) { m = Math.round(m || 0); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); },
		utilState: function (pct) { return pct >= 80 ? "ok" : (pct >= 50 ? "warn" : "crit"); },
		statusIcon: function (s) { return s === "ok" ? ICON.okc : (s === "warn" ? ICON.tri : ICON.xc); },
		bar: function (pct, st, label) {
			return "<div class=\"ub-bar\">" + (label !== undefined ? "<div class=\"ub-pct\">" + label + "</div>" : "") + "<div class=\"ub-line\"><div class=\"ub-track\"><div class=\"ub-fill " + st + "\" style=\"width:" + Math.max(0, Math.min(100, pct)) + "%\"></div></div><span class=\"ub-ico " + st + "\">" + hrx.statusIcon(st) + "</span></div></div>";
		},
		openUrl: function (u) { var w = window.open(u, "_blank"); if (!w) { hrx.toast("Your browser blocked the new tab. Allow pop-ups for this site.", "crit"); } },
		openPdf: function (b64) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) { a[i] = bin.charCodeAt(i); } hrx.openUrl(URL.createObjectURL(new Blob([a], { type: "application/pdf" }))); },

		/* ── form helpers ── */
		fld: function (o) {
			var k = o.k, v = o.val == null ? "" : o.val, req = o.req ? "<span class=\"req\">*</span>" : "", cls = "fld" + (o.span2 ? " span2" : "");
			var inner;
			if (o.type === "select") {
				inner = "<select data-k=\"" + k + "\"" + (o.dis ? " disabled" : "") + ">" + (o.ph ? "<option value=\"\">" + hrx.esc(o.ph) + "</option>" : "") + (o.opts || []).map(function (x) {
					var val = Array.isArray(x) ? x[0] : x, lab = Array.isArray(x) ? x[1] : x;
					return "<option value=\"" + hrx.esc(val) + "\"" + (String(val) === String(v) ? " selected" : "") + ">" + hrx.esc(lab) + "</option>";
				}).join("") + "</select>";
			} else if (o.type === "textarea") {
				inner = "<textarea data-k=\"" + k + "\" rows=\"" + (o.rows || 3) + "\" placeholder=\"" + hrx.esc(o.ph || "") + "\">" + hrx.esc(v) + "</textarea>";
			} else if (o.type === "toggle") {
				inner = "<label class=\"sw\"><input type=\"checkbox\" data-k=\"" + k + "\"" + (v ? " checked" : "") + (o.dis ? " disabled" : "") + "><span class=\"sw-t\"></span></label>";
			} else if (o.type === "check") {
				return "<div class=\"" + cls + "\"><label class=\"chk\"><input type=\"checkbox\" data-k=\"" + k + "\"" + (v ? " checked" : "") + "><span>" + hrx.esc(o.label) + "</span></label></div>";
			} else if (o.type === "ro") {
				inner = "<div class=\"ro\">" + (v === "" || v == null ? "—" : hrx.esc(v)) + "</div>";
			} else if (o.type === "chips") {
				inner = "<div class=\"chips\" data-k=\"" + k + "\" data-chips" + (o.dis ? " data-dis" : "") + ">" + (o.opts || []).map(function (x) {
					return "<button type=\"button\" class=\"chip" + ((v || []).indexOf(x) !== -1 ? " on" : "") + "\" data-v=\"" + hrx.esc(x) + "\"" + (o.dis ? " disabled" : "") + ">" + hrx.esc(x) + "</button>";
				}).join("") + "</div>";
			} else if (o.type === "file") {
				inner = "<input type=\"file\" data-k=\"" + k + "\"" + (o.accept ? " accept=\"" + o.accept + "\"" : "") + ">";
			} else {
				inner = "<input data-k=\"" + k + "\" type=\"" + (o.type || "text") + "\" value=\"" + hrx.esc(v) + "\" placeholder=\"" + hrx.esc(o.ph || "") + "\"" + (o.step ? " step=\"" + o.step + "\"" : "") + (o.min != null ? " min=\"" + o.min + "\"" : "") + (o.dis ? " disabled" : "") + ">";
			}
			return "<div class=\"" + cls + "\"><label class=\"f\">" + hrx.esc(o.label) + req + "</label>" + (o.suffix ? "<div class=\"sfx\">" + inner + "<span>" + hrx.esc(o.suffix) + "</span></div>" : inner) + (o.hint ? "<div class=\"fhint\">" + hrx.esc(o.hint) + "</div>" : "") + "</div>";
		},
		form: function (specs, cols) { return "<div class=\"fgrid" + (cols === 1 ? " one" : "") + "\">" + specs.map(hrx.fld).join("") + "</div>"; },
		read: function (root) {
			var o = {};
			root.querySelectorAll("[data-k]").forEach(function (el) {
				var k = el.dataset.k;
				if (el.hasAttribute("data-chips")) { o[k] = Array.prototype.map.call(el.querySelectorAll(".chip.on"), function (c) { return c.dataset.v; }); }
				else if (el.type === "checkbox") { o[k] = el.checked; }
				else if (el.type === "file") { o[k] = (el.files && el.files[0]) || null; }
				else { o[k] = el.value.trim(); }
			});
			return o;
		},
		validate: function (root, specs) {
			var ok = true;
			root.querySelectorAll(".err").forEach(function (e) { e.classList.remove("err"); });
			specs.filter(function (s) { return s.req; }).forEach(function (s) {
				var el = root.querySelector("[data-k=\"" + s.k + "\"]"); if (!el) { return; }
				var empty = el.type === "file" ? !(el.files && el.files.length) : !String(el.value || "").trim();
				if (empty) { ok = false; el.classList.add("err"); }
			});
			return ok;
		},
		tbl: function (cols, rows, empty) {
			return "<div class=\"tscroll\"><table><thead><tr>" + cols.map(function (c) { return "<th" + (c.al ? " style=\"text-align:" + c.al + "\"" : "") + ">" + c.h + "</th>"; }).join("") + "</tr></thead><tbody>" +
				(rows.length ? rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (cols[i].al ? " style=\"text-align:" + cols[i].al + "\"" : "") + ">" + c + "</td>"; }).join("") + "</tr>"; }).join("")
					: "<tr><td colspan=\"" + cols.length + "\" class=\"tbl-empty\">" + hrx.esc(empty || "Nothing to show") + "</td></tr>") + "</tbody></table></div>";
		},
		empty: function (t, s) { return "<div class=\"empty-state\"><div class=\"empty-t\">" + hrx.esc(t) + "</div>" + (s ? "<div class=\"empty-s\">" + hrx.esc(s) + "</div>" : "") + "</div>"; },
		loading: function (t) { return "<div class=\"empty-state hrx-loading\"><div class=\"hrx-spin\"></div><div class=\"empty-s\">" + hrx.esc(t || "Loading from the HRX service…") + "</div></div>"; },
		failed: function (e) { return hrx.empty("Could not load from the HRX service", hrx.errText(e)); },
		errText: function (e) { return (e && (e.message || e.statusText)) || String(e || "Unknown error"); },
		// creating a user or client: the service first makes its folder in SAP Document Management,
		// and passes that call's own failure on as "Request failed with status code …"
		createErrText: function (e, what) {
			var m = hrx.errText(e), dms = /^Request failed with status code (\d+)/.exec(m);
			return dms ? "The HRX service could not create the " + what + "'s folder in SAP Document Management (it answered " + dms[1] + "), so the " + what + " was not created. This needs fixing on the service." : m;
		},
		// a strip on pages whose data has no HRX endpoint yet: they show the prototype's sample data
		previewStrip: function (what) {
			return "<div class=\"strip warn hrx-preview\">" + ICON.tri + "<span><b>Preview data.</b> " + hrx.esc(what) + " The HRX service has no endpoint for this yet, so nothing here is saved.</span></div>";
		},
		confirm: function (title, msg, okText, onOk, danger) { hrx.modal({ title: title, body: "<p class=\"modal-p\">" + msg + "</p>", confirm: { text: okText, cls: danger === false ? "primary" : "danger" }, onConfirm: onOk }); },
		tabsHtml: function (tabs, cur) { return "<div class=\"tabs\">" + tabs.map(function (t) { return "<button type=\"button\" class=\"tab" + (t.k === cur ? " on" : "") + "\" data-tab=\"" + t.k + "\">" + hrx.esc(t.label) + "</button>"; }).join("") + "</div>"; },
		kpi: function (cls, icon, label, num, unit, sub) {
			return "<div class=\"kpi " + cls + "\"><div class=\"glyph " + cls + "\"><i class=\"ti " + icon + "\"></i></div><div class=\"klab\">" + label + "</div><div class=\"knum\">" + num + (unit ? "<span class=\"kunit\">" + unit + "</span>" : "") + "</div>" + (sub != null ? "<div class=\"ksub\">" + sub + "</div>" : "") + "</div>";
		},
		alert: function (kind, icon, text, link, go) { return "<div class=\"alert " + kind + "\">" + icon + "<span>" + text + "</span>" + (link ? "<button class=\"alert-link\" type=\"button\" data-go=\"" + go + "\">" + link + ICON.arrow + "</button>" : "") + "</div>"; },
		refreshStamp: function () { return "Last refreshed " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); },

		/* ── toast and modal ── */
		toast: function (msg, kind) {
			var w = hrx.root.querySelector(".toast-wrap"), t = document.createElement("div");
			t.className = "toast " + (kind || "ok");
			t.innerHTML = (kind === "crit" ? ICON.xc : ICON.okc) + "<span>" + hrx.esc(msg) + "</span>";
			w.appendChild(t);
			while (w.children.length > 3) { w.firstChild.remove(); }
			setTimeout(function () { t.style.transition = "opacity .3s"; t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 320); }, kind === "crit" ? 5200 : 3200);
		},
		modal: function (o) {
			var ov = hrx.root.querySelector(".modal-ov"), foot = ov.querySelector(".modal-foot"), body = ov.querySelector(".modal-body");
			ov.querySelector(".modal").className = "modal " + (o.cls || "");
			ov.querySelector(".modal-title").textContent = o.title;
			body.innerHTML = o.body || "";
			foot.innerHTML = "";
			var cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn ghost"; cancel.textContent = o.cancelText || "Cancel";
			var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn " + ((o.confirm && o.confirm.cls) || "primary"); ok.textContent = (o.confirm && o.confirm.text) || "OK";
			foot.append(ok, cancel);
			var close = function () { ov.classList.remove("open"); document.removeEventListener("keydown", esc); };
			var esc = function (e) { if (e.key === "Escape") { close(); } };
			cancel.onclick = close;
			ok.onclick = function () {
				if (ok.disabled) { return; }
				var r = o.onConfirm && o.onConfirm(body, ok);
				if (r === false) { return; }
				if (r && typeof r.then === "function") {
					// an async confirm keeps the dialog open, busy, until the service answers
					var label = ok.textContent; ok.disabled = true; ok.textContent = "Saving…";
					r.then(function (v) { ok.disabled = false; ok.textContent = label; if (v !== false) { close(); } }, function () { ok.disabled = false; ok.textContent = label; });
					return;
				}
				close();
			};
			ov.onclick = function (e) { if (e.target === ov) { close(); } };
			document.addEventListener("keydown", esc);
			ov.classList.add("open");
			if (o.onOpen) { o.onOpen(body, ok); }
			var first = body.querySelector("input:not([type=checkbox]):not([readonly]),textarea,select"); if (first) { first.focus(); }
			hrx.closeModal = close;
		}
	};

	return hrx;
});
