import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import { compareStrings, escapeRegExp } from '@sim/utils/string'
import { Parser } from 'htmlparser2'
import { toString as mdastToString } from 'mdast-util-to-string'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { ContentCatalog, DocsPage } from '@/lib/content/types'
import { DOCS_REDIRECTS } from '@/lib/redirects'

const logger = createLogger('DocsCorpusE2E')
const baseSetting = process.env.DOCS_E2E_BASE_URL
const reportSetting = process.env.DOCS_CORPUS_REPORT_PATH
if (!baseSetting || !reportSetting)
  throw new Error('DOCS_E2E_BASE_URL and DOCS_CORPUS_REPORT_PATH are required')
const base = new URL(baseSetting)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Only a loopback production docs server may be tested')
const reportPath: string = reportSetting
const docsRoot = resolve(import.meta.dirname, '..')
const canonicalOrigin = new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sim.ai').origin
const MAX_BODY_BYTES = 32 * 1024 * 1024
const CONCURRENCY = 4
const startedAt = new Date().toISOString()
const selectedPaths = process.env.DOCS_CORPUS_PATHS?.split(',').filter(Boolean)

interface BaselinePage {
  source: string
  url: string
  explicitIds: string[]
  media: Array<{ type: string; src?: string }>
}
interface Baseline {
  pages: BaselinePage[]
  assets: Array<{ path: string; bytes: number; sha256: string }>
}
interface CheckResult {
  name: string
  path: string
  status: 'passed' | 'failed'
  durationMs: number
  responseStatus?: number
  bytes?: number
  error?: string
}
interface HtmlResult {
  title: string
  canonical: string[]
  ids: Map<string, number>
  media: Set<string>
  authenticationLinks: Set<string>
  text: string
}

const catalog = JSON.parse(
  await readFile(resolve(docsRoot, '.content/catalog.json'), 'utf8')
) as ContentCatalog
const baseline = JSON.parse(
  await readFile(resolve(docsRoot, 'migration/baseline.json'), 'utf8')
) as Baseline
const baselinePages = new Map(baseline.pages.map((page) => [page.url, page]))
const canonicalPages = new Set(catalog.pages.map((page) => page.url))
if (selectedPaths?.some((path) => !canonicalPages.has(path)))
  throw new Error('DOCS_CORPUS_PATHS must contain comma-separated canonical document paths')
const readablePages = catalog.pages.filter((page) => page.url !== '/')
const excludedAssets = baseline.assets.filter(
  (asset) => asset.path.split('/').at(-1) === '.DS_Store'
)
const publicAssets = baseline.assets.filter((asset) => !excludedAssets.includes(asset))
const results: CheckResult[] = []
const markdownParser = unified().use(remarkParse).use(remarkGfm)
const sourceParser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx)
const staticMediaSources = new Map<string, string[]>()
const staticMediaRoot = resolve(docsRoot, '.next/static/media')
for (const filename of await readdir(staticMediaRoot)) {
  if (!/\.(png|jpe?g|webp|avif)$/.test(filename)) continue
  const filenamePath = resolve(staticMediaRoot, filename)
  assert((await stat(filenamePath)).size <= MAX_BODY_BYTES, `Oversized static image: ${filename}`)
  const hash = createHash('sha256')
    .update(await readFile(filenamePath))
    .digest('hex')
  const originals = publicAssets.filter((asset) => asset.sha256 === hash)
  staticMediaSources.set(
    `/_next/static/media/${filename}`,
    originals.map((asset) => `/${asset.path}`)
  )
}
const specifications = new Map<string, Record<string, unknown>>()
for (const page of catalog.pages)
  if (page.operation && !specifications.has(page.operation.specFile))
    specifications.set(
      page.operation.specFile,
      JSON.parse(await readFile(resolve(docsRoot, page.operation.specFile), 'utf8')) as Record<
        string,
        unknown
      >
    )
