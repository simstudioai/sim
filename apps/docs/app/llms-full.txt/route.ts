import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

export const dynamic = 'force-static'

export async function GET() {
  const pages = source.getPages().filter((page) => Boolean(page?.data && page.url))
  const encoder = new TextEncoder()
  let nextPage = 0
  let hasContent = false
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
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
    },
    cancel() {
      cancelled = true
    },
  })
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
