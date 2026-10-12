sap.ui.define([
	"./Hrx",
	"./HrxTime",
	"./HrxLegacy",
	"./Documents",
	"./DocumentService",
	"./CurrentUser",
	"./Notifications"
], function (Hrx, HrxTime, HrxLegacy, Documents, DocumentService, CurrentUser, Notifications) {
	"use strict";

	// Which notifications have been read: kept in this browser, per employee. The
	// notifications themselves are worked out afresh each time.
	var READ_KEY = "hrx.notifications.read.";
	var READ_LIMIT = 200;

	/*
	 * Gathers the signed-in employee's notifications from the HRX service (and the
	 * document service, once bound). Each source is read on its own, so one being
	 * down leaves the rest.
	 *
	 * BINDING POINT for a real notification service: when one exists, add its
	 * notifications to the list in load() - they need the same shape (see
	 * Notifications.js), with a stable id.
	 */

	function settle(pList) {
		return pList.then(function (v) {
			return v;
		}, function (oError) {
			console.warn("A notification source failed", oError);
			return null;
		});
	}

	return {

		/**
		 * @param {object} oProfile the signed-in profile: empID, orgId, siteID, isManager
		 * @param {Date} [oNow] now (for tests)
		 * @returns {Promise<Array<object>>} every current notification, read or not
		 */
		load: function (oProfile, oNow) {
			var oAt = oNow || new Date();
			if (!oProfile || !oProfile.empID) {
				return Promise.resolve([]);
			}
			var sMe = Hrx.literal(oProfile.empID);
			var oWindow = Notifications.timesheetWindow(oAt);

			return Promise.all([
				// Your leave decided lately
				settle(Promise.all([
					Hrx.list("Leaves", {
						$filter: "EmpID_EmployeeID eq " + sMe + " and modifiedAt ge " +
							Notifications.decisionsSince(oAt).toISOString()
					}),
					HrxLegacy.leaveTypes()
				]).then(function (aResults) {
					var mTypes = {};
					aResults[1].forEach(function (oType) {
						mTypes[oType.ID] = oType.desc;
					});
					return Notifications.leaveDecisions(aResults[0], HrxLegacy.leaveStatus, mTypes, oAt);
				})),

				// This week's timesheet, from Thursday
				oWindow ? settle(HrxTime.compliance(oWindow.from, oWindow.to).then(function (aRows) {
					return Notifications.timesheetReminder(aRows.filter(function (oRow) {
						return oRow.UserID === oProfile.empID;
					})[0], oWindow);
				})) : Promise.resolve(null),

				// Documents to acknowledge - none until the document service is bound
				DocumentService.isBound() ? settle(Promise.all([
					DocumentService.getDocuments(oProfile.orgId),
					DocumentService.getAcknowledgements(oProfile.orgId)
				]).then(function (aResults) {
					var oMe = { EmpID: oProfile.empID, SiteID: oProfile.siteID };
					var mAcks = Documents.ackIndex(aResults[1]);
					var mMine = {};
					Object.keys(mAcks).forEach(function (sDocumentId) {
						if (mAcks[sDocumentId][oProfile.empID]) {
							mMine[sDocumentId] = true;
						}
					});
					return Notifications.documents((aResults[0] || []).filter(function (oDocument) {
						return Documents.isFor(oDocument, oMe);
					}), mMine);
				})) : Promise.resolve(null),

				// Requests waiting for a manager: their own (everyone's with full access)
				oProfile.isManager ? settle(Hrx.list("Leaves", {
					$filter: "ApprovalRequired eq true and WFFlag eq null" +
						(CurrentUser.hasFullAccess() ? "" : " and ApproverID_EmployeeID eq " + sMe)
				}).then(function (aLeaves) {
					return Notifications.approvals(aLeaves.filter(function (oLeave) {
						return HrxLegacy.leaveStatus(oLeave) === "REQ";
					}));
				})) : Promise.resolve(null)
			]).then(function (aResults) {
				return [].concat.apply([], aResults.map(function (v) {
					return Array.isArray(v) ? v : v ? [v] : [];
				}));
			});
		},

		/**
		 * @param {string} sEmpId the employee
		 * @returns {Array<string>} the notification ids they have read
		 */
		readIds: function (sEmpId) {
			try {
				return JSON.parse(window.localStorage.getItem(READ_KEY + sEmpId) || "[]");
			} catch (oError) {
				return [];
			}
		},

		/**
		 * @param {string} sEmpId the employee
		 * @param {Array<string>} aIds ids to mark as read
		 */
		markRead: function (sEmpId, aIds) {
			var aRead = this.readIds(sEmpId).filter(function (sId) {
				return aIds.indexOf(sId) === -1;
			}).concat(aIds).slice(-READ_LIMIT);
			try {
				window.localStorage.setItem(READ_KEY + sEmpId, JSON.stringify(aRead));
			} catch (oError) {
				// Private window or blocked storage: read state lasts for this page only.
			}
		}
	};
});
