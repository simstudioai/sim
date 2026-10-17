import { ChipLink, cn } from '@sim/emcn'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/core/utils/urls'
import { DOCS_URL } from '@/lib/help-links'
import { BackLink } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  buildComparisonFaqs,
  buildComparisonVerdict,
  getComparisonPageDescription,
  getComparisonPageTitle,
  getComparisonUpdatedAt,
  getModelComparisonBySlug,
  getModelComparisonsFor,
  MODEL_COMPARISONS,
  type ModelComparison,
} from '@/app/(landing)/models/comparisons'
import { ComparisonLinks } from '@/app/(landing)/models/components/comparison-links'
import {
  MODEL_TABLE_CELL_CLASS,
  MODEL_TABLE_HEADER_CELL_CLASS,
} from '@/app/(landing)/models/components/constants'
import { ProviderIcon } from '@/app/(landing)/models/components/model-primitives'
import {
  buildModelCapabilityFacts,
  formatPrice,
  formatPricingTier,
  formatTokenCount,
  formatUpdatedAt,
  getPricingBounds,
  type PricingInfo,
} from '@/app/(landing)/models/utils'

const baseUrl = SITE_URL

const AGENT_BLOCK_DOCS_URL = `${DOCS_URL}/workflows/blocks/agent`

/**
 * Only curated pairs render, and no `loading.tsx` may wrap this segment ("Static rendering" in
 * `(landing)/CLAUDE.md`).
 */
export const dynamicParams = false

export async function generateStaticParams() {
  return MODEL_COMPARISONS.map((comparison) => ({ pair: comparison.slug }))
}

interface ModelComparisonPageProps {
  params: Promise<{ pair: string }>
}

export async function generateMetadata({ params }: ModelComparisonPageProps): Promise<Metadata> {
  const { pair } = await params
  const comparison = getModelComparisonBySlug(pair)

  if (!comparison) {
    return {}
  }

  const title = getComparisonPageTitle(comparison)
  const description = getComparisonPageDescription(comparison)
  const { a, b } = comparison

  return {
    title,
    description,
    keywords: [
      `${a.model.displayName} vs ${b.model.displayName}`,
      `${b.model.displayName} vs ${a.model.displayName}`,
      `${a.model.displayName} pricing`,
      `${b.model.displayName} pricing`,
      `${a.model.displayName} context window`,
      `${b.model.displayName} context window`,
    ],
    // og:image/twitter:image come from the sibling opengraph-image.tsx -
    // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
    openGraph: {
      title: `${title} | Sim`,
      description,
      url: `${baseUrl}${comparison.href}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | Sim`,
      description,
    },
    alternates: {
      canonical: `${baseUrl}${comparison.href}`,
    },
  }
}

