import { JSON_SCHEMA, load } from 'js-yaml'
import { marked } from 'marked'
import { z } from 'zod'

/**
 * Compiler for agent-authored `.html` pages.
 *
 * The stored `.html` file holds the agent's SOURCE — YAML frontmatter, GFM
 * prose, and `sim:` fences — the way a `.pdf` file stores its generating
 * script. Rendering surfaces (the preview panel, the share view, download)
 * call {@link compileSimPage} to produce the complete docs-styled HTML
 * document on demand. The source is never mutated at write time, so agent
 * appends stay plain concatenation and the raw editor view IS the source
 * view, mirroring the pdf source/rendered duality.
 *
 * Content starting `<!DOCTYPE`/`<html` is a bespoke page and passes through
 * every surface untouched — except a hand-written imitation of compiled
 * output, which {@link isHandWrittenCompiledPage} rejects at write time.
 */

/**
 * The retired write-time compiler's signature. New compiles no longer emit
 * it, but legacy stored-compiled files carry it and an agent copying one
 * would too — it stays recognized purely to reject imitations.
 */
export const SIM_PAGE_MARKER = '<!--sim-page-->'

const frontmatterSchema = z.object({
  title: z.string().min(1),
  eyebrow: z.string().optional(),
  lede: z.string().optional(),
  layout: z.enum(['docs', 'report']).optional(),
  /** Docs-style footer pagination: a markdown link — `[Title](sim:file/<id>)`. */
  prev: z.string().optional(),
  next: z.string().optional(),
})

const MD_LINK = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/

/** Renders one footer pagination card from a frontmatter `[Title](href)` link. */
function paginationCard(value: string, direction: 'prev' | 'next'): string {
  const match = value.match(MD_LINK)
  if (!match) return ''
  const [, title, href] = match
  const label = direction === 'prev' ? '← Previous' : 'Next →'
  return `<a class="page-nav-card ${direction}" href="${escapeHtml(href)}"><span class="page-nav-dir">${label}</span><span class="page-nav-title">${escapeHtml(title)}</span></a>`
}

/** YAML leaves unquoted scalars typed; reject null/objects rather than stringify them. */
const textCell = z.union([z.string(), z.number(), z.boolean()]).transform((value) => String(value))

const tablePayloadSchema = z.object({
  columns: z
    .array(
      z.union([
        textCell.transform((header) =>
          header.endsWith(':num')
            ? { header: header.slice(0, -4), align: 'num' as const }
            : { header, align: 'text' as const }
        ),
        z.object({ header: textCell, align: z.enum(['text', 'num']).optional() }),
      ])
    )
    .min(1),
  rows: z.array(z.array(textCell)).min(1),
})
const kvItemsSchema = z.array(z.object({ key: textCell, value: textCell })).min(1)
const accordionItemsSchema = z
  .array(
    z
      .object({ q: textCell.optional(), title: textCell.optional(), markdown: textCell })
      .refine((item) => item.q !== undefined || item.title !== undefined, {
        message: 'each item needs a q or title',
      })
  )
  .min(1)

