import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { getPage } from '@/lib/content/catalog'
import { pagePathSchema } from '@/lib/http/pages'

const logger = createLogger('DocsFeedback')
const feedbackSchema = z
  .object({
    submissionId: z.uuid(),
    page: pagePathSchema,
    helpful: z.boolean(),
    comment: z.string().trim().max(2000),
  })
  .strict()
const MAX_BODY_BYTES = 12_288

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers })
  const requestUrl = new URL(request.url)
  const host = request.headers.get('host')
  if (!host || request.headers.get('origin') !== `${requestUrl.protocol}//${host}`) {
    return fail('Feedback must be submitted from this site.', 403)
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return fail('Expected JSON.', 415)
  }
  const reader = request.body?.getReader()
  if (!reader) return fail('Feedback is required.', 400)
  let text = ''
  let bytes = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return fail('Feedback is too long.', 413)
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    return fail('Could not read feedback.', 400)
  } finally {
    reader.releaseLock()
  }
  let input: z.infer<typeof feedbackSchema>
  try {
    input = feedbackSchema.parse(JSON.parse(text))
  } catch {
    return fail('Check your feedback and try again.', 400)
  }
  const page = getPage(input.page.replace(/\/$/, '') || '/')
  if (!page || page.url === '/') return fail('Documentation page not found.', 404)
  const endpoint = process.env.DOCS_FEEDBACK_WEBHOOK_URL
  const token = process.env.DOCS_FEEDBACK_WEBHOOK_TOKEN
  if (!endpoint || !token) return fail('Feedback is temporarily unavailable.', 503)
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') throw new Error('Invalid feedback configuration')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        submission_id: input.submissionId,
        page: page.url,
        helpful: input.helpful,
        comment: input.comment,
        received_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    if (!response.ok) {
      logger.warn('Feedback intake rejected submission', { status: response.status })
      return fail('Could not send feedback. Please try again.', 502)
    }
    const receipt: unknown = await response.json()
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      !('message' in receipt) ||
      receipt.message !== 'Webhook processed'
    ) {
      return fail('Could not confirm feedback. Please try again.', 502)
    }
    return Response.json({ accepted: true }, { status: 202, headers })
  } catch {
    logger.warn('Feedback intake unavailable')
    return fail('Could not send feedback. Please try again.', 503)
  }
}
