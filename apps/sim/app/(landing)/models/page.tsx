import type { Metadata } from 'next'
import { Badge } from '@/components/emcn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { ModelComparisonCharts } from '@/app/(landing)/models/components/model-comparison-charts'
import { ModelDirectory } from '@/app/(landing)/models/components/model-directory'
import {
  FeaturedModelCard,
  FeaturedProviderCard,
} from '@/app/(landing)/models/components/model-primitives'
import {
  ALL_CATALOG_MODELS,
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
  const featuredProviderOrder = ['anthropic', 'openai', 'google']
  const featuredProviders = featuredProviderOrder
    .map((id) => MODEL_PROVIDERS_WITH_CATALOGS.find((p) => p.id === id))
    .filter((p): p is (typeof MODEL_PROVIDERS_WITH_CATALOGS)[number] => p !== undefined)
  const featuredModels = featuredProviders
    .map((provider) =>
      provider.featuredModels[0] ? { provider, model: provider.featuredModels[0] } : null
    )
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

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

      <section className='bg-[var(--landing-bg)]'>
        <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='mb-5 bg-white/10 font-season text-white uppercase tracking-[0.02em]'
          >
            Models
          </Badge>

          <div className='flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between'>
            <h1
              id='models-heading'
              className='text-balance text-[28px] text-white leading-[100%] tracking-[-0.02em] lg:text-[40px]'
            >
              Models
            </h1>
            <p className='font-[430] font-season text-[var(--landing-text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              Browse {TOTAL_MODELS} AI models across {TOTAL_MODEL_PROVIDERS} providers. Compare
              pricing, context windows, and capabilities.
            </p>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

        <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
          {featuredProviders.length > 0 && (
            <>
              <nav aria-label='Featured providers' className='flex flex-col sm:flex-row'>
                {featuredProviders.map((provider) => (
                  <FeaturedProviderCard key={provider.id} provider={provider} />
                ))}
              </nav>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            </>
          )}

          {featuredModels.length > 0 && (
            <>
              <nav aria-label='Featured models' className='flex flex-col sm:flex-row'>
                {featuredModels.map(({ provider, model }) => (
                  <FeaturedModelCard key={model.id} provider={provider} model={model} />
                ))}
              </nav>
              <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            </>
          )}

          <ModelComparisonCharts models={ALL_CATALOG_MODELS} />

          <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

          <section aria-labelledby='all-models-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='all-models-heading'
                className='mb-2 text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                All models
              </h2>
            </div>
            <ModelDirectory />
          </section>

          <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

          <section aria-labelledby='faq-heading' className='px-6 py-10'>
            <h2
              id='faq-heading'
              className='mb-8 text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'
            >
              Frequently asked questions
            </h2>
            <div>
              <LandingFAQ faqs={faqItems} />
            </div>
          </section>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
      </section>
    </>
  )
}