await mkdir(dirname(reportPath), { recursive: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function plainMarkdown(value: string): string {
  const blocks = new Set(['paragraph', 'heading', 'code', 'listItem', 'tableCell', 'tableRow'])
  const readNode = (node: unknown): string => {
    const record = toRecord(node)
    if (record.type === 'html') return ''
    if (record.type === 'break') return ' '
    const value =
      typeof record.value === 'string'
        ? record.value
        : toArray(record.children).map(readNode).join('')
    return blocks.has(String(record.type)) ? ` ${value} ` : value
  }
  return normalized(readNode(markdownParser.parse(value)))
}

async function assertMarkdownStructure(page: DocsPage, markdown: string) {
  if (page.operation) return
  const source = await readFile(resolve(docsRoot, 'content/docs', page.sourcePath), 'utf8')
  const authored = sourceParser.parse(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''))
  const received = markdownParser.parse(markdown)
  const failures: string[] = []
  const headingKey = (depth: number, title: string) =>
    `${depth}:${title.replace(/\s*\[#[^\]]+\]\s*$/, '')}`
  const headings = new Map<string, number>()
  const fences = new Map<string, number>()
  const tables: Array<{ rows: number; cells: number; codes: string[] }> = []
  visit(received, (node) => {
    if (node.type === 'heading') {
      const key = headingKey(node.depth, mdastToString(node))
      headings.set(key, (headings.get(key) ?? 0) + 1)
    }
    if (node.type === 'code') {
      const key = `${node.lang ?? ''}:${node.value}`
      fences.set(key, (fences.get(key) ?? 0) + 1)
    }
    if (node.type === 'table') {
      const codes: string[] = []
      visit(node, 'inlineCode', (code) => {
        codes.push(code.value)
      })
      tables.push({
        rows: node.children.length,
        cells: node.children.reduce((count, row) => count + row.children.length, 0),
        codes,
      })
    }
  })
  const consumeOccurrence = (counts: Map<string, number>, key: string, label: string) => {
    const count = counts.get(key) ?? 0
    if (count === 0) failures.push(`${label}: ${key.slice(0, 100)}`)
    else counts.set(key, count - 1)
  }
  let tableIndex = 0
  visit(authored, (node) => {
    if (node.type === 'heading')
      consumeOccurrence(headings, headingKey(node.depth, mdastToString(node)), 'Missing heading')
    if (node.type === 'code')
      consumeOccurrence(fences, `${node.lang ?? ''}:${node.value}`, 'Missing code fence')
    if (
      node.type !== 'table' &&
      !(
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        node.name === 'table'
      )
    )
      return
    let rows = 0
    let cells = 0
    const codes: string[] = []
    visit(node, (child) => {
      if (child.type === 'tableRow') rows++
      if (child.type === 'tableCell') cells++
      if (child.type === 'inlineCode') codes.push(child.value)
      if (child.type !== 'mdxJsxFlowElement' && child.type !== 'mdxJsxTextElement') return
      if (child.name === 'tr') rows++
      if (child.name === 'th' || child.name === 'td') cells++
      if (child.name === 'code')
        codes.push(
          child.children
            .map((part) => {
              if (part.type !== 'mdxTextExpression' && part.type !== 'mdxFlowExpression')
                return mdastToString(part)
              const statement = toRecord(toArray(toRecord(part.data?.estree).body)[0])
              const expression = toRecord(statement.expression)
              assert(expression.type === 'Literal', 'Unsupported source code expression')
              return String(expression.value)
            })
            .join('')
        )
    })
    const table = tables[tableIndex++]
    if (!table || table.rows !== rows || table.cells !== cells)
      failures.push(`Table ${tableIndex} lost its ${rows} rows or ${cells} cells`)
    const actualCodes = new Map<string, number>()
    for (const code of table?.codes ?? []) actualCodes.set(code, (actualCodes.get(code) ?? 0) + 1)
    for (const code of codes)
      consumeOccurrence(actualCodes, code, `Table ${tableIndex} lost an inline code value`)
  })
  assert(!failures.length, failures.join('; '))
}

async function consume(response: Response, onChunk: (chunk: Uint8Array) => void): Promise<number> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel()
    throw new Error(`Response declares ${declared} bytes, exceeding ${MAX_BODY_BYTES}`)
  }
  const reader = response.body?.getReader()
  if (!reader) return 0
  let bytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new Error(`Response exceeds ${MAX_BODY_BYTES} bytes`)
      }
      onChunk(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return bytes
}

async function expectResponse(response: Response, status: number, contentType?: string) {
  const actualType = response.headers.get('content-type')
  if (response.status !== status || (contentType && !actualType?.startsWith(contentType))) {
    await response.body?.cancel()
    throw new Error(
      `Expected HTTP ${status}${contentType ? ` ${contentType}` : ''}, received ${response.status} ${actualType}`
    )
  }
}

