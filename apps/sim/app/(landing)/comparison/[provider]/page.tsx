import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { CompetitorProfile } from '@/lib/compare/data'
import { simProfile } from '@/lib/compare/data'
import { SITE_URL } from '@/lib/core/utils/urls'
import { buildLandingMetadata } from '@/lib/landing/seo'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparison/comparison-sections'
import { BrandIconTile, SimIconTile } from '@/app/(landing)/comparison/components/brand-icon-tile'
import { ComparisonCards } from '@/app/(landing)/comparison/components/comparison-cards'
import { ComparisonTable } from '@/app/(landing)/comparison/components/comparison-table'
import { KeyDifferences } from '@/app/(landing)/comparison/components/key-differences'
import {
  ALL_COMPETITORS,
  buildBottomLine,
  buildComparisonFaqs,
  getCompetitorBySlug,
  getLatestVerifiedDate,
  SIM_LATEST_VERIFIED,
} from '@/app/(landing)/comparison/utils'
import { BackLink } from '@/app/(landing)/components'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'

const baseUrl = SITE_URL

export const revalidate = 3600
export const dynamicParams = false

export async function generateStaticParams() {
  return ALL_COMPETITORS.map((competitor) => ({ provider: competitor.id }))
}

/** Flattens a profile's facts into JSON-LD `additionalProperty` entries, in {@link COMPARISON_SECTIONS} order. */
function factsToProperties(profile: CompetitorProfile) {
  return COMPARISON_SECTIONS.flatMap((section) => {
    const group = getFactGroup(profile, section.group)
    return section.rows.map((row) => ({
      '@type': 'PropertyValue',
      name: row.label,
      value: group[row.key]?.value ?? 'Unknown',
    }))
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string }>
}): Promise<Metadata> {
  const { provider: providerSlug } = await params
  const competitor = getCompetitorBySlug(providerSlug)

  if (!competitor) {
    return {}
  }

  return buildLandingMetadata({
    title: `Sim vs ${competitor.name}: AI Workspace Comparison`,
    description: `Compare Sim, the open-source AI workspace, to ${competitor.name} on platform, AI, integrations, pricing, security, and support. Sourced and dated facts.`,
    path: `/comparison/${competitor.id}`,
    keywords: [
      `Sim vs ${competitor.name}`,
      `${competitor.name} alternative`,
      `${competitor.name} vs Sim`,
      `open source ${competitor.name} alternative`,
      `${competitor.name} comparison`,
      'AI agent workspace',
      'AI workflow automation comparison',
    ].join(', '),
  })
}

