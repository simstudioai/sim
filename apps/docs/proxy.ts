import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextRequest, NextResponse } from 'next/server'

/** Docs pages live at the root (`/introduction`), so every page path maps to its markdown route. */
const { rewrite: rewriteLLM } = rewritePath('/*path', '/llms.mdx/*path')

/**
 * Docs page paths never carry an extension, so a final segment with one is a file or route
 * (`/openapi.json`, `/introduction.md`) that must not be rewritten to a markdown page.
 */
const FILE_EXTENSION = /\.[^/]+$/

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isMarkdownPreferred(request) && !FILE_EXTENSION.test(pathname)) {
    const result = rewriteLLM(pathname)

    if (result) {
      const response = NextResponse.rewrite(new URL(result, request.nextUrl))
      response.headers.append('Vary', 'Accept')
      return response
    }
  }

  const response = NextResponse.next()
  response.headers.append('Vary', 'Accept')
  return response
}

export const config = {
  matcher: [
    '/((?!api/|api$|llms.mdx|_next/static|_next/image|favicon|icon.svg|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)',
  ],
}