const FENCE_OPEN = /^```(\S*)[ \t]*(.*)$/

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { gfm: true, async: false }) as string
}

/**
 * Inline markdown for structured-block text (table cells, kv values, faq
 * questions): links, `code`, and emphasis render; raw HTML stays escaped
 * because the text is escaped BEFORE the inline pass.
 */
function renderInlineMarkdown(text: string): string {
  return marked.parseInline(escapeHtml(text), { gfm: true, async: false }) as string
}

const SIM_RESOURCE_ROUTES: Record<string, (workspaceId: string, id: string) => string> = {
  workflow: (workspaceId, id) => `/workspace/${workspaceId}/w/${id}`,
  table: (workspaceId, id) => `/workspace/${workspaceId}/tables/${id}`,
  knowledge: (workspaceId, id) => `/workspace/${workspaceId}/knowledge/${id}`,
  file: (workspaceId, id) => `/workspace/${workspaceId}/files/${id}/view`,
}

/**
 * Rewrites `sim:` resource links (`[Name](sim:workflow/<id>)` in source) into
 * real workspace routes. Applied when the rendering surface knows its
 * workspace; without one the sim: hrefs stay put and render inert.
 * `data-sim-link` marks them so the preview sandbox can bridge clicks to the
 * app router instead of cancelling them.
 */
export function resolveSimResourceLinks(html: string, workspaceId: string): string {
  return html.replace(
    /href="sim:(workflow|table|knowledge|file)\/([^"]+)"/g,
    (match, type: string, id: string) => {
      const route = SIM_RESOURCE_ROUTES[type]
      return route ? `href="${route(workspaceId, id)}" data-sim-link=""` : match
    }
  )
}

function loadYaml(body: string): unknown {
  return load(body, { schema: JSON_SCHEMA })
}

type FenceRenderer = (payload: unknown) => string | null

const FENCE_RENDERERS: Record<string, FenceRenderer> = {
  table: (payload) => {
    const parsed = tablePayloadSchema.safeParse(payload)
    if (!parsed.success) return null
    const { columns, rows } = parsed.data
    const head = columns
      .map(
        (column) =>
          `<th${column.align === 'num' ? ' class="num"' : ''}>${escapeHtml(column.header)}</th>`
      )
      .join('')
    const body = rows
      .map(
        (row) =>
          `<tr>${row
            .map(
              (cell, index) =>
                `<td${columns[index]?.align === 'num' ? ' class="num"' : ''}>${renderInlineMarkdown(cell)}</td>`
            )
            .join('')}</tr>`
      )
      .join('')
    return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  },
  kv: (payload) => {
    const parsed = kvItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const rows = parsed.data
      .map(
        (item) =>
          `<li><span class="key">${escapeHtml(item.key)}</span><span>${renderInlineMarkdown(item.value)}</span></li>`
      )
      .join('')
    return `<ul class="rows">${rows}</ul>`
  },
  faq: renderAccordion,
  accordion: renderAccordion,
}

/** `sim:faq` and `sim:accordion` share the docs' expandable-rows treatment. */
function renderAccordion(payload: unknown): string | null {
  const parsed = accordionItemsSchema.safeParse(payload)
  if (!parsed.success) return null
  const items = parsed.data
    .map(
      (item) =>
        `<details><summary>${renderInlineMarkdown(item.q ?? item.title ?? '')}</summary>${renderMarkdown(item.markdown)}</details>`
    )
    .join('')
  return `<div class="faq">${items}</div>`
}

export const HAND_WRITTEN_PAGE_MESSAGE =
  'Rejected: this content imitates the compiled page output (hand-written page HTML). Never write the page HTML yourself. Write page SOURCE instead — YAML frontmatter with a title, markdown prose, and sim: fences — and Sim renders it as the styled page. Raw HTML is only for a bespoke one-off page that carries its own complete inline <style>.'

/**
 * True when agent-authored content imitates the compiler's OUTPUT instead of
 * being page source or a genuine bespoke page. The marker is the retired
 * write-time compiler's signature — nothing may hand-write it — and an
 * artifact-opted page without its own <style> can only have been copied from
 * compiled output, since a bespoke page must carry its styles inline to
 * render in the sandbox.
 */
export function isHandWrittenCompiledPage(content: string): boolean {
  if (content.includes(SIM_PAGE_MARKER)) return true
  const trimmed = content.trimStart()
  if (!/^<!doctype\b/i.test(trimmed) && !/^<html\b/i.test(trimmed)) return false
  return /<meta\s+name=["']sim-artifact["']/i.test(content) && !/<style[\s>]/i.test(content)
}

/**
 * True when `.html` content is Sim page source: it announces itself with
 * YAML frontmatter carrying a valid title. Raw HTML (bespoke pages and
 * legacy stored-compiled files) returns false and renders as-is.
 */
export function isSimPageSource(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---\n')) return false
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return false
  try {
    return frontmatterSchema.safeParse(loadYaml(trimmed.slice(4, end)) ?? {}).success
  } catch {
    return false
  }
}

/** Compiles the body portion — prose, fences — of the source. */
function compileBody(source: string): string {
  const lines = source.split('\n')
  const html: string[] = []
  let prose: string[] = []
  const flushProse = () => {
    const markdown = prose.join('\n').trim()
    prose = []
    if (markdown) html.push(renderMarkdown(markdown))
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const fence = line.match(FENCE_OPEN)
    if (fence?.[1].startsWith('sim:')) {
      const kind = fence[1].slice(4)
      const caption = fence[2].trim()
      const bodyStart = index + 1
      let bodyEnd = bodyStart
      while (bodyEnd < lines.length && !lines[bodyEnd].startsWith('```')) bodyEnd++
      const body = lines.slice(bodyStart, bodyEnd).join('\n')
      flushProse()

      if (kind === 'callout') {
        if (body.trim()) html.push(`<div class="callout">${renderMarkdown(body.trim())}</div>`)
      } else if (kind === 'diagram') {
        if (/^\s*<svg[\s>]/i.test(body)) {
          const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
          html.push(`<figure>${body.trim()}${figcaption}</figure>`)
        } else {
          html.push(
            `<div class="callout"><p>A diagram block was skipped: its body must be a complete <code>&lt;svg&gt;</code> element.</p></div>`
          )
        }
      } else {
        const renderer = FENCE_RENDERERS[kind]
        let payload: unknown
        let rendered: string | null = null
        if (renderer) {
          try {
            payload = loadYaml(body)
            rendered = renderer(payload)
          } catch {
            rendered = null
          }
        }
        // A malformed block becomes a visible notice rather than vanishing —
        // the author reads the page, not a log.
        html.push(
          rendered ??
            `<div class="callout"><p>A <code>sim:${escapeHtml(kind)}</code> block was skipped: its payload did not match the expected shape.</p></div>`
        )
      }
      index = bodyEnd + 1
      continue
    }
    prose.push(line)
    index++
  }
  flushProse()
  return html.join('\n')
}

