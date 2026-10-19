# ../venv2/bin/python compare.py design.png app.png out.png [x0 y0 x1 y1]
# Puts the design (left) and the app (right) side by side, same crop, for a visual check.
import sys
from PIL import Image
d, a, out = sys.argv[1:4]
A = Image.open(d).convert("RGB"); B = Image.open(a).convert("RGB")
box = tuple(map(int, sys.argv[4:8])) if len(sys.argv) >= 8 else (0, 0, min(A.width, B.width), min(A.height, B.height))
A = A.crop(box); B = B.crop(box)
C = Image.new("RGB", (A.width * 2 + 10, A.height), (255, 0, 0)); C.paste(A, (0, 0)); C.paste(B, (A.width + 10, 0)); C.save(out)
