import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'

const EXTRACT_TIMEOUT_MS = 180_000

/**
 * PDF asset extraction runs in the doc sandbox — the same vetted image that
 * compiles and renders documents — because the PDF toolchain lives there:
 * poppler's `pdfimages` dumps every embedded image in its native format,
 * pdfplumber supplies each image's placement rects in page points plus the
 * document's font families, and pdftoppm+Pillow sample a dominant-color
 * palette from rendered pages.
 *
 * A transparent image in a PDF is stored as an opaque base image plus a
 * separate alpha mask (`/SMask`), so the base alone carries a baked-in solid
 * background. The script pairs each mask with its base via `pdfimages -list`
 * row adjacency and recomposites them into an RGBA PNG; masks are never
 * shipped as standalone assets.
 *
 * Assets are shipped at presentation resolution: print-dpi originals are
 * downscaled to a 2560px long edge (alpha preserved) and exotic formats
 * (TIFF/JP2) are normalized to PNG/JPEG, so the extracted set stays inside
 * the doc-compile staging budget and re-stages fast on every slide edit.
 * Images already within range keep their original bytes.
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
  /** Font family names used in the document (style suffixes split off). */
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
  /** Font family name, with the PostScript style suffix split off. */
  font: string
  sizePt: number
  colorHex: string | null
  bold?: boolean
  italic?: boolean
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

/** An extracted asset's placement on a page, by its written filename. */
export interface PdfPlacedImage {
  name: string
  xPt: number
  yPt: number
  wPt: number
  hPt: number
}

