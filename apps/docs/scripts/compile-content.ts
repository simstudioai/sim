import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { compareStrings, escapeRegExp } from '@sim/utils/string'
import matter from 'gray-matter'
import { z } from 'zod'
import { compileDocument } from '@/lib/content/compile'
import { buildNavigation } from '@/lib/content/navigation'
import { buildOperationPages } from '@/lib/content/openapi'
import type { ContentCatalog, DocsPage, NavigationMeta } from '@/lib/content/types'
import { writeFullMarkdown } from '@/lib/llms-build'
import { OPENAPI_SPEC_FILES } from '@/lib/openapi-specs'
import { DOCS_REDIRECTS } from '@/lib/redirects'
import { buildSearchIndex } from '@/lib/search/build'

const logger = createLogger('DocsContent')
const DOCS_ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT_ROOT = path.join(DOCS_ROOT, 'content/docs')
const OUTPUT_ROOT = path.join(DOCS_ROOT, '.content')
const MAX_CONTENT_BYTES = 64 * 1024 * 1024
const frontmatterSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().default(''),
    integration: z.object({ type: z.string().min(1), color: z.string().min(1) }).optional(),
  })
  .strict()
const metadataSchema = z
  .object({
    title: z.string().optional(),
    pages: z.array(z.string()).optional(),
    labels: z.record(z.string(), z.string().min(1)).optional(),
    root: z.boolean().optional(),
    defaultOpen: z.boolean().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
  })
  .strict()

interface CompiledCache {
  pipeline: string
  files: Record<
    string,
    {
      hash: string
      page: DocsPage
      links: string[]
      media: string[]
      ids: string[]
      codeFences: Array<{ lang?: string | null; meta?: string | null; sha256: string }>
    }
  >
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? filesIn(path.join(directory, entry.name))
          : [path.join(directory, entry.name)]
      )
    )
  )
    .flat()
    .sort(compareStrings)
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function validateLinks(pages: DocsPage[], cache: CompiledCache) {
  const byUrl = new Map(pages.map((page) => [page.url, page]))
  const bySource = new Map(Object.values(cache.files).map((entry) => [entry.page.url, entry]))
  const rules = DOCS_REDIRECTS.map((rule) => {
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
    return { ...rule, keys, expression: new RegExp(`^${pattern}$`) }
  })
  const resolve = (input: string) => {
    let url = input
    for (let hop = 0; hop < 8; hop++) {
      if (byUrl.has(url)) return url
      const rule = rules.find((candidate) => candidate.expression.test(url))
      if (!rule) return url
      const match = rule.expression.exec(url)
      url = rule.destination.replace(
        /:(\w+)\*?/g,
        (_, key: string) => match?.[rule.keys.indexOf(key) + 1] ?? ''
      )
    }
    throw new Error(`Redirect cycle while resolving ${input}`)
  }
  let count = 0
  for (const [source, entry] of Object.entries(cache.files)) {
    for (const href of entry.links) {
      const url = new URL(href, `https://docs.sim.ai${entry.page.url}`)
      if (url.origin !== 'https://docs.sim.ai') continue
      if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/static/') ||
        ['/openapi.json', '/llms.txt', '/llms-full.txt'].includes(url.pathname)
      )
        continue
      const canonical = resolve(url.pathname.replace(/\.mdx?$/, '').replace(/\/$/, '') || '/')
      const page = byUrl.get(canonical)
      if (!page) throw new Error(`${source}: unresolved documentation link ${href}`)
      if (url.hash) {
        const anchor = decodeURIComponent(url.hash.slice(1))
        const legacyOperationAnchors = [
          'authorization',
          'parameters-path',
          'parameters-query',
          'parameters-header',
          'parameters-cookie',
          'request-body',
          'response-body',
          'callbacks',
        ]
        const ids = page.operation
          ? [...page.headings.map((heading) => heading.id), ...legacyOperationAnchors]
          : (bySource.get(canonical)?.ids ?? [])
        if (!ids.includes(anchor))
          throw new Error(`${source}: unresolved documentation anchor ${href}`)
      }
      count++
    }
  }
  return count
}

function lastModified(): Map<string, string> {
  const dates = new Map<string, string>()
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: DOCS_ROOT,
      encoding: 'utf8',
      maxBuffer: MAX_CONTENT_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  try {
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') return dates
    const root = git(['rev-parse', '--show-toplevel'])
    let date: string | undefined
    for (const line of git([
      '-c',
      'core.quotepath=off',
      'log',
      '--format=%x00%aI',
      '--name-only',
      '--',
      'content/docs',
      '*.json',
    ]).split('\n')) {
      if (line.startsWith('\0')) date = line.slice(1)
      else if (line && date && !dates.has(path.join(root, line)))
        dates.set(path.join(root, line), date)
    }
  } catch {
    logger.warn('Git history unavailable; modification dates omitted')
  }
  return dates
}

async function readCache(): Promise<CompiledCache> {
  try {
    return JSON.parse(await readFile(path.join(OUTPUT_ROOT, 'cache.json'), 'utf8')) as CompiledCache
  } catch {
    return { pipeline: '', files: {} }
  }
}

