// node app.js <email> <route> <out.png|-> [--full] [--eval "js"] [--measure '["css selectors"]']
// Opens the HRX app in the local FLP preview (http://localhost:8088) as <email> (test users: sam.evans@example.test
// is a manager, kyle.barnfield@example.test an employee, dan.barton@example.test a manager) on <route>
// (the hash after &/ - "" home, timesheet, leave, teamcalendar, policies, explorer, sickness, documents,
// timesheetreporting, timesheetreporting?tab=util, manageresources, manageclients, manageprojects, missingtimesheets).
// The viewport is 1440 x 1052: the launchpad's own 52px bar on top, then the same 1440 x 1000 as design.js.
// Prints the app's own errors (launchpad sandbox noise is filtered out).
const puppeteer = require("puppeteer-core");
const a = process.argv.slice(2); const email = a[0], route = a[1], out = a[2];
const opt = (k) => { const i = a.indexOf(k); return i === -1 ? null : (a[i + 1] || true); };
const NOISE = /fioriSandboxConfig|\/user-api\/currentUser|\/sap\/bc\/lrep\/|LrepConnector|\/changes\/[a-z-]*bundle\.json|\/test\/i18n\/|Merging of arrays|FUTURE FATAL|fallback locale|Failed to load resource|font configuration/;
(async () => {
	const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"] });
	const c = await b.createBrowserContext(); const p = await c.newPage(); await p.setViewport({ width: 1440, height: 1052 });
	await p.authenticate({ username: email, password: "" });
	const errs = [];
	p.on("pageerror", (e) => errs.push("PAGE ERROR " + (e.stack || e.message).split("\n").slice(0, 3).join(" <- ")));
	p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push("CONSOLE " + m.text().slice(0, 300)); });
	p.on("response", (r) => { if (r.status() >= 400 && !NOISE.test(r.url())) errs.push("HTTP " + r.status() + " " + r.url()); });
	await p.goto("http://localhost:8088/test/flp.html?sap-ui-xx-viewCache=false#app-preview?email=" + email + (route ? "&/" + route : ""), { waitUntil: "networkidle0", timeout: 90000 });
	// The page has drawn once the shell shows its title; then give its data a moment.
	await p.waitForFunction(() => { const t = document.querySelector(".hrxPageTitle"); return t && t.innerText.trim().length > 0; }, { timeout: 60000 }).catch(() => errs.push("TIMEOUT waiting for the page title"));
	await p.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
	await new Promise((r) => setTimeout(r, 1500));
	if (opt("--eval")) { console.log(await p.evaluate(opt("--eval"))); await new Promise((r) => setTimeout(r, 1500)); }
	if (opt("--measure")) console.log(await p.evaluate((sel) => JSON.parse(sel).map((s) => { const e = document.querySelector(s); if (!e) return s + ": none"; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return s + ": x" + r.x.toFixed(1) + " y" + (r.y - 52).toFixed(1) + " w" + r.width.toFixed(1) + " h" + r.height.toFixed(1) + " | font " + cs.fontSize + " " + cs.fontWeight + " " + cs.fontFamily.split(",")[0] + " color " + cs.color + " bg " + cs.backgroundColor + " pad " + cs.padding + " radius " + cs.borderRadius + " border " + cs.border; }).join("\n"), opt("--measure")));
	if (out && out !== "-") {
		if (opt("--full")) await p.screenshot({ path: out, fullPage: true });
		else await p.screenshot({ path: out, clip: { x: 0, y: 52, width: 1440, height: 1000 } });
	}
	console.log(errs.length ? "APP ERRORS:\n" + errs.join("\n") : "no app errors");
	await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
