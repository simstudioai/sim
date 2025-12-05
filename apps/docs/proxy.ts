import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware'
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'

const { rewrite: rewriteLLM } = rewritePath('/docs/*path', '/llms.mdx/*path')
const i18nProxy = createI18nMiddleware(i18n)

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isMarkdownPreferred(request)) {
    const result = rewriteLLM(request.nextUrl.pathname)

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl))
    }
  }

  return i18nProxy(request, event)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon|static|robots.txt|sitemap.xml|llms.txt|llms-full.txt).*)',
  ],
}
