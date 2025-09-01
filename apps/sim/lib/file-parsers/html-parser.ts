import { readFile } from 'fs/promises'
import * as cheerio from 'cheerio'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('HtmlParser')

export class HtmlParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('HTML file error:', error)
      throw new Error(`Failed to parse HTML file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing HTML buffer, size:', buffer.length)

      const htmlContent = buffer.toString('utf-8')
      const $ = cheerio.load(htmlContent)

      // Extract meta information before removing tags
      const title = $('title').text().trim()
      const metaDescription = $('meta[name="description"]').attr('content') || ''

      $('script, style, noscript, meta, link, iframe, object, embed, svg').remove()

      $.root()
        .contents()
        .filter(function () {
          return this.type === 'comment'
        })
        .remove()

      const content = this.extractStructuredText($)

      const sanitizedContent = sanitizeTextForUTF8(content)

      const characterCount = sanitizedContent.length
      const wordCount = sanitizedContent.split(/\s+/).filter((word) => word.length > 0).length
      const estimatedTokenCount = Math.ceil(characterCount / 4)

      const headings = this.extractHeadings($)

      const links = this.extractLinks($)

      return {
        content: sanitizedContent,
        metadata: {
          title,
          metaDescription,
          characterCount,
          wordCount,
          tokenCount: estimatedTokenCount,
          headings,
          links: links.slice(0, 50),
          hasImages: $('img').length > 0,
          imageCount: $('img').length,
          hasTable: $('table').length > 0,
          tableCount: $('table').length,
          hasList: $('ul, ol').length > 0,
          listCount: $('ul, ol').length,
        },
      }
    } catch (error) {
      logger.error('HTML buffer parsing error:', error)
      throw new Error(`Failed to parse HTML buffer: ${(error as Error).message}`)
    }
  }

  /**
   * Extract structured text content preserving document hierarchy
   */
  private extractStructuredText($: cheerio.CheerioAPI): string {
    const contentParts: string[] = []

    const rootElement = $('body').length > 0 ? $('body') : $.root()

    this.processElement($, rootElement, contentParts, 0)

    return contentParts.join('\n').trim()
  }

  /**
   * Recursively process elements to extract text with structure
   */
  private processElement(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<any>,
    contentParts: string[],
    depth: number
  ): void {
    element.contents().each((_, node) => {
      if (node.type === 'text') {
        const text = $(node).text().trim()
        if (text) {
          contentParts.push(text)
        }
      } else if (node.type === 'tag') {
        const $node = $(node)
        const tagName = node.tagName?.toLowerCase()

        switch (tagName) {
          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6': {
            const headingText = $node.text().trim()
            if (headingText) {
              contentParts.push(`\n${headingText}\n`)
            }
            break
          }

          case 'p': {
            const paragraphText = $node.text().trim()
            if (paragraphText) {
              contentParts.push(`${paragraphText}\n`)
            }
            break
          }

          case 'br':
            contentParts.push('\n')
            break

          case 'hr':
            contentParts.push('\n---\n')
            break

          case 'li': {
            const listItemText = $node.text().trim()
            if (listItemText) {
              const indent = '  '.repeat(Math.min(depth, 3))
              contentParts.push(`${indent}• ${listItemText}`)
            }
            break
          }

          case 'ul':
          case 'ol':
            contentParts.push('\n')
            this.processElement($, $node, contentParts, depth + 1)
            contentParts.push('\n')
            break

          case 'table':
            this.processTable($, $node, contentParts)
            break

          case 'blockquote': {
            const quoteText = $node.text().trim()
            if (quoteText) {
              contentParts.push(`\n> ${quoteText}\n`)
            }
            break
          }

          case 'pre':
          case 'code': {
            const codeText = $node.text().trim()
            if (codeText) {
              contentParts.push(`\n\`\`\`\n${codeText}\n\`\`\`\n`)
            }
            break
          }

          case 'div':
          case 'section':
          case 'article':
          case 'main':
          case 'aside':
          case 'nav':
          case 'header':
          case 'footer':
            this.processElement($, $node, contentParts, depth)
            break

          case 'a': {
            const linkText = $node.text().trim()
            const href = $node.attr('href')
            if (linkText) {
              if (href?.startsWith('http')) {
                contentParts.push(`${linkText} (${href})`)
              } else {
                contentParts.push(linkText)
              }
            }
            break
          }

          case 'img': {
            const alt = $node.attr('alt')
            if (alt) {
              contentParts.push(`[Image: ${alt}]`)
            }
            break
          }

          default:
            this.processElement($, $node, contentParts, depth)
        }
      }
    })
  }

  /**
   * Process table elements to extract structured data
   */
  private processTable(
    $: cheerio.CheerioAPI,
    table: cheerio.Cheerio<any>,
    contentParts: string[]
  ): void {
    contentParts.push('\n[Table]')

    table.find('tr').each((_, row) => {
      const $row = $(row)
      const cells: string[] = []

      $row.find('td, th').each((_, cell) => {
        const cellText = $(cell).text().trim()
        cells.push(cellText || '')
      })

      if (cells.length > 0) {
        contentParts.push(`| ${cells.join(' | ')} |`)
      }
    })

    contentParts.push('[/Table]\n')
  }

  /**
   * Extract heading structure for metadata
   */
  private extractHeadings($: cheerio.CheerioAPI): Array<{ level: number; text: string }> {
    const headings: Array<{ level: number; text: string }> = []

    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $element = $(element)
      const tagName = element.tagName?.toLowerCase()
      const level = Number.parseInt(tagName?.charAt(1) || '1', 10)
      const text = $element.text().trim()

      if (text) {
        headings.push({ level, text })
      }
    })

    return headings
  }

  /**
   * Extract links from the document
   */
  private extractLinks($: cheerio.CheerioAPI): Array<{ text: string; href: string }> {
    const links: Array<{ text: string; href: string }> = []

    $('a[href]').each((_, element) => {
      const $element = $(element)
      const href = $element.attr('href')
      const text = $element.text().trim()

      if (href && text && href.startsWith('http')) {
        links.push({ text, href })
      }
    })

    return links
  }
}
