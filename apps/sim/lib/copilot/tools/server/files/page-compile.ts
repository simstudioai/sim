import { JSON_SCHEMA, load } from 'js-yaml'
import { marked } from 'marked'
import { z } from 'zod'

/**
 * Write-time compiler for agent-authored `.html` pages.
 *
 * The file agent writes a minimal, markdown-shaped source — frontmatter, GFM
 * prose, and `sim:` fences for structured blocks — and this compiles each
 * `apply_file_edit` chunk into the Sim page vocabulary as it is stored. The
 * stored file is always real, portable HTML; the agent never writes markup.
 * Same split the doc formats use (pptx/docx source compiled Sim-side), except
 * the compile happens at write time because HTML needs no sandbox to produce.
 *
 * Compiled output deliberately leaves `</div></body></html>` unwritten: those
 * closing tags are optional in the HTML spec, and omitting them is what lets
 * later chunks append inside the page without re-parsing what exists.
 *
 * Raw HTML sources pass through untouched — a page starting `<!DOCTYPE` or
 * `<html` is the bespoke escape hatch, not source to compile.
 */

/** Stamped into compiled output so continuation chunks know to compile too. */
export const SIM_PAGE_MARKER = '<!--sim-page-->'

const frontmatterSchema = z.object({
  title: z.string().min(1),
  eyebrow: z.string().optional(),
  lede: z.string().optional(),
  layout: z.enum(['docs', 'report', 'brief', 'dashboard']).optional(),
})

const toneSchema = z.enum(['neutral', 'ok', 'warn', 'bad'])
/** YAML leaves unquoted scalars typed; reject null/objects rather than stringify them. */
const textCell = z.union([z.string(), z.number(), z.boolean()]).transform((value) => String(value))

const statsItemsSchema = z
  .array(
    z.object({
      label: textCell,
      value: textCell,
      note: textCell.optional(),
      tone: toneSchema.optional(),
    })
  )
  .min(1)
const cardsItemsSchema = z
  .array(
    z.object({
      title: textCell,
      markdown: textCell,
      pill: z.object({ text: textCell, tone: toneSchema.optional() }).optional(),
    })
  )
  .min(1)
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
const faqItemsSchema = z.array(z.object({ q: textCell, markdown: textCell })).min(1)

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

function pillHtml(text: string, tone?: string): string {
  const modifier = tone === 'ok' || tone === 'warn' || tone === 'bad' ? ` pill--${tone}` : ''
  return `<span class="pill${modifier}">${escapeHtml(text)}</span>`
}

function loadYaml(body: string): unknown {
  return load(body, { schema: JSON_SCHEMA })
}

type FenceRenderer = (payload: unknown) => string | null

const FENCE_RENDERERS: Record<string, FenceRenderer> = {
  stats: (payload) => {
    const parsed = statsItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const cards = parsed.data
      .map((item) => {
        const note = item.note
          ? item.tone
            ? `<p>${pillHtml(item.note, item.tone)}</p>`
            : `<p class="stat-note">${escapeHtml(item.note)}</p>`
          : ''
        return `<div class="card"><div class="stat-label">${escapeHtml(item.label)}</div><div class="stat">${escapeHtml(item.value)}</div>${note}</div>`
      })
      .join('')
    return `<div class="grid">${cards}</div>`
  },
  cards: (payload) => {
    const parsed = cardsItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const cards = parsed.data
      .map((card) => {
        const pill = card.pill ? `<p>${pillHtml(card.pill.text, card.pill.tone)}</p>` : ''
        return `<article class="card">${pill}<h3>${escapeHtml(card.title)}</h3>${renderMarkdown(card.markdown)}</article>`
      })
      .join('')
    return `<div class="grid">${cards}</div>`
  },
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
                `<td${columns[index]?.align === 'num' ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`
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
          `<li><span class="key">${escapeHtml(item.key)}</span><span>${escapeHtml(item.value)}</span></li>`
      )
      .join('')
    return `<ul class="rows">${rows}</ul>`
  },
  faq: (payload) => {
    const parsed = faqItemsSchema.safeParse(payload)
    if (!parsed.success) return null
    const items = parsed.data
      .map(
        (item) =>
          `<details><summary>${escapeHtml(item.q)}</summary>${renderMarkdown(item.markdown)}</details>`
      )
      .join('')
    return `<div class="faq">${items}</div>`
  },
}

/**
 * True when this apply_file_edit content is Sim page source to compile.
 * First chunk announces itself with frontmatter carrying a title; every later
 * chunk is recognised by the marker the first compile stamped into the file.
 */
export function isSimPageSource(content: string, existingContent: string): boolean {
  if (existingContent.includes(SIM_PAGE_MARKER)) return true
  if (existingContent.trim() !== '') return false
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

/** Compiles the body portion — prose, fences, dividers — of a source chunk. */
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
 * Compiles one source chunk to the HTML that gets stored. The first chunk
 * emits the document head and open page container from its frontmatter;
 * continuations emit body fragments that plain-append inside it.
 */
export function compileSimPageChunk(content: string, isFirstChunk: boolean): string {
  if (!isFirstChunk) return compileBody(content)

  const trimmed = content.trimStart()
  const end = trimmed.indexOf('\n---', 3)
  const frontmatterText = trimmed.slice(4, end)
  const rest = trimmed.slice(end + 4).replace(/^-*\n?/, '')
  let meta: z.infer<typeof frontmatterSchema>
  try {
    meta = frontmatterSchema.parse(loadYaml(frontmatterText) ?? {})
  } catch {
    // isSimPageSource gates on parseable frontmatter; this is a safety net.
    return compileBody(content)
  }

  const head = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="sim-artifact">',
    `<title>${escapeHtml(meta.title)}</title>`,
    '</head>',
    '<body>',
    SIM_PAGE_MARKER,
    `<div class="page" data-layout="${meta.layout ?? 'docs'}">`,
    ...(meta.eyebrow ? [`<p class="eyebrow">${escapeHtml(meta.eyebrow)}</p>`] : []),
    `<h1>${escapeHtml(meta.title)}</h1>`,
    ...(meta.lede ? [`<p class="lede">${escapeHtml(meta.lede)}</p>`] : []),
  ].join('\n')

  const body = compileBody(rest)
  return body ? `${head}\n${body}` : head
}
