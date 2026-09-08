import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { simProfile } from '@/lib/compare/data'
import { buildLandingMetadata } from '@/lib/landing/seo'
import { BrandIconTile, SimIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import { ComparisonCards } from '@/app/(landing)/comparisons/components/comparison-cards'
import { ComparisonRows } from '@/app/(landing)/comparisons/components/comparison-table/comparison-rows'
import { StickyComparisonTable } from '@/app/(landing)/comparisons/components/comparison-table/sticky-comparison-table'
import { CitedContent } from '@/app/(landing)/comparisons/components/source-info'
import { COMPARISON_THEME } from '@/app/(landing)/comparisons/theme'
import {
  ALL_COMPETITORS,
  buildBottomLine,
  buildComparisonFaqs,
  getCompetitorBySlug,
} from '@/app/(landing)/comparisons/utils'
import { BackLink } from '@/app/(landing)/components'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

export const revalidate = 3600
/** Unknown slugs reach the section 404 while known pages remain pre-rendered. */
export const dynamicParams = true

export async function generateStaticParams() {
  return ALL_COMPETITORS.map((competitor) => ({ provider: competitor.id }))
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
    title: `Sim vs ${competitor.name} | Sim, the AI Workspace`,
    description: `Compare Sim, the open-source AI workspace, to ${competitor.name} on platform, AI, integrations, pricing, security, and support. Sourced and dated facts.`,
    path: `/comparisons/${competitor.id}`,
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

  const verdict = buildBottomLine(competitor)
  const faqs = buildComparisonFaqs(competitor)
  const CompetitorIcon = competitor.brand?.icon

  return (
    <main id='main-content' className={cn('relative bg-[var(--bg)]', COMPARISON_THEME)}>
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
        <div className='relative'>
          <div className='absolute bottom-full left-0 mb-6'>
            <BackLink href='/comparisons' label='Back to comparisons' />
          </div>
          <div className='flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between'>
            <h1
              id='comparison-heading'
              className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
            >
              Sim vs {competitor.name}
            </h1>
            <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              Here is how Sim compares to {competitor.name} on platform architecture, AI
              capabilities, integrations, pricing, security, and support.
            </p>
          </div>
          <p className='sr-only'>
            Sim is an open-source AI workspace for building, deploying, and managing AI agents. This
            page compares Sim to {competitor.name} across platform architecture, AI capabilities,
            integrations, pricing, security and compliance, observability, and support, using
            sourced, dated facts for buyers evaluating both platforms.
          </p>
        </div>
      </div>

      <div aria-hidden='true' className='relative z-10 mt-8 h-px w-full bg-[var(--border)]' />

      <div className='w-full px-[var(--comparison-page-gutter)] [--comparison-page-gutter:40px] lg:bg-[var(--comparison-column-bg)] max-md:[--comparison-page-gutter:28px] max-lg:[--comparison-page-gutter:32px] max-xl:[--comparison-page-gutter:36px]'>
        <StickyComparisonTable
          label={`Sim and ${competitor.name} comparison`}
          header={
            <>
              <div
                role='columnheader'
                className='flex min-w-0 items-center bg-[var(--bg)] px-4 py-4 lg:border-[var(--border)] lg:border-x lg:bg-[var(--comparison-column-bg)] lg:px-6 xl:px-12'
              >
                <h2 className='flex min-w-0 flex-col items-start gap-3 text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em] sm:flex-row sm:items-center'>
                  <SimIconTile className='size-10 rounded-xl' wordmarkClassName='scale-[0.625]' />
                  <span className='min-w-0 break-words'>{simProfile.name}</span>
                </h2>
              </div>
              <div
                role='columnheader'
                className='flex min-w-0 items-center bg-[var(--bg)] px-4 py-4 lg:border-[var(--border)] lg:border-r lg:bg-[var(--comparison-column-bg)] lg:px-6 xl:px-12'
              >
                <h2 className='flex min-w-0 flex-col items-start gap-3 text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em] sm:flex-row sm:items-center'>
                  {CompetitorIcon ? (
                    <BrandIconTile
                      icon={CompetitorIcon}
                      selfFramed={competitor.brand?.selfFramed}
                      className='size-10 rounded-xl'
                      iconClassName='size-5'
                    />
                  ) : null}
                  <span className='min-w-0 break-words'>{competitor.name}</span>
                </h2>
              </div>
            </>
          }
        >
          <ComparisonRows sim={simProfile} competitor={competitor} />
        </StickyComparisonTable>
      </div>

      <div aria-hidden='true' className='-mt-px h-px w-full bg-[var(--border)]' />

      <div className={cn('w-full', LANDING_GUTTER)}>
        <div className='grid grid-cols-1 border-[var(--border)] border-x border-b lg:grid-cols-2'>
          <section
            id='sim-standout'
            aria-labelledby='sim-standout-heading'
            className='border-[var(--border)] border-b p-8 max-sm:p-6 lg:border-r lg:border-b-0 lg:px-12 lg:py-10'
          >
            <h2
              id='sim-standout-heading'
              className='mb-8 text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em] lg:text-[32px]'
            >
              Sim standout features
            </h2>
            <ComparisonCards items={simProfile.standoutFeatures} />
          </section>
          <section
            id='competitor-limitations'
            aria-labelledby='competitor-limitations-heading'
            className='p-8 max-sm:p-6 lg:px-12 lg:py-10'
          >
            <h2
              id='competitor-limitations-heading'
              className='mb-8 text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em] lg:text-[32px]'
            >
              Documented {competitor.name} limitations
            </h2>
            <ComparisonCards items={competitor.limitations} />
          </section>
        </div>
      </div>

      <div className={cn('w-full', LANDING_GUTTER)}>
        <section
          aria-labelledby='bottom-line-heading'
          className='border-[var(--border)] border-x bg-[oklch(0.439_0_0)] p-8 text-[#F8F8F8] max-sm:p-6 lg:p-10 dark:bg-[var(--surface-5)] dark:text-[var(--text-primary)]'
        >
          <h2
            id='bottom-line-heading'
            className='mb-6 text-[28px] leading-tight tracking-[-0.02em] lg:text-[32px]'
          >
            Bottom line
          </h2>
          <div className='flex flex-col gap-3'>
            <p className='text-small leading-[150%]'>{verdict.chooseSim}</p>
            <p className='text-small leading-[150%]'>{verdict.chooseCompetitor}</p>
          </div>
        </section>
      </div>

      <div className='border-[var(--border)] border-b'>
        <div className={cn('w-full', LANDING_GUTTER)}>
          <section
            aria-labelledby='faq-heading'
            className='border-[var(--border)] border-x border-t p-8 max-sm:p-6 lg:p-10'
          >
            <h2
              id='faq-heading'
              className='mb-6 text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em] lg:text-[32px]'
            >
              Frequently asked questions
            </h2>
            <LandingFAQ
              faqs={faqs.map((faq) => ({
                ...faq,
                answerContent: (
                  <p className='text-[14px] text-[var(--text-body)] leading-[1.75]'>
                    <CitedContent sources={faq.sources} label={faq.question}>
                      {faq.answer}
                    </CitedContent>
                  </p>
                ),
              }))}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
