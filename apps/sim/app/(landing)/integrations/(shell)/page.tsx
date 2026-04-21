import type { Metadata } from 'next'
import { Badge } from '@/components/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { IntegrationCard } from '@/app/(landing)/integrations/components/integration-card'
import { IntegrationGrid } from '@/app/(landing)/integrations/components/integration-grid'
import { RequestIntegrationModal } from '@/app/(landing)/integrations/components/request-integration-modal'
import { blockTypeToIconMap } from '@/app/(landing)/integrations/data/icon-mapping'
import integrations from '@/app/(landing)/integrations/data/integrations.json'
import { POPULAR_WORKFLOWS } from '@/app/(landing)/integrations/data/popular-workflows'
import type { Integration } from '@/app/(landing)/integrations/data/types'

const allIntegrations = integrations as Integration[]
const INTEGRATION_COUNT = allIntegrations.length

/**
 * Unique integration names that appear in popular workflow pairs.
 * Used for metadata keywords so they stay in sync automatically.
 */
const TOP_NAMES = [...new Set(POPULAR_WORKFLOWS.flatMap((p) => [p.from, p.to]))].slice(0, 6)

const baseUrl = SITE_URL

/** Curated featured integrations — high-recognition services shown as cards. */
const FEATURED_SLUGS = ['slack', 'notion', 'github', 'gmail'] as const

const bySlug = new Map(allIntegrations.map((i) => [i.slug, i]))
const featured = FEATURED_SLUGS.map((s) => bySlug.get(s)).filter(
  (i): i is Integration => i !== undefined
)

export const metadata: Metadata = {
  title: 'Integrations',
  description: `Connect ${INTEGRATION_COUNT}+ apps and services in Sim's AI workspace. Build agents that automate real work with ${TOP_NAMES.join(', ')}, and more.`,
  keywords: [
    'AI workspace integrations',
    'AI agent integrations',
    'AI agent builder integrations',
    ...TOP_NAMES.flatMap((n) => [`${n} integration`, `${n} automation`]),
    ...allIntegrations.slice(0, 20).map((i) => `${i.name} automation`),
  ],
  openGraph: {
    title: 'Integrations | Sim AI Workspace',
    description: `Connect ${INTEGRATION_COUNT}+ apps in Sim's AI workspace. Build agents that link ${TOP_NAMES.join(', ')}, and every tool your team uses.`,
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
    description: `Connect ${INTEGRATION_COUNT}+ apps in Sim's AI workspace.`,
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
            Connect every tool your team uses. Build agents that automate real work across{' '}
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
