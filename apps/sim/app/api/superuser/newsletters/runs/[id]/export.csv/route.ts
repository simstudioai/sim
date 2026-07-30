import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { exportNewsletterRunCsvContract } from '@/lib/api/contracts/newsletters'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { isNewsletterResendError } from '@/lib/newsletters/resend'
import { createNewsletterCsvExport } from '@/lib/newsletters/runs'

const logger = createLogger('NewsletterCsvExportAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await validateNewsletterSuperuser()
      if (!auth.success) return auth.response

      const parsed = await parseRequest(exportNewsletterRunCsvContract, request, context)
      if (!parsed.success) return parsed.response

      const { filename, lines } = await createNewsletterCsvExport(parsed.data.params.id)
      const iterator = lines[Symbol.asyncIterator]()
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await iterator.next()
            if (next.done) {
              controller.close()
              return
            }
            controller.enqueue(encoder.encode(`${next.value}\n`))
          } catch (error) {
            logger.error('Failed while streaming newsletter CSV', {
              error: getErrorMessage(error),
            })
            controller.error(error)
          }
        },
        async cancel() {
          await iterator.return?.(undefined)
        },
      })

      return new NextResponse(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    } catch (error) {
      const message = getErrorMessage(error)
      if (/not found/i.test(message)) {
        return NextResponse.json({ error: 'Newsletter run not found' }, { status: 404 })
      }
      if (/Finalize/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      if (isNewsletterResendError(error)) {
        return NextResponse.json({ error: message }, { status: 503 })
      }
      logger.error('Failed to export newsletter CSV', { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
