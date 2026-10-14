sap.ui.define([
	"./Hrx",
	"./HrxServices",
	"./Mail"
], function (Hrx, HrxServices, Mail) {
	"use strict";

	/*
	 * Sends a reminder email from HRX: a timesheet to book, a policy to acknowledge, a
	 * check-in after sickness.
	 *
	 * With the HRX service's sendReminder deployed and email set up on it, the service
	 * sends one email per person (the sender in copy). Otherwise - not deployed yet, or
	 * the service answers that email is not set up - the sender's own mail app opens
	 * with a draft instead, as before.
	 */

	function draftInMailApp(oReminder) {
		Mail.open(oReminder.draft);
		return "drafted";
	}

	return {

		/**
		 * @param {object} oReminder
		 *   kind        what it is about, for the service's log: "Timesheet", "Policy", "Sickness"
		 *   employeeIds the people it is for (EmployeeIDs)
		 *   subject     the email's subject
		 *   message     the email's text, sent as written
		 *   draft       the Mail.open() draft to fall back on ({ to | bcc, subject, body })
		 * @returns {Promise<string>} "sent" when the service sent it, "drafted" when a
		 * draft was opened in the mail app instead
		 */
		send: function (oReminder) {
			if (!HrxServices.has("sendReminder")) {
				return Promise.resolve(draftInMailApp(oReminder));
			}
			return Hrx.callAction("sendReminder", {
				Kind: oReminder.kind,
				EmployeeIDs: oReminder.employeeIds,
				Subject: oReminder.subject,
				Message: oReminder.message
			}).then(function () {
				return "sent";
			}, function (oError) {
				var bEmailNotSetUp = /not set up/i.test((oError && oError.message) || "");
				if (bEmailNotSetUp) {
					return draftInMailApp(oReminder);
				}
				throw oError;
			});
		}
	};
});
