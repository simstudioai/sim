import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import {
  ChevronArrow,
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

      <section className='bg-[var(--landing-bg)]'>
        <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
          <div className='mb-6'>
            <Link
              href='/models'
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
              Back to Models
            </Link>
          </div>

          <Badge
            variant='blue'
            size='md'
            dot
            className='mb-5 bg-white/10 font-season text-white uppercase tracking-[0.02em]'
          >
            Provider
          </Badge>

          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div className='flex items-center gap-4'>
              <ProviderIcon
                provider={provider}
                className='h-12 w-12 rounded-[5px]'
                iconClassName='h-6 w-6'
              />
              <h1
                id='provider-heading'
                className='font-[430] font-season text-[28px] text-white leading-[100%] tracking-[-0.02em] lg:text-[40px]'
              >
                {provider.name} models
              </h1>
            </div>
            <span className='shrink-0 font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
              {provider.modelCount} models
            </span>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

        <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
          {provider.featuredModels.length > 0 && (
            <>
              <nav aria-label='Featured models' className='flex flex-col sm:flex-row'>
                {provider.featuredModels.slice(0, 3).map((model) => (
                  <FeaturedModelCard key={model.id} provider={provider} model={model} />
                ))}
              </nav>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            </>
          )}

          <ModelTimelineChart models={provider.models} providerId={provider.id} />

          <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

          {provider.models.map((model) => (
            <div key={model.id}>
              <Link
                href={model.href}
                className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--landing-bg-elevated)]'
              >
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <h3 className='text-[14px] text-white leading-snug tracking-[-0.02em]'>
                    {model.displayName}
                  </h3>
                  <p className='line-clamp-1 hidden text-[12px] text-[var(--landing-text-muted)] leading-[150%] sm:block'>
                    {model.id}
                  </p>
                </div>
                <span className='hidden shrink-0 font-martian-mono text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.1em] md:block'>
                  {formatPrice(model.pricing.input)}/1M in
                </span>
                <span className='hidden shrink-0 font-martian-mono text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.1em] md:block'>
                  {formatPrice(model.pricing.output)}/1M out
                </span>
                {model.contextWindow ? (
                  <span className='hidden shrink-0 font-martian-mono text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.1em] lg:block'>
                    {formatTokenCount(model.contextWindow)} ctx
                  </span>
                ) : null}
                <ChevronArrow />
              </Link>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            </div>
          ))}

          {relatedProviders.length > 0 && (
            <>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
              <nav aria-label='Related providers' className='flex flex-col sm:flex-row'>
                {relatedProviders.map((entry) => (
                  <FeaturedProviderCard key={entry.id} provider={entry} />
                ))}
              </nav>
            </>
          )}

          <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

          <section aria-labelledby='provider-faq-heading' className='px-6 py-10'>
            <h2
              id='provider-faq-heading'
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
