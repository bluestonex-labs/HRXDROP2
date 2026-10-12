/*
 * Documents (managers): publish documents and chase acknowledgements. The HRX service's
 * Documents entity only stores profile pictures and logos, so the page says which
 * services it needs (see ../needed.js).
 */
sap.ui.define(["../needed"], function (needed) {
	"use strict";

	function render(el) {
		el.innerHTML = "<div class=\"card\">" + needed.block("policies", "Documents is where managers publish policies and see who hasn't acknowledged them. The HRX service only stores pictures and logos, not policy documents, so there is nothing to show. It needs:") + "</div>" +
			"<div class=\"card mt-lg\">" + needed.block("reminders", "Remind outstanding emails everyone who hasn't acknowledged a document. That needs:") + "</div>";
	}
	return { render: render, load: function () {} };
});
