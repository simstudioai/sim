import type React from 'react'
import { Children, cloneElement, isValidElement } from 'react'
import {
  chipFieldSurfaceClass,
  chipFieldTextClass,
  chipGeometryClass,
  chipHoverSurfaceClass,
  cn,
} from '@sim/emcn'
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
import { APIRequestTabs } from '@/components/ui/api-request-tabs'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { IntegrationIcon } from '@/components/ui/integration-icon'
import { ResponseSection } from '@/components/ui/response-section'
import { getAuthenticatedCodeSamples, openapi } from '@/lib/openapi'
import { simShikiOptions } from '@/lib/shiki-theme'
import { type PageData, source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

const BASE_URL = DOCS_BASE_URL

/**
 * Pages close with related-documentation links or legacy next-step links.
 * That heading is navigation, not content, so it is kept out of the table of
 * contents — the ToC should say what the page covers, not where to go after it.
 * The heading itself still renders above the onward links.
 *
 * Matched on the slug rather than the rendered title because a ToC title is a
 * `ReactNode`; the trailing group tolerates the slugger's dedupe suffix.
 */
const ONWARD_NAV_SLUG = /^#(?:next(?:-steps)?|related-docs)(?:-\d+)?$/i

const AUTH_SCHEME_LABELS: Record<string, string> = {
  apiKey: 'API key',
  oauthBearer: 'OAuth access token',
}

const DOCS_BODY_CLASS_NAME =
  '[overflow-wrap:anywhere] [&_:not(pre)>code:not([class])]:rounded! [&_:not(pre)>code:not([class])]:px-1! [&_:not(pre)>code:not([class])]:py-px! [&_:not(pre)>code:not([class])]:font-normal! [&_:not(pre)>code:not([class])]:text-[var(--text-primary)]! [&_:not(pre)>code:not([class])]:[font-size:inherit]! [&_:not(pre)>code:not([class])]:bg-[var(--surface-5)]! dark:[&_:not(pre)>code:not([class])]:bg-[var(--surface-4)]!'

const DOCS_PAGE_CLASS_NAME =
  '[&#nd-page_h1]:font-medium! [&#nd-page_h1]:text-3xl! [&#nd-page_h1]:leading-10 [&#nd-page_h2]:font-medium! [&#nd-page_p]:text-[var(--text-body)]'

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
  items?: Array<{ value: string; label: React.ReactNode }>
}

