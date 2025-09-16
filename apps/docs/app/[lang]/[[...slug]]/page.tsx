import { findNeighbour } from 'fumadocs-core/server'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StructuredData } from '@/components/structured-data'
import { source } from '@/lib/source'

export const dynamic = 'force-dynamic'

export default async function Page(props: { params: Promise<{ slug?: string[]; lang: string }> }) {
  const params = await props.params
  const page = source.getPage(params.slug, params.lang)
  if (!page) notFound()

  const MDX = page.data.body
  const baseUrl = 'https://docs.sim.ai'

  const pageTreeRecord = source.pageTree as Record<string, any>
  const pageTree =
    pageTreeRecord[params.lang] ?? pageTreeRecord.en ?? Object.values(pageTreeRecord)[0]
  const neighbours = pageTree ? findNeighbour(pageTree, page.url) : null

  const CustomFooter = () => (
    <div className='mt-12 flex items-center justify-between border-border border-t py-8'>
      {neighbours?.previous ? (
        <Link
          href={neighbours.previous.url}
          className='group flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
        >
          <ChevronLeft className='group-hover:-translate-x-1 h-4 w-4 transition-transform' />
          <span className='font-medium'>{neighbours.previous.name}</span>
        </Link>
      ) : (
        <div />
      )}

      {neighbours?.next ? (
        <Link
          href={neighbours.next.url}
          className='group flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
        >
          <span className='font-medium'>{neighbours.next.name}</span>
          <ChevronRight className='h-4 w-4 transition-transform group-hover:translate-x-1' />
        </Link>
      ) : (
        <div />
      )}
    </div>
  )

  return (
    <>
      <StructuredData
        title={page.data.title}
        description={page.data.description || ''}
        url={`${baseUrl}${page.url}`}
        lang={params.lang}
      />
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        tableOfContent={{
          style: 'clerk',
          enabled: true,
          header: <div className='mb-2 font-medium text-sm'>On this page</div>,
          single: false,
        }}
        article={{
          className: 'scroll-smooth max-sm:pb-16',
        }}
        tableOfContentPopover={{
          style: 'clerk',
          enabled: true,
        }}
        footer={{
          enabled: true,
          component: <CustomFooter />,
        }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={defaultMdxComponents} />
        </DocsBody>
      </DocsPage>
    </>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[]; lang: string }>
}) {
  const params = await props.params
  const page = source.getPage(params.slug, params.lang)
  if (!page) notFound()

  const baseUrl = 'https://docs.sim.ai'
  const fullUrl = `${baseUrl}${page.url}`

  return {
    title: page.data.title,
    description:
      page.data.description || 'Sim visual workflow builder for AI applications documentation',
    keywords: [
      'AI workflow builder',
      'visual workflow editor',
      'AI automation',
      'workflow automation',
      'AI agents',
      'no-code AI',
      'drag and drop workflows',
      page.data.title?.toLowerCase().split(' '),
    ]
      .flat()
      .filter(Boolean),
    authors: [{ name: 'Sim Team' }],
    category: 'Developer Tools',
    openGraph: {
      title: page.data.title,
      description:
        page.data.description || 'Sim visual workflow builder for AI applications documentation',
      url: fullUrl,
      siteName: 'Sim Documentation',
      type: 'article',
      locale: params.lang,
      alternateLocale: ['en', 'fr', 'zh'].filter((lang) => lang !== params.lang),
    },
    twitter: {
      card: 'summary',
      title: page.data.title,
      description:
        page.data.description || 'Sim visual workflow builder for AI applications documentation',
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    canonical: fullUrl,
    alternates: {
      canonical: fullUrl,
      languages: {
        en: `${baseUrl}/en${page.url.replace(`/${params.lang}`, '')}`,
        fr: `${baseUrl}/fr${page.url.replace(`/${params.lang}`, '')}`,
        zh: `${baseUrl}/zh${page.url.replace(`/${params.lang}`, '')}`,
      },
    },
  }
}