async function generate() {
  await mkdir(path.join(OUTPUT_ROOT, 'pages'), { recursive: true })
  const pipelineFiles = [
    path.join(DOCS_ROOT, 'lib/content/compile.ts'),
    path.join(DOCS_ROOT, 'lib/content/markdown.ts'),
    path.join(DOCS_ROOT, 'lib/shiki-theme.ts'),
    path.join(DOCS_ROOT, 'components/workflow-preview/examples.ts'),
    path.join(DOCS_ROOT, 'components/workflow-preview/block-display-workflows.ts'),
    path.join(DOCS_ROOT, 'package.json'),
  ].filter((file) => !file.endsWith('/catalog.ts'))
  const pipelineHash = hash(
    (await Promise.all(pipelineFiles.map((file) => readFile(file, 'utf8')))).join('\n')
  )
  const previous = await readCache()
  const cache: CompiledCache = { pipeline: pipelineHash, files: {} }
  const metadata: Record<string, NavigationMeta> = {}
  const pages: DocsPage[] = []
  const dates = lastModified()
  let compiled = 0
  for (const file of await filesIn(CONTENT_ROOT)) {
    const relative = path.relative(CONTENT_ROOT, file)
    if (relative.endsWith('meta.json')) {
      const parsed = metadataSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
      if (!parsed.success) throw new Error(`${relative}: ${parsed.error.message}`)
      const directory = path.dirname(relative)
      metadata[directory === '.' ? '' : directory] = parsed.data
      continue
    }
    if (!relative.endsWith('.mdx')) continue
    const raw = await readFile(file, 'utf8')
    const sourceHash = hash(raw)
    const stem = hash(`${relative}:${sourceHash}:${pipelineHash}`).slice(0, 24)
    const javascriptPath = path.join(OUTPUT_ROOT, 'pages', `${stem}.js`)
    const prior = previous.files[relative]
    if (
      previous.pipeline === pipelineHash &&
      prior?.hash === sourceHash &&
      existsSync(javascriptPath)
    ) {
      cache.files[relative] = prior
      pages.push(prior.page)
      continue
    }
    const parsed = matter(raw)
    const frontmatter = frontmatterSchema.safeParse(parsed.data)
    if (!frontmatter.success) throw new Error(`${relative}: ${frontmatter.error.message}`)
    const url = `/${relative
      .replace(/\.mdx$/, '')
      .replace(/(^|\/)index$/, '')
      .replace(/\/$/, '')}`
    const result = await compileDocument(relative, parsed.content, frontmatter.data.description)
    const section = url.startsWith('/api-reference/')
      ? 'api'
      : url === '/cli' || url.startsWith('/cli/')
        ? 'cli'
        : url.startsWith('/mcp/')
          ? 'mcp'
          : 'docs'
    const markdown = `# ${frontmatter.data.title} (${url})\n\n${result.markdown}`
    const page: DocsPage = {
      id: url,
      url,
      slugs: url.split('/').filter(Boolean),
      ...frontmatter.data,
      section,
      sourcePath: relative,
      headings: result.headings,
      markdown,
      contentHash: hash(markdown),
      ...(dates.get(file) ? { lastModified: dates.get(file) } : {}),
    }
    for (const media of result.media)
      if (
        media.startsWith('/') &&
        !existsSync(path.join(DOCS_ROOT, 'public', decodeURIComponent(media.split(/[?#]/)[0])))
      )
        throw new Error(`${relative}: missing media ${media}`)
    await writeFile(javascriptPath, result.javascript)
    await writeFile(
      javascriptPath.replace(/\.js$/, '.d.ts'),
      "import type { MDXContent } from 'mdx/types'\ndeclare const Content: MDXContent\nexport default Content\n"
    )
    cache.files[relative] = {
      hash: sourceHash,
      page,
      links: result.links,
      media: result.media,
      ids: result.ids,
      codeFences: result.codeFences,
    }
    pages.push(page)
    compiled++
    if (compiled % 50 === 0) logger.info(`Compiled ${compiled} authored pages`)
  }
  for (const page of buildOperationPages()) {
    page.contentHash = hash(page.markdown)
    page.lastModified = dates.get(path.join(DOCS_ROOT, page.sourcePath))
    pages.push(page)
  }
  const urls = new Set<string>()
  for (const page of pages) {
    if (urls.has(page.url)) throw new Error(`${page.sourcePath}: duplicate route ${page.url}`)
    urls.add(page.url)
  }
  pages.sort((left, right) => compareStrings(left.url, right.url))
  const catalog: ContentCatalog = {
    version: 1,
    pages,
    navigation: buildNavigation(pages, metadata),
  }
  const internalLinks = validateLinks(pages, cache)
  const serialized = JSON.stringify(catalog)
  const searchIndex = JSON.stringify(buildSearchIndex(pages))
  if (Buffer.byteLength(serialized) > MAX_CONTENT_BYTES)
    throw new Error('Documentation catalog exceeds the 64 MiB build budget')
  const loaders = pages
    .filter((page) => !page.operation)
    .map((page) => {
      const modulePath = `./pages/${hash(`${page.sourcePath}:${cache.files[page.sourcePath].hash}:${pipelineHash}`).slice(0, 24)}.js`
      return `  ${JSON.stringify(page.id)}: () => import(${JSON.stringify(modulePath)}),`
    })
    .join('\n')
  const registry = `import type { MDXContent } from 'mdx/types'\nconst loaders: Record<string, () => Promise<{default: MDXContent}>> = {\n${loaders}\n}\nexport function loadPage(id: string) {\n  const load = loaders[id]\n  if (!load) throw new Error(\`Unknown authored document: \${id}\`)\n  return load()\n}\n`
  const baseline = JSON.parse(
    await readFile(path.join(DOCS_ROOT, 'migration/baseline.json'), 'utf8')
  ) as {
    pages: Array<{
      url: string
      source: string
      headings: Array<{ url: string }>
      codeFences: Array<{ sha256: string }>
    }>
    operations: Array<{ urls: string[] }>
  }
  const lostRoutes = [
    ...baseline.pages.map((page) => page.url),
    ...baseline.operations.flatMap((operation) => operation.urls),
  ].filter((url) => !urls.has(url))
  const lostAnchors = baseline.pages.flatMap((old) => {
    const current = pages.find((page) => page.url === old.url)
    return old.headings
      .filter((heading) => !current?.headings.some((item) => `#${item.id}` === heading.url))
      .map((heading) => `${old.url}${heading.url}`)
  })
  const changedCodeFences = baseline.pages
    .filter(
      (page) =>
        JSON.stringify(page.codeFences.map((fence) => fence.sha256)) !==
        JSON.stringify(cache.files[page.source]?.codeFences.map((fence) => fence.sha256))
    )
    .map((page) => page.source)
  const report = {
    source: 'Canonical catalog compared with pre-migration MDX AST and specification inventory',
    authoredPages: pages.filter((page) => !page.operation).length,
    operationPages: pages.filter((page) => page.operation).length,
    totalPages: pages.length,
    catalogBytes: Buffer.byteLength(serialized),
    internalLinks,
    lostRoutes,
    lostAnchors,
    changedCodeFences,
    componentCoverage:
      'Every JSX component validated against the centrally owned component allowlist',
    routes: pages.map((page) => ({
      url: page.url,
      sourcePath: page.sourcePath,
      contentHash: page.contentHash,
      headings: page.headings.map((heading) => heading.id),
    })),
  }
  const reportPath = path.join(DOCS_ROOT, 'migration/report.json')
  const formattedReport = execFileSync(
    'bun',
    [
      'x',
      '--no-install',
      'biome',
      'format',
      '--stdin-file-path',
      reportPath,
      `--files-max-size=${MAX_CONTENT_BYTES}`,
    ],
    {
      cwd: DOCS_ROOT,
      encoding: 'utf8',
      input: JSON.stringify(report),
      maxBuffer: MAX_CONTENT_BYTES,
    }
  )
  if (!formattedReport.trim()) throw new Error('Migration report formatter returned empty output')
  await writeFile(reportPath, formattedReport)
  if (
    process.argv.includes('--verify-migration') &&
    (lostRoutes.length || lostAnchors.length || changedCodeFences.length)
  )
    throw new Error(
      `Migration loses ${lostRoutes.length} routes and ${lostAnchors.length} anchors or changes ${changedCodeFences.length} code examples; see migration/report.json`
    )
  await writeFullMarkdown(pages)
  for (const [name, data] of [
    ['registry.ts', registry],
    ['routes.json', JSON.stringify(pages.map((page) => page.url))],
    ['cache.json', JSON.stringify(cache)],
    ['search.json', searchIndex],
    ['catalog.json', serialized],
  ]) {
    await writeFile(path.join(OUTPUT_ROOT, `${name}.tmp`), data)
    await rename(path.join(OUTPUT_ROOT, `${name}.tmp`), path.join(OUTPUT_ROOT, name))
  }
  logger.info(
    `Catalog ready: ${pages.length} pages (${compiled} recompiled), ${Buffer.byteLength(serialized)} bytes`
  )
}

if (process.argv.includes('--watch')) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let pending = false
  const refresh = async () => {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.filename], { stdio: 'inherit' })
        child.once('error', reject)
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`Content compiler exited with ${code}`))
        )
      })
    } catch (error) {
      logger.error('Content compilation failed', error)
    } finally {
      running = false
      if (pending) {
        pending = false
        void refresh()
      }
    }
  }
  watch(DOCS_ROOT, { recursive: true }, (_, filename) => {
    const changed = filename?.toString().replaceAll('\\', '/') ?? ''
    if (
      !changed.startsWith('content/') &&
      !changed.startsWith('lib/content/') &&
      !changed.startsWith('lib/search/') &&
      !changed.startsWith('components/workflow-preview/') &&
      !['scripts/compile-content.ts', 'lib/shiki-theme.ts', ...OPENAPI_SPEC_FILES].includes(changed)
    )
      return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void refresh()
    }, 150)
  })
  logger.info('Watching documentation source')
  await refresh()
} else await generate()
