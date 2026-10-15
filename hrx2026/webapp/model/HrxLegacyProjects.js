sap.ui.define([
	"./Hrx",
	"./HrxServices"
], function (Hrx, HrxServices) {
	"use strict";

	/*
	 * Manage Projects' areas and attachments, answered from the HRX service in the
	 * shapes the page was written against (the original xsodata services). As with HrxLegacyClients, a call is only answered when the HRX service
	 * has what it needs deployed; otherwise it goes to the original services as before.
	 *
	 * An area's key on the page (TaskKey, ProjectTaskKey) is the HRX ProjectAreas ID.
	 */

	function ok(oPayload) {
		return Object.assign({ msgType: "S", msg: "" }, oPayload);
	}

	function projectKeyFilter(aFilters) {
		var oFilter = (aFilters || []).filter(function (oCandidate) {
			return (oCandidate.sPath || (oCandidate.getPath && oCandidate.getPath())) === "ProjectKey";
		})[0];
		return oFilter ? (oFilter.oValue1 !== undefined ? oFilter.oValue1 : oFilter.getValue1()) : null;
	}

	function base64ToBlob(sBase64, sMimeType) {
		var sBinary = atob(String(sBase64).replace(/^data:[^,]*,/, ""));
		var aBytes = new Uint8Array(sBinary.length);
		for (var iIndex = 0; iIndex < sBinary.length; iIndex++) {
			aBytes[iIndex] = sBinary.charCodeAt(iIndex);
		}
		return new Blob([aBytes], { type: sMimeType || "application/octet-stream" });
	}

	/* --------------------------------------------------------------- */
	/* areas                                                            */
	/* --------------------------------------------------------------- */

	var Areas = {

		isAvailable: function () {
			return HrxServices.has("ProjectAreas");
		},

		/**
		 * Replaces the areas a project covers.
		 * @param {string} sProjectId the project
		 * @param {Array<object>} aProjectTasks the page's ProjectTask: [{ TaskKey }]
		 * @returns {Promise} settles once saved (at once when areas are not deployed)
		 */
		saveProjectAreas: function (sProjectId, aProjectTasks) {
			if (!Areas.isAvailable() || !Array.isArray(aProjectTasks)) {
				return Promise.resolve();
			}
			return Hrx.callAction("setProjectAreas", {
				ProjectID: sProjectId,
				AreaIDs: aProjectTasks.map(function (oTask) {
					return oTask.TaskKey;
				}).filter(Boolean)
			});
		},

		/**
		 * Replaces the areas a resource works in on a project.
		 * @param {string} sProjectId the project
		 * @param {string} sEmpId the resource
		 * @param {Array<object>} aTaskAssigned the page's TaskAssigned: [{ ProjectTaskKey }]
		 * @returns {Promise} settles once saved (at once when areas are not deployed)
		 */
		saveResourceAreas: function (sProjectId, sEmpId, aTaskAssigned) {
			if (!Areas.isAvailable() || !Array.isArray(aTaskAssigned)) {
				return Promise.resolve();
			}
			return Hrx.callAction("setResourceAreas", {
				ProjectID: sProjectId,
				EmployeeID: sEmpId,
				AreaIDs: aTaskAssigned.map(function (oTask) {
					return oTask.ProjectTaskKey || oTask.TaskKey;
				}).filter(Boolean)
			});
		},

		/**
		 * The areas each resource works in on a project.
		 * @param {string} sProjectId the project
		 * @returns {Promise<object>} EmployeeID -> [{ TaskKey, ProjectTaskKey, TaskDesc }]
		 */
		resourceAreasOf: function (sProjectId) {
			if (!Areas.isAvailable()) {
				return Promise.resolve({});
			}
			return Hrx.list("ResourceAreaAssignments", {
				$filter: "Project_ID eq " + sProjectId,
				$expand: "Area($select=ID,AreaName)"
			}).then(function (aRows) {
				var mAreasByEmployee = {};
				aRows.forEach(function (oRow) {
					(mAreasByEmployee[oRow.Employee_EmployeeID] = mAreasByEmployee[oRow.Employee_EmployeeID] || []).push({
						TaskKey: oRow.Area_ID,
						ProjectTaskKey: oRow.Area_ID,
						TaskDesc: (oRow.Area && oRow.Area.AreaName) || ""
					});
				});
				return mAreasByEmployee;
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* attachments (hrx/manageAttachments.xsjs)                         */
	/* --------------------------------------------------------------- */

	var Attachments = {
		// The file opens from SAP Document Management (url), not from content in the list.
		fetch: function (oParams) {
			return Hrx.callFunction("fetchProjectDocuments", { ProjectID: oParams.ProjectKey }).then(function (aFiles) {
				return ok({
					attachments: (aFiles || []).map(function (oFile) {
						return {
							AttachmentID: oFile.ObjectID,
							FileName: oFile.FileName,
							FileType: oFile.MimeType,
							UploadedOn: oFile.UploadedAt,
							UploadedBy: oFile.UploadedBy,
							url: Hrx.pictureUrl("", oFile.ObjectID)
						};
					})
				});
			});
		},

		// The page sends the file as base64.
		"new": function (oBody) {
			var oFile = base64ToBlob(oBody.attachment, oBody.fileType);
			return Hrx.upload("Project", oBody.projectID, "", oFile, oBody.fileName).then(function () {
				return ok({});
			});
		},

		"delete": function (oBody) {
			return Hrx.callAction("deleteProjectDocument", { ProjectID: oBody.projectID, ObjectID: oBody.attachmentID }).then(function () {
				return ok({});
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* reads by entity set                                              */
	/* --------------------------------------------------------------- */

	var ENTITY_SETS = {
		// Every area a project can cover.
		Task: function () {
			return Hrx.list("ProjectAreas", { $filter: "IsActive ne false", $orderby: "AreaName" }).then(function (aAreas) {
				return aAreas.map(function (oArea) {
					return { TaskKey: oArea.ID, TaskDesc: oArea.AreaName };
				});
			});
		},

		// The areas one project covers.
		Proj_Task_Assign_Text: function (mParameters) {
			var sProjectKey = projectKeyFilter(mParameters && mParameters.filters);
			return Hrx.list("ProjectAreaAssignments", {
				$filter: sProjectKey ? "Project_ID eq " + sProjectKey : undefined,
				$expand: "Area($select=ID,AreaName)"
			}).then(function (aRows) {
				return aRows.map(function (oRow) {
					return {
						TaskKey: oRow.Area_ID,
						ProjectKey: oRow.Project_ID,
						ProjectTaskKey: oRow.Area_ID,
						TaskDesc: (oRow.Area && oRow.Area.AreaName) || ""
					};
				});
			});
		}
	};

	var SERVICES = {
		"hrx/manageAttachments.xsjs": { needs: "fetchProjectDocuments", commands: Attachments }
	};

	return {
		Areas: Areas,

		service: function (sServicePath) {
			var oEntry = SERVICES[sServicePath];
			return oEntry && HrxServices.has(oEntry.needs) ? oEntry.commands : null;
		},

		entitySet: function (sEntitySet) {
			return ENTITY_SETS[sEntitySet] && Areas.isAvailable() ? ENTITY_SETS[sEntitySet] : null;
		}
	};
});