export default async function ModelComparisonPage({ params }: ModelComparisonPageProps) {
  const { pair } = await params
  const comparison = getModelComparisonBySlug(pair)

  if (!comparison) {
    notFound()
  }

  const { a, b } = comparison
  const verdict = buildComparisonVerdict(comparison)
  const faqs = buildComparisonFaqs(comparison)
  const updatedAt = getComparisonUpdatedAt(comparison)
  const relatedComparisons = [
    ...new Set([...getModelComparisonsFor(a.model), ...getModelComparisonsFor(b.model)]),
  ].filter((entry) => entry.slug !== comparison.slug)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Models', item: `${baseUrl}/models` },
      {
        '@type': 'ListItem',
        position: 3,
        name: comparison.title,
        item: `${baseUrl}${comparison.href}`,
      },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: comparison.title,
    description: verdict[0],
    url: `${baseUrl}${comparison.href}`,
    dateModified: updatedAt.toISOString(),
    numberOfItems: 2,
    itemListElement: [a, b].map(({ model, provider }, index) => {
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
          sku: model.id,
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
        id='model-comparison'
        aria-labelledby='comparison-heading'
        className='bg-[var(--bg)]'
      >
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
          <p className='sr-only'>
            Sim is the open-source AI workspace where teams build, deploy, and manage AI agents.
            This page compares {a.model.displayName} and {b.model.displayName} on API pricing per 1M
            tokens, context window, max output, and capabilities. Both models are available in the
            Sim Agent block, and each Agent block in a Sim agent can use a different model.
          </p>
          <div className='mb-6'>
            <BackLink href='/models' label='Back to Models' />
          </div>

          <div className='mb-6 flex items-center gap-5'>
            <div className='flex shrink-0 items-center gap-2'>
              <ProviderIcon
                provider={a.provider}
                className='size-12 rounded-xl'
                iconClassName='size-6'
              />
              <ProviderIcon
                provider={b.provider}
                className='size-12 rounded-xl'
                iconClassName='size-6'
              />
            </div>
            <div>
              <p className='mb-0.5 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                API model comparison
              </p>
              <h1
                id='comparison-heading'
                className='text-[44px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-sm:text-[28px] max-lg:text-[36px]'
              >
                {comparison.title}
              </h1>
            </div>
          </div>

          <div className='mb-8 flex max-w-[760px] flex-col gap-3 text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
            {verdict.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>

          <div className='flex flex-wrap gap-2'>
            <ChipLink variant='primary' href='/'>
              Build with these models
            </ChipLink>
            <ChipLink href={a.model.href} variant='outline'>
              {a.model.displayName} details
            </ChipLink>
            <ChipLink href={b.model.href} variant='outline'>
              {b.model.displayName} details
            </ChipLink>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <div className='border-[var(--border)] border-x'>
            <section id='comparison-specs' aria-labelledby='comparison-specs-heading'>
              <div className='px-6 pt-10 pb-4'>
                <h2
                  id='comparison-specs-heading'
                  className='mb-2 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
                >
                  Pricing, context window, and capabilities
                </h2>
                <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
                  API prices are per 1M tokens. Pricing last updated{' '}
                  <time dateTime={updatedAt.toISOString().slice(0, 10)}>
                    {formatUpdatedAt(updatedAt.toISOString())}
                  </time>
                  .
                </p>
              </div>
              <ComparisonTable comparison={comparison} />
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <section
              id='comparison-build'
              aria-labelledby='comparison-build-heading'
              className='px-6 py-10'
            >
              <h2
                id='comparison-build-heading'
                className='mb-2 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
              >
                Use {a.model.displayName} or {b.model.displayName} in a Sim agent
              </h2>
              <p className='mb-6 max-w-[760px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
                Both models are available in the Sim Agent block. Pick either one from the model
                picker, and each Agent block in the same agent can use a different model.
              </p>
              <div className='flex flex-wrap gap-2'>
                <ChipLink
                  href={AGENT_BLOCK_DOCS_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  variant='outline'
                >
                  Agent block docs
                </ChipLink>
                <ChipLink href={a.provider.href} variant='outline'>
                  All {a.provider.name} models
                </ChipLink>
                {b.provider.id !== a.provider.id ? (
                  <ChipLink href={b.provider.href} variant='outline'>
                    All {b.provider.name} models
                  </ChipLink>
                ) : null}
                <ChipLink href='/models/context-windows' variant='outline'>
                  Context window comparison
                </ChipLink>
              </div>
            </section>

            {relatedComparisons.length > 0 && (
              <>
                <div className='h-px w-full bg-[var(--border)]' />
                <nav aria-labelledby='related-comparisons-heading' className='px-6 py-10'>
                  <h2
                    id='related-comparisons-heading'
                    className='mb-6 text-[24px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] max-lg:text-[20px]'
                  >
                    Related comparisons
                  </h2>
                  <ComparisonLinks comparisons={relatedComparisons} />
                </nav>
              </>
            )}

            <div className='h-px w-full bg-[var(--border)]' />

            <section
              id='comparison-faq'
              aria-labelledby='comparison-faq-heading'
              className='px-6 py-10'
            >
              <h2
                id='comparison-faq-heading'
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

/** Long-context surcharge tiers in one line, or a note that the model has none. */
function formatPricingTiers(pricing: PricingInfo): string {
  const tiers = pricing.tiers ?? []
  if (tiers.length === 0) return 'No long-context tier'

  return tiers.map((tier) => `${formatPricingTier(tier)}.`).join(' ')
}

interface ComparisonTableProps {
  comparison: ModelComparison
}

function ComparisonTable({ comparison }: ComparisonTableProps) {
  const { a, b } = comparison
  const factsA = buildModelCapabilityFacts(a.model)
  const factsB = new Map(buildModelCapabilityFacts(b.model).map((fact) => [fact.label, fact.value]))
  const hasTiers = Boolean(a.model.pricing.tiers?.length || b.model.pricing.tiers?.length)

  const rows: Array<{ label: string; a: string; b: string }> = [
    { label: 'Provider', a: a.provider.name, b: b.provider.name },
    {
      label: 'Input price',
      a: `${formatPrice(a.model.pricing.input)}/1M`,
      b: `${formatPrice(b.model.pricing.input)}/1M`,
    },
    {
      label: 'Cached input',
      a:
        a.model.pricing.cachedInput !== undefined
          ? `${formatPrice(a.model.pricing.cachedInput)}/1M`
          : 'N/A',
      b:
        b.model.pricing.cachedInput !== undefined
          ? `${formatPrice(b.model.pricing.cachedInput)}/1M`
          : 'N/A',
    },
    {
      label: 'Output price',
      a: `${formatPrice(a.model.pricing.output)}/1M`,
      b: `${formatPrice(b.model.pricing.output)}/1M`,
    },
    ...(hasTiers
      ? [
          {
            label: 'Long-context pricing',
            a: formatPricingTiers(a.model.pricing),
            b: formatPricingTiers(b.model.pricing),
          },
        ]
      : []),
    {
      label: 'Context window',
      a: a.model.contextWindow ? `${formatTokenCount(a.model.contextWindow)} tokens` : 'Unknown',
      b: b.model.contextWindow ? `${formatTokenCount(b.model.contextWindow)} tokens` : 'Unknown',
    },
    {
      label: 'Released',
      a: a.model.releaseDate ? formatUpdatedAt(a.model.releaseDate) : 'Unknown',
      b: b.model.releaseDate ? formatUpdatedAt(b.model.releaseDate) : 'Unknown',
    },
    ...factsA.map((fact) => ({
      label: fact.label,
      a: fact.value,
      b: factsB.get(fact.label) ?? 'Unknown',
    })),
  ]

  return (
    <div className='overflow-x-auto'>
      <table className='w-full border-collapse'>
        <caption className='sr-only'>
          {comparison.title}: pricing, context window, and capabilities
        </caption>
        <thead>
          <tr className='border-[var(--border)] border-t'>
            <th scope='col' className={MODEL_TABLE_HEADER_CELL_CLASS}>
              <span className='sr-only'>Metric</span>
            </th>
            {[a, b].map(({ model }) => (
              <th key={model.id} scope='col' className={MODEL_TABLE_HEADER_CELL_CLASS}>
                <Link
                  href={model.href}
                  className='text-[var(--text-primary)] underline-offset-2 hover:underline'
                >
                  {model.displayName}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className='border-[var(--border)] border-t'>
              <th scope='row' className={cn(MODEL_TABLE_HEADER_CELL_CLASS, 'py-4 align-top')}>
                {row.label}
              </th>
              <td className={MODEL_TABLE_CELL_CLASS}>{row.a}</td>
              <td className={MODEL_TABLE_CELL_CLASS}>{row.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
