import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ApiExamples, ApiReference } from '@/components/docs/api-reference'
import { Article } from '@/components/docs/article'
import { getMDXComponents } from '@/components/docs/mdx'
import { DocsShell } from '@/components/docs/shell'
import { StructuredData } from '@/components/structured-data'
import { getNavigation, getPage, getPages } from '@/lib/content/catalog'
import { DOCS_BASE_URL } from '@/lib/urls'
import { loadPage } from '@/.content/registry'

interface PageProps {
  params: Promise<{ slug?: string[] }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return getPages().map((page) => ({ slug: page.slugs }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = getPage((await params).slug)
  if (!page) notFound()
  const url = `${DOCS_BASE_URL}${page.url}`
  const image = `${DOCS_BASE_URL}/api/og?${new URLSearchParams({ title: page.title })}`
  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: url,
      types: {
        'text/markdown': `${url === `${DOCS_BASE_URL}/` ? `${DOCS_BASE_URL}/index` : url}.md`,
      },
    },
    openGraph: {
      type: 'article',
      title: page.title,
      description: page.description,
      url,
      siteName: 'Sim Documentation',
      images: [{ url: image, width: 1200, height: 675, alt: page.title }],
      ...(page.lastModified ? { modifiedTime: page.lastModified } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.description,
      images: [image],
    },
  }
}

export default async function Page({ params }: PageProps) {
  const page = getPage((await params).slug)
  if (!page) notFound()
  const MDX = page.operation ? undefined : (await loadPage(page.id)).default
  const breadcrumb = [{ name: 'Documentation', url: `${DOCS_BASE_URL}/introduction` }]
  for (let index = 1; index <= page.slugs.length; index++) {
    const ancestor = getPage(page.slugs.slice(0, index))
    if (ancestor && ancestor.url !== '/introduction')
      breadcrumb.push({ name: ancestor.title, url: `${DOCS_BASE_URL}${ancestor.url}` })
  }
  return (
    <DocsShell
      pathname={page.url}
      navigation={getNavigation(page.section)}
      headings={page.headings.filter((heading) => heading.depth <= 3)}
      api={Boolean(page.operation)}
    >
      <StructuredData
        title={page.title}
        description={page.description}
        url={`${DOCS_BASE_URL}${page.url}`}
        dateModified={page.lastModified}
        breadcrumb={breadcrumb}
      />
      <Article
        page={page}
        aside={page.operation ? <ApiExamples reference={page.operation} /> : undefined}
      >
        {page.operation ? (
          <ApiReference reference={page.operation} />
        ) : MDX ? (
          <MDX components={getMDXComponents()} />
        ) : null}
      </Article>
    </DocsShell>
  )
}
