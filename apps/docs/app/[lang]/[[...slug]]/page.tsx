import type React from 'react'
import type { Root } from 'fumadocs-core/page-tree'
import { findNeighbour } from 'fumadocs-core/page-tree'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { createAPIPage } from 'fumadocs-openapi/ui'
import { Pre } from 'fumadocs-ui/components/codeblock'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageNavigationArrows } from '@/components/docs-layout/page-navigation-arrows'
import { TOCFooter } from '@/components/docs-layout/toc-footer'
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

  const CustomFooter = () => (
    <div className='mt-12'>
      <div className='flex items-center justify-between py-8'>
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

      <div className='border-border border-t' />

      <div className='flex items-center gap-4 py-6'>
        <Link
          href='https://x.com/simdotai'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='X (Twitter)'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
        <Link
          href='https://github.com/simstudioai/sim'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='GitHub'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
        <Link
          href='https://discord.gg/Hr4UWYEcTT'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Discord'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
      </div>
    </div>
  )

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
            component: <CustomFooter />,
          }}
        >
          <div className='api-page-header relative mt-6 sm:mt-0'>
            <div className='absolute top-1 right-0 flex items-center gap-2'>
              <div className='hidden sm:flex'>
                <LLMCopyButton content={apiPageContent} />
              </div>
              <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
            </div>
            <DocsTitle>{data.title}</DocsTitle>
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
          footer: <TOCFooter />,
          single: false,
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
        <div className='relative mt-6 sm:mt-0'>
          <div className='absolute top-1 right-0 flex items-center gap-2'>
            <div className='hidden sm:flex'>
              <LLMCopyButton content={markdownContent} />
            </div>
            <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
          </div>
          <DocsTitle>{data.title}</DocsTitle>
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
      data.description || 'Sim visual workflow builder for AI applications documentation',
    keywords: [
      'AI workflow builder',
      'visual workflow editor',
      'AI automation',
      'workflow automation',
      'AI agents',
      'no-code AI',
      'drag and drop workflows',
      data.title?.toLowerCase().split(' '),
    ]
      .flat()
      .filter(Boolean),
    authors: [{ name: 'Sim Team' }],
    category: 'Developer Tools',
    openGraph: {
      title: data.title,
      description:
        data.description || 'Sim visual workflow builder for AI applications documentation',
      url: fullUrl,
      siteName: 'Sim Documentation',
      type: 'article',
      locale: lang === 'en' ? 'en_US' : `${lang}_${lang.toUpperCase()}`,
      alternateLocale: ['en', 'es', 'fr', 'de', 'ja', 'zh']
        .filter((l) => l !== lang)
        .map((l) => (l === 'en' ? 'en_US' : `${l}_${l.toUpperCase()}`)),
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
        data.description || 'Sim visual workflow builder for AI applications documentation',
      images: [ogImageUrl],
      creator: '@simdotai',
      site: '@simdotai',
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
