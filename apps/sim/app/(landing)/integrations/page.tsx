import type { Metadata } from 'next'
import { Badge } from '@/components/emcn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { IntegrationCard } from './components/integration-card'
import { IntegrationGrid } from './components/integration-grid'
import { RequestIntegrationModal } from './components/request-integration-modal'
import { blockTypeToIconMap } from './data/icon-mapping'
import integrations from './data/integrations.json'
import { POPULAR_WORKFLOWS } from './data/popular-workflows'
import type { Integration } from './data/types'

const allIntegrations = integrations as Integration[]
const INTEGRATION_COUNT = allIntegrations.length

/**
 * Unique integration names that appear in popular workflow pairs.
 * Used for metadata keywords so they stay in sync automatically.
 */
const TOP_NAMES = [...new Set(POPULAR_WORKFLOWS.flatMap((p) => [p.from, p.to]))].slice(0, 6)

const baseUrl = getBaseUrl()

/** Curated featured integrations — high-recognition services shown as cards. */
const FEATURED_SLUGS = ['slack', 'notion', 'github', 'gmail'] as const

const bySlug = new Map(allIntegrations.map((i) => [i.slug, i]))
const featured = FEATURED_SLUGS.map((s) => bySlug.get(s)).filter(
  (i): i is Integration => i !== undefined
)

export const metadata: Metadata = {
  title: 'Integrations',
  description: `Connect ${INTEGRATION_COUNT}+ apps and services with Sim's AI workflow automation. Build intelligent pipelines with ${TOP_NAMES.join(', ')}, and more.`,
  keywords: [
    'workflow automation integrations',
    'AI workflow automation',
    'no-code automation',
    ...TOP_NAMES.flatMap((n) => [`${n} integration`, `${n} automation`]),
    ...allIntegrations.slice(0, 20).map((i) => `${i.name} automation`),
  ],
  openGraph: {
    title: 'Integrations for AI Workflow Automation | Sim',
    description: `Connect ${INTEGRATION_COUNT}+ apps with Sim. Build AI-powered pipelines that link ${TOP_NAMES.join(', ')}, and every tool your team uses.`,
    url: `${baseUrl}/integrations`,
    type: 'website',
    images: [
      {
        url: `${baseUrl}/opengraph-image.png`,
        width: 1200,
        height: 630,
        alt: 'Sim Integrations for AI Workflow Automation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Integrations | Sim',
    description: `Connect ${INTEGRATION_COUNT}+ apps with Sim's AI workflow automation.`,
    images: [
      { url: `${baseUrl}/opengraph-image.png`, alt: 'Sim Integrations for AI Workflow Automation' },
    ],
  },
  alternates: { canonical: `${baseUrl}/integrations` },
}

export default function IntegrationsPage() {
  const breadcrumbJsonLd = {
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

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Sim AI Workflow Integrations',
    description: `Complete list of ${INTEGRATION_COUNT}+ integrations available in Sim for building AI-powered workflow automation.`,
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

  return (
    <section className='bg-[var(--landing-bg)]'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      {/* Hero */}
      <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <Badge
          variant='blue'
          size='md'
          dot
          className='mb-5 bg-white/10 font-season text-white uppercase tracking-[0.02em]'
        >
          Integrations
        </Badge>

        <div className='flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between'>
          <h1
            id='integrations-heading'
            className='text-balance text-[28px] text-white leading-[100%] tracking-[-0.02em] lg:text-[40px]'
          >
            Integrations
          </h1>
          <p className='font-[430] font-season text-[var(--landing-text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
            Connect every tool your team uses. Build AI-powered workflows that automate tasks across{' '}
            {INTEGRATION_COUNT} apps and services.
          </p>
        </div>
      </div>

      {/* Full-width divider */}
      <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

      {/* Border-railed content */}
      <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        {/* Featured integrations — top */}
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
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </>
        )}

        {/* All Integrations — search, filters, rows */}
        <section aria-labelledby='all-integrations-heading'>
          <div className='px-6 pt-10 pb-4'>
            <h2
              id='all-integrations-heading'
              className='mb-2 text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'
            >
              All Integrations
            </h2>
          </div>
          <IntegrationGrid integrations={allIntegrations} />
        </section>

        {/* Integration request */}
        <div className='flex flex-col items-start gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='text-[15px] text-white tracking-[-0.02em]'>
              Don&apos;t see the integration you need?
            </p>
            <p className='mt-0.5 font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
              Let us know and we&apos;ll prioritize it.
            </p>
          </div>
          <RequestIntegrationModal />
        </div>
      </div>

      {/* Closing full-width divider */}
      <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
    </section>
  )
}
