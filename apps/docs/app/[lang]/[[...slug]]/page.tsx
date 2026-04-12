import type React from 'react'
import type { Root } from 'fumadocs-core/page-tree'
import { findNeighbour } from 'fumadocs-core/page-tree'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { createAPIPage } from 'fumadocs-openapi/ui'
import { Pre } from 'fumadocs-ui/components/codeblock'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import { PageFooter } from '@/components/docs-layout/page-footer'
import { PageNavigationArrows } from '@/components/docs-layout/page-navigation-arrows'
import { LLMCopyButton } from '@/components/page-actions'
import { StructuredData } from '@/components/structured-data'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { ResponseSection } from '@/components/ui/response-section'
import { i18n } from '@/lib/i18n'
import { getApiSpecContent, openapi } from '@/lib/openapi'
import { type PageData, source } from '@/lib/source'

const SUPPORTED_LANGUAGES: Set<string> = new Set(i18n.languages)
const BASE_URL = 'https://docs.sim.ai'

const OG_LOCALE_MAP: Record<string, string> = {
  en: 'en_US',
  es: 'es_ES',
  fr: 'fr_FR',
  de: 'de_DE',
  ja: 'ja_JP',
  zh: 'zh_CN',
}

function resolveLangAndSlug(params: { slug?: string[]; lang: string }) {
  const isValidLang = SUPPORTED_LANGUAGES.has(params.lang)
  const lang = isValidLang ? params.lang : 'en'
  const slug = isValidLang ? params.slug : [params.lang, ...(params.slug ?? [])]
  return { lang, slug }
}

const APIPage = createAPIPage(openapi, {
  playground: { enabled: false },
  content: {
    renderOperationLayout: async (slots) => {
      return (
        <div className='flex @4xl:flex-row flex-col @4xl:items-start gap-x-6 gap-y-4'>
          <div className='min-w-0 flex-1'>
            {slots.header}
            {slots.apiPlayground}
            {slots.authSchemes && <div className='api-section-divider'>{slots.authSchemes}</div>}
            {slots.paremeters}
            {slots.body && <div className='api-section-divider'>{slots.body}</div>}
            <ResponseSection>{slots.responses}</ResponseSection>
            {slots.callbacks}
          </div>
          <div className='@4xl:sticky @4xl:top-[calc(var(--fd-docs-row-1,2rem)+1rem)] @4xl:w-[400px]'>
            {slots.apiExample}
          </div>
        </div>
      )
    },
  },
})

