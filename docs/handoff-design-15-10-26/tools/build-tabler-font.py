# python3 build-tabler-font.py
# Builds webapp/fonts/tabler/ for the app: the Tabler icon font the design draws its
# "ti ti-*" glyphs with (Tabler Icons 3.19.0, MIT), cut down to the glyphs the design
# uses, plus the name -> code point JSON that sap.ui.core.IconPool.registerFont reads.
# Needs: npm i @tabler/icons-webfont@3.19.0 (here, in tools/) and pip install fonttools brotli.
import json, os, re, shutil
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.join(HERE, "..", "design", "HRX Drop 2 - 15.10.26.html")
TABLER = os.path.join(HERE, "node_modules", "@tabler", "icons-webfont")
OUT = os.path.join(HERE, "..", "..", "..", "hrx2026", "webapp", "fonts", "tabler")
FAMILY = "tabler-icons-hrx"

# Every glyph the design names, plus any the app needs that the design draws elsewhere
aNames = sorted(set(re.findall(r"\bti-([a-z0-9-]+)", open(DESIGN, encoding="utf-8").read())))
sCss = open(os.path.join(TABLER, "dist", "tabler-icons.css"), encoding="utf-8").read()
mCodes = {}
for sName in aNames:
    oMatch = re.search(r"\.ti-" + re.escape(sName) + r":before\s*\{\s*content:\s*\"\\([0-9a-f]+)\"", sCss)
    if oMatch:
        mCodes[sName] = oMatch.group(1)
    else:
        print("not in Tabler 3.19.0:", sName)

os.makedirs(OUT, exist_ok=True)
oOptions = subset.Options()
oOptions.flavor = "woff2"
oOptions.layout_features = []
oOptions.name_IDs = ["*"]
oFont = subset.load_font(os.path.join(TABLER, "dist", "fonts", "tabler-icons.ttf"), oOptions)
oSubsetter = subset.Subsetter(oOptions)
oSubsetter.populate(unicodes=[int(sCode, 16) for sCode in mCodes.values()])
oSubsetter.subset(oFont)
subset.save_font(oFont, os.path.join(OUT, FAMILY + ".woff2"), oOptions)
json.dump(mCodes, open(os.path.join(OUT, FAMILY + ".json"), "w"), indent="\t", sort_keys=True)
shutil.copy(os.path.join(TABLER, "LICENSE"), os.path.join(OUT, "LICENSE"))
print(len(mCodes), "glyphs ->", os.path.normpath(OUT))
