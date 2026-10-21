import { createWriteStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createProcessor } from '@mdx-js/mdx'
import { createLogger } from '@sim/logger'
import { compareStrings } from '@sim/utils/string'
import { frontmatter } from 'fumadocs-core/content/md/frontmatter'
import { remarkLLMs } from 'fumadocs-core/mdx-plugins/remark-llms'
import { loader, type VirtualFile } from 'fumadocs-core/source'
import { applyMdxPreset, frontmatterSchema, remarkInclude } from 'fumadocs-mdx/config'
import { VFile } from 'vfile'
import config, { docs } from '@/source.config'

const MAX_LLM_TEXT_BYTES = 64 * 1024 * 1024
const logger = createLogger('DocsLlmsFullAsset', { logLevel: 'INFO' })

const started = performance.now()
const slowestPages: { path: string; parseMs: number; durationMs: number }[] = []
let parseMs = 0
let transformMs = 0
function measureParsing() {
  return (_tree: unknown, file: VFile) => {
    file.data.parsedAt = performance.now()
  }
}
const options = await applyMdxPreset(
  typeof config.mdxOptions === 'function' ? await config.mdxOptions() : config.mdxOptions
)('bundler')
// Keep MDX's built-in remark transforms without loading Shiki or the rendered component graph.
const mdxProcessor = createProcessor({
  format: 'mdx',
  remarkPlugins: [
    measureParsing,
    remarkInclude,
    ...(options.remarkPlugins ?? []),
    [remarkLLMs, { _data: true }],
  ],
})
const markdownProcessor = createProcessor({
  format: 'md',
  remarkPlugins: [
    measureParsing,
    remarkInclude,
    ...(options.remarkPlugins ?? []),
    [remarkLLMs, { _data: true }],
  ],
})
const files = await readdir(docs.dir, { recursive: true })
const pages: VirtualFile[] = []
for (const file of files) {
  if (!/\.mdx?$/.test(file)) continue
  const { data } = frontmatter(await readFile(path.join(docs.dir, file), 'utf8'))
  pages.push({ type: 'page', path: file, data: frontmatterSchema.parse(data) })
}
const source = loader({ files: pages }, { baseUrl: '/' })
const publicDirectory = path.resolve('public')
const temporaryDirectory = await mkdtemp(path.join(publicDirectory, '.llms-full-'))
const temporaryFile = path.join(temporaryDirectory, 'llms-full.txt')

async function* generateText(): AsyncGenerator<string> {
  let hasContent = false
  let bytes = 0
  const pages = [...source.getPages()].sort((left, right) => compareStrings(left.url, right.url))
  for (const page of pages) {
    const filePath = path.resolve(docs.dir, page.path)
    const parsed = frontmatter(await readFile(filePath, 'utf8'))
    const file = new VFile({
      path: filePath,
      value: parsed.content,
      data: { frontmatter: parsed.data },
    })
    const processor = filePath.endsWith('.mdx') ? mdxProcessor : markdownProcessor
    const pageStarted = performance.now()
    await processor.process(file)
    const pageEnded = performance.now()
    const parsedAt = typeof file.data.parsedAt === 'number' ? file.data.parsedAt : pageStarted
    parseMs += parsedAt - pageStarted
    transformMs += pageEnded - parsedAt
    slowestPages.push({
      path: page.path,
      parseMs: Math.round(parsedAt - pageStarted),
      durationMs: Math.round(pageEnded - pageStarted),
    })
    slowestPages.sort((left, right) => right.durationMs - left.durationMs)
    slowestPages.length = Math.min(slowestPages.length, 5)
    if (typeof file.data.markdown !== 'string') {
      throw new Error(`No processed Markdown was generated for ${page.path}`)
    }
    const text = `# ${page.data.title} (${page.url})\n\n${file.data.markdown}`
    const chunk = `${hasContent ? '\n\n---\n\n' : ''}${text}`
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_LLM_TEXT_BYTES) {
      throw new Error('Full documentation text exceeds the static asset size budget')
    }
    yield chunk
    hasContent = true
  }
  if (!hasContent) throw new Error('No documentation text was generated')
}

try {
  await pipeline(Readable.from(generateText()), createWriteStream(temporaryFile))
  await rename(temporaryFile, path.join(publicDirectory, 'llms-full.txt'))
  logger.info('Generated full documentation static asset', {
    pages: source.getPages().length,
    durationMs: Math.round(performance.now() - started),
    parseMs: Math.round(parseMs),
    transformMs: Math.round(transformMs),
    slowestPages,
    peakMemoryMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  })
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