export default async function Page(props: { params: Promise<{ slug?: string[]; lang: string }> }) {
  const params = await props.params
  const { lang, slug } = resolveLangAndSlug(params)
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  const data = page.data as unknown as PageData & {
    _openapi?: { method?: string }
    getAPIPageProps?: () => ApiPageProps
  }
  const isOpenAPI = '_openapi' in data && data._openapi != null
  const isApiReference = slug?.some((s) => s === 'api-reference') ?? false

  const pageTreeRecord = source.pageTree as Record<string, Root>
  const pageTree = pageTreeRecord[lang] ?? pageTreeRecord.en ?? Object.values(pageTreeRecord)[0]
  const rawNeighbours = pageTree ? findNeighbour(pageTree, page.url) : null
  const neighbours = isApiReference
    ? {
        previous: rawNeighbours?.previous?.url.includes('/api-reference/')
          ? rawNeighbours.previous
          : undefined,
        next: rawNeighbours?.next?.url.includes('/api-reference/') ? rawNeighbours.next : undefined,
      }
    : rawNeighbours

  const generateBreadcrumbs = () => {
    const breadcrumbs: Array<{ name: string; url: string }> = [
      {
        name: 'Home',
        url: BASE_URL,
      },
    ]

    const urlParts = page.url.split('/').filter(Boolean)
    let currentPath = ''

    urlParts.forEach((part, index) => {
      if (index === 0 && SUPPORTED_LANGUAGES.has(part)) {
        currentPath = `/${part}`
        return
      }

      currentPath += `/${part}`

      const name = part
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

      if (index === urlParts.length - 1) {
        breadcrumbs.push({
          name: data.title,
          url: `${BASE_URL}${page.url}`,
        })
      } else {
        breadcrumbs.push({
          name: name,
          url: `${BASE_URL}${currentPath}`,
        })
      }
    })

    return breadcrumbs
  }

  const breadcrumbs = generateBreadcrumbs()
  const footer = <PageFooter previous={neighbours?.previous} next={neighbours?.next} />

  if (isOpenAPI && data.getAPIPageProps) {
    const apiProps = data.getAPIPageProps()
    const apiPageContent = getApiSpecContent(
      data.title,
      data.description,
      apiProps.operations ?? []
    )

    return (
      <>
        <StructuredData
          title={data.title}
          description={data.description || ''}
          url={`${BASE_URL}${page.url}`}
          lang={lang}
          breadcrumb={breadcrumbs}
        />
        <DocsPage
          toc={data.toc}
          breadcrumb={{
            enabled: false,
          }}
          tableOfContent={{
            style: 'clerk',
            enabled: false,
          }}
          tableOfContentPopover={{
            style: 'clerk',
            enabled: false,
          }}
          footer={{
            enabled: true,
            component: footer,
          }}
        >
          <div className='api-page-header relative mt-6 sm:mt-0'>
            <div className='absolute top-1 right-0 flex items-center gap-2'>
              <div className='hidden sm:flex'>
                <LLMCopyButton content={apiPageContent} />
              </div>
              <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
            </div>
            <DocsTitle className='mb-2'>{data.title}</DocsTitle>
            <DocsDescription>{data.description}</DocsDescription>
          </div>
          <DocsBody>
            <APIPage {...apiProps} />
          </DocsBody>
        </DocsPage>
      </>
    )
  }

  const MDX = data.body
  const markdownContent = await data.getText('processed')

  return (
    <>
      <StructuredData
        title={data.title}
        description={data.description || ''}
        url={`${BASE_URL}${page.url}`}
        lang={lang}
        breadcrumb={breadcrumbs}
      />
      <DocsPage
        toc={data.toc}
        full={data.full}
        breadcrumb={{
          enabled: false,
        }}
        tableOfContent={{
          style: 'clerk',
          enabled: true,
          single: false,
        }}
        tableOfContentPopover={{
          style: 'clerk',
          enabled: true,
        }}
        footer={{
          enabled: true,
          component: footer,
        }}
      >
        <div className='relative mt-6 sm:mt-0'>
          <div className='absolute top-1 right-0 flex items-center gap-2'>
            <div className='hidden sm:flex'>
              <LLMCopyButton content={markdownContent} />
            </div>
            <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
          </div>
          <DocsTitle className='mb-2'>{data.title}</DocsTitle>
          <DocsDescription>{data.description}</DocsDescription>
        </div>
        <DocsBody>
          <MDX
            components={{
              ...defaultMdxComponents,
              pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
                <CodeBlock {...props}>
                  <Pre>{props.children}</Pre>
                </CodeBlock>
              ),
              h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h1' {...props} />
              ),
              h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h2' {...props} />
              ),
              h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h3' {...props} />
              ),
              h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h4' {...props} />
              ),
              h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h5' {...props} />
              ),
              h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <Heading as='h6' {...props} />
              ),
            }}
          />
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
  const { lang, slug } = resolveLangAndSlug(params)
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  const data = page.data as unknown as PageData
  const fullUrl = `${BASE_URL}${page.url}`

  const ogImageUrl = `${BASE_URL}/api/og?title=${encodeURIComponent(data.title)}`

  return {
    title: data.title,
    description:
      data.description ||
      'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents.',
    keywords: [
      'AI agents',
      'AI workspace',
      'AI agent builder',
      'build AI agents',
      'LLM orchestration',
      'AI automation',
      'knowledge base',
      'AI integrations',
      data.title?.toLowerCase().split(' '),
    ]
      .flat()
      .filter(Boolean),
    authors: [{ name: 'Sim Team' }],
    category: 'Developer Tools',
    openGraph: {
      title: data.title,
      description:
        data.description ||
        'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents.',
      url: fullUrl,
      siteName: 'Sim Documentation',
      type: 'article',
      locale: OG_LOCALE_MAP[lang] ?? 'en_US',
      alternateLocale: i18n.languages
        .filter((l) => l !== lang)
        .map((l) => OG_LOCALE_MAP[l] ?? 'en_US'),
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: data.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: data.title,
      description:
        data.description ||
        'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents.',
      images: [ogImageUrl],
      creator: '@simdotai',
      site: '@simdotai',
    },
    canonical: fullUrl,
    alternates: {
      canonical: fullUrl,
      languages: {
        'x-default': `${BASE_URL}${page.url.replace(`/${lang}`, '')}`,
        en: `${BASE_URL}${page.url.replace(`/${lang}`, '')}`,
        es: `${BASE_URL}/es${page.url.replace(`/${lang}`, '')}`,
        fr: `${BASE_URL}/fr${page.url.replace(`/${lang}`, '')}`,
        de: `${BASE_URL}/de${page.url.replace(`/${lang}`, '')}`,
        ja: `${BASE_URL}/ja${page.url.replace(`/${lang}`, '')}`,
        zh: `${BASE_URL}/zh${page.url.replace(`/${lang}`, '')}`,
      },
    },
  }
}
