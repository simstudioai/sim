import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import {
  Breadcrumbs,
  CapabilityTags,
  DetailItem,
  ModelCard,
  ProviderIcon,
  StatCard,
} from '@/app/(landing)/models/components/model-primitives'
import {
  ALL_CATALOG_MODELS,
  buildModelCapabilityFacts,
  buildModelFaqs,
  formatPrice,
  formatTokenCount,
  formatUpdatedAt,
  getModelBySlug,
  getPricingBounds,
  getProviderBySlug,
  getRelatedModels,
} from '@/app/(landing)/models/utils'

const baseUrl = getBaseUrl()

export async function generateStaticParams() {
  return ALL_CATALOG_MODELS.map((model) => ({
    provider: model.providerSlug,
    model: model.slug,
  }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string; model: string }>
}): Promise<Metadata> {
  const { provider: providerSlug, model: modelSlug } = await params
  const provider = getProviderBySlug(providerSlug)
  const model = getModelBySlug(providerSlug, modelSlug)

  if (!provider || !model) {
    return {}
  }

  return {
    title: `${model.displayName} Pricing, Context Window, and Features`,
    description: `${model.displayName} by ${provider.name}: pricing, cached input cost, output cost, context window, and capability support. Explore the full generated model page on Sim.`,
    keywords: [
      model.displayName,
      `${model.displayName} pricing`,
      `${model.displayName} context window`,
      `${model.displayName} features`,
      `${provider.name} ${model.displayName}`,
      `${provider.name} model pricing`,
      ...model.capabilityTags,
    ],
    openGraph: {
      title: `${model.displayName} Pricing, Context Window, and Features | Sim`,
      description: `${model.displayName} by ${provider.name}: pricing, context window, and model capability details.`,
      url: `${baseUrl}${model.href}`,
      type: 'website',
      images: [
        {
          url: `${baseUrl}${model.href}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `${model.displayName} on Sim`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${model.displayName} | Sim`,
      description: model.summary,
      images: [
        { url: `${baseUrl}${model.href}/opengraph-image`, alt: `${model.displayName} on Sim` },
      ],
    },
    alternates: {
      canonical: `${baseUrl}${model.href}`,
    },
  }
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ provider: string; model: string }>
}) {
  const { provider: providerSlug, model: modelSlug } = await params
  const provider = getProviderBySlug(providerSlug)
  const model = getModelBySlug(providerSlug, modelSlug)

  if (!provider || !model) {
    notFound()
  }

  const faqs = buildModelFaqs(provider, model)
  const capabilityFacts = buildModelCapabilityFacts(model)
  const pricingBounds = getPricingBounds(model.pricing)
  const relatedModels = getRelatedModels(model, 6)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${baseUrl}/models` },
      { '@type': 'ListItem', position: 3, name: provider.name, item: `${baseUrl}${provider.href}` },
      {
        '@type': 'ListItem',
        position: 4,
        name: model.displayName,
        item: `${baseUrl}${model.href}`,
      },
    ],
  }

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: model.displayName,
    brand: provider.name,
    category: 'AI language model',
    description: model.summary,
    sku: model.id,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: pricingBounds.lowPrice.toString(),
      highPrice: pricingBounds.highPrice.toString(),
    },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
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
            { label: provider.name, href: provider.href },
            { label: model.displayName },
          ]}
        />

        <section aria-labelledby='model-heading' className='mb-14'>
          <div className='mb-6 flex items-start gap-4'>
            <ProviderIcon
              provider={provider}
              className='h-16 w-16 rounded-3xl'
              iconClassName='h-8 w-8'
            />
            <div className='min-w-0'>
              <p className='text-[12px] text-[var(--landing-text-muted)] uppercase tracking-[0.12em]'>
                {provider.name} model
              </p>
              <h1
                id='model-heading'
                className='font-[500] text-[38px] text-[var(--landing-text)] leading-tight sm:text-[48px]'
              >
                {model.displayName}
              </h1>
              <p className='mt-2 break-all text-[13px] text-[var(--landing-text-muted)]'>
                Model ID: {model.id}
              </p>
            </div>
          </div>

          <p className='max-w-[820px] text-[17px] text-[var(--landing-text-muted)] leading-relaxed'>
            {model.summary} {model.bestFor}
          </p>

          <div className='mt-8 flex flex-wrap gap-3'>
            <Link
              href={provider.href}
              className='inline-flex h-[34px] items-center rounded-[6px] border border-[var(--landing-border-strong)] px-3 font-[430] text-[14px] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              Explore {provider.name} models
            </Link>
            <a
              href='https://sim.ai'
              className='inline-flex h-[34px] items-center rounded-[6px] border border-[var(--white)] bg-[var(--white)] px-3 font-[430] text-[14px] text-[var(--landing-text-dark)] transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              Build with this model
            </a>
          </div>
        </section>

        <section
          aria-label='Model stats'
          className='mb-16 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'
        >
          <StatCard label='Input price' value={`${formatPrice(model.pricing.input)}/1M`} />
          <StatCard
            label='Cached input'
            value={
              model.pricing.cachedInput !== undefined
                ? `${formatPrice(model.pricing.cachedInput)}/1M`
                : 'N/A'
            }
            compact
          />
          <StatCard label='Output price' value={`${formatPrice(model.pricing.output)}/1M`} />
          <StatCard
            label='Context window'
            value={model.contextWindow ? formatTokenCount(model.contextWindow) : 'Unknown'}
            compact
          />
        </section>

        <div className='grid grid-cols-1 gap-16 lg:grid-cols-[1fr_320px]'>
          <div className='min-w-0 space-y-16'>
            <section aria-labelledby='pricing-heading'>
              <h2
                id='pricing-heading'
                className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
              >
                Pricing and limits
              </h2>
              <p className='mb-6 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
                Pricing below is generated directly from the provider registry in Sim. All amounts
                are listed per one million tokens.
              </p>

              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
                <DetailItem label='Input price' value={`${formatPrice(model.pricing.input)}/1M`} />
                <DetailItem
                  label='Cached input'
                  value={
                    model.pricing.cachedInput !== undefined
                      ? `${formatPrice(model.pricing.cachedInput)}/1M`
                      : 'N/A'
                  }
                />
                <DetailItem
                  label='Output price'
                  value={`${formatPrice(model.pricing.output)}/1M`}
                />
                <DetailItem label='Updated' value={formatUpdatedAt(model.pricing.updatedAt)} />
                <DetailItem
                  label='Context window'
                  value={
                    model.contextWindow
                      ? `${formatTokenCount(model.contextWindow)} tokens`
                      : 'Unknown'
                  }
                />
                <DetailItem
                  label='Max output'
                  value={
                    model.capabilities.maxOutputTokens
                      ? `${formatTokenCount(model.capabilities.maxOutputTokens)} tokens`
                      : 'Standard defaults'
                  }
                />
                <DetailItem label='Provider' value={provider.name} />
                <DetailItem label='Best for' value={model.bestFor} />
              </div>
            </section>

            <section aria-labelledby='capabilities-heading'>
              <h2
                id='capabilities-heading'
                className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
              >
                Capabilities
              </h2>
              <p className='mb-6 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
                These capability flags are generated from the provider and model definitions tracked
                in Sim.
              </p>
              <CapabilityTags tags={model.capabilityTags} />
              <div className='mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
                {capabilityFacts.map((item) => (
                  <DetailItem key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            </section>

            {relatedModels.length > 0 && (
              <section aria-labelledby='related-models-heading'>
                <h2
                  id='related-models-heading'
                  className='mb-2 font-[500] text-[28px] text-[var(--landing-text)]'
                >
                  Related {provider.name} models
                </h2>
                <p className='mb-8 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
                  Browse comparable models from the same provider to compare pricing, context
                  window, and capability coverage.
                </p>
                <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
                  {relatedModels.map((entry) => (
                    <ModelCard key={entry.id} provider={provider} model={entry} />
                  ))}
                </div>
              </section>
            )}

            <section
              aria-labelledby='model-faq-heading'
              className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
            >
              <h2
                id='model-faq-heading'
                className='font-[500] text-[28px] text-[var(--landing-text)]'
              >
                Frequently asked questions
              </h2>
              <div className='mt-3'>
                <LandingFAQ faqs={faqs} />
              </div>
            </section>
          </div>

          <aside className='space-y-5' aria-label='Model details'>
            <div className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-5'>
              <h2 className='mb-4 font-[500] text-[16px] text-[var(--landing-text)]'>
                Quick details
              </h2>
              <div className='space-y-3'>
                <DetailItem label='Display name' value={model.displayName} />
                <DetailItem label='Provider' value={provider.name} />
                <DetailItem
                  label='Context tracked'
                  value={model.contextWindow ? 'Yes' : 'Partial'}
                />
                <DetailItem
                  label='Pricing updated'
                  value={formatUpdatedAt(model.pricing.updatedAt)}
                />
              </div>
            </div>

            <div className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-5'>
              <h2 className='mb-4 font-[500] text-[16px] text-[var(--landing-text)]'>
                Browse more
              </h2>
              <div className='space-y-2'>
                <Link
                  href={provider.href}
                  className='block rounded-xl px-3 py-2 text-[14px] text-[var(--landing-text-muted)] transition-colors hover:bg-[var(--landing-bg-elevated)] hover:text-[var(--landing-text)]'
                >
                  All {provider.name} models
                </Link>
                <Link
                  href='/models'
                  className='block rounded-xl px-3 py-2 text-[14px] text-[var(--landing-text-muted)] transition-colors hover:bg-[var(--landing-bg-elevated)] hover:text-[var(--landing-text)]'
                >
                  Full models directory
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
