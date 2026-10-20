sap.ui.define([
	"./Hrx"
], function (Hrx) {
	"use strict";

	/**
	 * Everybody's picture and every client's logo, as stored in SAP Document Management,
	 * held in the component's "pictures" model so any page can show them:
	 *   pictures>/users   - picture address by employee ID
	 *   pictures>/clients - logo address by client ID (a project's ClientKey)
	 * A view shows the picture when there is one and falls back to the initials, e.g.
	 *   src="{= ${pictures>/users}[${home>EmpID}] }"
	 */
	return {

		/**
		 * Reads the pictures and logos into the model. On a service failure the model is
		 * left as it is, so pages keep showing initials.
		 * @param {sap.ui.model.json.JSONModel} oModel the component's "pictures" model
		 * @returns {Promise} resolves once the model is filled
		 */
		load: function (oModel) {
			return Promise.all([
				Hrx.list("Users", { $select: "EmployeeID,ImageRootID,ImageObjectID" }),
				Hrx.list("Clients", { $select: "ID,LogoRootID,LogoObjectID" })
			]).then(function (aResults) {
				var mUsers = {};
				var mClients = {};

				aResults[0].forEach(function (oUser) {
					var sPicture = Hrx.pictureUrl(oUser.ImageRootID, oUser.ImageObjectID);
					if (sPicture) {
						mUsers[oUser.EmployeeID] = sPicture;
					}
				});
				aResults[1].forEach(function (oClient) {
					var sLogo = Hrx.pictureUrl(oClient.LogoRootID, oClient.LogoObjectID);
					if (sLogo) {
						mClients[oClient.ID] = sLogo;
					}
				});

				oModel.setData({ users: mUsers, clients: mClients });
			}).catch(function () {
				// No pictures is not an error worth showing: every avatar has its initials.
			});
		}
	};
});