/** Labels Fumadocs auth selectors while retaining their selection state and content. */
function labelAuthSelectors(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return AUTH_SCHEME_LABELS[node] ?? node
  if (!isValidElement<ApiSlotElementProps>(node)) return node

  const props = node.props
  const children =
    props.children === undefined ? undefined : Children.map(props.children, labelAuthSelectors)

  if (node.type === 'code') {
    const scheme = Children.toArray(props.children).find(
      (child) =>
        isValidElement<ApiSlotElementProps>(child) &&
        typeof child.props.children === 'string' &&
        AUTH_SCHEME_LABELS[child.props.children]
    )
    return (
      <span className='font-normal text-sm [&>span]:font-normal'>
        {scheme ? labelAuthSelectors(scheme) : children}
      </span>
    )
  }

  if (Array.isArray(props.items)) {
    return cloneElement(
      node,
      {
        'aria-label': 'Authentication method',
        className: cn(
          props.className,
          chipGeometryClass,
          chipFieldSurfaceClass,
          chipFieldTextClass,
          chipHoverSurfaceClass,
          'relative shrink-0 py-0 focus:ring-0 focus-visible:bg-[var(--surface-hover)] before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-[""]'
        ),
        items: props.items.map((item) => ({
          ...item,
          label: labelAuthSelectors(item.label),
        })),
      },
      children
    )
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
    renderAPIExampleUsageTabs: (registry, context) => (
      <APIRequestTabs registry={registry} context={context} />
    ),
    renderOperationLayout: (slots, context, method) => {
      const introduction =
        'x-sim-docs-intro' in method && typeof method['x-sim-docs-intro'] === 'string'
          ? method['x-sim-docs-intro']
          : undefined
      const details =
        'x-sim-docs-details' in method && typeof method['x-sim-docs-details'] === 'string'
          ? method['x-sim-docs-details']
          : undefined
      const oauthScope =
        'x-oauth-scope' in method && typeof method['x-oauth-scope'] === 'string'
          ? method['x-oauth-scope']
          : undefined
      return (
        <div className='grid @3xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] grid-cols-1 @3xl:items-start gap-x-6 gap-y-4 [--badge-amber-text:var(--text-primary)] [--badge-blue-text:var(--text-primary)] [--badge-error-text:var(--text-primary)] [--badge-orange-text:var(--text-primary)] [--badge-success-text:var(--text-primary)] [&_button[aria-haspopup=dialog]]:min-h-6'>
          <div className='@3xl:col-start-1 @3xl:row-start-1 min-w-0 flex-1'>
            {slots.header}
            {introduction ? context.renderMarkdown(introduction) : slots.description}
            {slots.apiPlayground}
            {slots.authSchemes && (
              <div className='api-section-divider [&>div:first-child]:flex-wrap [&>div:first-child]:gap-y-3'>
                {labelAuthSelectors(slots.authSchemes)}
                {introduction && oauthScope && (
                  <p className='text-[var(--text-muted)] text-sm'>
                    Required OAuth scope: <code>{oauthScope}</code>.
                  </p>
                )}
                <p className='text-[var(--text-muted)] text-sm'>
                  Request examples use an API key. For OAuth, replace the <code>X-API-Key</code>{' '}
                  header with <code>Authorization: Bearer YOUR_ACCESS_TOKEN</code>.
                </p>
              </div>
            )}
          </div>
          <div className='@3xl:sticky @3xl:top-[calc(var(--fd-docs-row-1,2rem)+1rem)] @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 min-w-0'>
            {slots.apiExample}
          </div>
          <div className='@3xl:col-start-1 @3xl:row-start-2 min-w-0 flex-1'>
            {slots.parameters}
            {slots.body && <div className='api-section-divider'>{slots.body}</div>}
            {details && (
              <section className='api-section-divider'>
                <h2>Behavior</h2>
                {context.renderMarkdown(details)}
              </section>
            )}
            <ResponseSection>{slots.responses}</ResponseSection>
            {slots.callbacks}
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
    lastModified?: Date
    _openapi?: { method?: string }
    getAPIPageProps?: () => ApiPageProps
  }
  const isOpenAPI = '_openapi' in data && data._openapi != null
  const isApiReference = slug?.some((s) => s === 'api-reference') ?? false
  const isCli = slug?.[0] === 'cli'
  const isMcp = slug?.[0] === 'mcp'

  const rawNeighbours = findNeighbour(source.pageTree, page.url)
  // API Reference, CLI, and MCP are self-contained sections; keep prev/next
  // inside the section instead of spilling into the main documentation tree.
  // Match both the section's pages (`/<slug>/...`) and its index (`/<slug>`).
  const sectionSlug = isApiReference ? 'api-reference' : isCli ? 'cli' : isMcp ? 'mcp' : null
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

    return (
      <>
        <StructuredData
          title={data.title}
          description={data.description || ''}
          url={`${BASE_URL}${page.url}`}
          breadcrumb={breadcrumbs}
        />
        <DocsPage
          className={cn(
            DOCS_PAGE_CLASS_NAME,
            'min-w-0 max-md:col-[main]! max-md:px-4! [&>.api-page-header]:max-w-full! [&>div:last-child]:max-w-full!'
          )}
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
              <LLMCopyButton
                key={page.url}
                markdownUrl={`/llms.mdx${page.url === '/' ? '' : page.url}`}
              />
            </div>
            <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
          </PageHeader>
          <DocsBody className={DOCS_BODY_CLASS_NAME}>
            <APIPage {...apiProps} />
          </DocsBody>
        </DocsPage>
      </>
    )
  }

  const { body: MDX, toc, lastModified } = await data.load()

  return (
    <>
      <StructuredData
        title={data.title}
        description={data.description || ''}
        url={`${BASE_URL}${page.url}`}
        dateModified={lastModified?.toISOString()}
        breadcrumb={breadcrumbs}
      />
      <DocsPage
        className={DOCS_PAGE_CLASS_NAME}
        role='main'
        tabIndex={-1}
        toc={toc.filter(
          (item) => isContentHeading(item) && (slug?.[0] !== 'integrations' || item.depth <= 3)
        )}
        full={data.full}
        breadcrumb={{
          enabled: false,
        }}
        tableOfContent={{
          style: 'clerk',
          single: false,
        }}
        tableOfContentPopover={{
          style: 'clerk',
        }}
        footer={{
          enabled: true,
          component: footer,
        }}
      >
        <PageHeader
          title={data.title}
          icon={data.integration && <IntegrationIcon {...data.integration} />}
          className='max-sm:[&>h1]:basis-0 max-sm:[&_a]:size-10'
        >
          <div className='hidden sm:flex'>
            <LLMCopyButton
              key={page.url}
              markdownUrl={`/llms.mdx${page.url === '/' ? '' : page.url}`}
            />
          </div>
          <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
        </PageHeader>
        <DocsBody
          className={cn(
            DOCS_BODY_CLASS_NAME,
            slug?.[0] === 'integrations' && '[&_td]:[overflow-wrap:normal]'
          )}
        >
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

/** Every docs page is prerendered, so an unknown path is a static 404 rather than a function call. */
export const dynamicParams = false

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
    alternates: {
      canonical: fullUrl,
      types: { 'text/markdown': `${fullUrl}.md` },
    },
  }
}
