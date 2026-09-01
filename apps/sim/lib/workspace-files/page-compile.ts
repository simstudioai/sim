import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { JSON_SCHEMA, load } from 'js-yaml'
import { marked } from 'marked'
import { z } from 'zod'
import {
  createYamlExpansionBudget,
  isYamlExpansionBudgetExhausted,
  measureYamlExpansion,
  type YamlExpansionBudget,
  type YamlExpansionLimits,
} from '@/lib/file-parsers/yaml-limits'

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

/**
 * The INTERNAL content type stamped onto a page file's record when the write
 * path detects page source. The file stays `.html` to the user (serving and
 * downloads emit text/html); the record type is how surfaces know the file's
 * nature before any content loads — force the rendered view, hide the code
 * toggle, expect source.
 */
export const SIM_PAGE_CONTENT_TYPE = 'text/x-sim-page'

const frontmatterSchema = z.object({
  title: z.string().min(1),
  /** Tolerated for old sources; no longer rendered — the docs have no eyebrow. */
  eyebrow: z.string().optional(),
  lede: z.string().optional(),
  layout: z.enum(['docs', 'report']).optional(),
  /** Tolerated for old sources; no longer rendered — sets navigate by tabs. */
  prev: z.string().optional(),
  next: z.string().optional(),
  /**
   * Multi-page set navigation, the docs' top tab row: every page of a set
   * carries the SAME ordered list. Each entry is a markdown link
   * (`"[API Reference](sim:file/<id>)"`) to a sibling page; the CURRENT
   * page's entry is its bare label (`"Overview"`), rendered as the active
   * tab. The row scrolls horizontally when the set outgrows the column.
   */
  tabs: z.array(z.string()).min(1).optional(),
  /**
   * The SET's sidebar, docs-style: groups of pages under muted labels. Each
   * page entry is a markdown link; every page of a set carries the same nav.
   */
  /** Tolerated for old sources; no longer rendered — there is no sidebar. */
  nav: z
    .array(
      z.object({
        label: z.string().optional(),
        pages: z.array(z.string()).min(1),
      })
    )
    .optional(),
})

/**
 * The set navigation as real (hidden) markup, so sim: hrefs resolve through
 * the normal link pass and the shell can lift it into the left rail —
 * grouped page links with the current page's sections nested beneath it.
 */

const MD_LINK = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/

/**
 * The set's tab row above the title — the docs' own top tabs: linked entries
 * navigate to sibling pages, the bare-label entry IS this page and renders as
 * the active tab. sim: hrefs resolve through the normal link pass.
 */
function tabBar(tabs: string[] | undefined): string {
  if (!tabs || tabs.length === 0) return ''
  const items = tabs
    .map((entry) => {
      const match = entry.match(MD_LINK)
      if (match) {
        return `<a class="page-tab" href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`
      }
      return `<span class="page-tab is-active">${escapeHtml(entry.trim())}</span>`
    })
    .join('')
  return `<nav class="page-tabs" aria-label="Pages">${items}</nav>`
}

interface DocTab {
  title: string
  body: string
}

/**
 * Splits a page body at top-level `# ` headings — each starts an in-document
 * tab. Fence contents are opaque: a `# ` line inside a ``` or ~~~ block stays
 * content. With fewer than two headings the body is not tabbed at all, so a
 * stray single H1 never eats content.
 */
function splitDocTabs(body: string): { intro: string; tabs: DocTab[] } {
  const intro: string[] = []
  const tabs: Array<{ title: string; lines: string[] }> = []
  let fenceChar: string | null = null
  for (const line of body.split('\n')) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const char = fence[1][0]
      if (!fenceChar) fenceChar = char
      else if (char === fenceChar) fenceChar = null
    }
    const heading = fenceChar ? null : line.match(/^# +(.+?)\s*$/)
    if (heading) {
      tabs.push({ title: heading[1], lines: [] })
      continue
    }
    ;(tabs.length > 0 ? tabs[tabs.length - 1].lines : intro).push(line)
  }
  return {
    intro: intro.join('\n'),
    tabs: tabs.map((tab) => ({ title: tab.title, body: tab.lines.join('\n') })),
  }
}

/** The in-document tab row — same chrome as the set tab bar, but buttons. */
function docTabBar(tabs: DocTab[]): string {
  const items = tabs
    .map(
      (tab, i) =>
        `<button type="button" class="page-tab${i === 0 ? ' is-active' : ''}" data-tab-target="doc-tab-${i}">${escapeHtml(tab.title)}</button>`
    )
    .join('')
  return `<nav class="page-tabs" data-doc-tabs aria-label="Pages">${items}</nav>`
}

/**
 * The in-document tab switcher: toggles panels and announces the change. The
 * shell rebuilds its "On this page" rail from the newly active panel on the
 * sim-tab-change event, so each tab reads as its own page.
 */
