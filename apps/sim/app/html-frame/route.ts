import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { htmlContentOrigin } from '@/lib/workspace-files/html-runtime/config'
import { htmlRuntimeCsp, htmlRuntimeShell } from '@/lib/workspace-files/html-runtime/shell'

/** Public bootstrap bytes only. Private document content arrives over a parent-bound MessagePort. */
export const GET = withRouteHandler(async (request) => {
  const appOrigin = new URL(getEnv('NEXT_PUBLIC_APP_URL')!).origin
  const origin = htmlContentOrigin(getEnv('HTML_CONTENT_ORIGIN'), appOrigin)
  if (request.headers.get('host') !== new URL(origin).host)
    return new NextResponse(null, { status: 404 })
  return new NextResponse(htmlRuntimeShell(appOrigin), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': htmlRuntimeCsp(appOrigin),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
    },
  })
})
