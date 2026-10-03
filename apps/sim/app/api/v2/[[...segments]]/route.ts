import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * JSON 404 for any `/api/v2` path that matches no route file.
 *
 * Without it a mistyped path falls through to the app's global `not-found`
 * page and hands an API client a full HTML document, which is the one v2
 * response a JSON-parsing caller cannot read. This route keeps unknown paths in
 * the canonical `{ error: { code, message } }` envelope.
 *
 * This is a documented raw-`withRouteHandler` route rather than a contract
 * builder: it has no contract, no operation, and no authentication, because a
 * caller probing an unknown path must get the same answer whether or not it
 * holds a key — requiring auth first would turn the 404 into a 401 and confirm
 * that the path is special.
 *
 * Next.js only routes a request here when no literal segment matches, so every
 * real v2 route file is unaffected, however many there are. The optional form (`[[...segments]]`) also
 * covers bare `/api/v2`. It cannot fix a 405 on a path that *does* have a route
 * file but does not export that verb — Next generates that response itself,
 * before any handler runs.
 */
const notFound = () => v2Error('NOT_FOUND', 'Not found')

export const GET = withRouteHandler(notFound)
export const POST = withRouteHandler(notFound)
export const PUT = withRouteHandler(notFound)
export const PATCH = withRouteHandler(notFound)
export const DELETE = withRouteHandler(notFound)
export const HEAD = withRouteHandler(notFound)
export const OPTIONS = withRouteHandler(notFound)
