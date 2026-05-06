import type { Metadata } from 'next'
import { Badge } from '@/components/emcn'
import { SITE_URL } from '@/lib/core/utils/urls'
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
  MODEL_PROVIDERS_WITH_CATALOGS,
  TOP_MODEL_PROVIDERS,
  TOTAL_MODEL_PROVIDERS,
  TOTAL_MODELS,
} from '@/app/(landing)/models/utils'

const baseUrl = SITE_URL

const faqItems = [
  {
    question: 'Which AI models are best for building agents and automated workflows?',
    answer:
      'The most important factors for agent tasks are reliable tool use (function calling), a large enough context window to track conversation history and tool outputs, and consistent instruction following. In Sim, OpenAI GPT-4.1, Anthropic Claude Sonnet, and Google Gemini 2.5 Pro are popular choices — each supports tool use, structured outputs, and context windows of 128K tokens or more. For cost-sensitive or high-throughput agents, Groq and Cerebras offer significantly faster inference at lower cost.',
  },
  {
    question: 'What does context window size mean when running an AI agent?',
    answer:
      'The context window is the total number of tokens a model can process in a single call, including your system prompt, conversation history, tool call results, and any documents you pass in. For agents running multi-step tasks, context fills up quickly — each tool result and each retrieved document adds tokens. A 128K-token context window fits roughly 300 pages of text; models like Gemini 2.5 Pro support up to 1M tokens, enough to hold an entire codebase in a single pass.',
  },
  {
    question: 'Are model prices shown per million tokens?',
    answer:
      'Yes. Input, cached input, and output prices are all listed per one million tokens, matching how providers bill through their APIs. For agents that chain multiple calls, costs compound quickly — an agent completing 100 turns at 10K tokens each consumes roughly 1M tokens per session. Cached input pricing applies when a provider supports prompt caching, where a repeated prefix like a system prompt is billed at a reduced rate.',
  },
  {
    question: 'Which AI models support tool use and function calling?',
    answer:
      'Tool use — also called function calling — lets an agent invoke external APIs, query databases, run code, or take any action you define. In Sim, all first-party models from OpenAI, Anthropic, Google, Mistral, Groq, Cerebras, and xAI support tool use. Look for the Tool Use capability tag on any model card in this directory to confirm support.',
  },
  {
    question: 'How do I add a model to a Sim agent?',
    answer:
      'Open Sim, add an Agent block, and select your provider and model from the model picker inside that block. Every model listed in this directory is available in the Agent block. Swapping models takes one click and does not affect the rest of your agent, making it straightforward to test different models on the same task without rebuilding anything.',
  },
]

export const metadata: Metadata = {
  title: 'AI Models Directory',
  description: `Browse and compare ${TOTAL_MODELS}+ AI models across ${TOTAL_MODEL_PROVIDERS} providers in Sim's AI workspace. Compare pricing, context windows, and capabilities — then use any model directly in your agents.`,
  keywords: [
    'AI models directory',
    'AI model comparison',
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
  const flatModels = MODEL_PROVIDERS_WITH_CATALOGS.flatMap((provider) =>
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
              Compare AI Models
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
