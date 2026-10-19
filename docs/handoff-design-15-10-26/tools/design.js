// node design.js <view> <out.png|-> [--role employee] [--full] [--eval "js run in the page after opening the view"] [--measure '["css selectors"]']
// Renders the 15.10.26 design file at 1440x1000 and opens one of its views (data-view: dashboard, timesheet, leave,
// teamcal, mydocs, explorer, sickness, documents, tsreport, utilisation, resources, clients, projects, mybonus).
const puppeteer = require("puppeteer-core");
const a = process.argv.slice(2); const view = a[0], out = a[1];
const opt = (k) => { const i = a.indexOf(k); return i === -1 ? null : (a[i + 1] || true); };
(async () => {
	const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"].concat(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []) });
	const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
	await p.goto("file://" + require("path").resolve(__dirname, "../design/HRX Drop 2 - 15.10.26.html").split("/").map(encodeURIComponent).join("/"), { waitUntil: "networkidle0", timeout: 60000 });
	await new Promise((r) => setTimeout(r, 800));
	if (opt("--role")) { await p.evaluate((r) => { const s = document.getElementById("roleToggle"); s.value = r; s.dispatchEvent(new Event("change")); }, opt("--role")); await new Promise((r) => setTimeout(r, 400)); }
	await p.evaluate((v) => { const n = document.querySelector('.sidenav button[data-view="' + v + '"]'); if (n) n.click(); }, view);
	await new Promise((r) => setTimeout(r, 700));
	if (opt("--eval")) { console.log(await p.evaluate(opt("--eval"))); await new Promise((r) => setTimeout(r, 600)); }
	if (opt("--measure")) console.log(await p.evaluate((sel) => JSON.parse(sel).map((s) => { const e = document.querySelector(s); if (!e) return s + ": none"; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return s + ": x" + r.x.toFixed(1) + " y" + r.y.toFixed(1) + " w" + r.width.toFixed(1) + " h" + r.height.toFixed(1) + " | font " + cs.fontSize + " " + cs.fontWeight + " " + cs.fontFamily.split(",")[0] + " color " + cs.color + " bg " + cs.backgroundColor + " pad " + cs.padding + " radius " + cs.borderRadius + " border " + cs.border; }).join("\n"), opt("--measure")));
	if (out && out !== "-") await p.screenshot({ path: out, fullPage: !!opt("--full") });
	await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
