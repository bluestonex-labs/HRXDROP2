// Builds the "HRX expenses preview" app: this branch's committed code as an app of its
// own on TDD, so the expenses work can be tested while the team keeps deploying the
// HRX app (HRX2026) from main. The preview has its own launchpad link and its own
// app host and destination instances; it signs in through HRX2026's XSUAA instance
// and uses the same HRX and expense services, so the same data.
//
//   node tools/build-expenses-preview.js
//   cf target -o bsx-tdd -s TDD
//   cf deploy <the .mtar it prints>
//
// The branch itself is not changed: the committed code (git HEAD) is copied to a
// temporary folder, renamed there, and built with mbt.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MBT = "/Users/davidakilapa/.npm/_npx/32f204a681b479b0/node_modules/mbt/unpacked_bin/mbt";
const REPO = path.resolve(__dirname, "..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "hrx-expenses-preview-"));

/** Replaces text in one file; every replacement must find something. */
function rewrite(sFile, aReplacements) {
	let sText = fs.readFileSync(sFile, "utf8");
	aReplacements.forEach(function ([vFind, sReplace]) {
		const sBefore = sText;
		sText = sText.split(vFind).join(sReplace);
		if (sText === sBefore) {
			throw new Error(path.relative(WORK, sFile) + ": did not find " + vFind);
		}
	});
	fs.writeFileSync(sFile, sText);
}

/** Every file under a folder. */
function filesUnder(sFolder) {
	return fs.readdirSync(sFolder, { withFileTypes: true }).flatMap(function (oEntry) {
		const sPath = path.join(sFolder, oEntry.name);
		return oEntry.isDirectory() ? filesUnder(sPath) : [sPath];
	});
}

// 1. The committed code, into the temporary folder
execFileSync("sh", ["-c", "git archive HEAD | tar -x -C " + JSON.stringify(WORK)], { cwd: REPO });

// The repository keeps a built copy of the normal app (resources/bsxhrxhrx2026.zip);
// the preview must ship only its own
fs.rmSync(path.join(WORK, "resources"), { recursive: true, force: true });

// 2. The deploy file: its own MTA, service instances, business service and archive.
//    The HRX and expense XSUAA instances and the service URLs stay as they are.
rewrite(path.join(WORK, "mta.yaml"), [
	// uaa_HRX2026 first: "uaa_HRX2026-key" would otherwise be renamed twice
	["uaa_HRX2026", "uaa_HRX2026PREVIEW"],
	["ID: HRX2026", "ID: HRX2026PREVIEW"],
	["HRX2026-", "HRX2026PREVIEW-"],
	["HRX2026_", "HRX2026PREVIEW_"],
	["hrx2026_HRX2026PREVIEW", "hrx2026preview_HRX2026PREVIEW"],
	["hrx2026_uaa_HRX2026PREVIEW", "hrx2026preview_uaa_HRX2026PREVIEW"],
	["sap.cloud.service: hrx2026", "sap.cloud.service: hrx2026preview"],
	["bsxhrxhrx2026", "bsxhrxhrx2026preview"]
]);

// 3. Sign-in: the normal HRX app's own XSUAA instance and key, used as they are.
//    Passing the user's login on to the expense service carries their expense roles
//    only when the login comes from an app they have been granted in BTP (its
//    Token_Exchange role); HRX2026's is, a new instance would not be. The preview
//    only uses the instance, so HRX2026's deploys from main do not affect it.
rewrite(path.join(WORK, "mta.yaml"), [
	["HRX2026PREVIEW-xsuaa-service", "HRX2026-xsuaa-service"],
	["uaa_HRX2026PREVIEW-key", "uaa_HRX2026-key"],
	[`  type: org.cloudfoundry.managed-service
  parameters:
    path: ./xs-security.json
    service: xsuaa
    service-name: HRX2026-xsuaa-service
    service-plan: application`, `  type: org.cloudfoundry.existing-service
  parameters:
    service-name: HRX2026-xsuaa-service`],
	// Rewrite the preview's destinations on every deploy. With "ignore", a destination
	// that already exists keeps its old settings, so a change here (such as the sign-in
	// key above) never reaches the launchpad.
	["existing_destinations_policy: ignore", "existing_destinations_policy: update"]
]);

// 4. Its own app id, archive and business service
rewrite(path.join(WORK, "hrx2026", "ui5-deploy.yaml"), [
	["name: bsx.hrx.hrx2026", "name: bsx.hrx.hrx2026preview"],
	["archiveName: bsxhrxhrx2026", "archiveName: bsxhrxhrx2026preview"]
]);
filesUnder(path.join(WORK, "hrx2026", "webapp")).forEach(function (sFile) {
	if (!/\.(js|xml|json|html|properties)$/.test(sFile)) {
		return;
	}
	const sText = fs.readFileSync(sFile, "utf8");
	const sNew = sText.split("bsx.hrx.hrx2026").join("bsx.hrx.hrx2026preview")
		.split("bsx/hrx/hrx2026").join("bsx/hrx/hrx2026preview");
	if (sNew !== sText) {
		fs.writeFileSync(sFile, sNew);
	}
});
rewrite(path.join(WORK, "hrx2026", "webapp", "manifest.json"), [['"service": "hrx2026"', '"service": "hrx2026preview"']]);

// 5. Say on screen that this is the preview
rewrite(path.join(WORK, "hrx2026", "webapp", "i18n", "i18n.properties"), [
	["appTitle=HRX — HR Suite", "appTitle=HRX — Expenses preview"]
]);

// 6. Build
execFileSync(MBT, ["build", "--mtar", "expenses-preview.mtar"], { cwd: WORK, stdio: "inherit" });
console.log("\nBuilt: " + path.join(WORK, "mta_archives", "expenses-preview.mtar"));
