// Local test only: a stand-in for SAP Document Management (CMIS browser binding) on
// http://localhost:4005, holding folders and files in memory. The HRX service copy
// points at it (see run-service.sh); nothing here reaches a real service.
const http = require("http");

const mObjects = {}; // path -> { id, name, isFolder, content, mime, createdAt }
let iNextId = 1;

function send(oResponse, iStatus, oBody, sType) {
	oResponse.writeHead(iStatus, { "Content-Type": sType || "application/json" });
	oResponse.end(sType ? oBody : JSON.stringify(oBody));
}

function succinct(oObject) {
	return {
		"cmis:objectId": oObject.id,
		"cmis:name": oObject.name,
		"cmis:baseTypeId": oObject.isFolder ? "cmis:folder" : "cmis:document",
		"cmis:contentStreamLength": oObject.content ? oObject.content.length : 0,
		"cmis:contentStreamMimeType": oObject.mime || "",
		"cmis:createdBy": "local-test",
		"cmis:creationDate": oObject.createdAt
	};
}

http.createServer(async (oRequest, oResponse) => {
	const oUrl = new URL(oRequest.url, "http://localhost:4005");
	const aChunks = [];
	for await (const oChunk of oRequest) {
		aChunks.push(oChunk);
	}
	const oBody = Buffer.concat(aChunks);
	console.log(oRequest.method, oUrl.pathname, oUrl.search);

	if (oUrl.pathname === "/oauth/token") {
		return send(oResponse, 200, { access_token: "local-test-token" });
	}
	const aMatch = /^\/browser\/[^/]+\/root(.*)$/.exec(decodeURIComponent(oUrl.pathname));
	if (!aMatch) {
		return send(oResponse, 404, { message: "not found" });
	}
	const sPath = aMatch[1] || "";

	if (oRequest.method === "GET") {
		const sSelector = oUrl.searchParams.get("cmisselector");
		if (sSelector === "content") {
			const oFile = Object.values(mObjects).find((o) => o.id === oUrl.searchParams.get("objectId"));
			return oFile ? send(oResponse, 200, oFile.content, oFile.mime || "application/octet-stream") : send(oResponse, 404, { message: "no such object" });
		}
		if (sPath && !mObjects[sPath]) {
			return send(oResponse, 404, { message: "no such folder" });
		}
		const aChildren = Object.keys(mObjects).filter((sKey) => sKey.slice(0, sKey.lastIndexOf("/")) === sPath).map((sKey) => ({ object: { succinctProperties: succinct(mObjects[sKey]) } }));
		return send(oResponse, 200, { objects: aChildren });
	}

	const oForm = await new Request("http://localhost", { method: "POST", headers: { "content-type": oRequest.headers["content-type"] }, body: oBody }).formData();
	const sAction = oForm.get("cmisaction");
	// CMIS sends properties as propertyId[n] / propertyValue[n] pairs.
	let sName = "";
	for (const [sKey, vValue] of oForm.entries()) {
		const aIndex = /^propertyId\[(\d+)\]$/.exec(sKey);
		if (aIndex && vValue === "cmis:name") {
			sName = oForm.get("propertyValue[" + aIndex[1] + "]");
		}
	}

	if (sAction === "createFolder") {
		const sKey = sPath + "/" + sName;
		if (mObjects[sKey]) {
			return send(oResponse, 409, { exception: "nameConstraintViolation", message: "already exists" });
		}
		mObjects[sKey] = { id: "F" + iNextId++, name: sName, isFolder: true, createdAt: Date.now() };
		return send(oResponse, 201, { succinctProperties: succinct(mObjects[sKey]) });
	}
	if (sAction === "createDocument") {
		const oFile = oForm.get("media") || oForm.get("filename") || oForm.get("file");
		const sKey = sPath + "/" + (sName || (oFile && oFile.name) || "file");
		const oContent = oFile && oFile.arrayBuffer ? Buffer.from(await oFile.arrayBuffer()) : Buffer.from(String(oFile || ""));
		mObjects[sKey] = { id: "D" + iNextId++, name: sName, isFolder: false, content: oContent, mime: oFile && oFile.type, createdAt: Date.now() };
		return send(oResponse, 201, { succinctProperties: succinct(mObjects[sKey]) });
	}
	if (sAction === "delete") {
		const sKey = Object.keys(mObjects).find((k) => mObjects[k].id === oForm.get("objectId"));
		if (sKey) {
			delete mObjects[sKey];
		}
		return send(oResponse, 200, {});
	}
	return send(oResponse, 400, { message: "unknown action " + sAction });
}).listen(4005, () => console.log("fake DMS on http://localhost:4005"));
