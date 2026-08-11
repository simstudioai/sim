import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  Document,
  Font,
  Image,
  Link,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { JSONContent } from '@tiptap/core'
import sharp from 'sharp'
import { parseServerMarkdownToDoc } from '@/lib/collab-doc/server-markdown'
import { embeddedFileRefKey, extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'

type PdfImage = { data: Buffer; format: 'png' }

interface GlyphFont {
  hasGlyphForCodePoint(codePoint: number): boolean
}

interface PdfFont {
  family: string
  glyphs: GlyphFont
}

const require = createRequire(import.meta.url)

function resolveBrandFont(filename: string): string {
  const candidates = [
    join(process.cwd(), 'public', 'brand', 'fonts', filename),
    join(process.cwd(), 'apps', 'sim', 'public', 'brand', 'fonts', filename),
  ]
  const font = candidates.find(existsSync)
  if (!font) throw new Error(`PDF font not found: ${filename}`)
  return font
}

function resolveDependencyFont(packageName: string, filename: string): string {
  const relativePath = join(packageName, 'files', filename)
  const candidates = [
    join(process.cwd(), 'node_modules', relativePath),
    join(process.cwd(), '..', '..', 'node_modules', relativePath),
    join(process.cwd(), 'apps', 'sim', 'node_modules', relativePath),
  ]
  const font = candidates.find(existsSync)
  if (!font) throw new Error(`PDF dependency font not found: ${filename}`)
  return font
}

const GEIST_REGULAR = resolveBrandFont('Geist-Regular.ttf')
const GEIST_MEDIUM = resolveBrandFont('Geist-Medium.ttf')
const UNIFONT_REGULAR = resolveDependencyFont(
  '@fontsource/unifont',
  'unifont-latin-400-normal.woff'
)
const NOTO_ARABIC = resolveDependencyFont(
  '@fontsource/noto-sans-arabic',
  'noto-sans-arabic-arabic-400-normal.woff'
)
const NOTO_ARABIC_BOLD = resolveDependencyFont(
  '@fontsource/noto-sans-arabic',
  'noto-sans-arabic-arabic-700-normal.woff'
)
const NOTO_DEVANAGARI = resolveDependencyFont(
  '@fontsource/noto-sans-devanagari',
  'noto-sans-devanagari-devanagari-400-normal.woff'
)
const NOTO_DEVANAGARI_BOLD = resolveDependencyFont(
  '@fontsource/noto-sans-devanagari',
  'noto-sans-devanagari-devanagari-700-normal.woff'
)
const NOTO_HEBREW = resolveDependencyFont(
  '@fontsource/noto-sans-hebrew',
  'noto-sans-hebrew-hebrew-400-normal.woff'
)
const NOTO_HEBREW_BOLD = resolveDependencyFont(
  '@fontsource/noto-sans-hebrew',
  'noto-sans-hebrew-hebrew-700-normal.woff'
)

/**
 * PDF images never render wider than the A4 content box. These PDF-specific ceilings reject
 * decompression bombs well below Sharp's broad application default, then bound normalized output.
 */
const MAX_PDF_IMAGE_DIMENSION = 1568
const MAX_PDF_IMAGE_INPUT_PIXELS = 40_000_000
const MAX_PDF_TOTAL_INPUT_PIXELS = 80_000_000
const MAX_PDF_TOTAL_OUTPUT_PIXELS = 25_000_000
const MAX_PDF_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_PDF_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_PDF_DOCUMENT_NODES = 20_000
const MAX_PDF_TOP_LEVEL_BLOCKS = 3_000
const MAX_UNBREAKABLE_TABLE_HEIGHT = 620
const PDF_TABLE_CONTENT_WIDTH = 499

Font.register({
  family: 'Geist',
  fonts: [
    { src: GEIST_REGULAR, fontStyle: 'normal', fontWeight: 400 },
    { src: GEIST_REGULAR, fontStyle: 'italic', fontWeight: 400 },
    { src: GEIST_MEDIUM, fontStyle: 'normal', fontWeight: 700 },
    { src: GEIST_MEDIUM, fontStyle: 'italic', fontWeight: 700 },
  ],
})
function registerFallbackFont(family: string, src: string, boldSrc = src): void {
  Font.register({
    family,
    fonts: [
      { src, fontStyle: 'normal', fontWeight: 400 },
      { src, fontStyle: 'italic', fontWeight: 400 },
      { src: boldSrc, fontStyle: 'normal', fontWeight: 700 },
      { src: boldSrc, fontStyle: 'italic', fontWeight: 700 },
    ],
  })
}

registerFallbackFont('NotoSansArabic', NOTO_ARABIC, NOTO_ARABIC_BOLD)
registerFallbackFont('NotoSansDevanagari', NOTO_DEVANAGARI, NOTO_DEVANAGARI_BOLD)
registerFallbackFont('NotoSansHebrew', NOTO_HEBREW, NOTO_HEBREW_BOLD)
registerFallbackFont('Unifont', UNIFONT_REGULAR)

const { openSync } = require('fontkit') as { openSync(path: string): GlyphFont }
const geistGlyphs = openSync(GEIST_REGULAR)
const staticFallbackFonts: PdfFont[] = [
  { family: 'NotoSansArabic', glyphs: openSync(NOTO_ARABIC) },
  { family: 'NotoSansDevanagari', glyphs: openSync(NOTO_DEVANAGARI) },
  { family: 'NotoSansHebrew', glyphs: openSync(NOTO_HEBREW) },
]
const unifont: PdfFont = { family: 'Unifont', glyphs: openSync(UNIFONT_REGULAR) }

export interface MarkdownPdfInput {
  markdown: string
  title: string
  images?: ReadonlyMap<string, Buffer>
}

export class MarkdownPdfLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkdownPdfLimitError'
  }
}

