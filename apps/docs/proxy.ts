import { type NextRequest, NextResponse } from 'next/server'
import { prefersMarkdown } from '@/lib/http/negotiation'
import routes from '@/.content/routes.json'

const documentPaths = new Set(routes)

export default function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, '') || '/'
  const response =
    documentPaths.has(path) && prefersMarkdown(request.headers.get('accept'))
      ? NextResponse.rewrite(new URL(`/llms.mdx${path === '/' ? '' : path}`, request.nextUrl))
      : NextResponse.next()
  response.headers.append('Vary', 'Accept')
  return response
}

export const config = {
  matcher: [
    '/((?!api/|api$|llms.mdx|_next/|favicon|icon.svg|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt|openapi.json).*)',
  ],
}