export default async function ComparisonProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>
}) {
  const { provider: providerSlug } = await params
  const competitor = getCompetitorBySlug(providerSlug)

  if (!competitor) {
    notFound()
  }

  const faqs = buildComparisonFaqs(competitor)
  const verdict = buildBottomLine(competitor)
  const CompetitorIcon = competitor.brand?.icon

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Comparison', item: `${baseUrl}/comparison` },
      {
        '@type': 'ListItem',
        position: 3,
        name: `Sim vs ${competitor.name}`,
        item: `${baseUrl}/comparison/${competitor.id}`,
      },
    ],
  }

  const latestVerified = new Date(
    Math.max(SIM_LATEST_VERIFIED.getTime(), getLatestVerifiedDate(competitor).getTime())
  )

  const productComparisonJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Sim vs ${competitor.name}`,
    description: `Feature and pricing comparison between Sim and ${competitor.name}.`,
    url: `${baseUrl}/comparison/${competitor.id}`,
    dateModified: latestVerified.toISOString().slice(0, 10),
    numberOfItems: 2,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        item: {
          '@type': 'SoftwareApplication',
          name: 'Sim',
          applicationCategory: 'BusinessApplication',
          url: SITE_URL,
          description: simProfile.oneLiner,
          additionalProperty: factsToProperties(simProfile),
        },
      },
      {
        '@type': 'ListItem',
        position: 2,
        item: {
          '@type': 'SoftwareApplication',
          name: competitor.name,
          applicationCategory: 'BusinessApplication',
          url: competitor.website,
          description: competitor.oneLiner,
          additionalProperty: factsToProperties(competitor),
        },
      },
    ],
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
      <JsonLd data={productComparisonJsonLd} />
      <JsonLd data={faqJsonLd} />

      <main id='main-content' className='bg-[var(--bg)]'>
        <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          <div className='mb-6'>
            <BackLink href='/comparison' label='Back to comparisons' />
          </div>

          <div className='flex flex-col gap-4'>
            <h1
              id='comparison-heading'
              className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
            >
              Sim vs {competitor.name}
            </h1>
            <p className='max-w-[720px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              Sim is the open-source AI workspace where teams build, deploy, and manage AI agents
              visually, conversationally, or with code. Here is how Sim compares to{' '}
              {competitor.name} on platform architecture, AI capabilities, integrations, pricing,
              security, and support. Every fact below is sourced and dated.
            </p>
            <p className='sr-only'>
              Sim is an open-source AI workspace for building, deploying, and managing AI agents.
              This page compares Sim to {competitor.name} across platform architecture, AI
              capabilities, integrations, pricing, security and compliance, observability, and
              support, using sourced, dated facts for buyers evaluating both platforms.
            </p>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1446px]'>
          <div className='mx-12 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
            <div className='grid grid-cols-1 sm:grid-cols-2'>
              <section
                aria-labelledby='what-is-sim-heading'
                className='border-[var(--border)] border-r px-6 py-6 max-sm:border-r-0 max-sm:border-b'
              >
                <h2
                  id='what-is-sim-heading'
                  className='mb-2 flex items-center gap-2.5 text-[18px] text-[var(--text-primary)] leading-snug tracking-[-0.01em]'
                >
                  <SimIconTile className='size-9' />
                  What is Sim?
                </h2>
                <p className='text-[var(--text-body)] text-small leading-[150%]'>
                  {simProfile.oneLiner}
                </p>
              </section>
              <section aria-labelledby='what-is-competitor-heading' className='px-6 py-6'>
                <h2
                  id='what-is-competitor-heading'
                  className='mb-2 flex items-center gap-2.5 text-[18px] text-[var(--text-primary)] leading-snug tracking-[-0.01em]'
                >
                  {CompetitorIcon ? (
                    <BrandIconTile
                      icon={CompetitorIcon}
                      selfFramed={competitor.brand?.selfFramed}
                      className='size-9'
                      iconClassName='size-5'
                    />
                  ) : null}
                  What is {competitor.name}?
                </h2>
                <p className='text-[var(--text-body)] text-small leading-[150%]'>
                  {competitor.oneLiner}
                </p>
              </section>
            </div>

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='key-differences-heading' className='px-6 py-10'>
              <h2
                id='key-differences-heading'
                className='mb-4 text-[var(--text-primary)] text-md leading-[100%] tracking-[-0.02em]'
              >
                Key differences at a glance
              </h2>
              <KeyDifferences sim={simProfile} competitor={competitor} />
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='comparison-table-heading' className='px-6 py-10'>
              <h2
                id='comparison-table-heading'
                className='mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                Sim vs {competitor.name}: feature-by-feature comparison
              </h2>
              <ComparisonTable sim={simProfile} competitor={competitor} />
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <div className='grid grid-cols-1 lg:grid-cols-2'>
              <section
                aria-labelledby='sim-standout-heading'
                className='border-[var(--border)] border-r max-lg:border-r-0 max-lg:border-b'
              >
                <div className='px-6 pt-6 pb-2'>
                  <h2
                    id='sim-standout-heading'
                    className='text-[18px] text-[var(--text-primary)] leading-snug tracking-[-0.01em]'
                  >
                    Sim standout features
                  </h2>
                </div>
                <ComparisonCards items={simProfile.standoutFeatures} />
              </section>
              <section aria-labelledby='competitor-limitations-heading'>
                <div className='px-6 pt-6 pb-2'>
                  <h2
                    id='competitor-limitations-heading'
                    className='text-[18px] text-[var(--text-primary)] leading-snug tracking-[-0.01em]'
                  >
                    Documented {competitor.name} limitations
                  </h2>
                </div>
                <ComparisonCards items={competitor.limitations} />
              </section>
            </div>

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='bottom-line-heading' className='px-6 py-10'>
              <h2
                id='bottom-line-heading'
                className='mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                Bottom line
              </h2>
              <div className='flex flex-col gap-3'>
                <p className='text-[var(--text-body)] text-small leading-[150%]'>
                  {verdict.chooseSim}
                </p>
                <p className='text-[var(--text-body)] text-small leading-[150%]'>
                  {verdict.chooseCompetitor}
                </p>
              </div>
            </section>

            <div className='h-px w-full bg-[var(--border)]' />

            <section aria-labelledby='faq-heading' className='px-6 py-10'>
              <h2
                id='faq-heading'
                className='mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
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
      </main>

      <div className='py-16'>
        <Cta />
      </div>
    </>
  )
}