interface MarkdownDocumentProps {
  document: JSONContent
  title: string
  images: ReadonlyMap<string, PdfImage>
}

interface FontRun {
  family: string
  text: string
}

interface TableChunk {
  rows: JSONContent[]
  unbreakable: boolean
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    color: '#171717',
    fontFamily: 'Geist',
    fontSize: 10.5,
    lineHeight: 1.45,
    paddingBottom: 48,
    paddingHorizontal: 48,
    paddingTop: 48,
  },
  paragraph: { marginBottom: 9 },
  h1: { fontSize: 23, fontWeight: 700, lineHeight: 1.2, marginBottom: 12, marginTop: 4 },
  h2: { fontSize: 19, fontWeight: 700, lineHeight: 1.25, marginBottom: 10, marginTop: 8 },
  h3: { fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 8, marginTop: 7 },
  h4: { fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, marginBottom: 7, marginTop: 6 },
  h5: { fontSize: 11.5, fontWeight: 700, marginBottom: 6, marginTop: 5 },
  h6: { color: '#404040', fontSize: 10.5, fontWeight: 700, marginBottom: 5, marginTop: 4 },
  strong: { fontWeight: 700 },
  emphasis: { fontStyle: 'italic' },
  deleted: { textDecoration: 'line-through' },
  highlighted: { backgroundColor: '#fff3bf' },
  inlineCode: {
    backgroundColor: '#f1f3f5',
    color: '#24292f',
    fontSize: 9,
  },
  link: { color: '#0969da', textDecoration: 'underline' },
  mention: { backgroundColor: '#f1f3f5', color: '#404040' },
  blockquote: {
    borderLeftColor: '#b6bec8',
    borderLeftWidth: 2,
    color: '#4b5563',
    marginBottom: 9,
    paddingLeft: 10,
  },
  codeBlock: {
    backgroundColor: '#f6f8fa',
    borderColor: '#d0d7de',
    borderRadius: 3,
    borderWidth: 0.5,
    color: '#24292f',
    fontSize: 8.5,
    lineHeight: 1.35,
    marginBottom: 10,
    padding: 9,
  },
  list: { marginBottom: 8 },
  listItem: { flexDirection: 'row', marginBottom: 3 },
  listMarker: { flexShrink: 0, width: 22 },
  listBody: { flexBasis: 0, flexGrow: 1 },
  listText: { marginBottom: 2 },
  rule: { borderBottomColor: '#d0d7de', borderBottomWidth: 0.75, marginBottom: 12, marginTop: 4 },
  table: { borderColor: '#b6bec8', borderLeftWidth: 0.5, borderTopWidth: 0.5, marginBottom: 11 },
  tableRow: { flexDirection: 'row' },
  tableCell: {
    borderBottomWidth: 0.5,
    borderColor: '#b6bec8',
    borderRightWidth: 0.5,
    flexBasis: 0,
    flexGrow: 1,
    fontSize: 8.5,
    minWidth: 0,
    padding: 5,
  },
  tableHeader: { backgroundColor: '#f1f3f5', fontWeight: 700 },
  imageBlock: { marginBottom: 11 },
  image: { maxHeight: 430, objectFit: 'contain', width: '100%' },
  imageFallback: {
    backgroundColor: '#f6f8fa',
    color: '#57606a',
    fontStyle: 'italic',
    marginBottom: 9,
    padding: 8,
  },
  sourceFallback: {
    backgroundColor: '#f6f8fa',
    color: '#57606a',
    fontSize: 8.5,
    marginBottom: 9,
    padding: 8,
  },
})

