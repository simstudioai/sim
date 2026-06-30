import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChipLink } from '@/components/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { BackLink } from '@/app/(landing)/components'
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

export const dynamicParams = false

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
    // og:image/twitter:image come from the sibling opengraph-image.tsx -
    // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
    openGraph: {
      title: `${model.displayName} Pricing, Context Window, and Features | Sim`,
      description: `${model.displayName} by ${provider.name}: pricing, context window, and model capability details.`,
      url: `${baseUrl}${model.href}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${model.displayName} | Sim`,
      description: model.summary,
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

      <section className='bg-[var(--bg)]'>
        <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          <div className='mb-6'>
            <BackLink href={provider.href} label={`Back to ${provider.name}`} />
          </div>

          <div className='mb-6 flex items-center gap-5'>
            <ProviderIcon
              provider={provider}
              className='size-16 rounded-xl'
              iconClassName='h-8 w-8'
            />
            <div>
              <p className='mb-0.5 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                {provider.name} model
              </p>
              <h1
                id='model-heading'
                className='text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] sm:text-[36px] lg:text-[44px]'
              >
                {model.displayName}
              </h1>
            </div>
          </div>

          <p className='mb-8 max-w-[700px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
            {model.summary}
            {model.bestFor ? ` ${model.bestFor}` : ''}
          </p>

          <div className='flex flex-wrap gap-2'>
            <ChipLink variant='primary' href='/'>
              Build with this model
            </ChipLink>
            <ChipLink href={provider.href} className='border border-[var(--border-1)]'>
              All {provider.name} models
            </ChipLink>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1446px]'>
          <div className='mx-12 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
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
                <div className='h-px w-full bg-[var(--border)]' />
                <nav aria-label='Related models' className='flex flex-col sm:flex-row'>
                  {relatedModels.slice(0, 3).map((entry) => (
                    <FeaturedModelCard key={entry.id} provider={provider} model={entry} />
                  ))}
                </nav>
              </>
            )}

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='model-faq-heading' className='px-6 py-10'>
              <h2
                id='model-faq-heading'
                className='mb-8 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                Frequently asked questions
              </h2>
              <div>
                <LandingFAQ faqs={faqs} />
              </div>
            </section>
          </div>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </section>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-4 border-[var(--border)] border-t px-6 py-4 first:border-t-0'>
      <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>{label}</span>
      <span className='text-right text-[14px] text-[var(--text-primary)] leading-snug'>
        {value}
      </span>
    </div>
  )
}
