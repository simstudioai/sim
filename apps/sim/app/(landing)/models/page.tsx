import type { Metadata } from 'next'
import Link from 'next/link'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { ModelDirectory } from '@/app/(landing)/models/components/model-directory'
import { ModelCard, ProviderCard } from '@/app/(landing)/models/components/model-primitives'
import {
  getPricingBounds,
  MODEL_CATALOG_PROVIDERS,
  MODEL_PROVIDERS_WITH_CATALOGS,
  TOP_MODEL_PROVIDERS,
  TOTAL_MODEL_PROVIDERS,
  TOTAL_MODELS,
} from '@/app/(landing)/models/utils'

const baseUrl = getBaseUrl()

const faqItems = [
  {
    question: 'What is the Sim AI models directory?',
    answer:
      'The Sim AI models directory is a public catalog of the language models and providers tracked inside Sim. It shows provider coverage, model IDs, pricing per one million tokens, context windows, and supported capabilities such as reasoning controls, structured outputs, and deep research.',
  },
  {
    question: 'Can I compare models from multiple providers in one place?',
    answer:
      'Yes. This page organizes every tracked model by provider and lets you search across providers, model names, and capabilities. You can quickly compare OpenAI, Anthropic, Google, xAI, Mistral, Groq, Cerebras, Fireworks, Bedrock, and more from a single directory.',
  },
  {
    question: 'Are these model prices shown per million tokens?',
    answer:
      'Yes. Input, cached input, and output prices on this page are shown per one million tokens based on the provider metadata tracked in Sim.',
  },
  {
    question: 'Does Sim support providers with dynamic model catalogs too?',
    answer:
      'Yes. Some providers such as OpenRouter, Fireworks, Ollama, and vLLM load their model lists dynamically at runtime. Those providers are still shown here even when their full public model list is not hard-coded into the catalog.',
  },
]

