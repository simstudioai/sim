import { Suspense } from 'react'
import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import { BackLink } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  TokenCounter,
  TokenCounterFallback,
} from '@/app/(landing)/models/(shell)/token-counter/components/token-counter'
import { ModelToolLink } from '@/app/(landing)/models/components/model-tool-link'
import { MODEL_TOOLS, TOOL_MODELS } from '@/app/(landing)/models/tools'

const PAGE_PATH = '/models/token-counter'
const PAGE_URL = `${SITE_URL}${PAGE_PATH}`

const TITLE = 'Token Counter and Tokenizer for OpenAI and Claude'
const DESCRIPTION =
  'Free token counter: paste text to count tokens and characters and estimate input cost for OpenAI, Claude, Gemini, and other models. Runs in your browser.'

const TOKENIZER_FACTS = [
  {
    id: 'what-is-a-token',
    title: 'What a token is',
    body: 'A token is the unit a language model reads and writes: a whole word, part of a word, a punctuation mark, or a run of whitespace. In English, one token averages about four characters, so 1,000 tokens is roughly 750 words. Code, non-English text, and numbers usually take more tokens per character.',
  },
  {
    id: 'exact-vs-estimate',
    title: 'Exact counts and estimates',
    body: "OpenAI publishes its tokenizer encodings, so the Sim token counter loads OpenAI's tiktoken encodings in your browser and counts text exactly as the OpenAI API tokenizes it. Anthropic, Google, and most other providers do not publish a browser tokenizer, so their counts are character-based estimates and are labelled as such.",
  },
  {
    id: 'why-count',
    title: 'Why token counts matter',
    body: 'Tokens set both the price of a call and whether it fits the model context window. An agent that resends its system prompt, tool definitions, and conversation history on every turn can multiply a small prompt into a large bill, so counting the tokens in each piece shows where to trim.',
  },
]

const faqItems = [
  {
    question: 'How do I count tokens for OpenAI models?',
    answer:
      "Paste your text into the Sim token counter and select an OpenAI model. The count comes from OpenAI's tiktoken encodings (o200k_base for GPT-4o and newer models, cl100k_base for older GPT-4 and GPT-3.5 models), the same tokenizer the OpenAI API uses to bill input.",
  },
  {
    question: 'Can I count tokens for Claude?',
    answer:
      'Anthropic does not publish a tokenizer that runs in the browser, so the Sim token counter estimates Claude token counts from character and word length and labels them as estimates. For an exact Claude count, call the Anthropic token counting API with the same messages you plan to send.',
  },
  {
    question: 'Is my text sent anywhere?',
    answer:
      'No. The Sim token counter tokenizes text in your browser. Pasted text is never sent to Sim or stored in the page URL; only the selected models are kept in the link so you can share a configuration.',
  },
  {
    question: 'How many tokens is 1,000 words?',
    answer:
      'About 1,300 tokens for typical English prose with OpenAI tokenizers, since one token averages about four characters. The ratio varies with vocabulary, formatting, and language, so paste the actual text for a real count.',
  },
  {
    question: 'How do token counts translate to cost?',
    answer: `Each model bills input and output tokens at its own rate per one million tokens. The Sim token counter multiplies your token count by the input rate of each selected model, switching to the higher long-context rate when the count crosses a model's pricing tier threshold; use the Sim LLM API pricing calculator to add output tokens, prompt caching, and monthly volume across ${TOOL_MODELS.length} models.`,
  },
]

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    keywords: [
      'token counter',
      'tokenizer',
      'OpenAI tokenizer',
      'token calculator',
      'Claude token counter',
      'tiktoken online',
      'GPT token counter',
      'count tokens',
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

export default function TokenCounterPage() {
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${SITE_URL}/models` },
      { '@type': 'ListItem', position: 3, name: 'Token counter', item: PAGE_URL },
    ],
  }

  const applicationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${PAGE_URL}#application`,
    name: 'Sim Token Counter',
    description: DESCRIPTION,
    url: PAGE_URL,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    publisher: { '@id': `${SITE_URL}#organization` },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'Exact token counts for OpenAI models',
      'Token estimates for Claude, Gemini, and other models',
      'Character count',
      'Estimated input cost per model',
      'Runs entirely in the browser',
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
        id='token-counter'
        aria-labelledby='token-counter-heading'
        className='bg-[var(--bg)]'
      >
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
          <p className='sr-only'>
            Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. The
            free Sim token counter counts the tokens and characters in pasted text for OpenAI,
            Anthropic Claude, Google Gemini, and other models, exactly for OpenAI and as an estimate
            for the rest, and shows each model's input cost. Text never leaves the browser.
          </p>
          <div className='mb-6'>
            <BackLink href='/models' label='Back to models' />
          </div>
          <p className='mb-2 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
            Free tool
          </p>
          <h1
            id='token-counter-heading'
            className='text-balance text-[40px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[28px]'
          >
            Token counter
          </h1>
          <p className='mt-4 max-w-[760px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
            Paste a prompt or document to count its tokens and characters and see what it costs as
            input to OpenAI, Anthropic Claude, Google Gemini, and other models. Counts are exact for
            OpenAI models and estimated for the rest, and your text never leaves the browser.
          </p>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <div className='border-[var(--border)] border-x'>
            <Suspense fallback={<TokenCounterFallback />}>
              <TokenCounter />
            </Suspense>

            <div className='h-px w-full bg-[var(--border)]' />

            <section id='tokenizer' aria-labelledby='tokenizer-heading' className='px-6 py-10'>
              <h2
                id='tokenizer-heading'
                className='mb-3 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
              >
                How LLM tokenizers count text
              </h2>
              <p className='mb-8 max-w-[760px] text-[var(--text-body)] text-sm leading-[150%]'>
                A tokenizer splits text into the tokens a model reads, and each provider uses its
                own vocabulary, so the same text yields different counts on different models.
              </p>
              <div className='grid grid-cols-3 gap-8 max-lg:grid-cols-1'>
                {TOKENIZER_FACTS.map((fact) => (
                  <div key={fact.id}>
                    <h3 className='mb-2 text-[var(--text-primary)] text-base'>{fact.title}</h3>
                    <p className='text-[var(--text-muted)] text-sm leading-[150%]'>{fact.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <nav aria-label='Related resources' className='flex max-sm:flex-col'>
              <ModelToolLink
                href={MODEL_TOOLS.pricingCalculator.href}
                title={MODEL_TOOLS.pricingCalculator.name}
                description='Turn token counts into cost per request and per month.'
              />
              <ModelToolLink
                href='/models'
                title='AI models directory'
                description='Rates, context windows, and capabilities for every model.'
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