function fontRuns(value: string): FontRun[] {
  const characters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)
    const fallback =
      codePoint === undefined
        ? undefined
        : (staticFallbackFonts.find(({ glyphs }) => glyphs.hasGlyphForCodePoint(codePoint)) ??
          (unifont.glyphs.hasGlyphForCodePoint(codePoint) ? unifont : undefined))
    const family =
      codePoint !== undefined && geistGlyphs.hasGlyphForCodePoint(codePoint)
        ? 'Geist'
        : (fallback?.family ?? 'Unifont')
    return {
      family,
      neutral: /^[\p{N}\p{P}\p{Z}\s]$/u.test(character),
      text: family === 'Geist' || fallback ? character : '�',
    }
  })

  for (const [index, character] of characters.entries()) {
    if (character.family !== 'Geist' || !character.neutral) continue

    let previous = index - 1
    while (previous >= 0 && characters[previous].neutral) previous -= 1
    let next = index + 1
    while (next < characters.length && characters[next].neutral) next += 1
    const previousFamily = characters[previous]?.family
    const nextFamily = characters[next]?.family
    if (previousFamily && previousFamily !== 'Geist' && previousFamily === nextFamily) {
      character.family = previousFamily
    } else if (previousFamily && previousFamily !== 'Geist' && next >= characters.length) {
      character.family = previousFamily
    }
  }

  const runs: FontRun[] = []
  for (const { family, text } of characters) {
    const current = runs.at(-1)
    if (current?.family === family) current.text += text
    else runs.push({ family, text })
  }
  return runs
}

function renderText(value: string, keyPrefix: string): ReactNode[] {
  return fontRuns(value).map((run, index) =>
    run.family === 'Geist' ? (
      run.text
    ) : (
      <Text key={`${keyPrefix}-font-${index}`} style={{ fontFamily: run.family }}>
        {run.text}
      </Text>
    )
  )
}

function nodeText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(nodeText).join('')
}

