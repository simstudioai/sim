import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { SITE_URL } from '@/lib/core/utils/urls'
import {
  blockTypeToIconMap,
  type FAQItem,
  INTEGRATIONS,
  type Integration,
  POPULAR_WORKFLOWS,
} from '@/lib/integrations'
import { withFilteredNoindex } from '@/lib/landing/seo'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { IntegrationCard } from '@/app/(landing)/integrations/components/integration-card'
import { IntegrationGrid } from '@/app/(landing)/integrations/components/integration-grid'
import { RequestIntegrationModal } from '@/app/(landing)/integrations/components/request-integration-modal'
import { integrationsSearchParamsCache } from '@/app/(landing)/integrations/search-params'

const allIntegrations = INTEGRATIONS
const INTEGRATION_COUNT = allIntegrations.length
const OAUTH_COUNT = allIntegrations.filter((i) => i.authType === 'oauth').length
const TRIGGER_INTEGRATION_COUNT = allIntegrations.filter((i) => i.triggerCount > 0).length
const TOTAL_TOOL_COUNT = allIntegrations.reduce((sum, i) => sum + i.operationCount, 0)

/**
 * Catalog-level FAQ. Questions that read the same for every integration live
 * here exactly once instead of repeating across all per-integration pages.
 */
const CATALOG_FAQS: FAQItem[] = [
  {
    question: 'How do integrations work in Sim?',
    answer: `Each integration is a block you drag onto Sim's workflow builder. Together, Sim's ${INTEGRATION_COUNT} integrations expose ${TOTAL_TOOL_COUNT}+ tools that AI agents can call. ${OAUTH_COUNT} connect with one-click OAuth, and the rest use an API key or no authentication at all. Wire blocks together, add an AI agent block for reasoning, and run.`,
  },
  {
    question: 'Are Sim integrations free to use?',
    answer: `Yes. Sim's free plan includes every integration in the library, all ${INTEGRATION_COUNT} of them, with no credit card required. Create an account at sim.ai and start building.`,
  },
  {
    question: 'Can an AI agent decide when to use an integration?',
    answer: `Yes. This is the core of Sim. You give an agent access to integration tools and describe the goal in plain language; the agent decides which tools to call, in what order, and how to handle the results. Automations adapt to context instead of breaking when inputs change.`,
  },
  {
    question: 'Can external events trigger my agents automatically?',
    answer: `Yes. ${TRIGGER_INTEGRATION_COUNT} Sim integrations include real-time webhook triggers. Add a trigger block to your agent, copy its webhook URL into the external service, and every matching event starts your agent instantly, no polling, no delay.`,
  },
  {
    question: 'How many integrations does Sim support?',
    answer: `Sim supports ${INTEGRATION_COUNT} integrations across messaging, CRMs, databases, developer tools, AI providers, and more, and the catalog grows continually. If a tool you need is missing, request it below and we'll prioritize it.`,
  },
]

/**
 * Unique integration names that appear in popular workflow pairs.
 * Used for metadata keywords so they stay in sync automatically.
 */
const TOP_NAMES = [...new Set(POPULAR_WORKFLOWS.flatMap((p) => [p.from, p.to]))].slice(0, 6)

const baseUrl = SITE_URL

const INTEGRATIONS_BREADCRUMB_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Integrations',
      item: `${baseUrl}/integrations`,
    },
  ],
}

/** Curated featured integrations - high-recognition services shown as cards. */
const FEATURED_SLUGS = ['slack', 'notion', 'github', 'gmail'] as const

const bySlug = new Map(allIntegrations.map((i) => [i.slug, i]))
const featured = FEATURED_SLUGS.map((s) => bySlug.get(s)).filter(
  (i): i is Integration => i !== undefined
)

