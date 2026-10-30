import { getPage, getPages } from '@/lib/content/catalog'
import { getLLMText } from '@/lib/llms'
import { DOCS_BASE_URL } from '@/lib/urls'

export const dynamic = 'force-static'
export const dynamicParams = false

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = getPage(slug)
  if (!page) return new Response('Page not found', { status: 404 })
  return new Response(getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, must-revalidate',
      Vary: 'Accept',
      Link: `<${DOCS_BASE_URL}${page.url}>; rel="canonical"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function generateStaticParams() {
  return getPages().map((page) => ({ slug: page.slugs }))
}
