import type React from 'react'
import { Children, cloneElement, isValidElement } from 'react'
import { highlight } from 'fumadocs-core/highlight'
import { findNeighbour } from 'fumadocs-core/page-tree'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { createAPIPage } from 'fumadocs-openapi/ui'
import { Pre } from 'fumadocs-ui/components/codeblock'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsPage } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import { PageFooter } from '@/components/docs-layout/page-footer'
import { PageHeader } from '@/components/docs-layout/page-header'
import { PageNavigationArrows } from '@/components/docs-layout/page-navigation-arrows'
import { LLMCopyButton } from '@/components/page-actions'
import { StructuredData } from '@/components/structured-data'
import { APIExampleSelector } from '@/components/ui/api-example-selector'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { ResponseSection } from '@/components/ui/response-section'
import { getApiSpecContent, getAuthenticatedCodeSamples, openapi } from '@/lib/openapi'
import { simShikiOptions } from '@/lib/shiki-theme'
import { type PageData, source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

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

interface ApiSlotElementProps extends React.HTMLAttributes<HTMLElement> {
  items?: unknown[]
}

/** Labels Fumadocs auth selectors while retaining their selection state and content. */
function labelAuthSelectors(node: React.ReactNode): React.ReactNode {
  if (!isValidElement<ApiSlotElementProps>(node)) return node

  const props = node.props
  const children =
    props.children === undefined ? undefined : Children.map(props.children, labelAuthSelectors)

  if (Array.isArray(props.items)) {
    return cloneElement(node, { 'aria-label': 'Authentication method' }, children)
  }
  return children === undefined ? node : cloneElement(node, undefined, children)
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
        <div className='flex @4xl:flex-row flex-col @4xl:items-start gap-x-6 gap-y-4 [--badge-amber-text:#854d0e] [--badge-blue-text:#1e40af] [--badge-error-text:#991b1b] [--badge-orange-text:#9a3412] [--badge-success-text:#166534] dark:[--badge-amber-text:#fcd34d] dark:[--badge-blue-text:#93c5fd] dark:[--badge-error-text:#fca5a5] dark:[--badge-orange-text:#fdba74] dark:[--badge-success-text:#86efac] [&_button[aria-haspopup=dialog]]:min-h-6'>
          <div className='min-w-0 flex-1'>
            {slots.header}
            {slots.description}
            {slots.apiPlayground}
            {slots.authSchemes && (
              <div className='api-section-divider'>{labelAuthSelectors(slots.authSchemes)}</div>
            )}
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

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params
  const page = source.getPage(slug)
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

  const rawNeighbours = findNeighbour(source.pageTree, page.url)
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
          breadcrumb={breadcrumbs}
        />
        <DocsPage
          role='main'
          tabIndex={-1}
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
          <PageHeader title={data.title} className='api-page-header'>
            <div className='hidden sm:flex'>
              <LLMCopyButton content={apiPageContent} />
            </div>
            <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
          </PageHeader>
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
        breadcrumb={breadcrumbs}
      />
      <DocsPage
        role='main'
        tabIndex={-1}
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
        <PageHeader title={data.title}>
          <div className='hidden sm:flex'>
            <LLMCopyButton content={markdownContent} />
          </div>
          <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
        </PageHeader>
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

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params
  const page = source.getPage(slug)
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
      locale: 'en_US',
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
    },
  }
}
