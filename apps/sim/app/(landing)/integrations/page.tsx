import type { Metadata } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'
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
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <div className='mx-auto max-w-[1200px] px-6 py-16 sm:px-8 md:px-12'>
        {/* Hero */}
        <section aria-labelledby='integrations-heading' className='mb-16'>
          <h1
            id='integrations-heading'
            className='mb-4 font-[500] text-[#ECECEC] text-[40px] leading-tight sm:text-[56px]'
          >
            Integrations
          </h1>
          <p className='max-w-[640px] text-[#999] text-[18px] leading-relaxed'>
            Connect every tool your team uses. Build AI-powered workflows that automate tasks across{' '}
            {TOP_NAMES.slice(0, 4).map((name, i, arr) => {
              const integration = allIntegrations.find((int) => int.name === name)
              const Icon = integration ? blockTypeToIconMap[integration.type] : undefined
              return (
                <span key={name} className='inline-flex items-center gap-[5px]'>
                  {Icon && (
                    <span
                      aria-hidden='true'
                      className='inline-flex shrink-0'
                      style={{ opacity: 0.65 }}
                    >
                      <Icon className='h-[0.85em] w-[0.85em]' />
                    </span>
                  )}
                  {name}
                  {i < arr.length - 1 ? ', ' : ''}
                </span>
              )
            })}
            {' and more.'}
          </p>
        </section>

        {/* Searchable grid — client component */}
        <section aria-labelledby='all-integrations-heading'>
          <h2 id='all-integrations-heading' className='mb-8 font-[500] text-[#ECECEC] text-[24px]'>
            All Integrations
          </h2>
          <IntegrationGrid integrations={allIntegrations} />
        </section>

        {/* Integration request */}
        <div className='mt-16 flex flex-col items-start gap-3 border-[#2A2A2A] border-t pt-10 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='font-[500] text-[#ECECEC] text-[15px]'>
              Don&apos;t see the integration you need?
            </p>
            <p className='mt-0.5 text-[#555] text-[13px]'>
              Let us know and we&apos;ll prioritize it.
            </p>
          </div>
          <RequestIntegrationModal />
        </div>
      </div>
    </>
  )
}