/**
 * Compiles page source into the complete HTML document a rendering surface
 * serves. Pure and stateless — the same call backs the live preview, the
 * share view, and download, so all three always agree. When the surface
 * knows its workspace, `sim:` resource links resolve to real routes.
 */
export function compileSimPage(source: string, options?: { workspaceId?: string }): string {
  // Workspace images (`![alt](sim:file/<id>)`) resolve to the authed byte
  // route regardless of surface; deep links additionally need the workspace.
  const compiled = compileSimPageDocument(source)
    .replace(/src="sim:file\/([^"]+)"/g, 'src="/api/files/view/$1"')
    // External links leave the page in a new tab on every surface; in the
    // sandboxed preview the bootstrap bridges the click to the host instead.
    .replace(
      /<a href="(https?:\/\/[^"]+)"/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer"'
    )
  return options?.workspaceId ? resolveSimResourceLinks(compiled, options.workspaceId) : compiled
}

function compileSimPageDocument(source: string): string {
  const trimmed = source.trimStart()
  const end = trimmed.indexOf('\n---', 3)
  const frontmatterText = trimmed.slice(4, end)
  const rest = trimmed.slice(end + 4).replace(/^-*\n?/, '')
  let meta: z.infer<typeof frontmatterSchema>
  try {
    meta = frontmatterSchema.parse(loadYaml(frontmatterText) ?? {})
  } catch {
    // isSimPageSource gates on parseable frontmatter; this is a safety net.
    return compileBody(source)
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="sim-artifact">',
    `<title>${escapeHtml(meta.title)}</title>`,
    '</head>',
    '<body>',
    `<div class="page" data-layout="${meta.layout ?? 'docs'}">`,
    ...(meta.eyebrow ? [`<p class="eyebrow">${escapeHtml(meta.eyebrow)}</p>`] : []),
    `<h1>${escapeHtml(meta.title)}</h1>`,
    ...(meta.lede ? [`<p class="lede">${escapeHtml(meta.lede)}</p>`] : []),
    compileBody(rest),
    ...(() => {
      const cards = [
        meta.prev ? paginationCard(meta.prev, 'prev') : '',
        meta.next ? paginationCard(meta.next, 'next') : '',
      ]
        .filter(Boolean)
        .join('')
      return cards ? [`<footer class="page-nav">${cards}</footer>`] : []
    })(),
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}