export const metadata: Metadata = {
  title: 'AI Models Directory',
  description: `Browse ${TOTAL_MODELS}+ AI models across ${TOTAL_MODEL_PROVIDERS} providers. Compare pricing, context windows, and capabilities for OpenAI, Anthropic, Google, xAI, Mistral, Bedrock, Groq, and more.`,
  keywords: [
    'AI models directory',
    'LLM model list',
    'model pricing',
    'context window comparison',
    'OpenAI models',
    'Anthropic models',
    'Google Gemini models',
    'xAI Grok models',
    'Mistral models',
    ...TOP_MODEL_PROVIDERS.map((provider) => `${provider} models`),
  ],
  openGraph: {
    title: 'AI Models Directory | Sim',
    description: `Explore ${TOTAL_MODELS}+ AI models across ${TOTAL_MODEL_PROVIDERS} providers with pricing, context windows, and capability details.`,
    url: `${baseUrl}/models`,
    type: 'website',
    images: [
      {
        url: `${baseUrl}/models/opengraph-image`,
        width: 1200,
        height: 630,
        alt: 'Sim AI Models Directory',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Models Directory | Sim',
    description: `Search ${TOTAL_MODELS}+ AI models across ${TOTAL_MODEL_PROVIDERS} providers.`,
    images: [{ url: `${baseUrl}/models/opengraph-image`, alt: 'Sim AI Models Directory' }],
  },
  alternates: {
    canonical: `${baseUrl}/models`,
  },
}

export default function ModelsPage() {
  const flatModels = MODEL_CATALOG_PROVIDERS.flatMap((provider) =>
    provider.models.map((model) => ({ provider, model }))
  )
  const featuredProviders = MODEL_PROVIDERS_WITH_CATALOGS.slice(0, 6)
  const featuredModels = MODEL_PROVIDERS_WITH_CATALOGS.flatMap((provider) =>
    provider.featuredModels[0] ? [{ provider, model: provider.featuredModels[0] }] : []
  ).slice(0, 6)
  const heroProviders = ['openai', 'anthropic', 'azure-openai', 'google', 'bedrock']
    .map((providerId) => MODEL_CATALOG_PROVIDERS.find((provider) => provider.id === providerId))
    .filter(
      (provider): provider is (typeof MODEL_CATALOG_PROVIDERS)[number] => provider !== undefined
    )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${baseUrl}/models` },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Sim AI Models Directory',
    description: `Directory of ${TOTAL_MODELS} AI models tracked in Sim across ${TOTAL_MODEL_PROVIDERS} providers.`,
    url: `${baseUrl}/models`,
    numberOfItems: TOTAL_MODELS,
    itemListElement: flatModels.map(({ provider, model }, index) => {
      const { lowPrice, highPrice } = getPricingBounds(model.pricing)
      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: model.displayName,
          url: `${baseUrl}${model.href}`,
          description: model.summary,
          brand: provider.name,
          category: 'AI language model',
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'USD',
            lowPrice: lowPrice.toString(),
            highPrice: highPrice.toString(),
          },
        },
      }
    }),
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
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

      <div className='mx-auto max-w-[1280px] px-6 py-16 sm:px-8 md:px-12'>
        <section aria-labelledby='models-heading' className='mb-14'>
          <div className='max-w-[840px]'>
            <p className='mb-3 text-[12px] text-[var(--landing-text-muted)] uppercase tracking-[0.16em]'>
              Public model directory
            </p>
            <h1
              id='models-heading'
              className='text-balance font-[500] text-[40px] text-[var(--landing-text)] leading-tight sm:text-[56px]'
            >
              Browse AI models by provider, pricing, and capabilities
            </h1>
            <p className='mt-5 max-w-[760px] text-[18px] text-[var(--landing-text-muted)] leading-relaxed'>
              Explore every model tracked in Sim across providers like{' '}
              {heroProviders.map((provider, index, allProviders) => {
                const Icon = provider.icon

                return (
                  <span key={provider.id}>
                    <span className='inline-flex items-center gap-1 whitespace-nowrap align-[0.02em]'>
                      {Icon ? (
                        <span
                          aria-hidden='true'
                          className='relative top-[0.02em] inline-flex shrink-0 text-[var(--landing-text)]'
                        >
                          <Icon className='h-[0.82em] w-[0.82em]' />
                        </span>
                      ) : null}
                      <span>{provider.name}</span>
                    </span>
                    {index < allProviders.length - 1 ? ', ' : ''}
                  </span>
                )
              })}
              {
                ' and more. Compare model IDs, token pricing, context windows, and features such as reasoning, structured outputs, and deep research from one clean catalog.'
              }
            </p>
          </div>

          <div className='mt-8 flex flex-wrap gap-3'>
            <a
              href='https://sim.ai'
              className='inline-flex h-[34px] items-center rounded-[6px] border border-[var(--white)] bg-[var(--white)] px-3 font-[430] text-[14px] text-[var(--landing-text-dark)] transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              Start building free
            </a>
            <Link
              href='/integrations'
              className='inline-flex h-[34px] items-center rounded-[6px] border border-[var(--landing-border-strong)] px-3 font-[430] text-[14px] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              Explore integrations
            </Link>
          </div>
        </section>

        <section aria-labelledby='providers-heading' className='mb-16'>
          <div className='mb-6'>
            <h2
              id='providers-heading'
              className='font-[500] text-[28px] text-[var(--landing-text)]'
            >
              Browse by provider
            </h2>
            <p className='mt-2 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
              Each provider has its own generated SEO page with model lineup details, featured
              models, provider FAQs, and internal links to individual model pages.
            </p>
          </div>

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {featuredProviders.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </section>

        <section aria-labelledby='featured-models-heading' className='mb-16'>
          <div className='mb-6'>
            <h2
              id='featured-models-heading'
              className='font-[500] text-[28px] text-[var(--landing-text)]'
            >
              Featured model pages
            </h2>
            <p className='mt-2 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
              These pages are generated directly from the model registry and target high-intent
              search queries around pricing, context windows, and model capabilities.
            </p>
          </div>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
            {featuredModels.map(({ provider, model }) => (
              <ModelCard key={model.id} provider={provider} model={model} showProvider />
            ))}
          </div>
        </section>

        <section aria-labelledby='all-models-heading'>
          <div className='mb-6'>
            <h2
              id='all-models-heading'
              className='font-[500] text-[28px] text-[var(--landing-text)]'
            >
              All models
            </h2>
            <p className='mt-2 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
              Search the full catalog by provider, model ID, or capability. Use it to compare
              providers, sanity-check pricing, and quickly understand which models fit the workflow
              you&apos;re building. All pricing is shown per one million tokens using the metadata
              currently tracked in Sim.
            </p>
          </div>

          <ModelDirectory />
        </section>

        <section
          aria-labelledby='faq-heading'
          className='mt-16 rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
        >
          <h2 id='faq-heading' className='font-[500] text-[28px] text-[var(--landing-text)]'>
            Frequently asked questions
          </h2>
          <div className='mt-3'>
            <LandingFAQ faqs={faqItems} />
          </div>
        </section>
      </div>
    </>
  )
}
