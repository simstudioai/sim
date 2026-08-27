import { isSimPageSource } from '@/lib/workspace-files/page-compile'

/**
 * A compiled standalone page document carries its own source so a download
 * survives the round trip: the served/downloaded HTML stays a fully styled,
 * self-contained page (tabs, theme toggle, and the TOC rail all work offline),
 * and uploading it back into Sim restores the editable page source instead of
 * freezing the compiled bytes. The source rides base64-encoded inside an inert
 * script block — base64 output cannot contain `</script>`, so no page content
 * can break out of the tag.
 */
const SIM_PAGE_SOURCE_EMBED_TYPE = 'text/x-sim-page-source'

const SIM_PAGE_SOURCE_EMBED_PATTERN =
  /<script type="text\/x-sim-page-source">([A-Za-z0-9+/=\s]*)<\/script>/

/** Renders the inert head block carrying the base64-encoded page source. */
export function simPageSourceEmbedBlock(source: string): string {
  return `<script type="${SIM_PAGE_SOURCE_EMBED_TYPE}">${Buffer.from(source, 'utf8').toString('base64')}</script>`
}

/**
 * Recovers the embedded page source from a compiled standalone document.
 * Returns null when the document carries no embed block, or when the block's
 * bytes are not valid page source — the frontmatter check keeps a crafted or
 * corrupted block from ever registering as a page.
 */
export function extractSimPageSource(documentHtml: string): string | null {
  const match = documentHtml.match(SIM_PAGE_SOURCE_EMBED_PATTERN)
  if (!match) return null
  const source = Buffer.from(match[1].replace(/\s+/g, ''), 'base64').toString('utf8')
  return isSimPageSource(source) ? source : null
}

/** Uploads larger than this skip the page-source sniff. */
export const MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES = 32 * 1024 * 1024

/**
 * An `.html` upload whose bytes are Sim page source — raw source, or a
 * compiled standalone download carrying its embedded source — is stored as a
 * page: the source becomes the stored content and the display name drops
 * `.html` (pages store extensionless), so a downloaded page uploads back as a
 * first-class editable page instead of frozen compiled bytes. Returns null
 * for every other upload.
 */
export function restoreSimPageSourceBuffer(
  name: string,
  buffer: Buffer
): { name: string; buffer: Buffer } | null {
  if (!name.toLowerCase().endsWith('.html')) return null
  if (buffer.length === 0 || buffer.length > MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES) return null
  const text = buffer.toString('utf8')
  const pageName = name.slice(0, -'.html'.length) || name
  if (isSimPageSource(text)) return { name: pageName, buffer }
  const source = extractSimPageSource(text)
  if (source === null) return null
  return { name: pageName, buffer: Buffer.from(source, 'utf8') }
}
