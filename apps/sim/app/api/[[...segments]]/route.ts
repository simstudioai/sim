import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * JSON 404 for any `/api` path that matches no route file, so a mistyped API path never gets
 * the global HTML `not-found` page. Unauthenticated for the reasons on its `/api/v2` counterpart,
 * which keeps the v2 envelope for that prefix.
 */
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export const GET = withRouteHandler(notFound)
export const POST = withRouteHandler(notFound)
export const PUT = withRouteHandler(notFound)
export const PATCH = withRouteHandler(notFound)
export const DELETE = withRouteHandler(notFound)
export const HEAD = withRouteHandler(notFound)
export const OPTIONS = withRouteHandler(notFound)
