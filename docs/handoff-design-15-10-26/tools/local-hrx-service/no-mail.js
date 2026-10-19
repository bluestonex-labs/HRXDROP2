// Local test only: stands in for nodemailer so the HRX service copy can never send
// a real email. Every "send" is written to the log instead.
module.exports = {
	createTransport: function () {
		return {
			sendMail: function (oMail, fnDone) {
				console.log("[email blocked - local test] to " + oMail.to + (oMail.cc ? " cc " + oMail.cc : "") + ": " + oMail.subject);
				var oInfo = { messageId: "blocked-local-test" };
				if (typeof fnDone === "function") {
					fnDone(null, oInfo);
					return undefined;
				}
				return Promise.resolve(oInfo);
			}
		};
	},
	getTestMessageUrl: function () {
		return false;
	}
};
