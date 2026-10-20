// Renders a .drawio file to PNG with mxGraph (the library draw.io is built on) in
// headless Chrome, so the PNG comes from the very same diagram file.
//   npm i mxgraph@4.2.2 puppeteer-core@24   (in a scratch folder; set NODE_PATH to it)
//   CHROME_PATH=/path/to/chrome node render-drawio.js in.drawio out.png
// Raleway must be installed on the machine (draw.io itself loads it from Google Fonts).
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const [sInput, sOutput] = process.argv.slice(2);
const sXml = fs.readFileSync(sInput, "utf8");
const sMxClient = fs.readFileSync(require.resolve("mxgraph/javascript/mxClient.min.js"), "utf8");

(async () => {
	const oBrowser = await puppeteer.launch({
		executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: "new",
		args: process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []
	});
	const oPage = await oBrowser.newPage();
	await oPage.setViewport({ width: 1760, height: 1120, deviceScaleFactor: 2 });
	await oPage.setContent("<html><body style=\"margin:0;background:#fff\"><div id=\"graph\" style=\"position:absolute;left:0;top:0;width:1720px;height:1080px\"></div></body></html>");
	// mxGraph looks for its resources next to it unless told not to.
	await oPage.evaluate("window.mxLoadResources = false; window.mxLoadStylesheets = false; window.mxBasePath = '.';");
	await oPage.addScriptTag({ content: sMxClient });
	await oPage.evaluate((sDiagram) => {
		/* global mxGraph, mxUtils, mxCodec */
		const oGraph = new mxGraph(document.getElementById("graph"));
		oGraph.setHtmlLabels(true);
		oGraph.setEnabled(false);
		// draw.io writes embedded images as "data:image/png,<base64>"; a browser needs ";base64".
		const fnGetImage = oGraph.getImage;
		oGraph.getImage = function (oState) {
			const sImage = fnGetImage.apply(this, arguments);
			return sImage && /^data:image\/png,/.test(sImage) ? sImage.replace("data:image/png,", "data:image/png;base64,") : sImage;
		};
		const oModelNode = mxUtils.parseXml(sDiagram).documentElement.getElementsByTagName("mxGraphModel")[0];
		new mxCodec(oModelNode.ownerDocument).decode(oModelNode, oGraph.getModel());
	}, sXml);
	await oPage.evaluate(() => document.fonts.ready);
	await new Promise((resolve) => setTimeout(resolve, 800));
	await oPage.screenshot({ path: sOutput, clip: { x: 0, y: 0, width: 1712, height: 1062 } });
	await oBrowser.close();
	console.log("Wrote " + path.relative(process.cwd(), sOutput));
})().catch((oError) => {
	console.error(oError);
	process.exit(1);
});
