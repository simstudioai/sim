import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'

const RENDER_TIMEOUT_MS = 150_000
// Bound the visual-QA cost: cap pages and rasterization DPI so the JPEGs the
// file agent inspects stay small enough for vision input.
const MAX_RENDER_PAGES = 20
const RENDER_DPI = 110

/** Extensions LibreOffice can render to page images for the visual QA loop. */
const RENDERABLE_EXTS = new Set(['pptx', 'docx', 'pdf'])

export function isRenderableDocExt(ext: string): boolean {
  return RENDERABLE_EXTS.has(ext.toLowerCase())
}

export interface DocRender {
  /** A single contact-sheet grid JPEG of all pages, for the agent's visual QA. */
  grid: Buffer
  pageCount: number
}

/**
 * Renders a compiled document binary to a single contact-sheet grid image inside
 * the E2B doc sandbox (LibreOffice → PDF → poppler `pdftoppm` → Pillow tile).
 * Works for any compiled binary regardless of which engine produced it
 * (isolated-vm JS or E2B Python), so the visual QA loop covers pptx/docx/pdf
 * uniformly. One grid image fits the VFS single-attachment read and gives the
 * agent the whole deck/doc at a glance (mirrors Anthropic's thumbnail grid).
 *
 * Throws on a sandbox/infra failure or when the doc renders to zero pages.
 */
export async function renderDocToGrid(args: {
  binary: Buffer
  ext: string
  workspaceId: string
}): Promise<DocRender> {
  const ext = args.ext.toLowerCase()
  if (!isRenderableDocExt(ext)) {
    throw new Error(`Cannot render .${ext} to images (supported: pptx, docx, pdf)`)
  }

  const script = `
import subprocess, glob, base64, json
from PIL import Image

ext = ${JSON.stringify(ext)}
inp = f"/home/user/input.{ext}"
pdf = inp if ext == "pdf" else "/home/user/input.pdf"

if ext != "pdf":
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", "/home/user", inp],
        check=True, timeout=120, capture_output=True,
    )

subprocess.run(
    ["pdftoppm", "-jpeg", "-r", "${RENDER_DPI}", "-l", "${MAX_RENDER_PAGES}", pdf, "/home/user/page"],
    check=True, timeout=120, capture_output=True,
)

paths = sorted(glob.glob("/home/user/page*.jpg"))[:${MAX_RENDER_PAGES}]
imgs = [Image.open(p).convert("RGB") for p in paths]
n = len(imgs)
if n == 0:
    print("__SIM_RESULT__=" + json.dumps({"grid": None, "pageCount": 0}))
else:
    cols = 1 if n == 1 else (2 if n <= 6 else 3)
    rows = (n + cols - 1) // cols
    cell_w = max(i.width for i in imgs)
    cell_h = max(i.height for i in imgs)
    pad = 12
    grid = Image.new("RGB", (cols * cell_w + (cols + 1) * pad, rows * cell_h + (rows + 1) * pad), (240, 240, 240))
    for idx, im in enumerate(imgs):
        r, c = divmod(idx, cols)
        grid.paste(im, (pad + c * (cell_w + pad), pad + r * (cell_h + pad)))
    # Cap the grid's longest edge so the JPEG stays a reasonable vision input.
    max_edge = 2200
    if max(grid.size) > max_edge:
        scale = max_edge / max(grid.size)
        grid = grid.resize((int(grid.width * scale), int(grid.height * scale)))
    grid.save("/home/user/grid.jpg", "JPEG", quality=80)
    with open("/home/user/grid.jpg", "rb") as f:
        print("__SIM_RESULT__=" + json.dumps({"grid": base64.b64encode(f.read()).decode(), "pageCount": n}))
`.trim()

  const result = await executeInSandbox({
    code: script,
    language: CodeLanguage.Python,
    timeoutMs: RENDER_TIMEOUT_MS,
    sandboxKind: 'doc',
    sandboxFiles: [
      {
        path: `/home/user/input.${ext}`,
        content: args.binary.toString('base64'),
        encoding: 'base64',
      },
    ],
  })

  if (result.error) {
    throw new Error(`Document render failed: ${result.error}`)
  }
  const payload = result.result as { grid?: string | null; pageCount?: number } | null
  if (!payload?.grid) {
    throw new Error('Document render produced no pages')
  }
  return { grid: Buffer.from(payload.grid, 'base64'), pageCount: payload.pageCount ?? 0 }
}
