import { Suspense } from 'react'
import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import { BackLink } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  PricingCalculator,
  PricingCalculatorFallback,
} from '@/app/(landing)/models/(shell)/pricing-calculator/components/pricing-calculator'
import { ModelToolLink } from '@/app/(landing)/models/components/model-tool-link'
import { MODEL_TOOLS, TOOL_MODELS, TOOL_PRICING_UPDATED_AT } from '@/app/(landing)/models/tools'
import { formatPrice, formatTokenCount, formatUpdatedAt } from '@/app/(landing)/models/utils'

const PAGE_PATH = '/models/pricing-calculator'
const PAGE_URL = `${SITE_URL}${PAGE_PATH}`
const AGENT_COST_ARTICLE_PATH = '/library/how-much-does-it-cost-to-build-and-run-an-ai-agent'

const TITLE = 'LLM API Pricing Calculator: OpenAI, Claude, Gemini'
const DESCRIPTION = `Free LLM API pricing calculator: estimate cost per request and per month for ${TOOL_MODELS.length} OpenAI, Claude, Gemini, and other models, with cached input.`

const tieredModel = TOOL_MODELS.find((model) => (model.pricing.tiers?.length ?? 0) > 0)
const tieredExample = tieredModel?.pricing.tiers?.[0]
const cachedModel = TOOL_MODELS.find(
  (model) =>
    model.pricing.cachedInput !== undefined && model.pricing.cachedInput < model.pricing.input
)

const tierSentence =
  tieredModel && tieredExample
    ? ` For example, ${tieredModel.displayName} bills ${formatPrice(tieredModel.pricing.input)} per 1M input tokens up to ${formatTokenCount(tieredExample.aboveInputTokens)} input tokens and ${formatPrice(tieredExample.input)} per 1M once a request goes past that.`
    : ''

const cachedSentence = cachedModel?.pricing.cachedInput
  ? ` ${cachedModel.displayName}, for instance, lists ${formatPrice(cachedModel.pricing.cachedInput)} per 1M cached input tokens against ${formatPrice(cachedModel.pricing.input)} per 1M uncached.`
  : ''

const COST_DRIVERS = [
  {
    id: 'tokens',
    title: 'Input and output tokens',
    body: 'Every LLM API call is billed per token, with separate rates for the tokens you send (system prompt, conversation history, tool results, retrieved documents) and the tokens the model generates. Output tokens usually cost several times more than input tokens, and reasoning models bill their hidden reasoning tokens as output.',
  },
  {
    id: 'cached-input',
    title: 'Cached input',
    body: `When a provider supports prompt caching, a repeated prompt prefix such as a long system prompt is read from cache at a discounted cached-input rate.${cachedSentence} The calculator bills the cached share of input at that rate and the rest at the full input rate; models without a cached rate bill all input at the input rate.`,
  },
  {
    id: 'tiers',
    title: 'Long-context pricing tiers',
    body: `Some models charge a higher rate for the whole request once its input crosses a size threshold.${tierSentence} Sim resolves the tier from all input tokens, cached and uncached, and applies it to input, cached input, and output alike.`,
  },
]

