import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { FeaturedModelCard, ProviderIcon } from '@/app/(landing)/models/components/model-primitives'
import {
  ALL_CATALOG_MODELS,
  buildModelCapabilityFacts,
  buildModelFaqs,
  formatPrice,
  formatTokenCount,
  formatUpdatedAt,
  getEffectiveMaxOutputTokens,
  getModelBySlug,
  getPricingBounds,
  getProviderBySlug,
  getRelatedModels,
} from '@/app/(landing)/models/utils'

const baseUrl = SITE_URL

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

      <section className='bg-[var(--landing-bg)]'>
        <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
          <div className='mb-6'>
            <Link
              href={provider.href}
              className='group/link inline-flex items-center gap-1.5 font-season text-[var(--landing-text-muted)] text-sm tracking-[0.02em] hover:text-[var(--landing-text)]'
            >
              <svg
                className='h-3 w-3 shrink-0'
                viewBox='0 0 10 10'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <line
                  x1='1'
                  y1='5'
                  x2='10'
                  y2='5'
                  stroke='currentColor'
                  strokeWidth='1.33'
                  strokeLinecap='square'
                  className='origin-right scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
                />
                <path
                  d='M6.5 2L3.5 5L6.5 8'
                  stroke='currentColor'
                  strokeWidth='1.33'
                  strokeLinecap='square'
                  strokeLinejoin='miter'
                  fill='none'
                  className='group-hover/link:-translate-x-[30%] transition-transform duration-200 ease-out'
                />
              </svg>
              Back to {provider.name}
            </Link>
          </div>

          <div className='mb-6 flex items-center gap-5'>
            <ProviderIcon
              provider={provider}
              className='h-16 w-16 rounded-[5px]'
              iconClassName='h-8 w-8'
            />
            <div>
              <p className='mb-0.5 font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
                {provider.name} model
              </p>
              <h1
                id='model-heading'
                className='text-[28px] text-white leading-[100%] tracking-[-0.02em] sm:text-[36px] lg:text-[44px]'
              >
                {model.displayName}
              </h1>
            </div>
          </div>

          <p className='mb-8 max-w-[700px] text-[var(--landing-text-body)] text-base leading-[150%] tracking-[0.02em]'>
            {model.summary}
            {model.bestFor ? ` ${model.bestFor}` : ''}
          </p>

          <div className='flex flex-wrap gap-2'>
            <a
              href='/'
              className='inline-flex h-[32px] items-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-season text-black text-sm transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              Build with this model
            </a>
            <Link
              href={provider.href}
              className='inline-flex h-[32px] items-center rounded-[5px] border border-[var(--landing-border-strong)] px-2.5 font-season text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              All {provider.name} models
            </Link>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

        <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
          <InfoRow label='Input price' value={`${formatPrice(model.pricing.input)}/1M`} />
          <InfoRow
            label='Cached input'
            value={
              model.pricing.cachedInput !== undefined
                ? `${formatPrice(model.pricing.cachedInput)}/1M`
                : 'N/A'
            }
          />
          <InfoRow label='Output price' value={`${formatPrice(model.pricing.output)}/1M`} />
          <InfoRow
            label='Context window'
            value={model.contextWindow ? formatTokenCount(model.contextWindow) : 'Unknown'}
          />
          <InfoRow
            label='Max output'
            value={
              model.capabilities.maxOutputTokens
                ? `${formatTokenCount(getEffectiveMaxOutputTokens(model.capabilities))} tokens`
                : 'Not published'
            }
          />
          <InfoRow label='Provider' value={provider.name} />
          <InfoRow label='Updated' value={formatUpdatedAt(model.pricing.updatedAt)} />
          {model.bestFor ? <InfoRow label='Best for' value={model.bestFor} /> : null}

          {capabilityFacts.length > 0 && (
            <>
              {capabilityFacts.map((item) => (
                <InfoRow key={item.label} label={item.label} value={item.value} />
              ))}
            </>
          )}

          {relatedModels.length > 0 && (
            <>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
              <nav aria-label='Related models' className='flex flex-col sm:flex-row'>
                {relatedModels.slice(0, 3).map((entry) => (
                  <FeaturedModelCard key={entry.id} provider={provider} model={entry} />
                ))}
              </nav>
            </>
          )}

          <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

          <section aria-labelledby='model-faq-heading' className='px-6 py-10'>
            <h2
              id='model-faq-heading'
              className='mb-8 text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'
            >
              Frequently asked questions
            </h2>
            <div>
              <LandingFAQ faqs={faqs} />
            </div>
          </section>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
      </section>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
      <div className='flex items-baseline justify-between gap-4 px-6 py-4'>
        <span className='font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
          {label}
        </span>
        <span className='text-right text-[14px] text-white leading-snug'>{value}</span>
      </div>
    </>
  )
}