function mediaPath(value: string): string {
  const url = new URL(value, base)
  if (url.pathname === '/_next/image' && url.searchParams.has('url'))
    return mediaPath(url.searchParams.get('url') ?? '')
  return url.origin === base.origin || url.origin === canonicalOrigin ? url.pathname : url.href
}

async function readHtml(response: Response): Promise<HtmlResult & { bytes: number }> {
  const result: HtmlResult = {
    title: '',
    canonical: [],
    ids: new Map(),
    media: new Set(),
    authenticationLinks: new Set(),
    text: '',
  }
  const chunks: string[] = []
  const title: string[] = []
  let main = 0
  let ignored = 0
  let h1 = 0
  let svg = 0
  let authentication = 0
  const blocks = new Set([
    'p',
    'div',
    'section',
    'article',
    'header',
    'footer',
    'pre',
    'li',
    'td',
    'th',
    'summary',
    'details',
    'br',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
  ])
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'main') main++
        if (name === 'script' || name === 'style') ignored++
        if (name === 'svg') svg++
        if (name === 'section' && (authentication || attributes.id === 'authentication'))
          authentication++
        if (name === 'link' && attributes.rel?.split(/\s+/).includes('canonical'))
          result.canonical.push(attributes.href)
        if (!main || ignored) return
        if (name === 'h1') h1++
        if (attributes.id) result.ids.set(attributes.id, (result.ids.get(attributes.id) ?? 0) + 1)
        if (['img', 'video', 'source', 'iframe'].includes(name) && attributes.src) {
          const source = mediaPath(attributes.src)
          result.media.add(source)
          for (const original of staticMediaSources.get(source) ?? []) result.media.add(original)
        }
        if (authentication && name === 'a' && attributes.href)
          result.authenticationLinks.add(
            new URL(attributes.href, `${canonicalOrigin}${new URL(response.url).pathname}`).href
          )
      },
      ontext(value) {
        if (main && !ignored && !svg) {
          chunks.push(value)
          if (h1) title.push(value)
        }
      },
      onclosetag(name) {
        if (main && !ignored && blocks.has(name)) chunks.push(' ')
        if (name === 'h1' && main) h1--
        if (name === 'main') main--
        if (name === 'script' || name === 'style') ignored--
        if (name === 'svg') svg--
        if (name === 'section' && authentication) authentication--
      },
    },
    { decodeEntities: true }
  )
  const decoder = new TextDecoder()
  const bytes = await consume(response, (chunk) =>
    parser.write(decoder.decode(chunk, { stream: true }))
  )
  parser.end(decoder.decode())
  result.title = normalized(title.join(''))
  result.text = normalized(chunks.join(''))
  return { ...result, bytes }
}

function resolvePointer(
  value: unknown,
  document: Record<string, unknown>
): Record<string, unknown> {
  const record = toRecord(value)
  if (typeof record.$ref !== 'string') return record
  assert(record.$ref.startsWith('#/'), `Unexpected external specification reference ${record.$ref}`)
  let found: unknown = document
  for (const segment of record.$ref.slice(2).split('/'))
    found = toRecord(found)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  assert(isRecordLike(found), `Invalid canonical specification reference ${record.$ref}`)
  const { $ref: _reference, ...siblings } = record
  return { ...found, ...siblings }
}

