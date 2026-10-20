"""Exports the design document to PDF with LibreOffice, filling in its table of contents.

    python3 docs/design-tech/tools/export-pdf.py in.docx out.pdf [toc.json]

Starts a headless LibreOffice, opens the .docx, updates every index (the contents), exports
the PDF and, when asked, writes the contents entries [(level, text, page)] to toc.json, so
build-design-doc.py can put them into the .docx as the contents field's shown result.
Needs LibreOffice with its Python bridge (python3 -c "import uno").
"""
import json
import os
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def connect(port):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    for _ in range(60):
        try:
            return resolver.resolve("uno:socket,host=localhost,port=%d;urp;StarOffice.ComponentContext" % port)
        except Exception:  # LibreOffice still starting
            time.sleep(0.5)
    raise RuntimeError("LibreOffice did not start")


def main(source, target, toc_path=None):
    port = 2083
    profile = "file:///tmp/hrx-doc-lo-profile"
    office = subprocess.Popen(["soffice", "--headless", "--invisible", "--norestore", "-env:UserInstallation=" + profile,
                               "--accept=socket,host=localhost,port=%d;urp;" % port])
    try:
        context = connect(port)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(source)), "_blank", 0, (prop("Hidden", True),))
        indexes = document.getDocumentIndexes()
        for index in range(indexes.getCount()):
            indexes.getByIndex(index).update()
        document.refresh()
        # A second pass: the contents may have changed the page count it reports.
        for index in range(indexes.getCount()):
            indexes.getByIndex(index).update()

        if toc_path and indexes.getCount():
            entries = []
            enumeration = indexes.getByIndex(0).getAnchor().getText().createEnumeration()
            anchor = indexes.getByIndex(0).getAnchor()
            cursor = anchor.getText().createTextCursorByRange(anchor)
            for line in cursor.getString().split("\n"):
                if "\t" not in line:
                    continue
                text, page = line.rsplit("\t", 1)
                text = text.strip()
                level = 2 if text[:1].isdigit() and "." in text.split("  ")[0] else 1
                entries.append([level, text, page.strip()])
            with open(toc_path, "w") as file:
                json.dump(entries, file, indent=1)
            print("Contents entries: %d" % len(entries))

        document.storeToURL(uno.systemPathToFileUrl(os.path.abspath(target)), (prop("FilterName", "writer_pdf_Export"),))
        document.close(True)
        print("Wrote " + target)
    finally:
        try:
            desktop.terminate()
        except Exception:
            pass
        time.sleep(1)
        office.kill()


if __name__ == "__main__":
    main(*sys.argv[1:])
