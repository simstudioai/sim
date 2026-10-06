import { createLogger } from '@sim/logger'
import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

const logger = createLogger('DocsLlmsFullText')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const pages = source.getPages().filter((page) => Boolean(page?.data && page.url))
    const encoder = new TextEncoder()
    let nextPage = 0
    let hasContent = false
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (nextPage < pages.length) {
            const page = pages[nextPage]
            nextPage += 1
            const text = await getLLMText(page)
            if (cancelled) return
            if (!text) continue
            controller.enqueue(encoder.encode(`${hasContent ? '\n\n---\n\n' : ''}${text}`))
            hasContent = true
            return
          }
          controller.close()
        } catch (error) {
          if (cancelled) return
          logger.error('Error streaming LLM full text:', error)
          controller.error(error)
        }
      },
      cancel() {
        cancelled = true
      },
    })
    return new Response(body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (error) {
    logger.error('Error generating LLM full text:', error)
    return new Response('Error generating full documentation text', { status: 500 })
  }
}
