import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { TEMPLATES } from '@/app/workspace/[workspaceId]/home/components/template-prompts/consts'
import { IntegrationIcon } from '../components/integration-icon'
import { blockTypeToIconMap } from '../data/icon-mapping'
import integrations from '../data/integrations.json'
import type { AuthType, FAQItem, Integration } from '../data/types'
import { IntegrationFAQ } from './components/integration-faq'
import { TemplateCardButton } from './components/template-card-button'

const allIntegrations = integrations as Integration[]
const INTEGRATION_COUNT = allIntegrations.length
const baseUrl = getBaseUrl()

/** Fast O(1) lookups — avoids repeated linear scans inside render loops. */
const bySlug = new Map(allIntegrations.map((i) => [i.slug, i]))
const byType = new Map(allIntegrations.map((i) => [i.type, i]))

/**
 * Returns up to `limit` related integration slugs.
 *
 * Scoring (additive):
 *   +3 per shared operation name  — strongest signal (same capability)
 *   +2 per shared operation word  — weaker signal (e.g. both have "create" ops)
 *   +1  same auth type            — comparable setup experience
 *
 * Every integration gets a score, so the sidebar always has suggestions.
 * Ties are broken by alphabetical slug order for determinism.
 */
function getRelatedSlugs(
  slug: string,
  operations: Integration['operations'],
  authType: AuthType,
  limit = 6
): string[] {
  const currentOpNames = new Set(operations.map((o) => o.name.toLowerCase()))
  const currentOpWords = new Set(
    operations.flatMap((o) =>
      o.name
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )
  )

  return allIntegrations
    .filter((i) => i.slug !== slug)
    .map((i) => {
      const sharedNames = i.operations.filter((o) =>
        currentOpNames.has(o.name.toLowerCase())
      ).length
      const sharedWords = i.operations.filter((o) =>
        o.name
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.length > 3 && currentOpWords.has(w))
      ).length
      const sameAuth = i.authType === authType ? 1 : 0
      return { slug: i.slug, score: sharedNames * 3 + sharedWords * 2 + sameAuth }
    })
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit)
    .map(({ slug: s }) => s)
}

const AUTH_STEP: Record<AuthType, string> = {
  oauth: 'Authenticate with one-click OAuth — no credentials to copy-paste.',
  'api-key': 'Add your API key to authenticate — find it in your account settings.',
  none: 'Authenticate your account to connect.',
}

/**
 * Generates targeted FAQs from integration metadata.
 * Questions mirror real search queries to drive FAQPage rich snippets.
 */