function assertDocumentWithinLimits(document: JSONContent): void {
  if ((document.content?.length ?? 0) > MAX_PDF_TOP_LEVEL_BLOCKS) {
    throw new MarkdownPdfLimitError('This document has too many blocks to export as PDF.')
  }

  let nodeCount = 0
  const visit = (node: JSONContent): void => {
    nodeCount += 1
    if (nodeCount > MAX_PDF_DOCUMENT_NODES) {
      throw new MarkdownPdfLimitError('This document is too complex to export as PDF.')
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(document)
}

function stringAttr(node: JSONContent, name: string): string | undefined {
  const value = node.attrs?.[name]
  return typeof value === 'string' ? value : undefined
}

function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : undefined
  } catch {
    return undefined
  }
}

function renderInlineNode(node: JSONContent, key: string): ReactNode {
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'mention') {
    return (
      <Text key={key} style={styles.mention}>
        {renderText(stringAttr(node, 'label') ?? 'Mention', key)}
      </Text>
    )
  }
  if (node.type === 'rawInlineHtml' || node.type === 'footnoteRef') {
    return (
      <Text key={key} style={styles.inlineCode}>
        {renderText(nodeText(node), key)}
      </Text>
    )
  }
  if (node.type !== 'text') return renderText(nodeText(node), key)

  const marks = node.marks ?? []
  const textStyles: Array<
    | typeof styles.strong
    | typeof styles.emphasis
    | typeof styles.deleted
    | typeof styles.inlineCode
    | typeof styles.highlighted
  > = []
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        textStyles.push(styles.strong)
        break
      case 'italic':
        textStyles.push(styles.emphasis)
        break
      case 'strike':
        textStyles.push(styles.deleted)
        break
      case 'code':
        textStyles.push(styles.inlineCode)
        break
      case 'highlight':
        textStyles.push(styles.highlighted)
        break
    }
  }
  const content = renderText(node.text ?? '', key)
  const linkMark = marks.find((mark) => mark.type === 'link')
  const href = typeof linkMark?.attrs?.href === 'string' ? safeLink(linkMark.attrs.href) : undefined
  if (href) {
    return (
      <Link key={key} src={href} style={[styles.link, ...textStyles]}>
        {content}
      </Link>
    )
  }
  return textStyles.length > 0 ? (
    <Text key={key} style={textStyles}>
      {content}
    </Text>
  ) : (
    content
  )
}

function renderInline(keyPrefix: string, nodes: JSONContent[] = []): ReactNode[] {
  return nodes.map((node, index) => renderInlineNode(node, `${keyPrefix}-${index}`))
}

function renderImage(
  node: JSONContent,
  images: ReadonlyMap<string, PdfImage>,
  key: string
): ReactNode {
  const src = stringAttr(node, 'src') ?? ''
  const ref = extractEmbeddedFileRef(src)
  const image = ref ? images.get(embeddedFileRefKey(ref)) : undefined
  if (!image) {
    const alt = stringAttr(node, 'alt')
    return (
      <Text key={key} style={styles.imageFallback}>
        {renderText(alt ? `Image: ${alt}` : 'Image unavailable', key)}
      </Text>
    )
  }

  const requestedWidth = Number(stringAttr(node, 'width'))
  const width = Number.isFinite(requestedWidth)
    ? Math.min(Math.max(requestedWidth, 1), PDF_TABLE_CONTENT_WIDTH)
    : undefined
  return (
    <View key={key} style={styles.imageBlock}>
      <Image src={image} style={[styles.image, ...(width ? [{ width }] : [])]} />
    </View>
  )
}

