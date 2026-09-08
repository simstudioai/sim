import path from 'node:path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Parser } from 'htmlparser2'
import JSZip from 'jszip'
import { Marked } from 'marked'
import type { Definition, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { StorageContext } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'

const logger = createLogger('MarkdownExport')

export const MAX_EXPORT_TOTAL_BYTES = 250 * 1024 * 1024
/** Larger documents remain available as exact Markdown without allocating a syntax tree. */
export const MAX_EXPORT_MARKDOWN_PARSE_BYTES = 10 * 1024 * 1024
const MAX_EXPORT_ASSET_BYTES = 25 * 1024 * 1024
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, { unsafe: [{ character: '|' }, { character: '\n' }, { character: '\r' }] })
const markdownLexer = new Marked()

/** Source ranges keep unrelated links, definitions, code, and whitespace byte-for-byte intact. */
function rewriteImageSources(source: string, filenames: ReadonlyMap<string, string>): string {
  const { frontmatter, body: content } = splitFrontmatter(source)
  const root = markdownProcessor.parse(content)
  const definitions = new Map<string, Definition>()
  const stack: RootContent[] = [...root.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node)
    }
    if ('children' in node) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
    }
  }

  const replacementFor = (src: string) => {
    const ref = extractEmbeddedFileRef(src)
    const filename = ref && 'fileId' in ref ? filenames.get(ref.fileId) : undefined
    return filename === undefined ? null : `./assets/${encodeURIComponent(filename)}`
  }
  const replacements: Array<{ start: number; end: number; value: string }> = []
  let sourceDepth = 0
  let tagName = ''
  let sawSrc = false
  let htmlLength = 0
  let htmlOffset = 0
  const htmlParser = new Parser({
    onopentagname(name) {
      tagName = name
      sawSrc = false
    },
    onattribute(name, value) {
      if (tagName !== 'img' || name !== 'src' || sawSrc) return
      sawSrc = true
      if (sourceDepth > 0) return
      const replacement = replacementFor(value)
      if (replacement !== null) {
        replacements.push({
          start: htmlOffset + htmlParser.startIndex,
          end: htmlOffset + htmlParser.endIndex,
          value: `src="${replacement}"`,
        })
      }
    },
    onopentag(name) {
      if (sourceDepth > 0 || ['pre', 'code', 'kbd', 'script', 'style'].includes(name)) sourceDepth++
    },
    onclosetag() {
      if (sourceDepth > 0) sourceDepth--
    },
  })

  const writeHtml = (html: string, start: number) => {
    htmlOffset = start - htmlLength
    htmlParser.write(html)
    htmlLength += html.length
  }

  for (let i = root.children.length - 1; i >= 0; i--) stack.push(root.children[i])
  while (stack.length) {
    const node = stack.pop()!
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
      if (node.type === 'html') {
        const valueLines = node.value.split('\n')
        /** Mask container prefixes removed by mdast without shifting source offsets. */
        const html = content
          .slice(start, end)
          .split('\n')
          .map((line, index) => {
            const value = valueLines[index]
            return value !== undefined && line.endsWith(value)
              ? ' '.repeat(line.length - value.length) + value
              : line
          })
          .join('\n')
        writeHtml(html, start)
      } else if (node.type === 'text' && node.value.includes('<')) {
        /** Marked also renders unquoted slash-containing HTML attributes that mdast treats as text. */
        const tokens = new markdownLexer.Lexer(markdownLexer.defaults).inlineTokens(
          content.slice(start, end)
        )
        let tokenOffset = start
        for (const token of tokens) {
          if (token.type === 'html') writeHtml(token.raw, tokenOffset)
          tokenOffset += token.raw.length
        }
      } else if (sourceDepth === 0 && (node.type === 'image' || node.type === 'imageReference')) {
        const destination = node.type === 'image' ? node : definitions.get(node.identifier)
        const replacement = destination && replacementFor(destination.url)
        if (replacement) {
          const value = markdownProcessor
            .stringify({
              type: 'root',
              children: [
                {
                  type: 'image',
                  alt: node.alt,
                  title: destination?.title,
                  url: replacement,
                },
              ],
            })
            .trimEnd()
          replacements.push({ start, end, value })
        }
      }
    }
    if ('children' in node) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
    }
  }
  htmlParser.end()

  const chunks: string[] = []
  let offset = 0
  for (const { start, end, value } of replacements) {
    chunks.push(content.slice(offset, start), value)
    offset = end
  }
  chunks.push(content.slice(offset))
  return frontmatter + chunks.join('')
}

