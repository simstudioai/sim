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
import { marked, type Token, type Tokens } from 'marked'
import sharp from 'sharp'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'

type PdfImage = { data: Buffer; format: 'png' }

interface GlyphFont {
  hasGlyphForCodePoint(codePoint: number): boolean
}

const FONT_DIR = join(process.cwd(), 'public', 'brand', 'fonts')
const GEIST_REGULAR = join(FONT_DIR, 'Geist-Regular.ttf')
const GEIST_MEDIUM = join(FONT_DIR, 'Geist-Medium.ttf')

/**
 * PDF images never render wider than the A4 content box, so retaining camera-resolution
 * rasters only increases Sharp and React PDF work. The dimension matches the app's existing
 * inline-image preparation ceiling; the aggregate budgets bound work across a document.
 */
const MAX_PDF_IMAGE_DIMENSION = 1568
const MAX_PDF_IMAGE_INPUT_PIXELS = 268_402_689
const MAX_PDF_TOTAL_INPUT_PIXELS = 268_402_689
const MAX_PDF_TOTAL_OUTPUT_PIXELS = 25_000_000
const MAX_PDF_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_PDF_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024

Font.register({
  family: 'Geist',
  fonts: [
    { src: GEIST_REGULAR, fontStyle: 'normal', fontWeight: 400 },
    { src: GEIST_REGULAR, fontStyle: 'italic', fontWeight: 400 },
    { src: GEIST_MEDIUM, fontStyle: 'normal', fontWeight: 700 },
    { src: GEIST_MEDIUM, fontStyle: 'italic', fontWeight: 700 },
  ],
})

const require = createRequire(import.meta.url)
const { openSync } = require('fontkit') as { openSync(path: string): GlyphFont }
const geistGlyphs = openSync(GEIST_REGULAR)

export interface MarkdownPdfInput {
  markdown: string
  title: string
  images?: ReadonlyMap<string, Buffer>
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
  inlineCode: {
    backgroundColor: '#f1f3f5',
    color: '#24292f',
    fontFamily: 'Geist',
    fontSize: 9,
  },
  link: { color: '#0969da', textDecoration: 'underline' },
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
    fontFamily: 'Geist',
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
  htmlFallback: { color: '#57606a', marginBottom: 9 },
})

function safeText(value: string): string {
  // React PDF's standard fonts can map a missing glyph to an unrelated visible character.
  // Use the same bundled font for measurement and rendering, with an explicit readable fallback.
  let safe = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    safe += codePoint !== undefined && geistGlyphs.hasGlyphForCodePoint(codePoint) ? character : '?'
  }
  return safe
}

function plainHtml(value: string): string {
  return safeText(value.replace(/<[^>]*>/g, '').trim())
}

function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : undefined
  } catch {
    return undefined
  }
}

function embeddedImageId(href: string): string | undefined {
  const ref = extractEmbeddedFileRef(href)
  return ref && 'fileId' in ref ? ref.fileId : undefined
}

function renderInline(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'text':
        return token.tokens?.length ? renderInline(token.tokens, key) : safeText(token.text)
      case 'escape':
        return safeText(token.text)
      case 'strong': {
        const strong = token as Tokens.Strong
        return (
          <Text key={key} style={styles.strong}>
            {renderInline(strong.tokens, key)}
          </Text>
        )
      }
      case 'em': {
        const emphasis = token as Tokens.Em
        return (
          <Text key={key} style={styles.emphasis}>
            {renderInline(emphasis.tokens, key)}
          </Text>
        )
      }
      case 'del': {
        const deleted = token as Tokens.Del
        return (
          <Text key={key} style={styles.deleted}>
            {renderInline(deleted.tokens, key)}
          </Text>
        )
      }
      case 'codespan':
        return (
          <Text key={key} style={styles.inlineCode}>
            {safeText(token.text)}
          </Text>
        )
      case 'br':
        return '\n'
      case 'link': {
        const link = token as Tokens.Link
        const href = safeLink(link.href)
        const content = renderInline(link.tokens, key)
        return href ? (
          <Link key={key} src={href} style={styles.link}>
            {content}
          </Link>
        ) : (
          <Text key={key} style={styles.link}>
            {content}
          </Text>
        )
      }
      case 'image':
        return safeText(token.text || token.href)
      case 'html':
        return plainHtml(token.text)
      case 'checkbox':
        return token.checked ? '[x] ' : '[ ] '
      default:
        return 'text' in token && typeof token.text === 'string' ? safeText(token.text) : ''
    }
  })
}

function directImage(token: Token): Tokens.Image | undefined {
  if (token.type === 'image') return token as Tokens.Image
  if (token.type === 'link') {
    const link = token as Tokens.Link
    if (link.tokens.length === 1 && link.tokens[0]?.type === 'image') {
      return link.tokens[0] as Tokens.Image
    }
  }
  return undefined
}

function renderImage(token: Tokens.Image, images: ReadonlyMap<string, PdfImage>, key: string) {
  const id = embeddedImageId(token.href)
  const image = id ? images.get(id) : undefined
  if (!image) {
    return (
      <Text key={key} style={styles.imageFallback}>
        {token.text ? `Image: ${safeText(token.text)}` : 'Image unavailable'}
      </Text>
    )
  }
  return (
    <View key={key} style={styles.imageBlock}>
      <Image src={image} style={styles.image} />
    </View>
  )
}

