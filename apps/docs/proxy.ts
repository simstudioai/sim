import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextRequest, NextResponse } from 'next/server'

const { rewrite: rewriteLLM } = rewritePath('/docs/*path', '/llms.mdx/*path')

export default function proxy(request: NextRequest) {
  if (isMarkdownPreferred(request)) {
    const result = rewriteLLM(request.nextUrl.pathname)

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon|icon.svg|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)',
  ],
}