export interface MarkdownExportAsset {
  imageId: string
  key: string
  context: StorageContext
  originalName: string
  size: number
}

export interface MarkdownExportResult {
  buffer: Buffer
  fileName: string
  contentType: string
  format: 'markdown' | 'zip'
  assetCount: number
}

export class MarkdownExportSizeError extends Error {
  constructor(bytes: number) {
    super(
      `This document and its embedded files total ${formatFileSize(bytes)}, which exceeds the ${formatFileSize(MAX_EXPORT_TOTAL_BYTES)} export limit.`
    )
    this.name = 'MarkdownExportSizeError'
  }
}

function safeFilename(name: string): string {
  return path
    .basename(name)
    .replace(/["\\]/g, '_')
    .replace(/[\r\n\t]/g, '')
}

function deduplicatedFilename(preferred: string, existing: Set<string>, imageId: string): string {
  if (!existing.has(preferred)) return preferred
  const ext = path.extname(preferred)
  const base = path.basename(preferred, ext)
  const short = `${base}_${imageId.slice(0, 8)}${ext}`
  if (!existing.has(short)) return short
  return `${base}_${imageId}${ext}`
}

/**
 * Packages one Markdown snapshot and its already-authorized, count-bounded asset targets.
 * Missing or oversized assets retain their original links; total overflow rejects the export.
 */
export async function createMarkdownExport({
  content,
  fileName,
  assets,
}: {
  content: Buffer
  fileName: string
  assets: readonly MarkdownExportAsset[]
}): Promise<MarkdownExportResult> {
  const plainMarkdown: MarkdownExportResult = {
    buffer: content,
    fileName: safeFilename(fileName),
    contentType: 'text/markdown; charset=utf-8',
    format: 'markdown',
    assetCount: 0,
  }
  if (content.length > MAX_EXPORT_TOTAL_BYTES) throw new MarkdownExportSizeError(content.length)
  if (content.length > MAX_EXPORT_MARKDOWN_PARSE_BYTES) return plainMarkdown
  const declaredBytes = content.length + assets.reduce((sum, asset) => sum + asset.size, 0)
  if (declaredBytes > MAX_EXPORT_TOTAL_BYTES) throw new MarkdownExportSizeError(declaredBytes)

  let retainedBytes = content.length
  let overflowBytes: number | undefined
  const fetched = await mapWithConcurrency(assets, MATERIALIZE_CONCURRENCY, async (asset) => {
    if (overflowBytes !== undefined) return null
    let buffer: Buffer
    try {
      buffer = await downloadFile({
        key: asset.key,
        context: asset.context,
        maxBytes: MAX_EXPORT_ASSET_BYTES,
      })
    } catch (error) {
      logger.warn('Failed to fetch asset for export', {
        imageId: asset.imageId,
        error: toError(error).message,
      })
      return null
    }
    if (overflowBytes !== undefined) return null
    const nextBytes = retainedBytes + buffer.length
    if (nextBytes > MAX_EXPORT_TOTAL_BYTES) {
      overflowBytes = nextBytes
      return null
    }
    retainedBytes = nextBytes
    return { ...asset, buffer }
  })
  if (overflowBytes !== undefined) throw new MarkdownExportSizeError(overflowBytes)

  const assetMap = new Map<string, { filename: string; buffer: Buffer }>()
  const usedFilenames = new Set<string>()
  for (const result of fetched) {
    if (!result) continue
    const preferred = safeFilename(result.originalName)
    const filename = deduplicatedFilename(preferred, usedFilenames, result.imageId)
    usedFilenames.add(filename)
    assetMap.set(result.imageId, { filename, buffer: result.buffer })
  }

  if (assetMap.size === 0) {
    return plainMarkdown
  }

  const markdown = rewriteImageSources(
    content.toString('utf-8'),
    new Map([...assetMap].map(([imageId, asset]) => [imageId, asset.filename]))
  )

  const zip = new JSZip()
  zip.file(safeFilename(fileName), markdown)
  const assetsFolder = zip.folder('assets')!
  for (const { filename, buffer } of assetMap.values()) assetsFolder.file(filename, buffer)

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    fileName: safeFilename(`${fileName.replace(/\.[^.]+$/, '')}.zip`),
    contentType: 'application/zip',
    format: 'zip',
    assetCount: assetMap.size,
  }
}
