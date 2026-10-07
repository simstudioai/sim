import { createWriteStream } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createLogger } from '@sim/logger'
import { compareStrings } from '@sim/utils/string'
import { plugin } from 'bun'
import { createMdxPlugin } from 'fumadocs-mdx/bun'

const MAX_LLM_TEXT_BYTES = 64 * 1024 * 1024
const logger = createLogger('DocsLlmsFullAsset')

await plugin(createMdxPlugin({ disableMetaFile: true }))

const { source } = await import('@/lib/source')
const { getLLMText } = await import('@/lib/llms')
const publicDirectory = path.resolve('public')
const temporaryDirectory = await mkdtemp(path.join(publicDirectory, '.llms-full-'))
const temporaryFile = path.join(temporaryDirectory, 'llms-full.txt')

async function* generateText(): AsyncGenerator<string> {
  let hasContent = false
  let bytes = 0
  const pages = [...source.getPages()].sort((left, right) => compareStrings(left.url, right.url))
  for (const page of pages) {
    if (!page?.data || !page.url) continue
    const text = await getLLMText(page)
    if (!text) continue
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
  logger.info('Generated full documentation static asset')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
