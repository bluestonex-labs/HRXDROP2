/*
 * Policies to read. The HRX service has no policy or acknowledgement endpoints yet, so
 * the page says which services it needs (see ../needed.js).
 */
sap.ui.define(["../needed"], function (needed) {
	"use strict";

	function render(el) {
		el.innerHTML = "<div class=\"card\">" + needed.block("policies", "Policies to read lists the policies you need to read and lets you acknowledge them. The HRX service has no endpoint for policies yet, so there is nothing to show. It needs:") + "</div>";
	}
	return { render: render, load: function () {} };
});
