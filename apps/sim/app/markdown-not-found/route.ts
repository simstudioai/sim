import { toSiteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { DOCS_URL } from '@/lib/help-links'

const NOT_FOUND_MARKDOWN = `# Page not found

There is no page at this address. It may have moved or never existed.

- [Sim home](${toSiteUrl('/')})
- [Documentation](${DOCS_URL})
- [llms.txt](${toSiteUrl('/llms.txt')}): an index of every public page
- [Sitemap](${toSiteUrl('/sitemap.xml')})
`

/**
 * The 404 body for a client that asks for Markdown. `next.config.ts` rewrites an unmatched path
 * here, whatever its method, only when its `Accept` header names `text/markdown`, so browsers keep
 * the HTML `not-found` page. Uncached like that page, and `Vary: Accept` because the same URL
 * answers both ways.
 */
const notFound = withRouteHandler(
  () =>
    new Response(NOT_FOUND_MARKDOWN, {
      status: 404,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Accept',
      },
    })
)

export const GET = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const OPTIONS = notFound
