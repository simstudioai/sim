import { createLogger } from '@/lib/logs/console/logger'
import type { CanvasLayout } from '@/tools/sharepoint/types'

const logger = createLogger('SharepointUtils')

// Extract readable text from SharePoint canvas layout
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
              // Extract text from HTML, removing tags
              const text = webpart.innerHtml.replace(/<[^>]*>/g, '').trim()
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
          const text = webpart.innerHtml.replace(/<[^>]*>/g, '').trim()
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

// Remove OData metadata from objects
export function cleanODataMetadata<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanODataMetadata(item)) as T
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip OData metadata keys
    if (key.includes('@odata')) continue

    cleaned[key] = cleanODataMetadata(value)
  }

  return cleaned as T
}