function operationEvidence(page: DocsPage): Set<string> {
  const reference = page.operation
  const evidence = new Set<string>()
  if (!reference) return evidence
  const document = specifications.get(reference.specFile)
  assert(document, `Missing canonical document ${reference.specFile}`)
  const pathItem = resolvePointer(toRecord(document.paths)[reference.path], document)
  const declaredOperation = resolvePointer(pathItem[reference.method.toLowerCase()], document)
  assert(
    declaredOperation.operationId === reference.operationId,
    `Operation identity differs from its source specification: ${reference.operationId}`
  )
  const operation: Record<string, unknown> = {
    ...declaredOperation,
    parameters: [...toArray(pathItem.parameters), ...toArray(declaredOperation.parameters)],
  }
  evidence.add(reference.method)
  evidence.add(reference.path)
  const addDescription = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) evidence.add(plainMarkdown(value))
  }
  const visited = new Set<string>()
  const inspectSchema = (value: unknown, skipDescription = false) => {
    const raw = toRecord(value)
    if (typeof raw.$ref === 'string') {
      if (visited.has(raw.$ref)) return
      visited.add(raw.$ref)
    }
    const schema = resolvePointer(value, document)
    if (!skipDescription) addDescription(schema.description)
    for (const key of [
      'default',
      'enum',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'pattern',
      'minItems',
      'maxItems',
    ])
      if (key in schema)
        evidence.add(
          normalized(typeof schema[key] === 'string' ? schema[key] : JSON.stringify(schema[key]))
        )
    for (const [name, child] of Object.entries(toRecord(schema.properties))) {
      evidence.add(name)
      inspectSchema(child)
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'])
      for (const child of toArray(schema[keyword])) inspectSchema(child)
    if (schema.items) inspectSchema(schema.items)
    if (isRecordLike(schema.additionalProperties)) inspectSchema(schema.additionalProperties)
  }
  const inspectMedia = (content: unknown) => {
    for (const media of Object.values(toRecord(content))) inspectSchema(toRecord(media).schema)
  }
  for (const parameter of toArray(operation.parameters)) {
    const value = resolvePointer(parameter, document)
    if (typeof value.name === 'string') evidence.add(value.name)
    addDescription(value.description)
    inspectSchema(value.schema, typeof value.description === 'string')
    inspectMedia(value.content)
  }
  const body = resolvePointer(operation.requestBody, document)
  addDescription(body.description)
  inspectMedia(body.content)
  for (const [status, response] of Object.entries(toRecord(operation.responses))) {
    evidence.add(status)
    const value = resolvePointer(response, document)
    addDescription(value.description)
    inspectMedia(value.content)
    for (const [name, header] of Object.entries(toRecord(value.headers))) {
      evidence.add(name)
      inspectSchema(resolvePointer(header, document).schema)
    }
  }
  const schemes = toRecord(toRecord(document.components).securitySchemes)
  for (const requirement of toArray(operation.security ?? document.security))
    for (const [name, scopes] of Object.entries(toRecord(requirement))) {
      const scheme = resolvePointer(schemes[name], document)
      if (scheme.type === 'apiKey' && typeof scheme.name === 'string') evidence.add(scheme.name)
      if (scheme.type === 'oauth2' || scheme.scheme === 'bearer')
        evidence.add('Authorization: Bearer')
      for (const scope of toArray(scopes)) if (typeof scope === 'string') evidence.add(scope)
    }
  if (typeof operation['x-oauth-scope'] === 'string') evidence.add(operation['x-oauth-scope'])
  return evidence
}

function authenticationLinks(page: DocsPage): Set<string> {
  const links = new Set<string>()
  if (!page.operation) return links
  const reference = page.operation
  const document = specifications.get(reference.specFile)
  assert(document, `Missing canonical document ${reference.specFile}`)
  const pathItem = resolvePointer(toRecord(document.paths)[reference.path], document)
  const operation = resolvePointer(pathItem[reference.method.toLowerCase()], document)
  const schemes = toRecord(toRecord(document.components).securitySchemes)
  for (const requirement of toArray(operation.security ?? document.security))
    for (const name of Object.keys(toRecord(requirement))) {
      const scheme = resolvePointer(schemes[name], document)
      if (typeof scheme.description !== 'string') continue
      visit(markdownParser.parse(scheme.description), 'link', (node) => {
        links.add(new URL(node.url, `${canonicalOrigin}${page.url}`).href)
      })
    }
  return links
}

async function check(name: string, path: string, run: (result: CheckResult) => Promise<void>) {
  if (selectedPaths && !selectedPaths.includes(path.replace(/\.mdx$/, ''))) return
  const result: CheckResult = { name, path, status: 'failed', durationMs: 0 }
  const started = performance.now()
  try {
    await run(result)
    result.status = 'passed'
  } catch (error) {
    result.error = getErrorMessage(error)
    logger.error('Corpus check failed', { path, name, error: result.error })
  }
  result.durationMs = Math.round(performance.now() - started)
  results.push(result)
  if (results.length % 100 === 0)
    logger.info('Corpus verification progress', {
      checks: results.length,
      failed: results.filter((item) => item.status === 'failed').length,
    })
}

