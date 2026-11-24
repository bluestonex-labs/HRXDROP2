sap.ui.define([], function () {
	"use strict";

	/*
	 * What the Expenses pages work out about a claim, with no UI in it: status names,
	 * money, the tax split, the checks on each line and whether a claim is ready to
	 * submit. The checks mirror the expense service's own rules (srv/lib/validate.js
	 * in ExpenseService), so what the page asks for is what the service will insist on:
	 *  - blocking: required fields, no future dates, a receipt for every type that
	 *    requires one (ExpenseTypes.requiresReceipt)
	 *  - warnings only: a possible duplicate, meals or hotel over the daily limit in
	 *    the country's policy (the approver sees those)
	 * The service recalculates every amount when a claim is saved; the figures here are
	 * a preview while the claim is being typed.
	 */

	// The service's statuses, as the design names them, and the colour of their pill
	var STATUS = {
		Draft: { text: "Draft", state: "None" },
		Submitted: { text: "Submitted", state: "Information" },
		FirstApproved: { text: "Awaiting 2nd approval", state: "Information" },
		Approved: { text: "Approved", state: "Success" },
		Returned: { text: "Returned for rework", state: "Warning" },
		Rejected: { text: "Rejected", state: "Error" }
	};

	var CURRENCY_OF_COUNTRY = { UK: "GBP", IN: "INR" };

	// The phone's pills are coloured by their own keys (css/pages/mobile.css hrxMbPill)
	var PILL_OF_STATE = { None: "neu", Information: "info", Success: "ok", Warning: "warn", Error: "crit" };
	var SYMBOL_OF_CURRENCY = { GBP: "£", INR: "₹", EUR: "€", USD: "$" };

	// A scan read with less confidence than this asks the employee to check it
	var LOW_CONFIDENCE = 0.8;

	// A line read from a banking app screenshot starts its notes with this, so the
	// page can say it is not a VAT receipt until a real receipt replaces it
	var SCREENSHOT_NOTE = "Bank screenshot";

	function isFromScreenshot(oItem) {
		return !!oItem && typeof oItem.notes === "string" && oItem.notes.indexOf(SCREENSHOT_NOTE) === 0;
	}

	function round2(fValue) {
		return Math.round((Number(fValue) + Number.EPSILON) * 100) / 100;
	}

	function isBlank(vValue) {
		return vValue === null || vValue === undefined || String(vValue).trim() === "";
	}

	function todayIso() {
		var oToday = new Date();
		return oToday.getFullYear() + "-" + String(oToday.getMonth() + 1).padStart(2, "0") + "-" +
			String(oToday.getDate()).padStart(2, "0");
	}

	/**
	 * @param {number} fAmount an amount
	 * @param {string} sCurrency GBP, INR, …
	 * @returns {string} e.g. "£1,234.50"
	 */
	function money(fAmount, sCurrency) {
		var sSymbol = SYMBOL_OF_CURRENCY[sCurrency];
		var sNumber = round2(fAmount || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return sSymbol ? sSymbol + sNumber : sNumber + " " + (sCurrency || "");
	}

	/**
	 * Splits a tax-inclusive gross amount into net and tax.
	 * @param {number} fGross the amount paid, tax included
	 * @param {number} fRate the tax rate as a fraction, e.g. 0.2
	 * @returns {{gross: number, net: number, tax: number}} the split
	 */
	function taxSplit(fGross, fRate) {
		var fRounded = round2(fGross || 0);
		var fTax = fRate > 0 ? round2(fRounded * fRate / (1 + fRate)) : 0;
		return { gross: fRounded, net: round2(fRounded - fTax), tax: fTax };
	}

	/**
	 * The claim's totals: the service's saved figures where it has them, otherwise
	 * worked out from the lines.
	 * @param {object} oClaim the claim with items and mileageClaims
	 * @param {function} fnTaxRate (vatType) → rate for the claim's country
	 * @returns {{net: number, tax: number, total: number}} the totals
	 */
	function claimTotals(oClaim, fnTaxRate) {
		var fNet = 0;
		var fTax = 0;
		var fTotal = 0;
		(oClaim.items || []).forEach(function (oItem) {
			var oSplit = taxSplit(oItem.grossAmount, fnTaxRate(oItem.vatType));
			fNet += oSplit.net;
			fTax += oSplit.tax;
			fTotal += oSplit.gross;
		});
		(oClaim.mileageClaims || []).forEach(function (oMileage) {
			var fAmount = round2((Number(oMileage.milesCount) || 0) * (Number(oMileage.ratePerMile) || 0));
			fNet += fAmount;
			fTotal += fAmount;
		});
		return { net: round2(fNet), tax: round2(fTax), total: round2(fTotal) };
	}

	/** @returns {string[]} the fields an item still needs (date, type, reason, gross) */
	function missingItemFields(oItem) {
		var aMissing = [];
		if (isBlank(oItem.expenseDate)) { aMissing.push("date"); }
		if (isBlank(oItem.expenseType_code)) { aMissing.push("type"); }
		if (isBlank(oItem.reasonForTrip)) { aMissing.push("reason"); }
		if (!(Number(oItem.grossAmount) > 0)) { aMissing.push("gross"); }
		return aMissing;
	}

	/** @returns {string[]} the fields a mileage line still needs */
	function missingMileageFields(oMileage) {
		var aMissing = [];
		if (isBlank(oMileage.tripDate)) { aMissing.push("date"); }
		if (isBlank(oMileage.destination)) { aMissing.push("destination"); }
		if (isBlank(oMileage.reasonForTrip)) { aMissing.push("reason"); }
		if (!(Number(oMileage.milesCount) > 0)) { aMissing.push("miles"); }
		return aMissing;
	}

	/**
	 * The checks on one item, each saying who has to act:
	 *  need "you"  fix before submitting (blocks the claim unless it can be waved off)
	 *  need "fyi"  fine to submit; the approver will see it
	 * @param {object} oItem the item (with the page's own scanConfidence, detectedType
	 *   and dismissed list, when it has them)
	 * @param {object} oContext { items, policy, types (code → type), currency }
	 * @returns {{checks: object[], you: object[], fyi: object[], state: string}} the checks;
	 *   state is "none" (nothing typed yet), "input" (something to fix) or "ok"
	 */
	function itemChecks(oItem, oContext) {
		var fGross = Number(oItem.grossAmount) || 0;
		var aChecks = [];
		var aDismissed = oItem.dismissed || [];

		if (isBlank(oItem.expenseType_code) || !(fGross > 0)) {
			return { checks: [], you: [], fyi: [], state: "none" };
		}

		var bHasReason = !isBlank(oItem.reasonForTrip);
		var oType = oContext.types[oItem.expenseType_code] || {};
		var oPolicy = oContext.policy || {};

		function addCheck(oCheck) {
			if (oCheck.key && aDismissed.indexOf(oCheck.key) >= 0) {
				return;
			}
			aChecks.push(oCheck);
		}

		// Daily limits (the service's FOOD and HOTEL rules): a warning, never a block
		var mLimits = { FOOD: { limit: oPolicy.mealDailyLimit, label: "meal" }, HOTEL: { limit: oPolicy.hotelDailyLimit, label: "hotel" } };
		var oLimit = mLimits[oItem.expenseType_code];
		if (oLimit && Number(oLimit.limit) > 0) {
			var fDayTotal = round2((oContext.items || []).filter(function (oOther) {
				return oOther.expenseType_code === oItem.expenseType_code && oOther.expenseDate === oItem.expenseDate;
			}).reduce(function (fSum, oOther) {
				return fSum + (Number(oOther.grossAmount) || 0);
			}, 0));
			var sDayText = money(fDayTotal, oContext.currency) + " of " + money(oLimit.limit, oContext.currency) + " daily limit";
			if (fDayTotal > Number(oLimit.limit)) {
				aChecks.push({
					status: "flag",
					need: bHasReason ? "fyi" : "you",
					label: "Over daily " + oLimit.label + " limit",
					detail: sDayText + (bHasReason ? "" : " — explain why in Reason"),
					fix: bHasReason ? null : "reason",
					fixText: "Add a reason"
				});
			} else {
				aChecks.push({ status: "ok", label: "Within daily " + oLimit.label + " limit", detail: sDayText });
			}
		}

		// What the receipt reading said
		if (oItem.detectedType && oItem.detectedType !== oItem.expenseType_code) {
			addCheck({
				key: "mismatch", status: "flag", need: "you", label: "Type differs from the receipt",
				detail: "The receipt reads as “" + ((oContext.types[oItem.detectedType] || {}).description || oItem.detectedType) + "”",
				fix: "use-detected", fixText: "Use that type", dismissText: "Keep mine"
			});
		}
		if (oItem.scanConfidence !== null && oItem.scanConfidence !== undefined && oItem.scanConfidence < LOW_CONFIDENCE) {
			addCheck({
				key: "lowconf", status: "flag", need: "you", label: "Check the values we read",
				detail: "Read with " + Math.round(oItem.scanConfidence * 100) + "% confidence — check the date, amount and type",
				dismissText: "Looks right"
			});
		}

		// Possible duplicate (the service's warning)
		var bDuplicate = (oContext.items || []).some(function (oOther) {
			return oOther.ID !== oItem.ID && oOther.expenseType_code === oItem.expenseType_code &&
				oOther.expenseDate === oItem.expenseDate && round2(oOther.grossAmount) === round2(fGross);
		});
		if (bDuplicate) {
			addCheck({
				key: "dup", status: "flag", need: "you", label: "Possible duplicate",
				detail: "Same date, type and amount as another item in this claim", dismissText: "Not a duplicate"
			});
		}

		// No future dates (blocking on the service)
		if (oItem.expenseDate && oItem.expenseDate > todayIso()) {
			aChecks.push({ status: "block", need: "you", label: "Date in the future", detail: "Check the expense date", fix: "edit", fixText: "Fix the date" });
		}

		// A banking app screenshot shows the payment, not the tax: ask for the receipt
		if (isFromScreenshot(oItem)) {
			addCheck({
				key: "shot", status: "flag", need: "you", label: "Bank screenshot only",
				detail: "Not a VAT receipt. Add an itemised receipt if you can",
				fix: "attach", fixText: "Attach receipt", dismissText: "Keep the screenshot"
			});
		}

		// Receipt: required for most types (blocking on the service)
		if (oItem.receiptAttached) {
			aChecks.push({ status: "ok", label: "Receipt attached", detail: oItem.receiptFileName || "" });
		} else if (oType.requiresReceipt) {
			aChecks.push({
				status: "block", need: "you", label: "Receipt required",
				detail: (oType.description || "This type") + " always needs a receipt", fix: "attach", fixText: "Attach receipt"
			});
		} else {
			aChecks.push({ status: "info", label: "No receipt needed", detail: (oType.description || "This type") + " can go without one" });
		}

		// Spending abroad carries no reclaimable tax
		if (oItem.originalCurrency && oItem.originalCurrency !== oContext.currency) {
			aChecks.push({
				status: "info", label: "No tax to reclaim",
				detail: "Paid in " + oItem.originalCurrency + ": foreign tax can’t be reclaimed"
			});
		}

		var aYou = aChecks.filter(function (oCheck) { return oCheck.need === "you"; });
		var aFyi = aChecks.filter(function (oCheck) { return oCheck.need === "fyi"; });
		return { checks: aChecks, you: aYou, fyi: aFyi, state: aYou.length || missingItemFields(oItem).length ? "input" : "ok" };
	}

	/**
	 * What is left to do before a claim can be submitted.
	 * @param {object} oClaim the claim
	 * @param {object} oContext as for itemChecks
	 * @returns {{toFix: number, flagged: number, reading: number, empty: boolean, firstToFix: string|null}}
	 */
	function readiness(oClaim, oContext) {
		var iToFix = 0;
		var iFlagged = 0;
		var iReading = 0;
		var sFirst = null;
		var aItems = oClaim.items || [];
		var aMileage = oClaim.mileageClaims || [];

		if (isBlank(oClaim.claimPeriod)) {
			iToFix++;
			sFirst = "claim";
		}
		aItems.forEach(function (oItem) {
			if (oItem.reading) {
				iReading++;
				return;
			}
			var oChecks = itemChecks(oItem, oContext);
			if (missingItemFields(oItem).length || oChecks.you.length) {
				iToFix++;
				sFirst = sFirst || oItem.ID;
			}
			if (oChecks.fyi.length) {
				iFlagged++;
			}
		});
		aMileage.forEach(function (oMileage) {
			if (missingMileageFields(oMileage).length || (oMileage.tripDate && oMileage.tripDate > todayIso())) {
				iToFix++;
				sFirst = sFirst || oMileage.ID;
			}
		});
		return { toFix: iToFix, flagged: iFlagged, reading: iReading, empty: !aItems.length && !aMileage.length, firstToFix: sFirst };
	}

	/**
	 * The expense lines a read receipt becomes, as the old My Expenses app made them
	 * (its model/scanLines.js):
	 *  - an itemised receipt (several printed lines that add up to no more than what
	 *    was charged) becomes one line per printed line, each with its own type;
	 *  - anything else becomes one line at the receipt total.
	 * The AI reads printed lines in the receipt's own currency; abroad they are
	 * converted at the receipt's rate, so each line's amount and its original amount
	 * agree (the service checks that when the claim is saved).
	 * @param {object} oReading the service's reading of the receipt (ReceiptDraft)
	 * @param {string} sClaimCurrency the claim's currency, e.g. GBP
	 * @param {boolean} [bScreenshot] read from a banking app screenshot: always one
	 *   line, its notes starting with SCREENSHOT_NOTE
	 * @returns {object[]} one item to create per line, plus scanConfidence and
	 *   detectedType for the page's own checks
	 */
	function linesFromReading(oReading, sClaimCurrency, bScreenshot) {
		var bForeign = !!oReading.isForeign;
		var fRate = Number(oReading.fxRate) || null;
		var aPrinted = Array.isArray(oReading.lineItems) ? oReading.lineItems : [];
		var bItemised = !bScreenshot && aPrinted.length > 1 && !oReading.lineItemsExceedTotal;

		var fnLine = function (fReceiptAmount, fHomeAmount, sType, sNotes) {
			return {
				expenseDate: oReading.expenseDate || todayIso(),
				expenseType_code: sType || null,
				destination: oReading.vendor || "",
				grossAmount: fHomeAmount === null || isNaN(fHomeAmount) ? null : round2(fHomeAmount),
				vatType: oReading.vatType || (bForeign ? "ZR" : "STD"),
				originalAmount: bForeign ? fReceiptAmount : null,
				originalCurrency: bForeign ? oReading.currency : null,
				fxRate: bForeign ? fRate : null,
				fxTargetCurrency: bForeign ? sClaimCurrency : null,
				notes: sNotes || null,
				scanConfidence: oReading.confidence === null || oReading.confidence === undefined ? null : Number(oReading.confidence),
				detectedType: sType || null
			};
		};

		if (!bItemised) {
			var fHome = Number(bForeign ? oReading.homeAmount : oReading.grossAmount);
			var sNotes = bScreenshot ? [SCREENSHOT_NOTE, oReading.notes].filter(Boolean).join(" · ") : oReading.notes;
			return [fnLine(bForeign ? Number(oReading.grossAmount) : null, fHome, oReading.matchedType, sNotes)];
		}
		return aPrinted.map(function (oPrinted) {
			var fAmount = Number(oPrinted.amount);
			var fHomeLine = bForeign ? (fRate ? fAmount * fRate : null) : fAmount;
			var sNotes = [oPrinted.description, oPrinted.notes].filter(Boolean).join(" · ");
			return fnLine(bForeign ? fAmount : null, fHomeLine, oPrinted.matchedType, sNotes);
		});
	}

	function isEditable(sStatus) {
		return sStatus === "Draft" || sStatus === "Returned";
	}

	function isPending(sStatus) {
		return sStatus === "Submitted" || sStatus === "FirstApproved";
	}

	return {
		STATUS: STATUS,
		CURRENCY_OF_COUNTRY: CURRENCY_OF_COUNTRY,
		SCREENSHOT_NOTE: SCREENSHOT_NOTE,
		isFromScreenshot: isFromScreenshot,
		round2: round2,
		todayIso: todayIso,
		money: money,
		taxSplit: taxSplit,
		claimTotals: claimTotals,
		missingItemFields: missingItemFields,
		missingMileageFields: missingMileageFields,
		itemChecks: itemChecks,
		readiness: readiness,
		linesFromReading: linesFromReading,
		isEditable: isEditable,
		isPending: isPending,

		/**
		 * @param {string} sState a UI5 value state (None, Information, Success, Warning, Error)
		 * @returns {string} the phone pill's colour key (neu, info, ok, warn, crit)
		 */
		pillOf: function (sState) {
			return PILL_OF_STATE[sState] || "neu";
		},

		/** @returns {{text: string, state: string}} the status as shown, and its pill colour */
		statusOf: function (sStatus) {
			return STATUS[sStatus] || { text: sStatus || "", state: "None" };
		},

		/**
		 * The claim country for a site key: UK* → UK, IN* → IN, anything else UK
		 * (the service's homeCountryFor rule).
		 * @param {string} sSiteKey e.g. UKOSW
		 * @returns {string} UK or IN
		 */
		countryOfSite: function (sSiteKey) {
			return String(sSiteKey || "").toUpperCase().indexOf("IN") === 0 ? "IN" : "UK";
		}
	};
});
