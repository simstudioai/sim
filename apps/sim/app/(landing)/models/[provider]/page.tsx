import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import {
  Breadcrumbs,
  CapabilityTags,
  ModelCard,
  ProviderCard,
  ProviderIcon,
  StatCard,
} from '@/app/(landing)/models/components/model-primitives'
import {
  buildProviderFaqs,
  getProviderBySlug,
  getProviderCapabilitySummary,
  MODEL_PROVIDERS_WITH_CATALOGS,
  TOP_MODEL_PROVIDERS,
} from '@/app/(landing)/models/utils'

const baseUrl = getBaseUrl()

export async function generateStaticParams() {
  return MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
    provider: provider.slug,
  }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string }>
}): Promise<Metadata> {
  const { provider: providerSlug } = await params
  const provider = getProviderBySlug(providerSlug)

  if (!provider || provider.models.length === 0) {
    return {}
  }

  const providerFaqs = buildProviderFaqs(provider)

  return {
    title: `${provider.name} Models`,
    description: `Browse ${provider.modelCount} ${provider.name} models tracked in Sim. Compare pricing, context windows, default model selection, and capabilities for ${provider.name}'s AI model lineup.`,
    keywords: [
      `${provider.name} models`,
      `${provider.name} pricing`,
      `${provider.name} context window`,
      `${provider.name} model list`,
      `${provider.name} AI models`,
      ...provider.models.slice(0, 6).map((model) => model.displayName),
    ],
    openGraph: {
      title: `${provider.name} Models | Sim`,
      description: `Explore ${provider.modelCount} ${provider.name} models with pricing and capability details.`,
      url: `${baseUrl}${provider.href}`,
      type: 'website',
      images: [
        {
          url: `${baseUrl}${provider.href}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `${provider.name} Models on Sim`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${provider.name} Models | Sim`,
      description: providerFaqs[0]?.answer ?? provider.summary,
      images: [
        {
          url: `${baseUrl}${provider.href}/opengraph-image`,
          alt: `${provider.name} Models on Sim`,
        },
      ],
    },
    alternates: {
      canonical: `${baseUrl}${provider.href}`,
    },
  }
}

export default async function ProviderModelsPage({
  params,
}: {
  params: Promise<{ provider: string }>
}) {
  const { provider: providerSlug } = await params
  const provider = getProviderBySlug(providerSlug)

  if (!provider || provider.models.length === 0) {
    notFound()
  }

  const faqs = buildProviderFaqs(provider)
  const capabilitySummary = getProviderCapabilitySummary(provider)
  const relatedProviders = MODEL_PROVIDERS_WITH_CATALOGS.filter(
    (entry) => entry.id !== provider.id && TOP_MODEL_PROVIDERS.includes(entry.name)
  ).slice(0, 4)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${baseUrl}/models` },
      { '@type': 'ListItem', position: 3, name: provider.name, item: `${baseUrl}${provider.href}` },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${provider.name} Models`,
    description: `List of ${provider.modelCount} ${provider.name} models tracked in Sim.`,
    url: `${baseUrl}${provider.href}`,
    numberOfItems: provider.modelCount,
    itemListElement: provider.models.map((model, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${baseUrl}${model.href}`,
      name: model.displayName,
    })),
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
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
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className='mx-auto max-w-[1280px] px-6 py-12 sm:px-8 md:px-12'>
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Models', href: '/models' },
            { label: provider.name },
          ]}
        />

        <section aria-labelledby='provider-heading' className='mb-14'>
          <div className='mb-6 flex items-center gap-4'>
            <ProviderIcon
              provider={provider}
              className='h-16 w-16 rounded-3xl'
              iconClassName='h-8 w-8'
            />
            <div>
              <p className='text-[12px] text-[var(--landing-text-muted)] uppercase tracking-[0.12em]'>
                Provider
              </p>
              <h1
                id='provider-heading'
                className='font-[500] text-[38px] text-[var(--landing-text)] leading-tight sm:text-[48px]'
              >
                {provider.name} models
              </h1>
            </div>
          </div>

          <p className='max-w-[820px] text-[17px] text-[var(--landing-text-muted)] leading-relaxed'>
            {provider.summary} Browse every {provider.name} model page generated from Sim&apos;s
            provider registry with human-readable names, pricing, context windows, and capability
            metadata.
          </p>

          <div className='mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
            <StatCard label='Models tracked' value={provider.modelCount.toString()} />
            <StatCard
              label='Default model'
              value={provider.defaultModelDisplayName || 'Dynamic'}
              compact
            />
            <StatCard
              label='Metadata coverage'
              value={provider.contextInformationAvailable ? 'Tracked' : 'Partial'}
              compact
            />
            <StatCard
              label='Featured models'
              value={provider.featuredModels.length.toString()}
              compact
            />
          </div>

          <div className='mt-6'>
            <CapabilityTags tags={provider.providerCapabilityTags} />
          </div>
        </section>

        <section aria-labelledby='provider-models-heading' className='mb-16'>
          <h2
            id='provider-models-heading'
            className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
          >
            All {provider.name} models
          </h2>
          <p className='mb-8 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
            Every model below links to a dedicated SEO page with exact pricing, context window,
            capability support, and related model recommendations.
          </p>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
            {provider.models.map((model) => (
              <ModelCard key={model.id} provider={provider} model={model} />
            ))}
          </div>
        </section>

        <section
          aria-labelledby='lineup-snapshot-heading'
          className='mb-16 rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
        >
          <h2
            id='lineup-snapshot-heading'
            className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
          >
            Lineup snapshot
          </h2>
          <p className='mb-8 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
            A quick view of the strongest differentiators in the {provider.name} model lineup based
            on the metadata currently tracked in Sim.
          </p>

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {capabilitySummary.map((item) => (
              <StatCard key={item.label} label={item.label} value={item.value} compact />
            ))}
          </div>
        </section>

        {relatedProviders.length > 0 && (
          <section aria-labelledby='related-providers-heading' className='mb-16'>
            <h2
              id='related-providers-heading'
              className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
            >
              Compare with other providers
            </h2>
            <p className='mb-8 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
              Explore similar provider hubs to compare model lineups, pricing surfaces, and
              long-context coverage across the broader AI ecosystem.
            </p>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
              {relatedProviders.map((entry) => (
                <ProviderCard key={entry.id} provider={entry} />
              ))}
            </div>
          </section>
        )}

        <section
          aria-labelledby='provider-faq-heading'
          className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
        >
          <h2
            id='provider-faq-heading'
            className='font-[500] text-[28px] text-[var(--landing-text)]'
          >
            Frequently asked questions
          </h2>
          <div className='mt-3'>
            <LandingFAQ faqs={faqs} />
          </div>
        </section>
      </div>
    </>
  )
}
