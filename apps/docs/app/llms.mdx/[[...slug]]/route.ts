import { notFound } from 'next/navigation'
import { type NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'
import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params

  let lang: (typeof i18n.languages)[number] = i18n.defaultLanguage
  let pageSlug = slug

  if (slug && slug.length > 0 && i18n.languages.includes(slug[0] as typeof lang)) {
    lang = slug[0] as typeof lang
    pageSlug = slug.slice(1)
  }

  const page = source.getPage(pageSlug, lang)
  if (!page) notFound()

  return new NextResponse(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  })
}

export function generateStaticParams() {
  return source.generateParams()
}