/**
 * `q`/`category` render a genuinely different server-rendered list (see
 * search-params.ts), so filtered URLs are noindexed rather than
 * self-canonicalized — keeps the single indexable URL as the bare catalog
 * page instead of asking Google to index every filter permutation.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const { q, category } = await integrationsSearchParamsCache.parse(searchParams)
  const isFiltered = Boolean(q || category)

  return withFilteredNoindex(
    {
      title: 'Integrations',
      description: `Connect ${INTEGRATION_COUNT}+ apps and services in Sim's AI workspace. Build agents that automate real work with ${TOP_NAMES.join(', ')}, and more.`,
      keywords: [
        'AI workspace integrations',
        'AI agent integrations',
        'AI agent builder integrations',
        ...TOP_NAMES.flatMap((n) => [`${n} integration`, `${n} automation`]),
        ...allIntegrations.slice(0, 20).map((i) => `${i.name} automation`),
      ],
      // og:image/twitter:image come from the sibling opengraph-image.tsx -
      // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
      openGraph: {
        title: 'Integrations | Sim AI Workspace',
        description: `Connect ${INTEGRATION_COUNT}+ apps in Sim's AI workspace. Build agents that link ${TOP_NAMES.join(', ')}, and every tool your team uses.`,
        url: `${baseUrl}/integrations`,
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Integrations | Sim',
        description: `Connect ${INTEGRATION_COUNT}+ apps in Sim's AI workspace.`,
      },
      alternates: { canonical: `${baseUrl}/integrations` },
    },
    isFiltered
  )
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await integrationsSearchParamsCache.parse(searchParams)

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Sim AI Workflow Integrations',
    description: `Complete list of ${INTEGRATION_COUNT}+ integrations available in Sim's AI workspace for building and deploying AI agents.`,
    url: `${baseUrl}/integrations`,
    numberOfItems: INTEGRATION_COUNT,
    itemListElement: allIntegrations.map((integration, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'SoftwareApplication',
        name: integration.name,
        description: integration.description,
        url: `${baseUrl}/integrations/${integration.slug}`,
        applicationCategory: 'BusinessApplication',
        featureList: integration.operations.map((o) => o.name),
      },
    })),
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: CATALOG_FAQS.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }

  return (
    <section className='bg-[var(--bg)]'>
      <JsonLd data={INTEGRATIONS_BREADCRUMB_JSON_LD} />
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={faqJsonLd} />

      {/* Hero */}
      <div className='mx-auto w-full max-w-[1460px] px-20 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
        <div className='flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between'>
          <h1
            id='integrations-heading'
            className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
          >
            Integrations
          </h1>
          <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
            Connect every tool your team uses. Build agents that automate real work across{' '}
            {INTEGRATION_COUNT} apps and services.
          </p>
        </div>
      </div>

      {/* Full-width divider */}
      <div className='mt-8 h-px w-full bg-[var(--border)]' />

      {/* Border-railed content */}
      <div className='mx-auto w-full max-w-[1460px]'>
        <div className='mx-20 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
          {/* Featured integrations - top */}
          {featured.length > 0 && (
            <>
              <nav aria-label='Featured integrations' className='flex flex-col sm:flex-row'>
                {featured.map((integration) => (
                  <IntegrationCard
                    key={integration.type}
                    integration={integration}
                    IconComponent={blockTypeToIconMap[integration.type]}
                  />
                ))}
              </nav>
              <div className='h-px w-full bg-[var(--border)]' />
            </>
          )}

          {/* All Integrations - search, filters, rows */}
          <section aria-labelledby='all-integrations-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='all-integrations-heading'
                className='mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                All Integrations
              </h2>
            </div>
            <IntegrationGrid integrations={allIntegrations} />
          </section>

          {/* FAQ */}
          <section aria-labelledby='integrations-faq-heading' className='px-6 py-10'>
            <h2
              id='integrations-faq-heading'
              className='mb-8 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]'
            >
              Frequently asked questions
            </h2>
            <LandingFAQ faqs={CATALOG_FAQS} />
          </section>

          <div className='h-px w-full bg-[var(--border)]' />

          {/* Integration request */}
          <div className='flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <p className='text-[15px] text-[var(--text-primary)] tracking-[-0.02em]'>
                Don&apos;t see the integration you need?
              </p>
              <p className='mt-0.5 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                Let us know and we&apos;ll prioritize it.
              </p>
            </div>
            <RequestIntegrationModal />
          </div>
        </div>
      </div>

      {/* Closing full-width divider */}
      <div className='-mt-px h-px w-full bg-[var(--border)]' />
    </section>
  )
}
