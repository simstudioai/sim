import type { Metadata } from 'next'
import Link from 'next/link'
import { simProfile } from '@/lib/compare/data'
import { SITE_URL } from '@/lib/core/utils/urls'
import { buildLandingMetadata } from '@/lib/landing/seo'
import { BrandIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import {
  ALL_COMPETITORS,
  ensurePeriod,
  getComparisonReviewDate,
  lowercaseFirst,
} from '@/app/(landing)/comparisons/utils'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'

const baseUrl = SITE_URL

export const revalidate = 3600

const faqItems = [
  {
    question: 'How does Sim compare to workflow automation and AI agent platforms?',
    answer:
      'Sim combines a visual workflow canvas, natural-language assistance, multiple model providers, a knowledge base, and MCP support. Its core can run on your own infrastructure. Each comparison examines the specific product surfaces, plans, and deployment options offered by Sim and the other platform.',
  },
  {
    question: 'Is Sim open source?',
    answer:
      'Sim’s core is Apache-2.0 licensed and can be self-hosted with Docker or Kubernetes. Enterprise features have separate license terms, and some capabilities, including Chat, use external services.',
  },
  {
    question: 'Which AI agent platform should I choose?',
    answer:
      "The right platform depends on what you're optimizing for: licensing and data control (Sim, n8n self-hosted), integration breadth (Zapier, Pipedream), enterprise governance (Workato, Tines), or AI-native agent building specifically (Sim, Gumloop, StackAI). Each comparison page on this site lays out sourced, dated facts across platform, AI capabilities, integrations, pricing, security, and support so you can weigh the tradeoffs for your team.",
  },
  {
    question: 'Is Sim free to use?',
    answer: `${ensurePeriod(simProfile.facts.pricing.freeTier.value)} You can also self-host the Apache-2.0 core. Infrastructure, model providers, external services, and Enterprise licensing may carry separate costs.`,
  },
  {
    question: 'Does Sim support MCP (Model Context Protocol)?',
    answer: `${ensurePeriod(simProfile.facts.aiCapabilities.mcpSupport.value)} ${ensurePeriod(simProfile.facts.integrations.mcpPublishing.value)}`,
  },
  {
    question: 'How many integrations does Sim support?',
    answer: `Sim lists ${ensurePeriod(lowercaseFirst(simProfile.facts.integrations.integrationCount.value))} MCP, API, and custom code connections provide additional extension options. Service counts and individual tool-action counts are different measures.`,
  },
]

export const metadata: Metadata = buildLandingMetadata({
  title: 'Sim Comparisons | Sim, the AI Workspace',
  description:
    'Compare Sim, the open-source AI workspace, to n8n, Zapier, Make, and other workflow automation and AI agent platforms. Sourced, dated, fact-checked.',
  path: '/comparisons',
  keywords: [
    'Sim comparison',
    'Sim vs n8n',
    'Sim vs Zapier',
    'Sim alternative',
    'AI agent platform comparison',
    'workflow automation comparison',
    'open source AI workspace',
  ].join(', '),
})

export default function ComparisonHubPage() {
  const reviewDate = getComparisonReviewDate([simProfile, ...ALL_COMPETITORS])
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Comparisons', item: `${baseUrl}/comparisons` },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Sim Comparisons',
    description: 'Directory of Sim comparison pages against AI agent and workflow platforms.',
    url: `${baseUrl}/comparisons`,
    numberOfItems: ALL_COMPETITORS.length,
    itemListElement: ALL_COMPETITORS.map((competitor, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${baseUrl}/comparisons/${competitor.id}`,
      name: `Sim vs ${competitor.name}`,
    })),
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
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={faqJsonLd} />

      <main id='main-content' className='bg-[var(--bg)]'>
        <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          {/* Invisible spacer matching the detail page's BackLink block height/margin, so the divider below lands at the same Y on both pages. */}
          <div className='mb-6 h-6' aria-hidden='true' />

          <div className='flex flex-col gap-4'>
            <h1
              id='comparison-hub-heading'
              className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
            >
              Sim comparisons
            </h1>
            <p className='max-w-[720px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              Sim is the open-source AI workspace where teams build, deploy, and manage AI agents.
              See how Sim compares to workflow automation platforms and AI agent builders on
              platform architecture, AI capabilities, integrations, pricing, security, and support.
              {reviewDate ? (
                <>
                  {' '}
                  Verified against the cited sources as of{' '}
                  <time dateTime={reviewDate.toISOString().slice(0, 10)}>
                    {reviewDate.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </time>
                  .
                </>
              ) : null}{' '}
              Estimates and unverified capabilities are labeled on each comparison.
            </p>
            <p className='sr-only'>
              This directory lists every Sim vs. competitor comparison page, covering workflow
              automation platforms (n8n, Zapier, Make, Pipedream), enterprise AI builders (Gumloop,
              Workato, Retool, Tines, StackAI, Power Automate, Vellum), and AI agent products
              (OpenAI AgentKit, Claude Cowork). Each page gives sourced, dated facts across
              platform, AI capabilities, integrations, pricing, security, and support.
            </p>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1446px] px-12 max-sm:px-5 max-lg:px-8'>
          <div className='border-[var(--border)] border-x'>
            <section aria-labelledby='all-comparisons-heading' className='pt-10'>
              <h2
                id='all-comparisons-heading'
                className='mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                All comparisons
              </h2>
              <div>
                {ALL_COMPETITORS.map((competitor) => {
                  const Icon = competitor.brand?.icon
                  return (
                    <div key={competitor.id}>
                      <Link
                        href={`/comparisons/${competitor.id}`}
                        className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
                        aria-label={`Sim vs ${competitor.name} comparison`}
                      >
                        {Icon ? (
                          <BrandIconTile
                            icon={Icon}
                            selfFramed={competitor.brand?.selfFramed}
                            className='size-8 shrink-0'
                            iconClassName='size-4'
                          />
                        ) : null}
                        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                          <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                            Sim vs {competitor.name}
                          </h3>
                          <p className='hidden text-[var(--text-muted)] text-caption leading-[150%] sm:line-clamp-1'>
                            {competitor.oneLiner}
                          </p>
                        </div>
                        <ChevronArrow />
                      </Link>
                      <div className='h-px w-full bg-[var(--border)]' />
                    </div>
                  )
                })}
              </div>
            </section>

            <section aria-labelledby='faq-heading' className='px-6 py-10'>
              <h2
                id='faq-heading'
                className='mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
              >
                Frequently asked questions
              </h2>
              <div>
                <LandingFAQ faqs={faqItems} />
              </div>
            </section>
          </div>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </main>
    </>
  )
}
