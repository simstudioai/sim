import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/core/utils/urls'
import { BackLink, ChevronArrow } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import {
  FeaturedModelCard,
  FeaturedProviderCard,
  ProviderIcon,
} from '@/app/(landing)/models/components/model-primitives'
import { ModelTimelineChart } from '@/app/(landing)/models/components/model-timeline-chart'
import {
  buildProviderFaqs,
  formatPrice,
  formatTokenCount,
  getProviderBySlug,
  MODEL_PROVIDERS_WITH_CATALOGS,
  TOP_MODEL_PROVIDERS,
} from '@/app/(landing)/models/utils'

const baseUrl = SITE_URL

export const dynamicParams = false

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
    // og:image/twitter:image come from the sibling opengraph-image.tsx -
    // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
    openGraph: {
      title: `${provider.name} Models | Sim`,
      description: `Explore ${provider.modelCount} ${provider.name} models with pricing and capability details.`,
      url: `${baseUrl}${provider.href}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${provider.name} Models | Sim`,
      description: providerFaqs[0]?.answer ?? provider.summary,
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
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={faqJsonLd} />

      <section className='bg-[var(--bg)]'>
        <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          <div className='mb-6'>
            <BackLink href='/models' label='Back to Models' />
          </div>

          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div className='flex items-center gap-4'>
              <ProviderIcon
                provider={provider}
                className='size-12 rounded-xl'
                iconClassName='size-6'
              />
              <h1
                id='provider-heading'
                className='text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
              >
                {provider.name} models
              </h1>
            </div>
            <span className='shrink-0 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
              {provider.modelCount} models
            </span>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1446px]'>
          <div className='mx-12 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
            {provider.featuredModels.length > 0 && (
              <>
                <nav aria-label='Featured models' className='flex flex-col sm:flex-row'>
                  {provider.featuredModels.slice(0, 3).map((model) => (
                    <FeaturedModelCard key={model.id} provider={provider} model={model} />
                  ))}
                </nav>
                <div className='h-px w-full bg-[var(--border)]' />
              </>
            )}

            <ModelTimelineChart models={provider.models} providerId={provider.id} />

            {provider.models.map((model) => (
              <Link
                key={model.id}
                href={model.href}
                className='group/link flex items-center gap-4 border-[var(--border)] border-t px-6 py-4 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)]'
              >
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <h3 className='text-[14px] text-[var(--text-primary)] leading-snug tracking-[-0.02em]'>
                    {model.displayName}
                  </h3>
                  <p className='line-clamp-1 hidden text-[12px] text-[var(--text-muted)] leading-[150%] sm:block'>
                    {model.id}
                  </p>
                </div>
                <span className='hidden shrink-0 text-[11px] text-[var(--text-muted)] uppercase tracking-[0.1em] md:block'>
                  {formatPrice(model.pricing.input)}/1M in
                </span>
                <span className='hidden shrink-0 text-[11px] text-[var(--text-muted)] uppercase tracking-[0.1em] md:block'>
                  {formatPrice(model.pricing.output)}/1M out
                </span>
                {model.contextWindow ? (
                  <span className='hidden shrink-0 text-[11px] text-[var(--text-muted)] uppercase tracking-[0.1em] lg:block'>
                    {formatTokenCount(model.contextWindow)} ctx
                  </span>
                ) : null}
                <ChevronArrow />
              </Link>
            ))}

            {relatedProviders.length > 0 && (
              <>
                <div className='h-px w-full bg-[var(--border)]' />
                <nav aria-label='Related providers' className='flex flex-col sm:flex-row'>
                  {relatedProviders.map((entry) => (
                    <FeaturedProviderCard key={entry.id} provider={entry} />
                  ))}
                </nav>
              </>
            )}

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='provider-faq-heading' className='px-6 py-10'>
              <h2
                id='provider-faq-heading'
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
