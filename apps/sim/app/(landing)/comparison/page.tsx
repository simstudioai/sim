import type { Metadata } from 'next'
import Link from 'next/link'
import { simProfile } from '@/lib/compare/data'
import { SITE_URL } from '@/lib/core/utils/urls'
import { buildLandingMetadata } from '@/lib/landing/seo'
import { BrandIconTile } from '@/app/(landing)/comparison/components/brand-icon-tile'
import { ALL_COMPETITORS, lowercaseFirst } from '@/app/(landing)/comparison/utils'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'

const baseUrl = SITE_URL

export const revalidate = 3600

const faqItems = [
  {
    question: 'How does Sim compare to workflow automation and AI agent platforms?',
    answer:
      'Sim is an open-source AI workspace where teams build, deploy, and manage AI agents visually, conversationally, or with code. Compared to workflow automation tools like n8n, Zapier, and Make, Sim treats AI agents as first-class building blocks rather than an add-on to data routing, and ships a native knowledge base, MCP support, and an in-editor AI Copilot. Compared to enterprise AI builders like Gumloop, Workato, StackAI, and Vellum, Sim is fully open source (Apache 2.0) and self-hostable, so teams can run it on their own infrastructure.',
  },
  {
    question: 'Is Sim open source?',
    answer:
      'Yes. Sim is released under the Apache License 2.0 and can be self-hosted via Docker or Kubernetes, or used as a managed cloud-hosted service.',
  },
  {
    question: 'Which AI agent platform should I choose?',
    answer:
      "The right platform depends on what you're optimizing for: licensing and data control (Sim, n8n self-hosted), integration breadth (Zapier, Pipedream), enterprise governance (Workato, Tines), or AI-native agent building specifically (Sim, Gumloop, StackAI). Each comparison page on this site lays out sourced, dated facts across platform, AI capabilities, integrations, pricing, security, and support so you can weigh the tradeoffs for your team.",
  },
  {
    question: 'Is Sim free to use?',
    answer: `Yes. ${simProfile.facts.pricing.freeTier.value} Sim is also free to self-host under the Apache 2.0 license with no seat or usage limits beyond your own infrastructure.`,
  },
  {
    question: 'Does Sim support MCP (Model Context Protocol)?',
    answer: `Yes. ${simProfile.facts.aiCapabilities.mcpSupport.value} Sim can also publish any deployed workflow as its own MCP server, so it works as both an MCP client and an MCP server.`,
  },
  {
    question: 'How many integrations does Sim support?',
    answer: `Sim ships ${lowercaseFirst(simProfile.facts.integrations.integrationCount.value)} Combined with native MCP client support, teams can extend Sim to any service with a public API, not just the built-in catalog.`,
  },
]

export const metadata: Metadata = buildLandingMetadata({
  title: 'Sim Comparisons: AI Agent & Workflow Platforms',
  description:
    'Compare Sim, the open-source AI workspace, to n8n, Zapier, Make, and other workflow automation and AI agent platforms. Sourced, dated, fact-checked.',
  path: '/comparison',
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
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Comparison', item: `${baseUrl}/comparison` },
    ],
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Sim Comparisons',
    description: 'Directory of Sim comparison pages against AI agent and workflow platforms.',
    url: `${baseUrl}/comparison`,
    numberOfItems: ALL_COMPETITORS.length,
    itemListElement: ALL_COMPETITORS.map((competitor, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${baseUrl}/comparison/${competitor.id}`,
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
                        href={`/comparison/${competitor.id}`}
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
