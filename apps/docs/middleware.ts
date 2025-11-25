import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware'
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'

const { rewrite: rewriteLLM } = rewritePath('/docs/*path', '/llms.mdx/*path')
const i18nMiddleware = createI18nMiddleware(i18n)

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // Check if the request prefers markdown content (from AI agents)
  if (isMarkdownPreferred(request)) {
    const result = rewriteLLM(request.nextUrl.pathname)

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl))
    }
  }

  // Otherwise, use default i18n middleware
  return i18nMiddleware(request, event)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)',
  ],
}
