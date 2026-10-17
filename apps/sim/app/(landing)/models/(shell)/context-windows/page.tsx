import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/core/utils/urls'
import { BackLink } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  MODEL_TABLE_CELL_CLASS,
  MODEL_TABLE_HEADER_CELL_CLASS,
} from '@/app/(landing)/models/components/constants'
import {
  buildContextWindowFaqs,
  CONTEXT_WINDOW_MODELS,
  CONTEXT_WINDOW_PROVIDER_COUNT,
  getLargestContextByProvider,
} from '@/app/(landing)/models/context-windows'
import {
  type CatalogModel,
  formatPrice,
  formatTokenCount,
  formatUpdatedAt,
  getEffectiveMaxOutputTokens,
  getLatestModelUpdate,
} from '@/app/(landing)/models/utils'

const baseUrl = SITE_URL
const PAGE_PATH = '/models/context-windows'
const PAGE_TITLE = 'LLM Context Window Comparison'
const PAGE_DESCRIPTION = `Context windows and max output tokens for ${CONTEXT_WINDOW_MODELS.length} LLMs, including Claude, GPT, Gemini, and Grok, with API prices. Use any of them in Sim's AI agents.`

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    'LLM context window',
    'context window comparison',
    'Claude context window',
    'Gemini context window',
    'GPT-5 context window',
    'Grok context window',
    'max output tokens',
    'largest context window LLM',
  ],
  // og:image/twitter:image come from the sibling opengraph-image.tsx -
  // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
  openGraph: {
    title: `${PAGE_TITLE} | Sim`,
    description: PAGE_DESCRIPTION,
    url: `${baseUrl}${PAGE_PATH}`,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} | Sim`,
    description: PAGE_DESCRIPTION,
  },
  alternates: {
    canonical: `${baseUrl}${PAGE_PATH}`,
  },
}

export default function ContextWindowsPage() {
  const faqs = buildContextWindowFaqs()
  const largestByProvider = getLargestContextByProvider()
  const updatedAt = getLatestModelUpdate(CONTEXT_WINDOW_MODELS)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${baseUrl}/models` },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Context windows',
        item: `${baseUrl}${PAGE_PATH}`,
      },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: PAGE_TITLE,
    description: `${CONTEXT_WINDOW_MODELS.length} AI models tracked in Sim, ordered by context window from largest to smallest.`,
    url: `${baseUrl}${PAGE_PATH}`,
    dateModified: updatedAt.toISOString(),
    numberOfItems: CONTEXT_WINDOW_MODELS.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: CONTEXT_WINDOW_MODELS.map((model, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${baseUrl}${model.href}`,
      name: `${model.displayName}: ${formatTokenCount(model.contextWindow)} tokens`,
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

      <section
        id='context-windows'
        aria-labelledby='context-windows-heading'
        className='bg-[var(--bg)]'
      >
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
          <p className='sr-only'>
            Sim is the open-source AI workspace where teams build, deploy, and manage AI agents.
            This page ranks the context windows and max output tokens of{' '}
            {CONTEXT_WINDOW_MODELS.length} models from {CONTEXT_WINDOW_PROVIDER_COUNT} providers,
            including Claude, GPT, Gemini, and Grok, with API prices per 1M tokens. Every model
            listed is available in the Sim Agent block.
          </p>
          <div className='mb-6'>
            <BackLink href='/models' label='Back to Models' />
          </div>

          <h1
            id='context-windows-heading'
            className='mb-6 text-[40px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[28px]'
          >
            LLM context window comparison
          </h1>
          <p className='max-w-[760px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
            Context windows and max output tokens for {CONTEXT_WINDOW_MODELS.length} models from{' '}
            {CONTEXT_WINDOW_PROVIDER_COUNT} providers, sorted from largest to smallest, with API
            prices per 1M tokens. Every model listed is available in the Sim Agent block. Data last
            updated{' '}
            <time dateTime={updatedAt.toISOString().slice(0, 10)}>
              {formatUpdatedAt(updatedAt.toISOString())}
            </time>
            .
          </p>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <div className='border-[var(--border)] border-x'>
            <section id='largest-by-provider' aria-labelledby='largest-by-provider-heading'>
              <div className='px-6 pt-10 pb-4'>
                <h2
                  id='largest-by-provider-heading'
                  className='mb-2 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
                >
                  Largest context window by provider
                </h2>
                <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
                  The biggest context window each provider offers in Sim, and the model that has it.
                </p>
              </div>
              {largestByProvider.map(({ provider, model }) => (
                <Link
                  key={provider.id}
                  href={model.href}
                  className='flex items-baseline justify-between gap-4 border-[var(--border)] border-t px-6 py-4 transition-colors hover:bg-[var(--surface-hover)]'
                >
                  <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                    {provider.apiName}
                  </span>
                  <span className='text-right text-[var(--text-primary)] text-sm leading-snug'>
                    {formatTokenCount(model.contextWindow)} tokens · {model.displayName}
                  </span>
                </Link>
              ))}
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <section id='all-context-windows' aria-labelledby='all-context-windows-heading'>
              <div className='px-6 pt-10 pb-4'>
                <h2
                  id='all-context-windows-heading'
                  className='mb-2 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
                >
                  Every model by context window
                </h2>
                <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
                  Sorted by context window, largest first. Prices are standard API rates per 1M
                  tokens.
                </p>
              </div>
              <ContextWindowTable models={CONTEXT_WINDOW_MODELS} />
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <section
              id='context-windows-faq'
              aria-labelledby='context-windows-faq-heading'
              className='px-6 py-10'
            >
              <h2
                id='context-windows-faq-heading'
                className='mb-8 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
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

function getMaxOutputLabel(model: CatalogModel): string {
  const maxOutputTokens = getEffectiveMaxOutputTokens(model.capabilities)
  return maxOutputTokens ? formatTokenCount(maxOutputTokens) : '—'
}

interface ContextWindowTableProps {
  models: CatalogModel[]
}

function ContextWindowTable({ models }: ContextWindowTableProps) {
  return (
    <div className='overflow-x-auto'>
      <table className='w-full border-collapse'>
        <caption className='sr-only'>
          Context window, max output tokens, and API prices for every model tracked in Sim
        </caption>
        <thead>
          <tr className='border-[var(--border)] border-t'>
            <th scope='col' className={MODEL_TABLE_HEADER_CELL_CLASS}>
              Model
            </th>
            <th scope='col' className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'max-md:hidden')}>
              Provider
            </th>
            <th scope='col' className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'text-right')}>
              Context
            </th>
            <th
              scope='col'
              className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'text-right max-sm:hidden')}
            >
              Max output
            </th>
            <th
              scope='col'
              className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'text-right max-md:hidden')}
            >
              Input
            </th>
            <th
              scope='col'
              className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'text-right max-md:hidden')}
            >
              Output
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id} className='border-[var(--border)] border-t'>
              <th scope='row' className={cn(MODEL_TABLE_CELL_CLASS, 'text-left font-normal')}>
                <Link href={model.href} className='underline-offset-2 hover:underline'>
                  {model.displayName}
                </Link>
                {model.deprecated ? (
                  <span className='ml-2 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                    Legacy
                  </span>
                ) : null}
              </th>
              <td className={cn(MODEL_TABLE_CELL_CLASS, 'text-[var(--text-muted)] max-md:hidden')}>
                {model.providerName}
              </td>
              <td className={cn(MODEL_TABLE_CELL_CLASS, 'text-right tabular-nums')}>
                {formatTokenCount(model.contextWindow)}
              </td>
              <td className={cn(MODEL_TABLE_CELL_CLASS, 'text-right tabular-nums max-sm:hidden')}>
                {getMaxOutputLabel(model)}
              </td>
              <td className={cn(MODEL_TABLE_CELL_CLASS, 'text-right tabular-nums max-md:hidden')}>
                {formatPrice(model.pricing.input)}
              </td>
              <td className={cn(MODEL_TABLE_CELL_CLASS, 'text-right tabular-nums max-md:hidden')}>
                {formatPrice(model.pricing.output)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
