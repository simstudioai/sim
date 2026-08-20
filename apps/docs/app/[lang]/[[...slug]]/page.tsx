import type React from 'react'
import { highlight } from 'fumadocs-core/highlight'
import type { Root } from 'fumadocs-core/page-tree'
import { findNeighbour } from 'fumadocs-core/page-tree'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { createAPIPage } from 'fumadocs-openapi/ui'
import { Pre } from 'fumadocs-ui/components/codeblock'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import { PageFooter } from '@/components/docs-layout/page-footer'
import { PageNavigationArrows } from '@/components/docs-layout/page-navigation-arrows'
import { LLMCopyButton } from '@/components/page-actions'
import { StructuredData } from '@/components/structured-data'
import { APIExampleSelector } from '@/components/ui/api-example-selector'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { ResponseSection } from '@/components/ui/response-section'
import { i18n } from '@/lib/i18n'
import { getApiSpecContent, getAuthenticatedCodeSamples, openapi } from '@/lib/openapi'
import { simShikiOptions } from '@/lib/shiki-theme'
import { type PageData, source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

const SUPPORTED_LANGUAGES: Set<string> = new Set(i18n.languages)
const BASE_URL = DOCS_BASE_URL

/**
 * Most pages close with a `## Next` / `## Next steps` grid of onward links.
 * That heading is navigation, not content, so it is kept out of the table of
 * contents — the ToC should say what the page covers, not where to go after it.
 * The heading itself still renders above the cards.
 *
 * Matched on the slug rather than the rendered title because a ToC title is a
 * `ReactNode`; the trailing group tolerates the slugger's dedupe suffix.
 */
const ONWARD_NAV_SLUG = /^#next(-steps)?(-\d+)?$/i

function isContentHeading(item: { url: string }): boolean {
  return !ONWARD_NAV_SLUG.test(item.url)
}

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

/**
 * Strips a leading `/{lang}` path segment from a page URL. Unlike a naive
 * `String.replace`, this only removes the locale when it is actually the
 * first path segment — a plain substring replace would also match `/en`
 * inside unrelated slugs (e.g. `/platform/enterprise`, `/integrations/enrich`,
 * `/platform/self-hosting/environment-variables`), corrupting canonical and
 * hreflang URLs for those pages.
 */
function stripLocalePrefix(url: string, lang: string): string {
  const prefix = `/${lang}`
  if (url === prefix) return ''
  if (url.startsWith(`${prefix}/`)) return url.slice(prefix.length)
  return url
}

/**
 * Renders the API reference's request and response samples through the docs' own `CodeBlock`
 * rather than fumadocs-openapi's built-in one, so those blocks get the emcn copy control
 * instead of fumadocs' lucide clipboard. Mirrors the default renderer — same `highlight` call,
 * same `Pre` component, same `my-0` — differing only in which shell wraps the result.
 */
async function ApiCodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <CodeBlock className='my-0'>
      {await highlight(code, { lang, ...simShikiOptions, components: { pre: Pre } })}
    </CodeBlock>
  )
}

const APIPage = createAPIPage(openapi, {
  renderCodeBlock: (props) => <ApiCodeBlock {...props} />,
  playground: { enabled: false },
  generateCodeSamples: getAuthenticatedCodeSamples,
  /**
   * fumadocs-openapi highlights its request and response samples through its own Shiki
   * instance, not the MDX pipeline, so it does not inherit `source.config.ts`. Left alone,
   * every API reference page renders `github-light` / `github-dark` while the rest of the docs
   * render the platform palette.
   */
  shikiOptions: simShikiOptions,
  client: {
    operation: { APIExampleSelector },
  },
  content: {
    renderOperationLayout: (slots) => {
      return (
        <div className='flex @4xl:flex-row flex-col @4xl:items-start gap-x-6 gap-y-4'>
          <div className='min-w-0 flex-1'>
            {slots.header}
            {slots.description}
            {slots.apiPlayground}
            {slots.authSchemes && <div className='api-section-divider'>{slots.authSchemes}</div>}
            {slots.parameters}
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
  // Academy lessons are video-first: drop the "On this page" TOC and go full
  // width so the lesson hero/video gets the room (chapters live in-page instead).
  const isAcademy = slug?.[0] === 'academy'
  const isCli = slug?.[0] === 'cli'

  const pageTreeRecord = source.pageTree as Record<string, Root>
  const pageTree = pageTreeRecord[lang] ?? pageTreeRecord.en ?? Object.values(pageTreeRecord)[0]
  const rawNeighbours = pageTree ? findNeighbour(pageTree, page.url) : null
  // Academy, API Reference, and CLI are self-contained sections; keep prev/next
  // inside the section instead of spilling into the main documentation tree.
  // Match both the section's pages (`/<slug>/...`) and its index (`/<slug>`).
  const sectionSlug = isApiReference
    ? 'api-reference'
    : isAcademy
      ? 'academy'
      : isCli
        ? 'cli'
        : null
  const inSection = (url?: string) =>
    url != null && (url.includes(`/${sectionSlug}/`) || url.endsWith(`/${sectionSlug}`))
  const neighbours = sectionSlug
    ? {
        previous: inSection(rawNeighbours?.previous?.url) ? rawNeighbours?.previous : undefined,
        next: inSection(rawNeighbours?.next?.url) ? rawNeighbours?.next : undefined,
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

    urlParts.forEach((part: string, index: number) => {
      if (index === 0 && SUPPORTED_LANGUAGES.has(part)) {
        currentPath = `/${part}`
        return
      }

      currentPath += `/${part}`

      const name = part
        .split('-')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
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
          toc={data.toc.filter(isContentHeading)}
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
        toc={data.toc.filter(isContentHeading)}
        full={data.full || isAcademy}
        breadcrumb={{
          enabled: false,
        }}
        tableOfContent={{
          style: 'clerk',
          enabled: !isAcademy,
          single: false,
        }}
        tableOfContentPopover={{
          style: 'clerk',
          enabled: !isAcademy,
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
      alternateLocale: i18n.languages.reduce<string[]>((locales, l) => {
        if (l !== lang) {
          locales.push(OG_LOCALE_MAP[l] ?? 'en_US')
        }
        return locales
      }, []),
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 675,
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
        'x-default': `${BASE_URL}${stripLocalePrefix(page.url, lang)}`,
        en: `${BASE_URL}${stripLocalePrefix(page.url, lang)}`,
        es: `${BASE_URL}/es${stripLocalePrefix(page.url, lang)}`,
        fr: `${BASE_URL}/fr${stripLocalePrefix(page.url, lang)}`,
        de: `${BASE_URL}/de${stripLocalePrefix(page.url, lang)}`,
        ja: `${BASE_URL}/ja${stripLocalePrefix(page.url, lang)}`,
        zh: `${BASE_URL}/zh${stripLocalePrefix(page.url, lang)}`,
      },
    },
  }
}
