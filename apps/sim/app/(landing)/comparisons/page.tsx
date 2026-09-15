import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import Link from 'next/link'
import { simProfile } from '@/lib/compare/data'
import { SITE_URL } from '@/lib/core/utils/urls'
import { buildLandingMetadata } from '@/lib/landing/seo'
import { BrandIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import { CitedContent } from '@/app/(landing)/comparisons/components/source-info'
import { COMPARISON_THEME } from '@/app/(landing)/comparisons/theme'
import {
  ALL_COMPETITORS,
  type ComparisonFaq,
  describeFact,
  getComparisonReviewDate,
  mergeSources,
} from '@/app/(landing)/comparisons/utils'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

const baseUrl = SITE_URL

export const revalidate = 3600

const faqItems: ComparisonFaq[] = [
  {
    question: 'How does Sim compare to workflow automation and AI agent platforms?',
    answer:
      'Sim combines a visual workflow canvas, natural-language assistance, multiple model providers, a knowledge base, and MCP support. Its core can run on your own infrastructure. Each comparison examines the specific product surfaces, plans, and deployment options offered by Sim and the other platform.',
    sources: mergeSources(
      simProfile.facts.platform.builderType.sources,
      simProfile.facts.aiCapabilities.naturalLanguageBuilding.sources,
      simProfile.facts.aiCapabilities.multiLlmSupport.sources,
      simProfile.facts.aiCapabilities.knowledgeBaseRag.sources,
      simProfile.facts.aiCapabilities.mcpSupport.sources,
      simProfile.facts.platform.selfHostOption.sources
    ),
  },
  {
    question: 'Is Sim open source?',
    answer:
      'Sim’s core is Apache-2.0 licensed and can be self-hosted with Docker or Kubernetes. Enterprise features have separate license terms, and some capabilities, including Chat, use external services.',
    sources: mergeSources(
      simProfile.facts.platform.license.sources,
      simProfile.facts.platform.selfHostOption.sources,
      simProfile.facts.platform.deploymentOptions.sources
    ),
  },
  {
    question: 'Which AI agent platform should I choose?',
    answer:
      'Choose based on the workflows you need to run, deployment requirements, model and integration support, governance, and total cost. Compare the documented product surfaces and plan restrictions, then test a representative workflow before deciding.',
    sources: [],
  },
  {
    question: 'Is Sim free to use?',
    answer: `${describeFact(simProfile.facts.pricing.freeTier)} You can also self-host the Apache-2.0 core. Infrastructure, model providers, external services, and Enterprise licensing may carry separate costs.`,
    sources: mergeSources(
      simProfile.facts.pricing.freeTier.sources,
      simProfile.facts.platform.license.sources,
      simProfile.facts.platform.selfHostOption.sources,
      simProfile.facts.platform.deploymentOptions.sources
    ),
  },
  {
    question: 'Does Sim support MCP (Model Context Protocol)?',
    answer:
      'Yes. Sim can call external MCP tools and publish deployed workflows as tools on public or API-key-protected MCP servers.',
    sources: mergeSources(
      simProfile.facts.aiCapabilities.mcpSupport.sources,
      simProfile.facts.integrations.mcpPublishing.sources
    ),
  },
  {
    question: 'How many integrations does Sim support?',
    answer: `${describeFact(simProfile.facts.integrations.integrationCount)} MCP, API, and custom code connections provide additional extension options. Service counts and individual tool-action counts are different measures.`,
    sources: mergeSources(
      simProfile.facts.integrations.integrationCount.sources,
      simProfile.facts.integrations.extensibilitySdk.sources,
      simProfile.facts.aiCapabilities.mcpSupport.sources,
      simProfile.facts.integrations.customCodeSteps.sources
    ),
  },
]

export const metadata: Metadata = buildLandingMetadata({
  title: 'Sim Comparisons | Sim, the AI Workspace',
  description:
    'Compare Sim, an AI workspace with an open-source core, to n8n, Zapier, Make, and other workflow automation and AI agent platforms. Documented capabilities, plan restrictions, and source review dates.',
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

      <main id='main-content' className={cn('bg-[var(--bg)]', COMPARISON_THEME)}>
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
          <div className='flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between'>
            <h1
              id='comparison-hub-heading'
              className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'
            >
              Sim comparisons
            </h1>
            <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              <CitedContent
                sources={mergeSources(
                  simProfile.facts.platform.builderType.sources,
                  simProfile.facts.platform.license.sources,
                  simProfile.facts.platform.deploymentOptions.sources
                )}
                label='About Sim'
              >
                Sim is an AI workspace where teams build, deploy, and manage AI agents. Its core is
                Apache-2.0 licensed; Enterprise features have separate terms, and Chat uses a
                Sim-managed service.
              </CitedContent>{' '}
              See how Sim compares to workflow automation platforms and AI agent builders on
              platform architecture, AI capabilities, integrations, pricing, security, and support.
              {reviewDate ? (
                <>
                  {' '}
                  Oldest profile citation date:{' '}
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
              This directory links to comparisons of Sim with the products listed below. Each page
              distinguishes product surfaces, plans, and deployment options across the comparison
              categories.
            </p>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
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
                      <div className='flex items-center'>
                        <Link
                          href={`/comparisons/${competitor.id}`}
                          className='group/link flex min-w-0 flex-1 items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
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
                        <span className='mr-6 shrink-0 text-[var(--text-muted)] text-caption'>
                          <CitedContent
                            sources={competitor.facts.platform.builderType.sources}
                            label={`${competitor.name} description`}
                            description={competitor.oneLiner}
                          >
                            Sources
                          </CitedContent>
                        </span>
                      </div>
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
                <LandingFAQ
                  faqs={faqItems.map((faq) => ({
                    ...faq,
                    answerContent: (
                      <CitedContent sources={faq.sources} label={faq.question}>
                        {faq.answer}
                      </CitedContent>
                    ),
                  }))}
                />
              </div>
            </section>
          </div>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </main>
    </>
  )
}