const DOC_TABS_SCRIPT = `<script>
(() => {
  const tabs = [...document.querySelectorAll('[data-doc-tabs] .page-tab')]
  const panels = [...document.querySelectorAll('[data-tab-panel]')]
  if (tabs.length === 0) return
  const activate = (target) => {
    for (const t of tabs) t.classList.toggle('is-active', t.dataset.tabTarget === target)
    for (const p of panels) p.classList.toggle('is-active', p.id === target)
    window.scrollTo({ top: 0 })
    document.dispatchEvent(new Event('sim-tab-change'))
  }
  for (const t of tabs) t.addEventListener('click', () => activate(t.dataset.tabTarget))
})()
</script>`

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
const stepsItemsSchema = z
  .array(z.object({ title: textCell, markdown: textCell.optional() }))
  .min(1)
const tabsItemsSchema = z
  .array(z.object({ label: textCell, lang: textCell.optional(), code: textCell }))
  .min(1)
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
  // The normal Files page with the file open — the same in-app navigation a
  // markdown link performs (the fullscreen /view route is only for the
  // standalone surface, not for links).
  file: (workspaceId, id) => `/workspace/${workspaceId}/files/${id}`,
}

/**
 * Rewrites `sim:` resource links (`[Name](sim:workflow/<id>)` in source) into
 * real workspace routes. Applied when the rendering surface knows its
 * workspace; without one the sim: hrefs stay put and render inert.
 * `data-sim-link` marks them so the preview sandbox can bridge clicks to the
 * app router instead of cancelling them.
 */
export function resolveSimResourceLinks(html: string, workspaceId: string, baseUrl = ''): string {
  return html.replace(
    /href="sim:(workflow|table|knowledge|file)\/([^"]+)"/g,
    (match, type: string, id: string) => {
      const route = SIM_RESOURCE_ROUTES[type]
      return route ? `href="${baseUrl}${route(workspaceId, id)}" data-sim-link=""` : match
    }
  )
}

/**
 * What ONE compile may expand its YAML to, counted across the frontmatter and
 * every `sim:` fence together — a request pays for their sum, so they share one
 * budget rather than each getting the full allowance.
 *
 * The ceiling has to sit on the EXPANDED value, not on the source: `load`
 * resolves aliases into shared references, so a payload of a few kilobytes
 * (`columns: &c [...]` plus a row list of aliases to it) parses into a small DAG
 * that the renderers then walk as a tree, one `marked.parseInline` per cell.
 * Cells grow with the product of the two alias lists while the source grows with
 * their sum, so bounding source length bounds nothing. These values clear a
 * 100x100 table — far past any page a person writes — and cap a compile's
 * rendering work at roughly a tenth of a second.
 */
const PAGE_YAML_LIMITS: YamlExpansionLimits = {
  maxNodes: 50_000,
  maxSerializedBytes: 2 * 1024 * 1024,
  maxDepth: 64,
}

type PageYamlResult = { ok: true; value: unknown } | { ok: false; reason: string }

/**
 * Parses one YAML region of a page — the frontmatter or a `sim:` fence payload —
 * and charges its expanded size to the compile's budget. On failure `reason` is
 * the clause a block-skipped diagnostic appends; the frontmatter callers only
 * read `ok`.
 */
function loadYaml(body: string, budget: YamlExpansionBudget): PageYamlResult {
  if (isYamlExpansionBudgetExhausted(budget)) {
    return {
      ok: false,
      reason: 'the page spent its whole structured-block budget on earlier blocks',
    }
  }
  let value: unknown
  try {
    value = load(body, { schema: JSON_SCHEMA })
  } catch (err) {
    const message = truncate(getErrorMessage(err, 'invalid YAML'), 160)
    return { ok: false, reason: `its payload is not valid YAML/JSON — ${message}` }
  }
  const measured = measureYamlExpansion(value, PAGE_YAML_LIMITS, budget)
  if (!measured.within) {
    return { ok: false, reason: `its payload is too large to render — ${measured.reason}` }
  }
  return { ok: true, value }
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
          `<li><span class="key">${renderInlineMarkdown(item.key)}</span><span>${renderInlineMarkdown(item.value)}</span></li>`
      )
      .join('')
    return `<ul class="rows">${rows}</ul>`
  },
  faq: renderAccordion,
  accordion: renderAccordion,
  steps: (payload) => {
    const parsed = stepsItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const items = parsed.data
      .map(
        (step, index) =>
          `<li class="step"><div class="step-marker">${index + 1}</div><div class="step-body"><div class="step-title">${renderInlineMarkdown(step.title)}</div>${step.markdown ? renderMarkdown(step.markdown) : ''}</div></li>`
      )
      .join('')
    return `<ol class="steps">${items}</ol>`
  },
  tabs: (payload) => {
    const parsed = tabsItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const buttons = parsed.data
      .map(
        (tab, index) =>
          `<button type="button" class="codetab${index === 0 ? ' is-active' : ''}">${escapeHtml(tab.label)}</button>`
      )
      .join('')
    const panes = parsed.data
      .map(
        (tab, index) =>
          `<pre${index === 0 ? '' : ' hidden'}><code${tab.lang ? ` class="language-${escapeHtml(tab.lang)}"` : ''}>${escapeHtml(tab.code)}</code></pre>`
      )
      .join('')
    return `<figure class="codeblock codetabs"><div class="codeblock-head codetabs-head">${buttons}</div>${panes}</figure>`
  },
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
  const parsed = loadYaml(trimmed.slice(4, end), createYamlExpansionBudget(PAGE_YAML_LIMITS))
  return parsed.ok && frontmatterSchema.safeParse(parsed.value ?? {}).success
}

