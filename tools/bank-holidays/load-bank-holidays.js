// One-off: add bank holidays to HRX, each office getting only its own country's.
// Run in the browser console of a signed-in HRX page (it uses the app's own service
// calls, so nothing in the HRX service changes). As an HR admin:
//   await hrxLoadBankHolidays(false)  -> preview only, changes nothing
//   await hrxLoadBankHolidays(true)   -> adds the holidays the preview listed
// Lists marked tentative (not yet confirmed by the office) are left out unless the
// second argument is true - only do that once the list has been announced:
//   await hrxLoadBankHolidays(false, true) / await hrxLoadBankHolidays(true, true)
// Safe to run twice: a holiday already there for that office and date is skipped.
//
// Offices are matched by name. Apphaus is part of Oswestry, so it gets the UK list too.
// Someone with no office gets the UK office's holidays (the app does that), so nothing
// is loaded without an office.
//
// UK: England and Wales, from https://www.gov.uk/bank-holidays.json (checked 23 Nov 2026).
// Poland: the statutory public holidays. Company substitute days for holidays that fall
// on a Saturday (1 May and 25 Dec 2027) are NOT included - add them once HR decides the dates.
// India (Aurangabad): the office's 2027 holiday calendar, received 24 Nov 2026 marked
// "TENTATIVE: to be confirmed and then announced" - so it is marked tentative and is
// NOT loaded until confirmed. Check the dates against the announced list first.

var HRX_BANK_HOLIDAYS = {
	UK: {
		offices: ["Oswestry", "Apphaus"],
		holidays: [
			["2026-12-25", "Christmas Day"],
			["2026-12-28", "Boxing Day (substitute day)"],
			["2027-01-01", "New Year's Day"],
			["2027-03-26", "Good Friday"],
			["2027-03-29", "Easter Monday"],
			["2027-05-03", "Early May bank holiday"],
			["2027-05-31", "Spring bank holiday"],
			["2027-08-30", "Summer bank holiday"],
			["2027-12-27", "Christmas Day (substitute day)"],
			["2027-12-28", "Boxing Day (substitute day)"],
			["2028-01-03", "New Year's Day (substitute day)"]
		]
	},
	India: {
		offices: ["Aurangabad"],
		tentative: true,
		holidays: [
			["2027-01-26", "Republic Day"],
			["2027-03-10", "Idul Fitr"],
			["2027-03-26", "Good Friday"],
			["2027-04-07", "Gudi Padwa/Ugadi/Telugu New Year"],
			["2027-04-15", "Ram Navami"],
			["2027-05-17", "Idul Aadha (Bakrid)"],
			["2027-05-20", "Maharashtra Day/Buddh Poornima/May day"],
			["2027-08-15", "Independence Day / Parsi New Year Day"],
			["2027-10-02", "Gandhi Jayanti"],
			["2027-10-09", "Dussehra"],
			["2027-10-29", "Deewali"],
			["2027-12-25", "Christmas Day"]
		]
	},
	Poland: {
		offices: ["Poland"],
		holidays: [
			["2027-01-01", "New Year's Day"],
			["2027-01-06", "Epiphany"],
			["2027-03-28", "Easter Sunday"],
			["2027-03-29", "Easter Monday"],
			["2027-05-01", "Labour Day"],
			["2027-05-03", "Constitution Day"],
			["2027-05-16", "Whit Sunday"],
			["2027-05-27", "Corpus Christi"],
			["2027-08-15", "Assumption Day"],
			["2027-11-01", "All Saints' Day"],
			["2027-11-11", "Independence Day"],
			["2027-12-24", "Christmas Eve"],
			["2027-12-25", "Christmas Day"],
			["2027-12-26", "2nd Day of Christmas"],
			["2028-01-01", "New Year's Day"],
			["2028-01-06", "Epiphany"]
		]
	}
};

window.hrxLoadBankHolidays = async function (bApply, bIncludeTentative) {
	var Hrx = sap.ui.require("bsx/hrx/hrx2026/model/Hrx");
	var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	var aSites = await Hrx.list("Sites", { $select: "ID,SiteDesc" });
	var aExisting = await Hrx.list("BankHolidays", { $select: "Org_ID,Site_ID,Date" });
	// The organisation the existing holidays belong to
	var sOrgId = (aExisting.filter(function (o) { return o.Org_ID; })[0] || {}).Org_ID;
	if (!sOrgId) {
		throw new Error("No existing bank holiday to take the organisation from - stopping.");
	}
	var mHave = {};
	aExisting.forEach(function (o) { mHave[o.Site_ID + "|" + String(o.Date).slice(0, 10)] = true; });

	var aAdd = [], aSkipped = [], aNoOffice = [], aTentative = [];
	Object.keys(HRX_BANK_HOLIDAYS).forEach(function (sCountry) {
		var oSet = HRX_BANK_HOLIDAYS[sCountry];
		if (oSet.tentative && !bIncludeTentative) {
			aTentative.push(sCountry + " (" + oSet.holidays.length + " holidays, not yet confirmed)");
			return;
		}
		oSet.offices.forEach(function (sOffice) {
			var oSite = aSites.filter(function (s) { return String(s.SiteDesc || "").trim().toLowerCase() === sOffice.toLowerCase(); })[0];
			if (!oSite) {
				aNoOffice.push(sOffice);
				return;
			}
			oSet.holidays.forEach(function (aHoliday) {
				var sDate = aHoliday[0];
				if (mHave[oSite.ID + "|" + sDate]) {
					aSkipped.push(sOffice + " " + sDate + " " + aHoliday[1]);
					return;
				}
				var aParts = sDate.split("-");
				aAdd.push({
					Org_ID: sOrgId,
					Site_ID: oSite.ID,
					Date: sDate,
					Day: WEEKDAYS[new Date(+aParts[0], +aParts[1] - 1, +aParts[2]).getDay()],
					HolidayDesc: aHoliday[1],
					_label: sOffice + " " + sDate + " " + aHoliday[1]
				});
			});
		});
	});

	var oPlan = {
		toAdd: aAdd.map(function (o) { return o._label; }),
		alreadyThere: aSkipped,
		officesNotFound: aNoOffice,
		leftOutAsTentative: aTentative
	};
	if (!bApply) {
		return { mode: "PREVIEW - nothing changed", plan: oPlan };
	}

	var aDone = [], aFailed = [];
	for (var i = 0; i < aAdd.length; i++) {
		var oRow = Object.assign({}, aAdd[i]);
		delete oRow._label;
		try {
			await Hrx.create("BankHolidays", oRow);
			aDone.push(aAdd[i]._label);
		} catch (e) {
			aFailed.push(aAdd[i]._label + ": " + e.message);
		}
	}
	return { mode: "APPLIED", added: aDone, failed: aFailed, alreadyThere: aSkipped, officesNotFound: aNoOffice, leftOutAsTentative: aTentative };
};
"ready";