function buildFAQs(integration: Integration): FAQItem[] {
  const { name, description, operations, triggers, authType } = integration
  const topOps = operations.slice(0, 5)
  const topOpNames = topOps.map((o) => o.name)
  const authStep = AUTH_STEP[authType]

  const faqs: FAQItem[] = [
    {
      question: `What is Sim's ${name} integration?`,
      answer: `Sim's ${name} integration lets you build AI-powered workflows that automate tasks in ${name} without writing code. ${description} You can connect ${name} to hundreds of other services in the same workflow — from CRMs and spreadsheets to messaging tools and databases.`,
    },
    {
      question: `What can I automate with ${name} in Sim?`,
      answer:
        topOpNames.length > 0
          ? `With Sim you can: ${topOpNames.join('; ')}${operations.length > 5 ? `; and ${operations.length - 5} more tools` : ''}. Each action runs inside an AI agent block, so you can combine ${name} with LLM reasoning, conditional logic, and data from any other connected service.`
          : `Sim lets you automate ${name} workflows by connecting it to an AI agent that can read from it, write to it, and chain it together with other services — all driven by natural-language instructions instead of rigid rules.`,
    },
    {
      question: `How do I connect ${name} to Sim?`,
      answer: `Getting started takes under five minutes: (1) Create a free account at sim.ai. (2) Open a new workflow. (3) Drag a ${name} block onto the canvas. (4) ${authStep} (5) Choose the tool you want to use, wire it to the inputs you need, and click Run. Your automation is live.`,
    },
    {
      question: `Can I use ${name} as a tool inside an AI agent in Sim?`,
      answer: `Yes — this is one of Sim's core capabilities. Instead of hard-coding when and how ${name} is used, you give an AI agent access to ${name} tools and describe the goal in plain language. The agent decides which tools to call, in what order, and how to handle the results. This means your automation adapts to context rather than breaking when inputs change.`,
    },
    ...(topOpNames.length >= 2
      ? [
          {
            question: `How do I ${topOpNames[0].toLowerCase()} with ${name} in Sim?`,
            answer: `Add a ${name} block to your workflow and select "${topOpNames[0]}" as the tool. Fill in the required fields — you can reference outputs from earlier steps, such as text generated by an AI agent or data fetched from another integration. No code is required.`,
          },
        ]
      : []),
    ...(triggers.length > 0
      ? [
          {
            question: `How do I trigger a Sim workflow from ${name} automatically?`,
            answer: `Add a ${name} trigger block to your workflow and copy the generated webhook URL. Paste that URL into ${name}'s webhook settings and select the events you want to listen for (${triggers.map((t) => t.name).join(', ')}). From that point on, every matching event in ${name} instantly fires your workflow — no polling, no delay.`,
          },
          {
            question: `What data does Sim receive when a ${name} event triggers a workflow?`,
            answer: `When ${name} fires a webhook, Sim receives the full event payload that ${name} sends — typically the record or object that changed, along with metadata like the event type and timestamp. Inside your workflow, every field from that payload is available as a variable you can pass to AI agents, conditions, or other integrations.`,
          },
        ]
      : []),
    {
      question: `What ${name} tools does Sim support?`,
      answer:
        operations.length > 0
          ? `Sim supports ${operations.length} ${name} tool${operations.length === 1 ? '' : 's'}: ${operations.map((o) => o.name).join(', ')}.`
          : `Sim supports core ${name} tools for reading and writing data, triggering actions, and integrating with your other services. See the full list in the Sim documentation.`,
    },
    {
      question: `Is the ${name} integration free to use?`,
      answer: `Yes — Sim's free plan includes access to the ${name} integration and every other integration in the library. No credit card is needed to get started. Visit sim.ai to create your account.`,
    },
  ]

  return faqs
}