function renderList(
  node: JSONContent,
  images: ReadonlyMap<string, PdfImage>,
  key: string
): ReactNode {
  const ordered = node.type === 'orderedList'
  const task = node.type === 'taskList'
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
  return (
    <View key={key} style={styles.list}>
      {(node.content ?? []).map((item, index) => {
        const marker = task
          ? item.attrs?.checked
            ? '[x]'
            : '[ ]'
          : ordered
            ? `${start + index}.`
            : '-'
        return (
          <View key={`${key}-${index}`} style={styles.listItem}>
            <Text style={styles.listMarker}>{marker}</Text>
            <View style={styles.listBody}>
              {(item.content ?? []).map((child, childIndex) =>
                child.type === 'paragraph' ? (
                  <Text key={`${key}-${index}-${childIndex}`} style={styles.listText}>
                    {renderInline(`${key}-${index}-${childIndex}`, child.content)}
                  </Text>
                ) : (
                  renderBlock(child, images, `${key}-${index}-${childIndex}`)
                )
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function estimateTableRowHeight(row: JSONContent, columnCount: number): number {
  const columnWidth = PDF_TABLE_CONTENT_WIDTH / Math.max(columnCount, 1)
  const charactersPerLine = Math.max(8, Math.floor(columnWidth / 4.8))
  const lines = Math.max(
    1,
    ...(row.content ?? []).map((cell) =>
      Math.ceil(Math.max(nodeText(cell).length, 1) / charactersPerLine)
    )
  )
  return 10 + lines * 12.5
}

function chunkTableRows(header: JSONContent, rows: JSONContent[]): TableChunk[] {
  const columnCount = header.content?.length ?? rows[0]?.content?.length ?? 1
  const headerHeight = estimateTableRowHeight(header, columnCount)
  const chunks: TableChunk[] = []
  let current: JSONContent[] = []
  let currentHeight = headerHeight

  const flush = () => {
    if (current.length === 0) return
    chunks.push({ rows: current, unbreakable: currentHeight <= MAX_UNBREAKABLE_TABLE_HEIGHT })
    current = []
    currentHeight = headerHeight
  }

  for (const row of rows) {
    const rowHeight = estimateTableRowHeight(row, columnCount)
    if (current.length > 0 && currentHeight + rowHeight > MAX_UNBREAKABLE_TABLE_HEIGHT) flush()
    current.push(row)
    currentHeight += rowHeight
    if (rowHeight + headerHeight > MAX_UNBREAKABLE_TABLE_HEIGHT) flush()
  }
  flush()
  return chunks
}

function renderTableRow(row: JSONContent, key: string, header: boolean): ReactNode {
  return (
    <View key={key} style={styles.tableRow} wrap={false}>
      {(row.content ?? []).map((cell, index) => (
        <Text
          key={`${key}-${index}`}
          style={[styles.tableCell, ...(header ? [styles.tableHeader] : [])]}
        >
          {(cell.content ?? []).map((child, childIndex) => (
            <Text key={`${key}-${index}-${childIndex}`}>
              {childIndex > 0 ? '\n' : null}
              {renderInline(`${key}-${index}-${childIndex}`, child.content)}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  )
}

function renderTable(node: JSONContent, key: string): ReactNode {
  const rows = (node.content ?? []).filter((child) => child.type === 'tableRow')
  if (rows.length === 0) return null
  const firstRow = rows[0]
  const hasHeader = firstRow.content?.some((cell) => cell.type === 'tableHeader') ?? false
  const header = hasHeader ? firstRow : { type: 'tableRow', content: [] }
  const bodyRows = hasHeader ? rows.slice(1) : rows
  const chunks = hasHeader
    ? chunkTableRows(header, bodyRows)
    : [{ rows: bodyRows, unbreakable: false }]

  return chunks.map((chunk, index) => (
    <View key={`${key}-${index}`} style={styles.table} wrap={!chunk.unbreakable}>
      {hasHeader ? renderTableRow(header, `${key}-${index}-header`, true) : null}
      {chunk.rows.map((row, rowIndex) =>
        renderTableRow(row, `${key}-${index}-row-${rowIndex}`, false)
      )}
    </View>
  ))
}

function renderBlock(
  node: JSONContent,
  images: ReadonlyMap<string, PdfImage>,
  key: string
): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(key, node.content)}
        </Text>
      )
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
      const headingStyle = [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6][
        Math.min(Math.max(level, 1), 6) - 1
      ]
      return (
        <Text key={key} minPresenceAhead={20} style={headingStyle}>
          {renderInline(key, node.content)}
        </Text>
      )
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(node, images, key)
    case 'blockquote':
      return (
        <View key={key} style={styles.blockquote}>
          {(node.content ?? []).map((child, index) =>
            renderBlock(child, images, `${key}-${index}`)
          )}
        </View>
      )
    case 'codeBlock':
      return (
        <Text key={key} style={styles.codeBlock}>
          {renderText(nodeText(node), key)}
        </Text>
      )
    case 'table':
      return renderTable(node, key)
    case 'horizontalRule':
      return <View key={key} style={styles.rule} />
    case 'image':
      return renderImage(node, images, key)
    case 'rawHtmlBlock':
    case 'footnoteDef':
      return (
        <Text key={key} style={styles.sourceFallback}>
          {renderText(nodeText(node), key)}
        </Text>
      )
    default: {
      const text = nodeText(node)
      return text ? (
        <Text key={key} style={styles.paragraph}>
          {renderText(text, key)}
        </Text>
      ) : null
    }
  }
}

function MarkdownDocument({ document, title, images }: MarkdownDocumentProps) {
  return (
    <Document creator='Sim' language='und' title={title}>
      <Page size='A4' style={styles.page} wrap>
        {(document.content ?? []).map((node, index) => renderBlock(node, images, `block-${index}`))}
      </Page>
    </Document>
  )
}

async function normalizeImages(
  images: ReadonlyMap<string, Buffer>
): Promise<Map<string, PdfImage>> {
  const normalized = new Map<string, PdfImage>()
  let totalInputPixels = 0
  let totalOutputPixels = 0
  let totalImageBytes = 0

  for (const [imageKey, buffer] of images) {
    try {
      const pipeline = sharp(buffer, {
        limitInputPixels: MAX_PDF_IMAGE_INPUT_PIXELS,
        sequentialRead: true,
      })
      const metadata = await pipeline.metadata()
      if (!metadata.width || !metadata.height) continue

      const inputPixels = metadata.width * metadata.height
      if (
        !Number.isSafeInteger(inputPixels) ||
        totalInputPixels + inputPixels > MAX_PDF_TOTAL_INPUT_PIXELS
      ) {
        continue
      }
      totalInputPixels += inputPixels

      const scale = Math.min(
        1,
        MAX_PDF_IMAGE_DIMENSION / metadata.width,
        MAX_PDF_IMAGE_DIMENSION / metadata.height
      )
      const outputWidth = Math.max(1, Math.round(metadata.width * scale))
      const outputHeight = Math.max(1, Math.round(metadata.height * scale))
      const outputPixels = outputWidth * outputHeight
      if (totalOutputPixels + outputPixels > MAX_PDF_TOTAL_OUTPUT_PIXELS) continue

      const data = await pipeline
        .rotate()
        .resize({
          width: MAX_PDF_IMAGE_DIMENSION,
          height: MAX_PDF_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
      if (
        data.length > MAX_PDF_IMAGE_BYTES ||
        totalImageBytes + data.length > MAX_PDF_TOTAL_IMAGE_BYTES
      ) {
        continue
      }

      totalOutputPixels += outputPixels
      totalImageBytes += data.length
      normalized.set(imageKey, { data, format: 'png' })
    } catch {
      // Keep the PDF usable when an otherwise downloadable attachment is not a renderable image.
    }
  }
  return normalized
}

export async function renderMarkdownPdf({
  markdown,
  title,
  images = new Map(),
}: MarkdownPdfInput): Promise<Buffer> {
  const normalizedImages = await normalizeImages(images)
  const { body } = splitFrontmatter(markdown)
  const document = parseServerMarkdownToDoc(body)
  assertDocumentWithinLimits(document)
  return renderToBuffer(
    <MarkdownDocument document={document} title={title} images={normalizedImages} />
  )
}