const faqItems = [
  {
    question: 'How do I calculate the cost of an LLM API call?',
    answer:
      'Multiply input tokens by the input rate and output tokens by the output rate, with both rates quoted per one million tokens, then add the two. If part of the input is served from a prompt cache, bill that part at the cached-input rate instead. Multiply the per-request cost by requests per day and by 30 for a monthly estimate. The Sim pricing calculator does this for every selected model at once.',
  },
  {
    question: 'Does this calculator work for OpenAI, Claude, and Gemini pricing?',
    answer: `Yes. The Sim LLM API pricing calculator covers ${TOOL_MODELS.length} current models from OpenAI, Anthropic Claude, Google Gemini, xAI, Mistral, DeepSeek, and other providers, using the same pricing data shown on each Sim model page. Prices were last updated ${formatUpdatedAt(TOOL_PRICING_UPDATED_AT)}.`,
  },
  {
    question: 'How much does prompt caching save?',
    answer:
      'Prompt caching discounts the input tokens a provider has already seen, so savings scale with how much of each request repeats. An agent that resends a long system prompt and tool definitions on every call can serve most of its input from cache. Set the cached input percentage in the Sim calculator to see the difference per model; cache writes, which some providers bill at a premium, are not included.',
  },
  {
    question: 'How many tokens is my prompt?',
    answer:
      'A token is roughly four characters of English text, but the exact count depends on the model tokenizer. Paste your prompt into the Sim token counter for an exact count on OpenAI models and an estimate for others, then use that number as the input tokens here.',
  },
  {
    question: 'How do I control LLM costs in an AI agent?',
    answer:
      'Pick the smallest model that handles the task, keep system prompts and tool definitions stable so they hit the prompt cache, trim conversation history and retrieved context, and cap output length. In Sim, every agent run records its token usage and cost per block in the logs, so you can see which step drives spend and swap models on that step alone.',
  },
]

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    keywords: [
      'LLM pricing calculator',
      'LLM API pricing calculator',
      'OpenAI pricing calculator',
      'Claude API cost calculator',
      'Gemini API pricing calculator',
      'AI API cost calculator',
      'LLM cost per request',
      'prompt caching cost',
    ],
    // og:image/twitter:image come from the sibling opengraph-image.tsx.
    openGraph: {
      title: `${TITLE} | Sim`,
      description: DESCRIPTION,
      url: PAGE_URL,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${TITLE} | Sim`,
      description: DESCRIPTION,
    },
    alternates: {
      canonical: PAGE_URL,
    },
  }
}

export default function PricingCalculatorPage() {
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${SITE_URL}/models` },
      { '@type': 'ListItem', position: 3, name: 'LLM API pricing calculator', item: PAGE_URL },
    ],
  }

  const applicationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${PAGE_URL}#application`,
    name: 'Sim LLM API Pricing Calculator',
    description: DESCRIPTION,
    url: PAGE_URL,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    dateModified: TOOL_PRICING_UPDATED_AT,
    publisher: { '@id': `${SITE_URL}#organization` },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'Cost per request, per day, and per month',
      'Side-by-side model comparison',
      'Cached input pricing',
      'Long-context pricing tiers',
      'Shareable links',
    ],
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={applicationJsonLd} />
      <JsonLd data={faqJsonLd} />

      <section
        id='pricing-calculator'
        aria-labelledby='pricing-calculator-heading'
        className='bg-[var(--bg)]'
      >
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
          <p className='sr-only'>
            Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. The
            free Sim LLM API pricing calculator estimates cost per request, per day, and per month
            for {TOOL_MODELS.length} OpenAI, Anthropic Claude, Google Gemini, and other models,
            using the same rates and long-context tier rules Sim uses to cost model calls in its
            execution logs.
          </p>
          <div className='mb-6'>
            <BackLink href='/models' label='Back to models' />
          </div>
          <p className='mb-2 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
            Free tool
          </p>
          <h1
            id='pricing-calculator-heading'
            className='text-balance text-[40px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[28px]'
          >
            LLM API pricing calculator
          </h1>
          <p className='mt-4 max-w-[760px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
            Estimate what an LLM API call costs across OpenAI, Anthropic Claude, Google Gemini, and{' '}
            {TOOL_MODELS.length} current models. Enter tokens per request, the share of input served
            from the prompt cache, and requests per day; Sim prices each model with the same rates
            and long-context tier rules it uses to cost model calls in its execution logs.
          </p>
          <p className='mt-3 text-[var(--text-muted)] text-small'>
            Prices last updated{' '}
            <time dateTime={TOOL_PRICING_UPDATED_AT}>
              {formatUpdatedAt(TOOL_PRICING_UPDATED_AT)}
            </time>
          </p>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <div className='border-[var(--border)] border-x'>
            <Suspense fallback={<PricingCalculatorFallback />}>
              <PricingCalculator />
            </Suspense>

            <div className='h-px w-full bg-[var(--border)]' />

            <section
              id='cost-drivers'
              aria-labelledby='cost-drivers-heading'
              className='px-6 py-10'
            >
              <h2
                id='cost-drivers-heading'
                className='mb-3 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
              >
                What drives LLM API cost
              </h2>
              <p className='mb-8 max-w-[760px] text-[var(--text-body)] text-sm leading-[150%]'>
                LLM API cost is tokens times rate: input tokens at the input rate, cached input at
                the cached rate, and output tokens at the output rate, all quoted per one million
                tokens. Three things move the total.
              </p>
              <div className='grid grid-cols-3 gap-8 max-lg:grid-cols-1'>
                {COST_DRIVERS.map((driver) => (
                  <div key={driver.id}>
                    <h3 className='mb-2 text-[var(--text-primary)] text-base'>{driver.title}</h3>
                    <p className='text-[var(--text-muted)] text-sm leading-[150%]'>{driver.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <nav aria-label='Related resources' className='flex max-sm:flex-col'>
              <ModelToolLink
                href={MODEL_TOOLS.tokenCounter.href}
                title={MODEL_TOOLS.tokenCounter.name}
                description='Count the tokens in a prompt before you price it.'
              />
              <ModelToolLink
                href='/models'
                title='AI models directory'
                description='Rates, context windows, and capabilities for every model.'
              />
              <ModelToolLink
                href={AGENT_COST_ARTICLE_PATH}
                title='What an AI agent costs to run'
                description='Model usage, infrastructure, and operations, end to end.'
              />
            </nav>

            <div className='h-px w-full bg-[var(--border)]' />

            <section id='faq' aria-labelledby='faq-heading' className='px-6 py-10'>
              <h2
                id='faq-heading'
                className='mb-8 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
              >
                Frequently asked questions
              </h2>
              <LandingFAQ faqs={faqItems} />
            </section>
          </div>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </section>
    </>
  )
}
