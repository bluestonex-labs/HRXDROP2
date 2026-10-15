sap.ui.define([
	"./Hrx"
], function (Hrx) {
	"use strict";

	/*
	 * Which parts of the HRX service are deployed.
	 *
	 * The app is released separately from the HRX service, so a page cannot assume an
	 * entity set or action exists just because this version of the app knows about it.
	 * The service's $metadata is read once at start-up (Component.js waits for it before
	 * routing); each page then asks has() / hasProperty() and either uses the HRX service
	 * or carries on as before and shows its "Service needed" note.
	 *
	 * The answers are also in the component model "services" (see FLAGS), for views to
	 * bind "Service needed" notes to.
	 */

	// Model flag -> what has to be deployed for it.
	var FLAGS = {
		policies: { entitySet: "Policies" },
		sicknessReviews: { entitySet: "SicknessReviews" },
		clientUsers: { entitySet: "ClientUsers" },
		clientSlas: { entitySet: "ClientSLAs" },
		clientComponents: { entitySet: "ClientComponents" },
		clientApplications: { entitySet: "ClientApplications" },
		projectAreas: { entitySet: "ProjectAreas" },
		projectContacts: { entityType: "Projects", property: "PrimaryContactName" },
		projectDocuments: { operation: "fetchProjectDocuments" },
		reminders: { operation: "sendReminder" },
		notificationReads: { operation: "fetchReadNotifications" },
		jobTitle: { entityType: "Users", property: "JobTitle" },
		contactName: { entityType: "Contacts", property: "FirstName" },
		dayCost: { entityType: "UserToProject", property: "DayCost" }
	};

	var oDeployed = { entitySets: {}, operations: {}, properties: {} };
	var pLoad = null;

	function readMetadata(sXml) {
		var oDocument = new DOMParser().parseFromString(sXml, "application/xml");
		var aElements = function (sTag) {
			return Array.prototype.slice.call(oDocument.getElementsByTagNameNS("*", sTag));
		};
		aElements("EntitySet").forEach(function (oElement) {
			oDeployed.entitySets[oElement.getAttribute("Name")] = true;
		});
		aElements("FunctionImport").concat(aElements("ActionImport")).forEach(function (oElement) {
			oDeployed.operations[oElement.getAttribute("Name")] = true;
		});
		aElements("EntityType").forEach(function (oType) {
			var sTypeName = oType.getAttribute("Name");
			Array.prototype.slice.call(oType.getElementsByTagNameNS("*", "Property")).forEach(function (oProperty) {
				oDeployed.properties[sTypeName + "." + oProperty.getAttribute("Name")] = true;
			});
		});
	}

	var HrxServices = {

		/**
		 * Reads the service's $metadata, once. Never rejects: when it cannot be read,
		 * nothing new counts as deployed and every page keeps its current behaviour.
		 * @returns {Promise<void>} settles once the answers are known
		 */
		load: function () {
			if (!pLoad) {
				pLoad = fetch(Hrx.ROOT + "/$metadata", { credentials: "same-origin" }).then(function (oResponse) {
					return oResponse.ok ? oResponse.text() : "";
				}).then(function (sXml) {
					if (sXml) {
						readMetadata(sXml);
					}
				}).catch(function (oError) {
					console.warn("HRX service metadata could not be read; new services are treated as not deployed", oError);
				});
			}
			return pLoad;
		},

		/**
		 * @param {string} sName an entity set, function or action of the HRX service
		 * @returns {boolean} true when it is deployed
		 */
		has: function (sName) {
			return !!(oDeployed.entitySets[sName] || oDeployed.operations[sName]);
		},

		/**
		 * @param {string} sEntityType e.g. "Users"
		 * @param {string} sProperty e.g. "JobTitle"
		 * @returns {boolean} true when the deployed entity type has the property
		 */
		hasProperty: function (sEntityType, sProperty) {
			return !!oDeployed.properties[sEntityType + "." + sProperty];
		},

		/**
		 * @returns {object} one boolean per FLAGS entry, for the "services" model
		 */
		flags: function () {
			var oFlags = {};
			Object.keys(FLAGS).forEach(function (sFlag) {
				var oNeed = FLAGS[sFlag];
				oFlags[sFlag] = oNeed.property ? this.hasProperty(oNeed.entityType, oNeed.property) : this.has(oNeed.entitySet || oNeed.operation);
			}.bind(this));
			return oFlags;
		}
	};

	return HrxServices;
});
