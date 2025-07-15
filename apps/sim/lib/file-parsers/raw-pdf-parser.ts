import { readFile } from 'fs/promises'
import { promisify } from 'util'
import zlib from 'zlib'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('RawPdfParser')

// Promisify zlib functions
const inflateAsync = promisify(zlib.inflate)
const unzipAsync = promisify(zlib.unzip)

/**
 * A simple PDF parser that extracts readable text from a PDF file.
 * This is used as a fallback when the pdf-parse library fails.
 */
export class RawPdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse file:', filePath)

      if (!filePath) {
        throw new Error('No file path provided')
      }

      // Read the file
      logger.info('Reading file...')
      const dataBuffer = await readFile(filePath)
      logger.info('File read successfully, size:', dataBuffer.length)

      return this.parseBuffer(dataBuffer)
    } catch (error) {
      logger.error('Error parsing PDF:', error)
      return {
        content: `Error parsing PDF: ${(error as Error).message}`,
        metadata: {
          error: (error as Error).message,
          pageCount: 0,
          version: 'unknown',
        },
      }
    }
  }

  async parseBuffer(dataBuffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse buffer, size:', dataBuffer.length)

      // Instead of trying to parse the binary PDF data directly,
      // we'll extract only the text sections that are readable

      // First convert to string but only for pattern matching, not for display
      const rawContent = dataBuffer.toString('utf-8')

      // Extract basic PDF info
      let version = 'Unknown'
      let pageCount = 0

      // Try to extract PDF version
      const versionMatch = rawContent.match(/%PDF-(\d+\.\d+)/)
      if (versionMatch?.[1]) {
        version = versionMatch[1]
      }

      // Count pages using multiple methods for redundancy
      // Method 1: Count "/Type /Page" occurrences (most reliable)
      const typePageMatches = rawContent.match(/\/Type\s*\/Page\b/gi)
      if (typePageMatches) {
        pageCount = typePageMatches.length
        logger.info('Found page count using /Type /Page:', pageCount)
      }

      // Method 2: Look for "/Page" dictionary references
      if (pageCount === 0) {
        const pageMatches = rawContent.match(/\/Page\s*\//gi)
        if (pageMatches) {
          pageCount = pageMatches.length
          logger.info('Found page count using /Page/ pattern:', pageCount)
        }
      }

      // Method 3: Look for "/Pages" object references
      if (pageCount === 0) {
        const pagesObjMatches = rawContent.match(/\/Pages\s+\d+\s+\d+\s+R/gi)
        if (pagesObjMatches && pagesObjMatches.length > 0) {
          // Extract the object reference
          const pagesObjRef = pagesObjMatches[0].match(/\/Pages\s+(\d+)\s+\d+\s+R/i)
          if (pagesObjRef?.[1]) {
            const objNum = pagesObjRef[1]
            // Find the referenced object
            const objRegex = new RegExp(`${objNum}\\s+0\\s+obj[\\s\\S]*?endobj`, 'i')
            const objMatch = rawContent.match(objRegex)
            if (objMatch) {
              // Look for /Count within the Pages object
              const countMatch = objMatch[0].match(/\/Count\s+(\d+)/i)
              if (countMatch?.[1]) {
                pageCount = Number.parseInt(countMatch[1], 10)
                logger.info('Found page count using /Count in Pages object:', pageCount)
              }
            }
          }
        }
      }

      // Method 4: Count trailer references to get an approximate count
      if (pageCount === 0) {
        const trailerMatches = rawContent.match(/trailer/gi)
        if (trailerMatches) {
          // This is just a rough estimate, not accurate
          pageCount = Math.max(1, Math.ceil(trailerMatches.length / 2))
          logger.info('Estimated page count using trailer references:', pageCount)
        }
      }

      // Default to at least 1 page if we couldn't find any
      if (pageCount === 0) {
        pageCount = 1
        logger.info('Defaulting to 1 page as no count was found')
      }

      // Extract text content using text markers commonly found in PDFs
      let extractedText = ''

      // Method 1: Extract text between BT (Begin Text) and ET (End Text) markers
      const textMatches = rawContent.match(/BT[\s\S]*?ET/g)
      if (textMatches && textMatches.length > 0) {
        logger.info('Found', textMatches.length, 'text blocks')

        extractedText = textMatches
          .map((textBlock) => {
            // Extract text objects (Tj, TJ) from the text block
            const textObjects = textBlock.match(/(\([^)]*\)|\[[^\]]*\])\s*(Tj|TJ)/g)
            if (textObjects && textObjects.length > 0) {
              return textObjects
                .map((obj) => {
                  // Clean up text objects
                  let text = ''
                  if (obj.includes('Tj')) {
                    // Handle Tj operator (simple string)
                    const match = obj.match(/\(([^)]*)\)\s*Tj/)
                    if (match?.[1]) {
                      text = match[1]
                    }
                  } else if (obj.includes('TJ')) {
                    // Handle TJ operator (array of strings and positioning)
                    const match = obj.match(/\[(.*)\]\s*TJ/)
                    if (match?.[1]) {
                      // Extract only the string parts from the array
                      const parts = match[1].match(/\([^)]*\)/g)
                      if (parts) {
                        text = parts.map((p) => p.slice(1, -1)).join(' ')
                      }
                    }
                  }

                  // Clean up PDF escape sequences
                  return text
                    .replace(/\\(\d{3})/g, (_, octal) =>
                      String.fromCharCode(Number.parseInt(octal, 8))
                    )
                    .replace(/\\\\/g, '\\')
                    .replace(/\\\(/g, '(')
                    .replace(/\\\)/g, ')')
                })
                .join(' ')
            }
            return ''
          })
          .join('\n')
          .trim()
      }

      // Try to extract metadata from XML
      let metadataText = ''
      const xmlMatch = rawContent.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/)
      if (xmlMatch) {
        const xmlContent = xmlMatch[0]
        logger.info('Found XML metadata')

        // Extract document title
        const titleMatch = xmlContent.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>(.*?)<\/rdf:li>/i)
        if (titleMatch?.[1]) {
          const title = titleMatch[1].replace(/<[^>]+>/g, '').trim()
          metadataText += `Document Title: ${title}\n\n`
        }

        // Extract creator/author
        const creatorMatch = xmlContent.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>(.*?)<\/rdf:li>/i)
        if (creatorMatch?.[1]) {
          const creator = creatorMatch[1].replace(/<[^>]+>/g, '').trim()
          metadataText += `Author: ${creator}\n`
        }

        // Extract creation date
        const dateMatch = xmlContent.match(/<xmp:CreateDate>(.*?)<\/xmp:CreateDate>/i)
        if (dateMatch?.[1]) {
          metadataText += `Created: ${dateMatch[1].trim()}\n`
        }

        // Extract producer
        const producerMatch = xmlContent.match(/<pdf:Producer>(.*?)<\/pdf:Producer>/i)
        if (producerMatch?.[1]) {
          metadataText += `Producer: ${producerMatch[1].trim()}\n`
        }
      }

      // Try to extract actual text content from content streams
      if (!extractedText || extractedText.length < 100 || extractedText.includes('/Type /Page')) {
        logger.info('Trying advanced text extraction from content streams')

        // Find content stream references
        const contentRefs = rawContent.match(/\/Contents\s+\[?\s*(\d+)\s+\d+\s+R\s*\]?/g)
        if (contentRefs && contentRefs.length > 0) {
          logger.info('Found', contentRefs.length, 'content stream references')

          // Extract object numbers from content references
          const objNumbers = contentRefs
            .map((ref) => {
              const match = ref.match(/\/Contents\s+\[?\s*(\d+)\s+\d+\s+R\s*\]?/)
              return match ? match[1] : null
            })
            .filter(Boolean)

          logger.info('Content stream object numbers:', objNumbers)

          // Try to find those objects in the content
          if (objNumbers.length > 0) {
            let textFromStreams = ''

            for (const objNum of objNumbers) {
              const objRegex = new RegExp(`${objNum}\\s+0\\s+obj[\\s\\S]*?endobj`, 'i')
              const objMatch = rawContent.match(objRegex)

              if (objMatch) {
                // Look for stream content within the object
                const streamMatch = objMatch[0].match(/stream\r?\n([\s\S]*?)\r?\nendstream/)
                if (streamMatch?.[1]) {
                  const streamContent = streamMatch[1]

                  // Look for text operations in the stream (Tj, TJ, etc.)
                  const textFragments = streamContent.match(/\([^)]+\)\s*Tj|\[[^\]]*\]\s*TJ/g)
                  if (textFragments && textFragments.length > 0) {
                    const extractedFragments = textFragments
                      .map((fragment) => {
                        if (fragment.includes('Tj')) {
                          return fragment
                            .replace(/\(([^)]*)\)\s*Tj/, '$1')
                            .replace(/\\(\d{3})/g, (_, octal) =>
                              String.fromCharCode(Number.parseInt(octal, 8))
                            )
                            .replace(/\\\\/g, '\\')
                            .replace(/\\\(/g, '(')
                            .replace(/\\\)/g, ')')
                        }
                        if (fragment.includes('TJ')) {
                          const parts = fragment.match(/\([^)]*\)/g)
                          if (parts) {
                            return parts
                              .map((p) =>
                                p
                                  .slice(1, -1)
                                  .replace(/\\(\d{3})/g, (_, octal) =>
                                    String.fromCharCode(Number.parseInt(octal, 8))
                                  )
                                  .replace(/\\\\/g, '\\')
                                  .replace(/\\\(/g, '(')
                                  .replace(/\\\)/g, ')')
                              )
                              .join(' ')
                          }
                        }
                        return ''
                      })
                      .filter(Boolean)
                      .join(' ')

                    if (extractedFragments.trim().length > 0) {
                      textFromStreams += `${extractedFragments.trim()}\n`
                    }
                  }
                }
              }
            }

            if (textFromStreams.trim().length > 0) {
              logger.info('Successfully extracted text from content streams')
              extractedText = textFromStreams.trim()
            }
          }
        }
      }

      // Try to decompress PDF streams
      // This is especially helpful for PDFs with compressed content
      if (!extractedText || extractedText.length < 100) {
        logger.info('Trying to decompress PDF streams')

        // Find compressed streams (FlateDecode)
        const compressedStreams = rawContent.match(
          /\/Filter\s*\/FlateDecode[\s\S]*?stream[\s\S]*?endstream/g
        )
        if (compressedStreams && compressedStreams.length > 0) {
          logger.info('Found', compressedStreams.length, 'compressed streams')

          // Process each stream
          const decompressedContents = await Promise.all(
            compressedStreams.map(async (stream) => {
              try {
                // Extract stream content between stream and endstream
                const streamMatch = stream.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)
                if (!streamMatch || !streamMatch[1]) return ''

                const compressedData = Buffer.from(streamMatch[1], 'binary')

                // Try different decompression methods
                try {
                  // Try inflate (most common)
                  const decompressed = await inflateAsync(compressedData)
                  const content = decompressed.toString('utf-8')

                  // Check if it contains readable text
                  const readable = content.replace(/[^\x20-\x7E\r\n]/g, ' ').trim()
                  if (
                    readable.length > 50 &&
                    readable.includes(' ') &&
                    (readable.includes('.') || readable.includes(',')) &&
                    !/[\x00-\x1F\x7F]/.test(readable)
                  ) {
                    return readable
                  }
                } catch (_inflateErr) {
                  // Try unzip as fallback
                  try {
                    const decompressed = await unzipAsync(compressedData)
                    const content = decompressed.toString('utf-8')

                    // Check if it contains readable text
                    const readable = content.replace(/[^\x20-\x7E\r\n]/g, ' ').trim()
                    if (
                      readable.length > 50 &&
                      readable.includes(' ') &&
                      (readable.includes('.') || readable.includes(',')) &&
                      !/[\x00-\x1F\x7F]/.test(readable)
                    ) {
                      return readable
                    }
                  } catch (_unzipErr) {
                    // Both methods failed, continue to next stream
                    return ''
                  }
                }
              } catch (_error) {
                // Error processing this stream, skip it
                return ''
              }

              return ''
            })
          )

          // Filter out empty results and combine
          const decompressedText = decompressedContents
            .filter((text) => text && text.length > 0)
            .join('\n\n')

          if (decompressedText && decompressedText.length > 0) {
            logger.info('Successfully decompressed text content, length:', decompressedText.length)
            extractedText = decompressedText
          }
        }
      }

      // Method 2: Look for text stream data
      if (!extractedText || extractedText.length < 50) {
        logger.info('Trying alternative text extraction method with streams')

        // Find text streams
        const streamMatches = rawContent.match(/stream[\s\S]*?endstream/g)
        if (streamMatches && streamMatches.length > 0) {
          logger.info('Found', streamMatches.length, 'streams')

          // Process each stream to look for text content
          const textContent = streamMatches
            .map((stream) => {
              // Remove 'stream' and 'endstream' markers
              const content = stream.replace(/^stream\r?\n|\r?\nendstream$/g, '')

              // Look for readable ASCII text (more strict heuristic)
              // Only keep ASCII printable characters
              const readable = content.replace(/[^\x20-\x7E\r\n]/g, ' ').trim()

              // Only keep content that looks like real text (has spaces, periods, etc.)
              if (
                readable.length > 20 &&
                readable.includes(' ') &&
                (readable.includes('.') || readable.includes(',')) &&
                !/[\x00-\x1F\x7F]/.test(readable)
              ) {
                return readable
              }
              return ''
            })
            .filter((text) => text.length > 0 && text.split(' ').length > 5) // Must have at least 5 words
            .join('\n\n')

          if (textContent.length > 0) {
            extractedText = textContent
          }
        }
      }

      // Method 3: Look for object streams
      if (!extractedText || extractedText.length < 50) {
        logger.info('Trying object streams for text')

        // Find object stream content
        const objMatches = rawContent.match(/\d+\s+\d+\s+obj[\s\S]*?endobj/g)
        if (objMatches && objMatches.length > 0) {
          logger.info('Found', objMatches.length, 'objects')

          // Process objects looking for text content
          const textContent = objMatches
            .map((obj) => {
              // Find readable text in the object - only keep ASCII printable characters
              const readable = obj.replace(/[^\x20-\x7E\r\n]/g, ' ').trim()

              // Only include if it looks like actual text (strict heuristic)
              if (
                readable.length > 50 &&
                readable.includes(' ') &&
                !readable.includes('/Filter') &&
                readable.split(' ').length > 10 &&
                (readable.includes('.') || readable.includes(','))
              ) {
                return readable
              }
              return ''
            })
            .filter((text) => text.length > 0)
            .join('\n\n')

          if (textContent.length > 0) {
            extractedText += (extractedText ? '\n\n' : '') + textContent
          }
        }
      }

      // If what we extracted is just PDF structure information rather than readable text,
      // provide a clearer message
      if (
        extractedText &&
        (extractedText.includes('endobj') ||
          extractedText.includes('/Type /Page') ||
          extractedText.match(/\d+\s+\d+\s+obj/g)) &&
        metadataText
      ) {
        logger.info(
          'Extracted content appears to be PDF structure information, using metadata instead'
        )
        extractedText = metadataText
      } else if (metadataText && !extractedText.includes('Document Title:')) {
        // Prepend metadata to extracted text if available
        extractedText = metadataText + (extractedText ? `\n\n${extractedText}` : '')
      }

      // Validate that the extracted text looks meaningful
      // Count how many recognizable words/characters it contains
      const validCharCount = (extractedText || '').replace(/[^\x20-\x7E\r\n]/g, '').length
      const totalCharCount = (extractedText || '').length
      const validRatio = validCharCount / (totalCharCount || 1)

      // Check for common PDF artifacts that indicate binary corruption
      const hasBinaryArtifacts =
        extractedText &&
        (extractedText.includes('\\u') ||
          extractedText.includes('\\x') ||
          extractedText.includes('\0') ||
          /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]{10,}/g.test(extractedText) ||
          validRatio < 0.7) // Less than 70% valid characters

      // Check if the content looks like gibberish
      const looksLikeGibberish =
        extractedText &&
        // Too many special characters
        (extractedText.replace(/[a-zA-Z0-9\s.,:'"()[\]{}]/g, '').length / extractedText.length >
          0.3 ||
          // Not enough spaces (real text has spaces between words)
          extractedText.split(' ').length < extractedText.length / 20)

      // If no text was extracted, or if it's binary/gibberish,
      // provide a helpful message instead
      if (!extractedText || extractedText.length < 50 || hasBinaryArtifacts || looksLikeGibberish) {
        logger.info('Could not extract meaningful text, providing fallback message')
        logger.info('Valid character ratio:', validRatio)
        logger.info('Has binary artifacts:', hasBinaryArtifacts)
        logger.info('Looks like gibberish:', looksLikeGibberish)

        // Start with metadata if available
        if (metadataText) {
          extractedText = `${metadataText}\n`
        } else {
          extractedText = ''
        }

        // Add basic PDF info
        extractedText += `This is a PDF document with ${pageCount} page(s) and version ${version}.\n\n`

        // Try to find a title in the PDF structure that we might have missed
        const titleInStructure =
          rawContent.match(/title\s*:\s*([^\n]+)/i) ||
          rawContent.match(/Microsoft Word -\s*([^\n]+)/i)

        if (titleInStructure?.[1] && !extractedText.includes('Document Title:')) {
          const title = titleInStructure[1].trim()
          extractedText = `Document Title: ${title}\n\n${extractedText}`
        }

        extractedText += `The text content could not be properly extracted due to encoding or compression issues.\nFile size: ${dataBuffer.length} bytes.\n\nTo view this PDF properly, please download the file and open it with a PDF reader.`
      }

      logger.info('PDF parsed with basic extraction, found text length:', extractedText.length)

      return {
        content: extractedText,
        metadata: {
          pageCount,
          info: {
            RawExtraction: true,
            Version: version,
            Size: dataBuffer.length,
          },
          version,
        },
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      return {
        content: `Error parsing PDF buffer: ${(error as Error).message}`,
        metadata: {
          error: (error as Error).message,
          pageCount: 0,
          version: 'unknown',
        },
      }
    }
  }
}
