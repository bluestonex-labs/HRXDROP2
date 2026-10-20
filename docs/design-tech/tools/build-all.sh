#!/bin/sh
# Builds the design & technical document (.docx and .pdf) and the architecture PNG.
# Run from the repository root. Needs python-docx, Pillow, LibreOffice (with its Python
# bridge), Raleway installed, and for the PNG: node with mxgraph@4.2.2 and
# puppeteer-core@24 on NODE_PATH, and CHROME_PATH.
set -e
TOOLS=docs/design-tech/tools
OUT=docs/design-tech
TMP=$(mktemp -d)
export HRX_APP_COMMIT=${HRX_APP_COMMIT:-$(git rev-parse --short HEAD)}

python3 $TOOLS/build-architecture-drawio.py
# The PNG only where mxgraph and puppeteer-core can be found (NODE_PATH)
if node -e "require.resolve('mxgraph'); require.resolve('puppeteer-core')" 2>/dev/null; then
	node $TOOLS/render-drawio.js $OUT/hrx-architecture.drawio $OUT/hrx-architecture.png
fi

# Two passes: the first works out the contents' page numbers, the second shows them.
python3 $TOOLS/build-design-doc.py
python3 $TOOLS/export-pdf.py $OUT/HRX-Design-and-Technical-Document.docx $TMP/pass1.pdf $TMP/toc.json
python3 $TOOLS/build-design-doc.py $TMP/toc.json
python3 $TOOLS/export-pdf.py $OUT/HRX-Design-and-Technical-Document.docx $OUT/HRX-Design-and-Technical-Document.pdf
rm -rf "$TMP"