async function bounded<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  let cursor = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]
        await run(item)
      }
    })
  )
}
const request = (path: string, init?: RequestInit) =>
  fetch(new URL(path, base), { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) })

const redirectRules = DOCS_REDIRECTS.map((rule) => {
  const keys: string[] = []
  const pattern = rule.source
    .split('/')
    .map((segment) => {
      const parameter = /^:(\w+)(?:\(([^)]+)\))?(\*)?$/.exec(segment)
      if (!parameter) return escapeRegExp(segment)
      keys.push(parameter[1])
      return `(${parameter[2] ?? (parameter[3] ? '.*' : '[^/]+')})`
    })
    .join('/')
  return { ...rule, keys, regex: new RegExp(`^${pattern}$`) }
})

function representativeRedirects(): string[] {
  const paths = new Set<string>()
  for (const rule of DOCS_REDIRECTS) {
    let candidates = ['']
    for (const segment of rule.source.split('/').slice(1)) {
      const parameter = /^:(\w+)(?:\(([^)]+)\))?(\*)?$/.exec(segment)
      let values = [segment]
      if (parameter) {
        if (parameter[2]) values = parameter[2].split('|')
        else if (rule.destination.includes(`:${parameter[1]}`)) {
          const [prefix, suffix] = rule.destination.split(new RegExp(`:${parameter[1]}\\*?`))
          const matched = [...canonicalPages]
            .filter((url) => url.startsWith(prefix) && url.endsWith(suffix))
            .map((url) => url.slice(prefix.length, suffix ? -suffix.length : undefined))
            .filter(Boolean)
            .sort((left, right) => left.length - right.length || compareStrings(left, right))
          assert(matched.length, `No canonical representative for ${rule.source}`)
          values = [matched[0]]
          const nested = parameter[3] ? matched.find((value) => value.includes('/')) : undefined
          if (nested && nested !== matched[0]) values.push(nested)
        } else values = [parameter[3] ? 'legacy/nested' : 'legacy']
      }
      candidates = candidates.flatMap((prefix) => values.map((value) => `${prefix}/${value}`))
    }
    for (const candidate of candidates) paths.add(candidate || '/')
  }
  assert(paths.size <= 4000, 'Redirect representative budget exceeded')
  return [...paths].sort(compareStrings)
}

