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

export interface ExtractedPdfAssets {
  theme: ExtractedPdfTheme
  media: ExtractedPdfMedia[]
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

fonts = set()
placements = []
page_size = None
with pdfplumber.open(inp) as pdf:
    page_count = len(pdf.pages)
    if pdf.pages:
        p0 = pdf.pages[0]
        page_size = {"widthPt": round(float(p0.width), 2), "heightPt": round(float(p0.height), 2)}
    for pi, page in enumerate(pdf.pages[:100], start=1):
        for ch in page.chars[:8000]:
            name = ch.get("fontname") or ""
            if name:
                fonts.add(re.sub(r"^[A-Z]{6}\\+", "", name))
        for im in page.images:
            src = im.get("srcsize") or (0, 0)
            placements.append({
                "page": pi,
                "xPt": round(float(im["x0"]), 2),
                "yPt": round(float(im["top"]), 2),
                "wPt": round(float(im["x1"] - im["x0"]), 2),
                "hPt": round(float(im["bottom"] - im["top"]), 2),
                "srcW": int(src[0] or 0),
                "srcH": int(src[1] or 0),
            })

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
  }
}
