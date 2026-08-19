import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'

const EXTRACT_TIMEOUT_MS = 180_000

/**
 * PDF asset extraction runs in the doc sandbox — the same vetted image that
 * compiles and renders documents — because the PDF toolchain lives there:
 * poppler's `pdfimages` dumps every embedded image in its native format
 * (masks filtered out via `pdfimages -list`), pdfplumber supplies each
 * image's placement rects in page points plus the document's font names, and
 * pdftoppm+Pillow sample a dominant-color palette from rendered pages.
 *
 * Unlike OOXML there is no declared theme in a PDF, so the palette is
 * explicitly labeled inferred; fonts are names only (embedded font files are
 * subsetted and license-restricted).
 */

export interface PdfImagePlacement {
  page: number
  xPt: number
  yPt: number
  wPt: number
  hPt: number
}

export interface ExtractedPdfTheme {
  format: 'pdf'
  fonts: string[]
  pageSize?: { widthPt: number; heightPt: number }
  pageCount: number
  /** Dominant colors sampled from rendered pages — inferred, not declared. */
  inferredPalette: string[]
  /** Per-asset intrinsic size and where each instance sits on its pages. */
  images: Record<string, { widthPx: number; heightPx: number; placements: PdfImagePlacement[] }>
}

export interface ExtractedPdfMedia {
  name: string
  bytes: Buffer
}

export interface PdfTextBlock {
  text: string
  xPt: number
  yPt: number
  wPt: number
  hPt: number
  font: string
  sizePt: number
  colorHex: string | null
}

export interface PdfFilledRect {
  xPt: number
  yPt: number
  wPt: number
  hPt: number
  colorHex: string | null
}

export interface PdfOverlay {
  imageAt: { xPt: number; yPt: number }
  colorHex: string | null
  coverage: number
}

/** One page's rebuild recipe: what sits where, in which font and color. */
export interface PdfPageLayout {
  page: number
  texts: PdfTextBlock[]
  rects: PdfFilledRect[]
  overlays: PdfOverlay[]
}

export interface ExtractedPdfAssets {
  theme: ExtractedPdfTheme
  media: ExtractedPdfMedia[]
  layout: PdfPageLayout[]
}