function renderParagraph(
  tokens: Token[],
  images: ReadonlyMap<string, PdfImage>,
  keyPrefix: string
): ReactNode[] {
  const output: ReactNode[] = []
  let inline: Token[] = []

  const flushInline = () => {
    if (inline.length === 0) return
    output.push(
      <Text key={`${keyPrefix}-text-${output.length}`} style={styles.paragraph}>
        {renderInline(inline, `${keyPrefix}-inline-${output.length}`)}
      </Text>
    )
    inline = []
  }

  for (const token of tokens) {
    const image = directImage(token)
    if (!image) {
      inline.push(token)
      continue
    }
    flushInline()
    output.push(renderImage(image, images, `${keyPrefix}-image-${output.length}`))
  }
  flushInline()
  return output
}

function renderList(token: Tokens.List, images: ReadonlyMap<string, PdfImage>, key: string) {
  const start = typeof token.start === 'number' ? token.start : 1
  return (
    <View key={key} style={styles.list}>
      {token.items.map((item, index) => {
        const marker = item.task
          ? item.checked
            ? '[x]'
            : '[ ]'
          : token.ordered
            ? `${start + index}.`
            : '-'
        return (
          <View key={`${key}-${index}`} style={styles.listItem}>
            <Text style={styles.listMarker}>{marker}</Text>
            <View style={styles.listBody}>
              {item.tokens.map((itemToken, tokenIndex) =>
                itemToken.type === 'text' ? (
                  <Text key={`${key}-${index}-${tokenIndex}`} style={styles.listText}>
                    {renderInline(itemToken.tokens ?? [itemToken], `${key}-${index}-${tokenIndex}`)}
                  </Text>
                ) : (
                  renderBlock(itemToken, images, `${key}-${index}-${tokenIndex}`)
                )
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function renderTable(token: Tokens.Table, key: string) {
  const row = (cells: Tokens.TableCell[], rowKey: string, header: boolean) => (
    <View key={rowKey} style={styles.tableRow}>
      {cells.map((cell, index) => (
        <Text
          key={`${rowKey}-${index}`}
          style={[styles.tableCell, ...(header ? [styles.tableHeader] : [])]}
        >
          {renderInline(cell.tokens, `${rowKey}-${index}`)}
        </Text>
      ))}
    </View>
  )

  return (
    <View key={key} style={styles.table}>
      {row(token.header, `${key}-header`, true)}
      {token.rows.map((cells, index) => row(cells, `${key}-row-${index}`, false))}
    </View>
  )
}

function renderBlock(token: Token, images: ReadonlyMap<string, PdfImage>, key: string): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'heading': {
      const heading = token as Tokens.Heading
      const headingStyle = [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6][
        Math.min(Math.max(heading.depth, 1), 6) - 1
      ]
      return (
        <Text key={key} minPresenceAhead={20} style={headingStyle}>
          {renderInline(heading.tokens, key)}
        </Text>
      )
    }
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph
      return <View key={key}>{renderParagraph(paragraph.tokens, images, key)}</View>
    }
    case 'text':
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(token.tokens ?? [token], key)}
        </Text>
      )
    case 'code':
      return (
        <Text key={key} style={styles.codeBlock}>
          {safeText(token.text)}
        </Text>
      )
    case 'blockquote': {
      const blockquote = token as Tokens.Blockquote
      return (
        <View key={key} style={styles.blockquote}>
          {blockquote.tokens.map((child, index) => renderBlock(child, images, `${key}-${index}`))}
        </View>
      )
    }
    case 'list':
      return renderList(token as Tokens.List, images, key)
    case 'table':
      return renderTable(token as Tokens.Table, key)
    case 'hr':
      return <View key={key} style={styles.rule} />
    case 'html': {
      const text = plainHtml(token.text)
      return text ? (
        <Text key={key} style={styles.htmlFallback}>
          {text}
        </Text>
      ) : null
    }
    default:
      return 'text' in token && typeof token.text === 'string' ? (
        <Text key={key} style={styles.paragraph}>
          {safeText(token.text)}
        </Text>
      ) : null
  }
}

interface MarkdownDocumentProps {
  markdown: string
  title: string
  images: ReadonlyMap<string, PdfImage>
}

function MarkdownDocument({ markdown, title, images }: MarkdownDocumentProps) {
  const tokens = marked.lexer(markdown, { gfm: true })
  return (
    <Document creator='Sim' language='en' title={safeText(title)}>
      <Page size='A4' style={styles.page} wrap>
        {tokens.map((token, index) => renderBlock(token, images, `block-${index}`))}
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

  for (const [id, buffer] of images) {
    try {
      const pipeline = sharp(buffer, { limitInputPixels: MAX_PDF_IMAGE_INPUT_PIXELS })
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
      normalized.set(id, { data, format: 'png' })
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
  return renderToBuffer(
    <MarkdownDocument markdown={markdown} title={title} images={normalizedImages} />
  )
}
