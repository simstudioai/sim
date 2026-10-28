import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** Public ownership challenge issued for the OpenAI plugin submission. */
export const GET = withRouteHandler(
  async () =>
    new Response('lFJ1-XIWpHGRNcgzTPl2Y_yYCTWLvlIbAvNRD08EvLI', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
)
