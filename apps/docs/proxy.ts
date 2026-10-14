import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextRequest, NextResponse } from 'next/server'

/** Docs pages live at the root (`/introduction`), so every page path maps to its markdown route. */
const { rewrite: rewriteLLM } = rewritePath('/*path', '/llms.mdx/*path')

/** `.md`/`.mdx` URLs already resolve to markdown through the `next.config.ts` rewrites. */
const MARKDOWN_SUFFIX = /\.mdx?$/

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isMarkdownPreferred(request) && !MARKDOWN_SUFFIX.test(pathname)) {
    const result = rewriteLLM(pathname)

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|llms.mdx|_next/static|_next/image|favicon|icon.svg|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)',
  ],
}