export async function generateStaticParams() {
  return allIntegrations.map((i) => ({ slug: i.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const integration = bySlug.get(slug)
  if (!integration) return {}

  const { name, description, operations } = integration
  const opSample = operations
    .slice(0, 3)
    .map((o) => o.name)
    .join(', ')
  const metaDesc = `Automate ${name} with AI-powered workflows on Sim. ${description.slice(0, 100).trimEnd()}. Free to start.`

  return {
    title: `${name} Integration`,
    description: metaDesc,
    keywords: [
      `${name} automation`,
      `${name} integration`,
      `automate ${name}`,
      `connect ${name}`,
      `${name} workflow`,
      `${name} AI automation`,
      ...(opSample ? [`${name} ${opSample}`] : []),
      'workflow automation',
      'no-code automation',
      'AI agent workflow',
    ],
    openGraph: {
      title: `${name} Integration — AI Workflow Automation | Sim`,
      description: `Connect ${name} to ${INTEGRATION_COUNT - 1}+ tools using AI agents. ${description.slice(0, 100).trimEnd()}.`,
      url: `${baseUrl}/integrations/${slug}`,
      type: 'website',
      images: [
        {
          url: `${baseUrl}/opengraph-image.png`,
          width: 1200,
          height: 630,
          alt: `${name} Integration — Sim`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} Integration | Sim`,
      description: `Automate ${name} with AI-powered workflows. Connect to ${INTEGRATION_COUNT - 1}+ tools. Free to start.`,
      images: [{ url: `${baseUrl}/opengraph-image.png`, alt: `${name} Integration — Sim` }],
    },
    alternates: { canonical: `${baseUrl}/integrations/${slug}` },
  }
}

export default async function IntegrationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const integration = bySlug.get(slug)
  if (!integration) notFound()

  const { name, description, longDescription, bgColor, docsUrl, operations, triggers, authType } =
    integration

  const IconComponent = blockTypeToIconMap[integration.type]
  const faqs = buildFAQs(integration)
  const relatedSlugs = getRelatedSlugs(slug, operations, authType)
  const relatedIntegrations = relatedSlugs
    .map((s) => bySlug.get(s))
    .filter((i): i is Integration => i !== undefined)
  const baseType = integration.type.replace(/_v\d+$/, '')
  const matchingTemplates = TEMPLATES.filter(
    (t) =>
      t.integrationBlockTypes.includes(integration.type) ||
      t.integrationBlockTypes.includes(baseType)
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Integrations',
        item: `${baseUrl}/integrations`,
      },
      { '@type': 'ListItem', position: 3, name, item: `${baseUrl}/integrations/${slug}` },
    ],
  }

  const softwareAppJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${name} Integration`,
    description,
    url: `${baseUrl}/integrations/${slug}`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    featureList: operations.map((o) => o.name),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }

  const howToJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `How to automate ${name} with Sim`,
    description: `Step-by-step guide to connecting ${name} to AI-powered workflows in Sim.`,
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Create a free Sim account',
        text: 'Sign up at sim.ai — no credit card required.',
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: `Add a ${name} block`,
        text: `Open a workflow, drag a ${name} block onto the canvas, and authenticate with your ${name} credentials.`,
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Configure and run',
        text: `Choose the operation you want, connect it to an AI agent, and run your workflow. Automate anything in ${name} without code.`,
      },
    ],
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }

  return (
    <section className='bg-[var(--landing-bg)]'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Hero */}
      <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <div className='mb-6'>
          <Link
            href='/integrations'
            className='group/link inline-flex items-center gap-1.5 font-season text-[var(--landing-text-muted)] text-sm tracking-[0.02em] hover:text-[var(--landing-text)]'
          >
            <svg
              className='h-3 w-3 shrink-0'
              viewBox='0 0 10 10'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              aria-hidden='true'
            >
              <line
                x1='1'
                y1='5'
                x2='10'
                y2='5'
                stroke='currentColor'
                strokeWidth='1.33'
                strokeLinecap='square'
                className='origin-right scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
              />
              <path
                d='M6.5 2L3.5 5L6.5 8'
                stroke='currentColor'
                strokeWidth='1.33'
                strokeLinecap='square'
                strokeLinejoin='miter'
                fill='none'
                className='group-hover/link:-translate-x-[30%] transition-transform duration-200 ease-out'
              />
            </svg>
            Back to Integrations
          </Link>
        </div>

        {/* Hero content */}
        <div className='mb-6 flex items-center gap-5'>
          <IntegrationIcon
            bgColor={bgColor}
            name={name}
            Icon={IconComponent}
            className='h-12 w-12 rounded-[5px]'
            iconClassName='h-6 w-6'
            fallbackClassName='text-[20px]'
            aria-hidden='true'
          />
          <div>
            <h1
              id='integration-heading'
              className='text-[28px] text-white leading-[100%] tracking-[-0.02em] sm:text-[36px] lg:text-[44px]'
            >
              {name}
            </h1>
          </div>
        </div>

        <p className='mb-8 max-w-[700px] text-[var(--landing-text-body)] text-base leading-[150%] tracking-[0.02em]'>
          {description}
        </p>

        {/* CTAs */}
        <div className='flex flex-wrap gap-2'>
          <Link
            href='/signup'
            className='inline-flex h-[32px] items-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-season text-black text-sm transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
          >
            Start building free
          </Link>
          <a
            href={docsUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='group/link inline-flex h-[32px] items-center gap-1.5 rounded-[5px] border border-[var(--landing-border-strong)] px-2.5 font-season text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
          >
            View docs
            <svg
              aria-hidden='true'
              className='-rotate-45 h-3 w-3 shrink-0'
              viewBox='0 0 10 10'
              fill='none'
            >
              <line
                x1='0'
                y1='5'
                x2='9'
                y2='5'
                stroke='currentColor'
                strokeWidth='1.33'
                strokeLinecap='square'
                className='origin-left scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
              />
              <path
                d='M3.5 2L6.5 5L3.5 8'
                stroke='currentColor'
                strokeWidth='1.33'
                strokeLinecap='square'
                strokeLinejoin='miter'
                fill='none'
                className='transition-transform duration-200 ease-out group-hover/link:translate-x-[30%]'
              />
            </svg>
          </a>
        </div>
      </div>

      {/* Full-width divider */}
      <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

      {/* Border-railed content */}
      <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        {/* Overview */}
        {longDescription && (
          <>
            <section aria-labelledby='overview-heading' className='px-6 py-10'>
              <h2
                id='overview-heading'
                className='mb-4 text-[20px] text-white leading-[100%] tracking-[-0.02em]'
              >
                Overview
              </h2>
              <p className='text-[15px] text-[var(--landing-text-body)] leading-[150%] tracking-[0.02em]'>
                {longDescription}
              </p>
            </section>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </>
        )}

        {/* How to automate */}
        <section aria-labelledby='how-it-works-heading' className='px-6 py-10'>
          <h2
            id='how-it-works-heading'
            className='mb-6 text-[20px] text-white leading-[100%] tracking-[-0.02em]'
          >
            How to automate {name} with Sim
          </h2>
          <ol className='space-y-4' aria-label='Steps to set up automation'>
            {[
              {
                step: '01',
                title: 'Create a free account',
                body: 'Sign up at sim.ai in seconds. No credit card required. Your workspace is ready immediately.',
              },
              {
                step: '02',
                title: `Add a ${name} block`,
                body:
                  authType === 'oauth'
                    ? `Open a workflow, drag a ${name} block onto the canvas, and connect your account with one-click OAuth.`
                    : authType === 'api-key'
                      ? `Open a workflow, drag a ${name} block onto the canvas, and paste in your ${name} API key.`
                      : `Open a workflow, drag a ${name} block onto the canvas, and authenticate your account.`,
              },
              {
                step: '03',
                title: 'Configure, connect, and run',
                body: `Pick the tool you need, wire in an AI agent for reasoning or data transformation, and run. Your ${name} automation is live.`,
              },
            ].map(({ step, title, body }) => (
              <li key={step} className='flex gap-4'>
                <span
                  className='mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--landing-border-strong)] font-martian-mono text-[11px] text-[var(--landing-text-subtle)]'
                  aria-hidden='true'
                >
                  {step}
                </span>
                <div>
                  <h3 className='mb-1 text-[15px] text-white tracking-[-0.02em]'>{title}</h3>
                  <p className='text-[14px] text-[var(--landing-text-body)] leading-[150%] tracking-[0.02em]'>
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

        {/* Triggers — rows */}
        {triggers.length > 0 && (
          <section aria-labelledby='triggers-heading'>
            <div className='px-6 pt-10 pb-4'>
              <div className='mb-2 flex items-center gap-2.5'>
                <span className='relative flex h-2 w-2' aria-hidden='true'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                  <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
                </span>
                <h2
                  id='triggers-heading'
                  className='text-[20px] text-white leading-[100%] tracking-[-0.02em]'
                >
                  Real-time triggers
                </h2>
              </div>
              <p className='text-[14px] text-[var(--landing-text-body)] leading-[150%] tracking-[0.02em]'>
                Connect a {name} webhook to Sim and your workflow fires the instant an event happens
                — no polling, no delay.
              </p>
            </div>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            {triggers.map((trigger) => (
              <div key={trigger.id}>
                <div className='flex items-start gap-4 px-6 py-4'>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <p className='text-[14px] text-white leading-snug tracking-[-0.02em]'>
                      {trigger.name}
                    </p>
                    {trigger.description && (
                      <p className='text-[12px] text-[var(--landing-text-muted)] leading-[150%]'>
                        {trigger.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
              </div>
            ))}
          </section>
        )}

        {/* Workflow templates — horizontal cards */}
        {matchingTemplates.length > 0 && (
          <section aria-labelledby='templates-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='templates-heading'
                className='mb-2 text-[20px] text-white leading-[100%] tracking-[-0.02em]'
              >
                Workflow templates
              </h2>
              <p className='text-[14px] text-[var(--landing-text-body)] tracking-[0.02em]'>
                Ready-to-use workflows featuring {name}. Click any to build it instantly.
              </p>
            </div>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            {(() => {
              const isOdd = matchingTemplates.length % 2 === 1
              const pairedTemplates = isOdd ? matchingTemplates.slice(0, -1) : matchingTemplates
              const lastTemplate = isOdd ? matchingTemplates[matchingTemplates.length - 1] : null

              const resolveTypes = (template: (typeof matchingTemplates)[number]) => [
                integration.type,
                ...template.integrationBlockTypes.filter((bt) => bt !== integration.type),
              ]

              const renderIcons = (allTypes: string[]) =>
                allTypes.map((bt, idx) => {
                  const resolvedBt = byType.get(bt)
                    ? bt
                    : byType.get(`${bt}_v2`)
                      ? `${bt}_v2`
                      : byType.get(`${bt}_v3`)
                        ? `${bt}_v3`
                        : bt
                  const int = byType.get(resolvedBt)
                  const ToolIcon = blockTypeToIconMap[resolvedBt]
                  return (
                    <span key={bt} className='inline-flex items-center gap-1.5'>
                      {idx > 0 && (
                        <span className='text-[#555] text-[11px]' aria-hidden='true'>
                          →
                        </span>
                      )}
                      <IntegrationIcon
                        bgColor={int?.bgColor ?? '#333'}
                        name={int?.name ?? bt}
                        Icon={ToolIcon}
                        as='span'
                        className='h-6 w-6 rounded-[4px]'
                        iconClassName='h-3.5 w-3.5'
                        fallbackClassName='text-[10px]'
                        aria-hidden='true'
                      />
                    </span>
                  )
                })

              return (
                <>
                  {/* Paired rows of 2 */}
                  {Array.from({ length: Math.ceil(pairedTemplates.length / 2) }, (_, rowIdx) => {
                    const row = pairedTemplates.slice(rowIdx * 2, rowIdx * 2 + 2)
                    return (
                      <div key={rowIdx}>
                        <nav
                          aria-label={`Template row ${rowIdx + 1}`}
                          className='flex flex-col sm:flex-row'
                        >
                          {row.map((template) => (
                            <TemplateCardButton
                              key={template.title}
                              prompt={template.prompt}
                              className='group flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--landing-bg-elevated)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                            >
                              <div className='flex items-center gap-1.5'>
                                {renderIcons(resolveTypes(template))}
                              </div>
                              <div className='flex flex-col gap-2'>
                                <h3 className='text-[14px] text-white leading-snug tracking-[-0.02em]'>
                                  {template.title}
                                </h3>
                                <p className='line-clamp-2 text-[var(--landing-text-muted)] text-sm leading-[150%]'>
                                  {template.prompt}
                                </p>
                              </div>
                            </TemplateCardButton>
                          ))}
                        </nav>
                        <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
                      </div>
                    )
                  })}

                  {/* Last template as a full-width row when odd */}
                  {lastTemplate && (
                    <>
                      <TemplateCardButton
                        prompt={lastTemplate.prompt}
                        className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--landing-bg-elevated)]'
                      >
                        <div className='flex items-center gap-1.5'>
                          {renderIcons(resolveTypes(lastTemplate))}
                        </div>
                        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                          <h3 className='text-[14px] text-white leading-snug tracking-[-0.02em]'>
                            {lastTemplate.title}
                          </h3>
                          <p className='line-clamp-1 text-[12px] text-[var(--landing-text-muted)] leading-[150%]'>
                            {lastTemplate.prompt}
                          </p>
                        </div>
                      </TemplateCardButton>
                      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
                    </>
                  )}
                </>
              )
            })()}
          </section>
        )}

        {/* Supported tools — rows */}
        {operations.length > 0 && (
          <section aria-labelledby='tools-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='tools-heading'
                className='mb-2 text-[20px] text-white leading-[100%] tracking-[-0.02em]'
              >
                Supported tools
              </h2>
              <p className='text-[14px] text-[var(--landing-text-body)] tracking-[0.02em]'>
                {operations.length} {name} tool{operations.length === 1 ? '' : 's'} available in Sim
              </p>
            </div>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
            {operations.map((op) => (
              <div key={op.name}>
                <div className='flex items-start gap-4 px-6 py-4'>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <p className='text-[14px] text-white leading-snug tracking-[-0.02em]'>
                      {op.name}
                    </p>
                    {op.description && (
                      <p className='text-[12px] text-[var(--landing-text-muted)] leading-[150%]'>
                        {op.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
              </div>
            ))}
          </section>
        )}

        {/* FAQ — full width */}
        <section aria-labelledby='faq-heading' className='px-6 py-10'>
          <h2
            id='faq-heading'
            className='mb-8 text-[20px] text-white leading-[100%] tracking-[-0.02em]'
          >
            Frequently asked questions
          </h2>
          <IntegrationFAQ faqs={faqs} />
        </section>

        <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

        {/* Related integrations — horizontal cards with vertical dividers (blog featured pattern) */}
        {relatedIntegrations.length > 0 && (
          <>
            <nav aria-label='Related integrations' className='flex flex-col sm:flex-row'>
              {relatedIntegrations.slice(0, 4).map((rel) => (
                <Link
                  key={rel.slug}
                  href={`/integrations/${rel.slug}`}
                  className='group flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--landing-bg-elevated)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                >
                  <IntegrationIcon
                    bgColor={rel.bgColor}
                    name={rel.name}
                    Icon={blockTypeToIconMap[rel.type]}
                    as='span'
                    className='h-10 w-10 rounded-[5px]'
                    aria-hidden='true'
                  />
                  <div className='flex flex-col gap-2'>
                    <h3 className='text-lg text-white leading-tight tracking-[-0.01em]'>
                      {rel.name}
                    </h3>
                    <p className='line-clamp-2 text-[var(--landing-text-muted)] text-sm leading-[150%]'>
                      {rel.description}
                    </p>
                  </div>
                </Link>
              ))}
            </nav>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </>
        )}

        {/* Bottom CTA */}
        <section aria-labelledby='cta-heading' className='px-6 py-16 text-center'>
          <div className='mx-auto mb-6 flex items-center justify-center gap-3'>
            <Image
              src='/brandbook/logo/small.png'
              alt='Sim'
              width={56}
              height={56}
              className='shrink-0 rounded-xl'
              unoptimized
            />
            <div className='flex items-center gap-2'>
              <span className='h-px w-5 bg-[#3d3d3d]' aria-hidden='true' />
              <span
                className='flex h-7 w-7 items-center justify-center rounded-full border border-[var(--landing-border-strong)]'
                aria-hidden='true'
              >
                <svg
                  className='h-3.5 w-3.5 text-[var(--landing-text-secondary)]'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth={2}
                  strokeLinecap='round'
                >
                  <path d='M5 12h14' />
                  <path d='M12 5v14' />
                </svg>
              </span>
              <span className='h-px w-5 bg-[#3d3d3d]' aria-hidden='true' />
            </div>
            <IntegrationIcon
              bgColor={bgColor}
              name={name}
              Icon={IconComponent}
              className='h-14 w-14 rounded-xl'
              iconClassName='h-7 w-7'
              fallbackClassName='text-[22px]'
              aria-hidden='true'
            />
          </div>
          <h2
            id='cta-heading'
            className='mb-3 text-[28px] text-white leading-[100%] tracking-[-0.02em] sm:text-[34px]'
          >
            Start automating {name} today
          </h2>
          <p className='mx-auto mb-8 max-w-[480px] text-[var(--landing-text-body)] text-base leading-[150%] tracking-[0.02em]'>
            Build your first AI workflow with {name} in minutes. Connect to every tool your team
            uses. Free to start — no credit card required.
          </p>
          <Link
            href='/signup'
            className='inline-flex h-[32px] items-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-season text-black text-sm transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
          >
            Build for free
          </Link>
        </section>
      </div>

      {/* Closing full-width divider */}
      <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
    </section>
  )
}