/** One page's rebuild recipe: what sits where, in which font and color. */
export interface PdfPageLayout {
  page: number
  texts: PdfTextBlock[]
  rects: PdfFilledRect[]
  overlays: PdfOverlay[]
  images: PdfPlacedImage[]
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
alpha_of = {}
prev_image = None
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
        prev_image = num
    elif typ in ("smask", "mask") and prev_image is not None:
        # poppler lists an image's alpha mask on the row directly after it.
        # An smask's luminance IS the alpha; an explicit /Mask paints only
        # where the sample is 0, hence the inversion downstream.
        alpha_of[prev_image] = {"num": num, "invert": typ == "mask"}
        prev_image = None
    else:
        prev_image = None

paths = {}
for path in sorted(glob.glob(outdir + "/asset-*")):
    m = re.search(r"asset-(\\d+)\\.(\\w+)$", path)
    if m:
        paths[int(m.group(1))] = path
files = {num: path for num, path in paths.items() if num in rows}

# A transparent source image arrives as an opaque base plus a separate mask;
# shipping the base alone would bake in a solid background. Recomposite the
# pair into an RGBA PNG (the mask may be stored at a different resolution).
for num, ref in alpha_of.items():
    base_path, mask_path = files.get(num), paths.get(ref["num"])
    if not base_path or not mask_path:
        continue
    try:
        base = Image.open(base_path).convert("RGB")
        mask = Image.open(mask_path).convert("L")
        if ref["invert"]:
            mask = Image.eval(mask, lambda v: 255 - v)
        if mask.size != base.size:
            mask = mask.resize(base.size, Image.BILINEAR)
        base.putalpha(mask)
        out = base_path.rsplit(".", 1)[0] + ".png"
        base.save(out, "PNG")
        if out != base_path:
            os.remove(base_path)
        files[num] = out
    except Exception:
        pass  # undecodable mask: the opaque base still beats losing the asset

# Downscale print-resolution assets and normalize exotic formats. Embedded PDF
# images are often 300-dpi originals several MB each, a slide never shows more
# than ~2560px on the long edge, and every deck compile re-stages the whole
# referenced set — so oversized extractions slow every edit and blow the byte
# staging budget. Images already within range keep their original bytes.
MAX_ASSET_EDGE = 2560
shipped_dims = {}
for num, path in list(files.items()):
    try:
        im = Image.open(path)
        im.load()
    except Exception:
        continue  # undecodable (jbig2/ccitt params etc.): ship as-is
    ext = path.rsplit(".", 1)[1].lower()
    exotic = ext not in ("png", "jpg", "jpeg")
    w, h = im.size
    scale = MAX_ASSET_EDGE / float(max(w, h))
    if scale >= 1 and not exotic:
        continue
    if scale < 1:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
    try:
        if ext in ("jpg", "jpeg") or (exotic and not has_alpha):
            out = path.rsplit(".", 1)[0] + ".jpg"
            im.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
        else:
            out = path.rsplit(".", 1)[0] + ".png"
            im.convert("RGBA" if has_alpha else "RGB").save(out, "PNG", optimize=True)
    except Exception:
        continue  # unencodable: keep the original bytes
    if out != path:
        os.remove(path)
    files[num] = out
    shipped_dims[num] = im.size

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

STYLE_TOKENS = {"bold", "black", "heavy", "light", "medium", "thin", "italic",
                "oblique", "semibold", "demibold", "extrabold", "ultrabold",
                "semi", "demi", "extra", "ultra", "condensed", "cond"}

def parse_font_name(name):
    # PostScript names pack family and style together ("Arial-BoldMT",
    # "MyriadPro-Semibold"). Split them so the rebuild can set a real family
    # plus bold/italic flags instead of asking PowerPoint for a face that
    # does not exist (which silently falls back to a regular weight).
    base = re.sub(r"^[A-Z]{6}\\+", "", name or "")
    parts = re.split(r"[-,_]", base, maxsplit=1)
    probe = parts[1] if len(parts) > 1 else base
    bold = re.search(r"(?i)bold|black|heavy|demi", probe) is not None
    italic = re.search(r"(?i)italic|oblique", probe) is not None
    family = re.sub(r"(?:PS|MT|PSMT)$", "", parts[0])
    family = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", family)
    words = family.split()
    while len(words) > 1 and words[-1].lower() in STYLE_TOKENS:
        words.pop()
    return " ".join(words), bold, italic

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
                family = parse_font_name(name)[0]
                if family:
                    fonts.add(family)
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
            # Side-by-side text boxes share a baseline; a gap much wider than
            # a space means a new box, not a continuation of the same line.
            runs = [[ws[0]]]
            for w in ws[1:]:
                prev = runs[-1][-1]
                gap = float(w["x0"]) - float(prev["x1"])
                if gap > max(2.5 * float(prev.get("size") or 10), 18):
                    runs.append([w])
                else:
                    runs[-1].append(w)
            for run in runs:
                first = run[0]
                color = to_hex(char_color.get((round(first["x0"], 1), round(first["top"], 1))))
                family, bold, italic = parse_font_name(first.get("fontname") or "")
                entry = {
                    "text": " ".join(w["text"] for w in run)[:400],
                    "xPt": round(float(first["x0"]), 2),
                    "yPt": round(float(first["top"]), 2),
                    "wPt": round(float(max(w["x1"] for w in run) - first["x0"]), 2),
                    "hPt": round(float(max(w["bottom"] for w in run) - first["top"]), 2),
                    "font": family,
                    "sizePt": round(float(first.get("size") or 0), 1),
                    "colorHex": color,
                }
                if bold:
                    entry["bold"] = True
                if italic:
                    entry["italic"] = True
                texts.append(entry)
        texts = texts[:80]

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
    dims = shipped_dims.get(num)
    images.append({
        "name": "image%d.%s" % (num, ext),
        "widthPx": dims[0] if dims else row["width"],
        "heightPx": dims[1] if dims else row["height"],
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
  layout?: Array<Omit<PdfPageLayout, 'images'>>
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
  // The sandbox reports placements per asset (asset → pages); the rebuild
  // recipe reads per page, so join each asset's rects onto its page entries.
  const layout = (payload.layout ?? []).map((page) => ({
    ...page,
    images: images.flatMap((image) =>
      image.placements
        .filter((placement) => placement.page === page.page)
        .map(({ xPt, yPt, wPt, hPt }) => ({ name: image.name, xPt, yPt, wPt, hPt }))
    ),
  }))
  return {
    theme,
    media: images.map((image) => ({
      name: image.name,
      bytes: Buffer.from(image.base64, 'base64'),
    })),
    layout,
  }
}
