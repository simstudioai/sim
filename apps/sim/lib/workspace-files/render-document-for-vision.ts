import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'
import { MAX_WORKSPACE_FORMDATA_FILE_SIZE } from '@/lib/uploads/shared/types'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { MAX_VISION_OUTPUT_BYTES, readSandboxJpeg } from '@/lib/workspace-files/vision-output'

const MAX_PAGES = 20
const pageResultSchema = z.object({
  first: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  last: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  total: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})

function requestedPages(pages?: string): { first: number; last: number } | undefined {
  if (pages === undefined) return undefined
  const match = /^(\d+)(?:-(\d+))?$/.exec(pages.trim())
  if (!match)
    throw new OrchestrationError('validation', 'Pages must be a page number or range, such as 2-5')
  const first = Number(match[1])
  const last = Number(match[2] ?? match[1])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) {
    throw new OrchestrationError('validation', 'Pages must be a valid positive page range')
  }
  if (last - first + 1 > MAX_PAGES) {
    throw new OrchestrationError('validation', 'Select at most 20 pages per read')
  }
  return { first, last }
}

/** Resolve an explicit range, or the first bounded preview, against the actual document size. */
export function resolveDocumentPages(total: number, pages?: string) {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new OrchestrationError('validation', 'Document has no readable pages')
  }
  const range = requestedPages(pages) ?? { first: 1, last: Math.min(total, MAX_PAGES) }
  if (range.last > total) {
    throw new OrchestrationError('validation', `Page range exceeds the document's ${total} pages`)
  }
  return { ...range, total }
}

/** Render authorized compiled document bytes as a JPEG contact sheet in the document sandbox. */
export async function renderDocumentForVision(
  buffer: Buffer,
  mimeType: string,
  name: string,
  pages?: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const type = resolveEffectiveMimeType(mimeType, name).toLowerCase()
  const ext =
    type === 'application/pdf'
      ? 'pdf'
      : type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ? 'docx'
        : type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          ? 'pptx'
          : undefined
  if (!ext)
    throw new OrchestrationError('validation', 'Document rendering supports PDF, DOCX, and PPTX')
  if (!buffer.length) throw new OrchestrationError('validation', 'Document is empty')
  if (buffer.length > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
    throw new OrchestrationError('payload_too_large', 'Document exceeds the 100 MB render limit')
  }
  const range = requestedPages(pages)
  const code = `import subprocess, glob, json, re, os
from PIL import Image, ImageDraw
ext = ${JSON.stringify(ext)}
requested = ${JSON.stringify(range ? [range.first, range.last] : [])}
inp = "/home/user/input." + ext
pdf = inp if ext == "pdf" else "/home/user/input.pdf"
if ext != "pdf":
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", "/home/user", inp], check=True, timeout=90, capture_output=True)
info = subprocess.run(["pdfinfo", pdf], check=True, timeout=15, capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"}).stdout
match = re.search(r"^Pages:\\s+(\\d+)\\s*$", info, re.MULTILINE)
if not match:
    raise ValueError("Document page count unavailable")
total = int(match.group(1))
first, last = requested if requested else (1, min(total, 20))
if total < 1 or first < 1 or last < first or last > total or last - first + 1 > 20:
    print("__SIM_RESULT__=" + json.dumps({"first": first, "last": last, "total": total}))
else:
    subprocess.run(["pdftoppm", "-jpeg", "-r", "110", "-scale-to", "1200", "-f", str(first), "-l", str(last), pdf, "/home/user/page"], check=True, timeout=90, capture_output=True)
    paths = sorted(glob.glob("/home/user/page-*.jpg"), key=lambda path: int(re.search(r"-(\\d+)\\.jpg$", path).group(1)))
    n = last - first + 1
    if len(paths) != n:
        raise ValueError("Document renderer returned an incomplete page range")
    cols = 1 if n == 1 else (2 if n <= 6 else 3)
    rows = (n + cols - 1) // cols
    sizes = []
    for path in paths:
        with Image.open(path) as page:
            sizes.append(page.size)
    cell_w = min(max(size[0] for size in sizes) + 16, 2200 // cols)
    cell_h = min(max(size[1] for size in sizes) + 32, 2200 // rows)
    grid = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(grid)
    for idx, path in enumerate(paths):
        with Image.open(path) as page:
            page.thumbnail((cell_w - 16, cell_h - 32))
            row, col = divmod(idx, cols)
            grid.paste(page.convert("RGB"), (col * cell_w + 8, row * cell_h + 24))
            draw.text((col * cell_w + 8, row * cell_h + 8), "Page " + str(first + idx), fill="black")
    grid.save("/home/user/rendered/grid.jpg", "JPEG", quality=80)
    if os.path.getsize("/home/user/rendered/grid.jpg") > ${MAX_VISION_OUTPUT_BYTES}:
        raise ValueError("Rendered image exceeds 5 MB")
    print("__SIM_RESULT__=" + json.dumps({"first": first, "last": last, "total": total}))`
  const result = await executeInSandbox({
    code,
    language: CodeLanguage.Python,
    timeoutMs: 150_000,
    sandboxKind: 'doc',
    signal,
    sandboxFiles: [
      { path: `/home/user/input.${ext}`, content: buffer.toString('base64'), encoding: 'base64' },
    ],
    outputSandboxDir: '/home/user/rendered',
  })
  signal?.throwIfAborted()
  if (result.error) throw new OrchestrationError('validation', 'Document could not be rendered')
  const parsed = pageResultSchema.safeParse(result.result)
  if (!parsed.success)
    throw new OrchestrationError(
      'validation',
      'Document renderer returned invalid page information'
    )
  const resolved = resolveDocumentPages(parsed.data.total, pages)
  if (resolved.first !== parsed.data.first || resolved.last !== parsed.data.last) {
    throw new OrchestrationError('validation', 'Document renderer returned the wrong page range')
  }
  const image = await readSandboxJpeg(
    result.collectedFiles?.find((file) => file.relativePath === 'grid.jpg')?.contentBase64
  )
  signal?.throwIfAborted()
  return {
    buffer: image,
    mediaType: 'image/jpeg' as const,
    ...resolved,
  }
}
