sap.ui.define([
	"./Hrx",
	"./HrxTime",
	"./HrxLegacy",
	"./Documents",
	"./DocumentService",
	"./CurrentUser",
	"./Notifications",
	"./HrxServices"
], function (Hrx, HrxTime, HrxLegacy, Documents, DocumentService, CurrentUser, Notifications, HrxServices) {
	"use strict";

	// Which notifications have been read: kept by the HRX service per employee once it
	// has NotificationReads (so it follows them between browsers), with a copy in this
	// browser that readIds() answers from. The notifications themselves are worked out
	// afresh each time.
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

	function storedReadIds(sEmpId) {
		try {
			return JSON.parse(window.localStorage.getItem(READ_KEY + sEmpId) || "[]");
		} catch (oError) {
			return [];
		}
	}

	function storeReadIds(sEmpId, aIds) {
		try {
			window.localStorage.setItem(READ_KEY + sEmpId, JSON.stringify(aIds.slice(-READ_LIMIT)));
		} catch (oError) {
			// Private window or blocked storage: read state lasts for this page only.
		}
	}

	/**
	 * Adds what the HRX service says has been read to this browser's copy.
	 * @param {string} sEmpId the signed-in employee
	 * @returns {Promise} settles once merged (at once when the service does not keep it)
	 */
	function syncReadIdsFromService(sEmpId) {
		if (!HrxServices.has("fetchReadNotifications")) {
			return Promise.resolve();
		}
		return Hrx.callFunction("fetchReadNotifications").then(function (aServiceIds) {
			var aLocalIds = storedReadIds(sEmpId);
			var aMerged = aLocalIds.concat((aServiceIds || []).filter(function (sId) {
				return aLocalIds.indexOf(sId) === -1;
			}));
			storeReadIds(sEmpId, aMerged);
		}).catch(function (oError) {
			console.warn("Read notifications could not be fetched; using this browser's copy", oError);
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
			var pReadIdsSynced = syncReadIdsFromService(oProfile.empID);

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
					$filter: "Status_ID eq " + HrxTime.LEAVE_STATUS.requested +
						(CurrentUser.hasFullAccess() ? "" : " and ApproverID_EmployeeID eq " + sMe)
				}).then(function (aLeaves) {
					return Notifications.approvals(aLeaves.filter(function (oLeave) {
						return HrxLegacy.leaveStatus(oLeave) === "REQ";
					}));
				})) : Promise.resolve(null)
			]).then(function (aResults) {
				return pReadIdsSynced.then(function () {
					return [].concat.apply([], aResults.map(function (v) {
						return Array.isArray(v) ? v : v ? [v] : [];
					}));
				});
			});
		},

		/**
		 * @param {string} sEmpId the employee
		 * @returns {Array<string>} the notification ids they have read
		 */
		readIds: function (sEmpId) {
			return storedReadIds(sEmpId);
		},

		/**
		 * @param {string} sEmpId the employee
		 * @param {Array<string>} aIds ids to mark as read
		 */
		markRead: function (sEmpId, aIds) {
			var aRead = storedReadIds(sEmpId).filter(function (sId) {
				return aIds.indexOf(sId) === -1;
			}).concat(aIds);
			storeReadIds(sEmpId, aRead);

			if (HrxServices.has("markNotificationsRead") && aIds.length) {
				Hrx.callAction("markNotificationsRead", { Keys: aIds }).catch(function (oError) {
					console.warn("Read notifications could not be saved to HRX; kept in this browser", oError);
				});
			}
		}
	};
});
