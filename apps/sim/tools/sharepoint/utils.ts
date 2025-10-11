import { createLogger } from '@/lib/logs/console/logger'
import type { CanvasLayout } from '@/tools/sharepoint/types'

const logger = createLogger('SharepointUtils')

function stripHtmlTags(html: string): string {
  let text = html
  let previous: string

  do {
    previous = text
    text = text.replace(/<[^>]*>/g, '')
    text = text.replace(/[<>]/g, '')
  } while (text !== previous)

  return text.trim()
}

export function extractTextFromCanvasLayout(canvasLayout: CanvasLayout | null | undefined): string {
  logger.info('Extracting text from canvas layout', {
    hasCanvasLayout: !!canvasLayout,
    hasHorizontalSections: !!canvasLayout?.horizontalSections,
    sectionsCount: canvasLayout?.horizontalSections?.length || 0,
  })

  if (!canvasLayout?.horizontalSections) {
    logger.info('No canvas layout or horizontal sections found')
    return ''
  }

  const textParts: string[] = []

  for (const section of canvasLayout.horizontalSections) {
    logger.info('Processing section', {
      sectionId: section.id,
      hasColumns: !!section.columns,
      hasWebparts: !!section.webparts,
      columnsCount: section.columns?.length || 0,
    })

    if (section.columns) {
      for (const column of section.columns) {
        if (column.webparts) {
          for (const webpart of column.webparts) {
            logger.info('Processing webpart', {
              webpartId: webpart.id,
              hasInnerHtml: !!webpart.innerHtml,
              innerHtml: webpart.innerHtml,
            })

            if (webpart.innerHtml) {
              const text = stripHtmlTags(webpart.innerHtml)
              if (text) {
                textParts.push(text)
                logger.info('Extracted text', { text })
              }
            }
          }
        }
      }
    } else if (section.webparts) {
      for (const webpart of section.webparts) {
        if (webpart.innerHtml) {
          const text = stripHtmlTags(webpart.innerHtml)
          if (text) textParts.push(text)
        }
      }
    }
  }

  const finalContent = textParts.join('\n\n')
  logger.info('Final extracted content', {
    textPartsCount: textParts.length,
    finalContentLength: finalContent.length,
    finalContent,
  })

  return finalContent
}

export function cleanODataMetadata<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanODataMetadata(item)) as T
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.includes('@odata')) continue

    cleaned[key] = cleanODataMetadata(value)
  }

  return cleaned as T
}
