sap.ui.define([
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/Label",
	"sap/m/TextArea",
	"sap/m/Input",
	"sap/m/VBox",
	"sap/m/HBox",
	"sap/m/MessageStrip",
	"sap/m/MessageToast"
], function (Dialog, Button, Label, TextArea, Input, VBox, HBox, MessageStrip, MessageToast) {
	"use strict";

	/*
	 * Opens a drafted email in Outlook, the organisation's email.
	 *
	 * The draft opens as a new message in Outlook on the web, in a new tab: an ordinary
	 * web address, so unlike a mailto: link it does not depend on the machine or the
	 * browser having an email app set up. It is the user's own mailbox, so what they
	 * send shows in desktop Outlook as well.
	 *
	 * If the browser blocks the new tab, the draft is shown instead, to copy, with a
	 * button to try Outlook again and one for the machine's own email app.
	 */
	var OUTLOOK_COMPOSE = "https://outlook.office.com/mail/deeplink/compose";

	function outlookUrl(oDraft) {
		var aParts = [];
		["to", "cc", "bcc", "subject", "body"].forEach(function (sKey) {
			if (oDraft[sKey]) {
				aParts.push(sKey + "=" + encodeURIComponent(oDraft[sKey]));
			}
		});
		return OUTLOOK_COMPOSE + (aParts.length ? "?" + aParts.join("&") : "");
	}

	/**
	 * @param {object} oDraft the draft
	 * @returns {boolean} true when the new tab opened
	 */
	function openOutlook(oDraft) {
		var oTab = window.open(outlookUrl(oDraft), "_blank");
		if (!oTab) {
			return false;
		}
		try {
			oTab.opener = null;
		} catch (oError) {
			// cross-origin already - nothing to detach
		}
		return true;
	}

	function openMailApp(oDraft) {
		var oLink = document.createElement("a");
		oLink.href = mailtoUrl(oDraft);
		oLink.target = "_top";
		oLink.rel = "noopener";
		oLink.style.display = "none";
		document.body.appendChild(oLink);
		oLink.click();
		document.body.removeChild(oLink);
	}

	function mailtoUrl(oDraft) {
		var aParts = [];
		if (oDraft.cc) {
			aParts.push("cc=" + encodeURIComponent(oDraft.cc));
		}
		if (oDraft.bcc) {
			aParts.push("bcc=" + encodeURIComponent(oDraft.bcc));
		}
		if (oDraft.subject) {
			aParts.push("subject=" + encodeURIComponent(oDraft.subject));
		}
		if (oDraft.body) {
			aParts.push("body=" + encodeURIComponent(oDraft.body));
		}
		return "mailto:" + (oDraft.to || "").split(",").map(function (sAddress) {
			return encodeURIComponent(sAddress.trim());
		}).join(",") + (aParts.length ? "?" + aParts.join("&") : "");
	}

	function copy(sText, oField) {
		var fnSelect = function () {
			var oDom = oField && oField.getFocusDomRef();
			if (oDom) {
				oDom.focus();
				oDom.select();
			}
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(sText).then(function () {
				MessageToast.show("Copied");
			}, fnSelect);
		} else {
			fnSelect();
		}
	}

	function field(sLabel, sValue, bMultiLine) {
		var oField = bMultiLine ?
			new TextArea({ value: sValue, editable: false, width: "100%", rows: 7, growing: true, growingMaxLines: 12 }) :
			new Input({ value: sValue, editable: false, width: "100%" });
		return new VBox({
			items: [
				new HBox({
					justifyContent: "SpaceBetween",
					alignItems: "Center",
					items: [
						new Label({ text: sLabel }),
						new Button({
							text: "Copy",
							type: "Transparent",
							icon: "sap-icon://copy",
							press: function () {
								copy(sValue, oField);
							}
						})
					]
				}),
				oField
			]
		}).addStyleClass("sapUiSmallMarginBottom");
	}

	function showDraft(oDraft) {
		var aItems = [
			new MessageStrip({
				text: "Outlook did not open in a new tab - the browser may have blocked it. Try again, or copy the details into a new email.",
				type: "Information",
				showIcon: true
			}).addStyleClass("sapUiSmallMarginBottom")
		];
		if (oDraft.to) {
			aItems.push(field("To", oDraft.to));
		}
		if (oDraft.bcc) {
			aItems.push(field("Bcc", oDraft.bcc));
		}
		if (oDraft.subject) {
			aItems.push(field("Subject", oDraft.subject));
		}
		if (oDraft.body) {
			aItems.push(field("Message", oDraft.body, true));
		}

		var oDialog = new Dialog({
			title: "Email draft",
			contentWidth: "34rem",
			content: new VBox({ items: aItems }),
			buttons: [
				new Button({
					text: "Open in Outlook",
					type: "Emphasized",
					icon: "sap-icon://email",
					press: function () {
						if (openOutlook(oDraft)) {
							oDialog.close();
						}
					}
				}),
				new Button({
					text: "Use my email app",
					press: function () {
						openMailApp(oDraft);
						oDialog.close();
					}
				}),
				new Button({
					text: "Close",
					press: function () {
						oDialog.close();
					}
				})
			],
			afterClose: function () {
				oDialog.destroy();
			}
		}).addStyleClass("sapUiContentPadding");
		oDialog.open();
	}

	return {

		/**
		 * @param {object} oDraft to (comma-separated), cc, bcc, subject and body
		 */
		open: function (oDraft) {
			if (!openOutlook(oDraft)) {
				showDraft(oDraft);
			}
		},

		outlookUrl: outlookUrl,

		mailtoUrl: mailtoUrl
	};
});