const SCRIPT = `
import subprocess, glob, json, base64, os, re
import pdfplumber
from PIL import Image

inp = "/home/user/input.pdf"
outdir = "/home/user/assets"
os.makedirs(outdir, exist_ok=True)

# Embedded images, native formats. No -p flag so filenames are asset-NNN.ext
# with NNN matching the -list "num" column exactly.
subprocess.run(["pdfimages", "-all", inp, outdir + "/asset"],
               check=True, timeout=120, capture_output=True)
listing = subprocess.run(["pdfimages", "-list", inp],
                         check=True, timeout=60, capture_output=True, text=True).stdout
rows = {}
for line in listing.splitlines()[2:]:
    parts = line.split()
    if len(parts) < 5:
        continue
    try:
        page, num, typ, w, h = int(parts[0]), int(parts[1]), parts[2], int(parts[3]), int(parts[4])
    except ValueError:
        continue
    if typ == "image":
        rows[num] = {"page": page, "width": w, "height": h}

files = {}
for path in sorted(glob.glob(outdir + "/asset-*")):
    m = re.search(r"asset-(\\d+)\\.(\\w+)$", path)
    if not m:
        continue
    num = int(m.group(1))
    if num in rows:
        files[num] = path

def to_hex(color):
    if color is None:
        return None
    vals = list(color) if isinstance(color, (tuple, list)) else [color]
    try:
        if len(vals) == 1:
            r = g = b = float(vals[0])
        elif len(vals) == 3:
            r, g, b = (float(v) for v in vals)
        elif len(vals) == 4:
            c, m, y, k = (float(v) for v in vals)
            r, g, b = (1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)
        else:
            return None
    except (TypeError, ValueError):
        return None
    f = lambda v: max(0, min(255, int(round(v * 255))))
    return "%02X%02X%02X" % (f(r), f(g), f(b))

fonts = set()
placements = []
page_size = None
layout = []
with pdfplumber.open(inp) as pdf:
    page_count = len(pdf.pages)
    if pdf.pages:
        p0 = pdf.pages[0]
        page_size = {"widthPt": round(float(p0.width), 2), "heightPt": round(float(p0.height), 2)}
    for pi, page in enumerate(pdf.pages[:100], start=1):
        char_color = {}
        for ch in page.chars[:8000]:
            name = ch.get("fontname") or ""
            if name:
                fonts.add(re.sub(r"^[A-Z]{6}\\+", "", name))
            char_color[(round(ch["x0"], 1), round(ch["top"], 1))] = ch.get("non_stroking_color")
        page_images = []
        for im in page.images:
            src = im.get("srcsize") or (0, 0)
            entry = {
                "page": pi,
                "xPt": round(float(im["x0"]), 2),
                "yPt": round(float(im["top"]), 2),
                "wPt": round(float(im["x1"] - im["x0"]), 2),
                "hPt": round(float(im["bottom"] - im["top"]), 2),
                "srcW": int(src[0] or 0),
                "srcH": int(src[1] or 0),
            }
            placements.append(entry)
            page_images.append(entry)

        # Text blocks: words grouped into lines, each line carrying its font,
        # size, and fill color — the recipe for what text sits where.
        words = page.extract_words(extra_attrs=["fontname", "size"])[:800]
        lines = {}
        for w in words:
            lines.setdefault(round(w["top"] / 2), []).append(w)
        texts = []
        for key in sorted(lines):
            ws = sorted(lines[key], key=lambda w: w["x0"])
            first = ws[0]
            color = to_hex(char_color.get((round(first["x0"], 1), round(first["top"], 1))))
            texts.append({
                "text": " ".join(w["text"] for w in ws)[:400],
                "xPt": round(float(first["x0"]), 2),
                "yPt": round(float(first["top"]), 2),
                "wPt": round(float(max(w["x1"] for w in ws) - first["x0"]), 2),
                "hPt": round(float(max(w["bottom"] for w in ws) - first["top"]), 2),
                "font": re.sub(r"^[A-Z]{6}\\+", "", first.get("fontname") or ""),
                "sizePt": round(float(first.get("size") or 0), 1),
                "colorHex": color,
            })
        texts = texts[:60]

        # Filled rects: backgrounds and the scrims decks lay over photos.
        rects = []
        for r in page.rects[:80]:
            if not r.get("fill"):
                continue
            rects.append({
                "xPt": round(float(r["x0"]), 2),
                "yPt": round(float(r["top"]), 2),
                "wPt": round(float(r["x1"] - r["x0"]), 2),
                "hPt": round(float(r["bottom"] - r["top"]), 2),
                "colorHex": to_hex(r.get("non_stroking_color")),
            })
        rects = rects[:40]

        # A rect covering most of an image is an overlay scrim — the "image
        # opacity" effect. Alpha is not recoverable from the stream, so the
        # renderer's page image is the reference for how strong it looks.
        overlays = []
        for r in rects:
            for im in page_images:
                ix0, iy0 = im["xPt"], im["yPt"]
                ix1, iy1 = ix0 + im["wPt"], iy0 + im["hPt"]
                rx0, ry0 = r["xPt"], r["yPt"]
                rx1, ry1 = rx0 + r["wPt"], ry0 + r["hPt"]
                inter = max(0, min(ix1, rx1) - max(ix0, rx0)) * max(0, min(iy1, ry1) - max(iy0, ry0))
                area = im["wPt"] * im["hPt"]
                if area > 0 and inter / area >= 0.5:
                    overlays.append({
                        "imageAt": {"xPt": ix0, "yPt": iy0},
                        "colorHex": r["colorHex"],
                        "coverage": round(inter / area, 2),
                    })
        layout.append({"page": pi, "texts": texts, "rects": rects, "overlays": overlays})

# Inferred palette: quantized dominant colors over up to 3 rendered pages.
palette = []
try:
    subprocess.run(["pdftoppm", "-jpeg", "-r", "50", "-f", "1", "-l", "3", inp, "/home/user/pal"],
                   check=True, timeout=60, capture_output=True)
    counts = {}
    for p in glob.glob("/home/user/pal*.jpg"):
        im = Image.open(p).convert("RGB").resize((120, 120))
        for c, rgb in im.getcolors(120 * 120) or []:
            q = tuple(v // 32 * 32 for v in rgb)
            counts[q] = counts.get(q, 0) + c
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    palette = ["%02X%02X%02X" % k for k, _ in top]
except Exception:
    palette = []

MAX_FILE = 15 * 1024 * 1024
MAX_TOTAL = 60 * 1024 * 1024
total = 0
images = []
for num, path in sorted(files.items()):
    size = os.path.getsize(path)
    if size == 0 or size > MAX_FILE or total + size > MAX_TOTAL:
        continue
    total += size
    row = rows[num]
    ext = path.rsplit(".", 1)[1]
    pls = [
        {k: p[k] for k in ("page", "xPt", "yPt", "wPt", "hPt")}
        for p in placements
        if p["page"] == row["page"] and (
            (p["srcW"] == row["width"] and p["srcH"] == row["height"]) or not p["srcW"]
        )
    ]
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    images.append({
        "name": "image%d.%s" % (num, ext),
        "widthPx": row["width"],
        "heightPx": row["height"],
        "placements": pls,
        "base64": data,
    })

print("__SIM_RESULT__=" + json.dumps({
    "fonts": sorted(f for f in fonts if f),
    "pageSize": page_size,
    "pageCount": page_count,
    "inferredPalette": palette,
    "images": images,
    "layout": layout,
}))
`.trim()

interface SandboxPdfImage {
  name: string
  widthPx: number
  heightPx: number
  placements: PdfImagePlacement[]
  base64: string
}

interface SandboxPdfResult {
  fonts?: string[]
  pageSize?: { widthPt: number; heightPt: number } | null
  pageCount?: number
  inferredPalette?: string[]
  images?: SandboxPdfImage[]
  layout?: PdfPageLayout[]
}

export async function extractPdfAssets(binary: Buffer): Promise<ExtractedPdfAssets> {
  const result = await executeInSandbox({
    code: SCRIPT,
    language: CodeLanguage.Python,
    timeoutMs: EXTRACT_TIMEOUT_MS,
    sandboxKind: 'doc',
    sandboxFiles: [
      { path: '/home/user/input.pdf', content: binary.toString('base64'), encoding: 'base64' },
    ],
  })
  if (result.error) {
    throw new Error(`PDF asset extraction failed: ${result.error}`)
  }
  const payload = (result.result ?? {}) as SandboxPdfResult
  const images = payload.images ?? []
  const theme: ExtractedPdfTheme = {
    format: 'pdf',
    fonts: payload.fonts ?? [],
    pageSize: payload.pageSize ?? undefined,
    pageCount: payload.pageCount ?? 0,
    inferredPalette: payload.inferredPalette ?? [],
    images: Object.fromEntries(
      images.map((image) => [
        image.name,
        { widthPx: image.widthPx, heightPx: image.heightPx, placements: image.placements },
      ])
    ),
  }
  return {
    theme,
    media: images.map((image) => ({
      name: image.name,
      bytes: Buffer.from(image.base64, 'base64'),
    })),
    layout: payload.layout ?? [],
  }
}