/**
 * Compiles the body portion — prose, fences — of the source. A malformed
 * sim: block renders NOTHING for the reader (an error card in a finished
 * page helps nobody); the skip is reported through `diagnostics` instead,
 * which the file-editing tool surfaces back to the authoring agent.
 */
function compileBody(source: string, budget: YamlExpansionBudget, diagnostics?: string[]): string {
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
          diagnostics?.push('sim:diagram block skipped: its body must be a complete <svg> element')
        }
      } else {
        const renderer = FENCE_RENDERERS[kind]
        let rendered: string | null = null
        let loadError: string | null = null
        if (renderer) {
          const parsed = loadYaml(body, budget)
          if (parsed.ok) rendered = renderer(parsed.value)
          else loadError = parsed.reason
        }
        if (rendered !== null) {
          html.push(rendered)
        } else {
          // Name WHICH block failed and WHY: a page can carry several blocks
          // of the same kind, and a bare "a table is malformed" sends the
          // fixing agent hunting through all of them.
          const preview = truncate(body.trim().split('\n')[0] ?? '', 80)
          const reason = loadError ?? 'its payload did not match the expected shape'
          diagnostics?.push(`sim:${kind} block starting "${preview}" skipped: ${reason}`)
        }
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
export function compileSimPage(
  source: string,
  options?: { workspaceId?: string; baseUrl?: string; diagnostics?: string[] }
): string {
  // Workspace images (`![alt](sim:file/<id>)`) resolve to the authed byte
  // route regardless of surface; deep links additionally need the workspace.
  // A baseUrl absolutizes both — a DOWNLOADED page opened outside the app
  // must reach Sim the way an absolute link in a downloaded .md does,
  // instead of resolving dead against file:// or a foreign host.
  const origin = options?.baseUrl?.replace(/\/$/, '') ?? ''
  const compiled = compileSimPageDocument(source, options?.diagnostics)
    .replace(/src="sim:file\/([^"]+)"/g, `src="${origin}/api/files/view/$1"`)
    // External links leave the page in a new tab on every surface; in the
    // sandboxed preview the bootstrap bridges the click to the host instead.
    .replace(
      /<a href="(https?:\/\/[^"]+)"/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer"'
    )
  return options?.workspaceId
    ? resolveSimResourceLinks(compiled, options.workspaceId, origin)
    : compiled
}

/**
 * Compiles the source solely to collect authoring diagnostics — one line per
 * skipped sim: block. Empty means every block rendered. The reader-facing
 * render never shows these; the file agent gets them in its tool result.
 */
export function collectSimPageDiagnostics(source: string): string[] {
  const diagnostics: string[] = []
  compileSimPageDocument(source, diagnostics)
  return diagnostics
}

function compileSimPageDocument(source: string, diagnostics?: string[]): string {
  const trimmed = source.trimStart()
  const end = trimmed.indexOf('\n---', 3)
  const frontmatterText = trimmed.slice(4, end)
  const rest = trimmed.slice(end + 4).replace(/^-*\n?/, '')
  // One budget for the whole document: the frontmatter and every fence draw
  // from it, so a page cannot buy more rendering by splitting across blocks.
  const budget = createYamlExpansionBudget(PAGE_YAML_LIMITS)
  const frontmatter = loadYaml(frontmatterText, budget)
  // isSimPageSource gates on parseable frontmatter; this is a safety net.
  if (!frontmatter.ok) return compileBody(source, budget, diagnostics)
  let meta: z.infer<typeof frontmatterSchema>
  try {
    meta = frontmatterSchema.parse(frontmatter.value ?? {})
  } catch {
    return compileBody(source, budget, diagnostics)
  }

  // Two or more top-level `# ` headings turn the body into IN-DOCUMENT tabs:
  // one file, one tab per heading, switched client-side. Content before the
  // first heading renders above the panels on every tab. In-file tabs win
  // over the legacy frontmatter `tabs` (cross-file set links).
  const { intro, tabs: docTabs } = splitDocTabs(rest)
  const multiTab = docTabs.length >= 2

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
    ...(multiTab ? [docTabBar(docTabs)] : meta.tabs ? [tabBar(meta.tabs)] : []),
    `<h1>${escapeHtml(meta.title)}</h1>`,
    ...(meta.lede ? [`<p class="lede">${escapeHtml(meta.lede)}</p>`] : []),
    ...(multiTab
      ? [
          ...(intro.trim() ? [compileBody(intro, budget, diagnostics)] : []),
          ...docTabs.map(
            (tab, i) =>
              `<section class="doc-tab-panel${i === 0 ? ' is-active' : ''}" id="doc-tab-${i}" data-tab-panel>${compileBody(tab.body, budget, diagnostics)}</section>`
          ),
          DOC_TABS_SCRIPT,
        ]
      : [compileBody(rest, budget, diagnostics)]),
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}