try {
  await bounded(readablePages, async (page) => {
    await check(
      'HTML identity, anchors, media and operation reference',
      page.url,
      async (result) => {
        const response = await request(page.url, { headers: { Accept: 'text/html' } })
        result.responseStatus = response.status
        await expectResponse(response, 200, 'text/html')
        const html = await readHtml(response)
        result.bytes = html.bytes
        assert(html.title === page.title, `Page title mismatch: ${html.title}`)
        assert(
          html.canonical.length === 1 && html.canonical[0] === `${canonicalOrigin}${page.url}`,
          `Canonical mismatch: ${html.canonical.join(', ')}`
        )
        for (const heading of page.headings)
          assert(html.ids.has(heading.id), `Missing heading #${heading.id}`)
        if (page.operation)
          for (const heading of page.headings) {
            const legacyId =
              heading.id === 'authentication'
                ? 'authorization'
                : heading.id === 'responses'
                  ? 'response-body'
                  : /^(path|query|header|cookie)-parameters$/.test(heading.id)
                    ? `parameters-${heading.id.split('-')[0]}`
                    : heading.id
            assert(html.ids.has(legacyId), `Missing original API anchor #${legacyId}`)
          }
        for (const id of baselinePages.get(page.url)?.explicitIds ?? [])
          assert(html.ids.has(id), `Missing original explicit ID #${id}`)
        const duplicates = [...html.ids].filter(([, count]) => count > 1).map(([id]) => id)
        assert(!duplicates.length, `Duplicate article IDs: ${duplicates.join(', ')}`)
        for (const media of baselinePages.get(page.url)?.media ?? []) {
          const original =
            media.src ??
            (media.type === 'IntroductionHero' ? '/static/introduction/platform.webp' : undefined)
          if (!original) continue
          const expected = mediaPath(original)
          assert(
            html.media.has(expected),
            `Missing source media ${original} (expected ${expected})`
          )
        }
        for (const text of operationEvidence(page))
          assert(html.text.includes(normalized(text)), `Missing operation/schema text: ${text}`)
        for (const href of authenticationLinks(page))
          assert(
            html.authenticationLinks.has(href),
            `Authentication description link is not a usable anchor: ${href}`
          )
      }
    )
    await check(
      'Complete Markdown matches the catalog and preserves source structure',
      `${page.url}.mdx`,
      async (result) => {
        const response = await request(`${page.url}.mdx`)
        result.responseStatus = response.status
        await expectResponse(response, 200, 'text/markdown')
        const hasher = createHash('sha256')
        const chunks: Uint8Array[] = []
        result.bytes = await consume(response, (chunk) => {
          hasher.update(chunk)
          chunks.push(chunk)
        })
        assert(
          result.bytes === Buffer.byteLength(page.markdown),
          `Markdown byte length differs: ${result.bytes} versus ${Buffer.byteLength(page.markdown)}`
        )
        assert(
          hasher.digest('hex') === digest(page.markdown),
          'Markdown content differs from the complete canonical page'
        )
        await assertMarkdownStructure(page, Buffer.concat(chunks).toString('utf8'))
      }
    )
  })
  await bounded(publicAssets, async (asset) => {
    await check('Original public asset bytes preserved', `/${asset.path}`, async (result) => {
      const response = await request(`/${asset.path}`)
      result.responseStatus = response.status
      await expectResponse(response, 200)
      const hasher = createHash('sha256')
      result.bytes = await consume(response, (chunk) => hasher.update(chunk))
      assert(
        result.bytes === asset.bytes && hasher.digest('hex') === asset.sha256,
        'Asset differs from its original source bytes'
      )
    })
  })
  await bounded(representativeRedirects(), async (path) => {
    await check('Ordered public redirect contract', path, async (result) => {
      const rule = redirectRules.find((candidate) => candidate.regex.test(path))
      assert(rule, `No expected redirect for ${path}`)
      const captures = rule.regex.exec(path)
      const destination = rule.destination.replace(
        /:(\w+)\*?/g,
        (_, key: string) => captures?.[rule.keys.indexOf(key) + 1] ?? ''
      )
      const response = await request(path)
      result.responseStatus = response.status
      await response.body?.cancel()
      assert(
        response.status === (rule.permanent ? 308 : 307),
        `Expected ${rule.permanent ? 308 : 307}, received ${response.status}`
      )
      const location = response.headers.get('location')
      assert(
        location && new URL(location, base).href === new URL(destination, base).href,
        `Redirect target differs: ${location}; expected ${destination}`
      )
      const target = new URL(destination, base)
      const targetPage = catalog.pages.find((page) => page.url === target.pathname)
      assert(targetPage, `Redirect does not land on a canonical page: ${destination}`)
      if (target.hash)
        assert(
          targetPage.headings.some((heading) => heading.id === target.hash.slice(1)) ||
            baselinePages.get(target.pathname)?.explicitIds.includes(target.hash.slice(1)),
          `Redirect fragment does not exist: ${destination}`
        )
    })
  })
  for (const path of [
    '/__docs-corpus-missing__',
    '/__docs-corpus-missing__.mdx',
    '/api-reference/workflows/__docs-corpus-missing__',
  ])
    await check('Unknown document is a genuine 404', path, async (result) => {
      const response = await request(path)
      result.responseStatus = response.status
      await response.body?.cancel()
      assert(response.status === 404, `Unknown document returned ${response.status}`)
    })
} catch (error) {
  results.push({
    name: 'Corpus suite lifecycle',
    path: base.origin,
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  const failed = results.filter((result) => result.status === 'failed')
  await writeFile(
    reportPath,
    `${JSON.stringify({ startedAt, completedAt: new Date().toISOString(), origin: base.origin, canonicalOrigin, selectedPaths, catalogHash: digest(catalog.pages.map((page) => `${page.id}:${page.contentHash}`).join('\n')), concurrency: CONCURRENCY, maxBodyBytes: MAX_BODY_BYTES, catalogPages: catalog.pages.length, readablePages: readablePages.length, redirectOnlyPages: ['/'], assets: publicAssets.length, excludedOsArtifacts: excludedAssets.map((asset) => asset.path), checks: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`
  )
  logger.info('Corpus verification completed', {
    checks: results.length,
    failed: failed.length,
    reportPath,
  })
  if (failed.length) process.exitCode = 1
}
