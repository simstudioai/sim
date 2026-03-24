import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TEMPLATES } from '@/app/workspace/[workspaceId]/home/components/template-prompts/consts'
import { IntegrationIcon } from '../components/integration-icon'
import { blockTypeToIconMap } from '../data/icon-mapping'
import integrations from '../data/integrations.json'
import type { AuthType, FAQItem, Integration } from '../data/types'
import { IntegrationFAQ } from './components/integration-faq'
import { TemplateCardButton } from './components/template-card-button'

const allIntegrations = integrations as Integration[]
const INTEGRATION_COUNT = allIntegrations.length

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
      url: `https://sim.ai/integrations/${slug}`,
      type: 'website',
      images: [{ url: 'https://sim.ai/opengraph-image.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} Integration | Sim`,
      description: `Automate ${name} with AI-powered workflows. Connect to ${INTEGRATION_COUNT - 1}+ tools. Free to start.`,
    },
    alternates: { canonical: `https://sim.ai/integrations/${slug}` },
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
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://sim.ai' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Integrations',
        item: 'https://sim.ai/integrations',
      },
      { '@type': 'ListItem', position: 3, name, item: `https://sim.ai/integrations/${slug}` },
    ],
  }

  const softwareAppJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${name} Integration`,
    description,
    url: `https://sim.ai/integrations/${slug}`,
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
    <>
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

      <div className='mx-auto max-w-[1200px] px-6 py-12 sm:px-8 md:px-12'>
        {/* Breadcrumb */}
        <nav
          aria-label='Breadcrumb'
          className='mb-10 flex items-center gap-2 text-[#555] text-[13px]'
        >
          <Link href='/' className='transition-colors hover:text-[#999]'>
            Home
          </Link>
          <span aria-hidden='true'>/</span>
          <Link href='/integrations' className='transition-colors hover:text-[#999]'>
            Integrations
          </Link>
          <span aria-hidden='true'>/</span>
          <span className='text-[#999]'>{name}</span>
        </nav>

        {/* Hero */}
        <section aria-labelledby='integration-heading' className='mb-16'>
          <div className='mb-6 flex items-center gap-5'>
            <IntegrationIcon
              bgColor={bgColor}
              name={name}
              Icon={IconComponent}
              className='h-16 w-16 rounded-xl'
              iconClassName='h-8 w-8'
              fallbackClassName='text-[26px]'
              aria-hidden='true'
            />
            <div>
              <p className='mb-0.5 text-[#555] text-[12px]'>Integration</p>
              <h1
                id='integration-heading'
                className='font-[500] text-[#ECECEC] text-[36px] leading-tight sm:text-[44px]'
              >
                {name}
              </h1>
            </div>
          </div>

          <p className='mb-8 max-w-[700px] text-[#999] text-[17px] leading-[1.7]'>{description}</p>

          {/* CTAs */}
          <div className='flex flex-wrap gap-[8px]'>
            <a
              href='https://sim.ai'
              className='inline-flex h-[32px] items-center rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] px-[10px] font-[430] font-season text-[#1C1C1C] text-[14px] transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              Start building free
            </a>
            <a
              href={docsUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex h-[32px] items-center gap-[6px] rounded-[5px] border border-[#3d3d3d] px-[10px] font-[430] font-season text-[#ECECEC] text-[14px] transition-colors hover:bg-[#2A2A2A]'
            >
              View docs
              <svg
                aria-hidden='true'
                className='h-3 w-3'
                fill='none'
                stroke='currentColor'
                strokeWidth={2}
                viewBox='0 0 24 24'
              >
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' x2='21' y1='14' y2='3' />
              </svg>
            </a>
          </div>
        </section>

        {/* Two-column layout */}
        <div className='grid grid-cols-1 gap-16 lg:grid-cols-[1fr_300px]'>
          {/* Main column */}
          <div className='min-w-0 space-y-16'>
            {/* Overview */}
            {longDescription && (
              <section aria-labelledby='overview-heading'>
                <h2 id='overview-heading' className='mb-4 font-[500] text-[#ECECEC] text-[20px]'>
                  Overview
                </h2>
                <p className='text-[#999] text-[15px] leading-[1.8]'>{longDescription}</p>
              </section>
            )}

            {/* How to automate — targets "how to connect X" queries */}
            <section aria-labelledby='how-it-works-heading'>
              <h2 id='how-it-works-heading' className='mb-6 font-[500] text-[#ECECEC] text-[20px]'>
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
                      className='mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#3d3d3d] font-[500] text-[#555] text-[11px]'
                      aria-hidden='true'
                    >
                      {step}
                    </span>
                    <div>
                      <h3 className='mb-1 font-[500] text-[#ECECEC] text-[15px]'>{title}</h3>
                      <p className='text-[#999] text-[14px] leading-relaxed'>{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Triggers */}
            {triggers.length > 0 && (
              <section aria-labelledby='triggers-heading'>
                <h2 id='triggers-heading' className='mb-2 font-[500] text-[#ECECEC] text-[20px]'>
                  Real-time triggers
                </h2>
                <p className='mb-4 text-[#999] text-[14px] leading-relaxed'>
                  Connect a {name} webhook to Sim and your workflow fires the instant an event
                  happens — no polling, no delay. Sim receives the full event payload and makes
                  every field available as a variable inside your workflow.
                </p>

                {/* Event cards */}
                <ul
                  className='grid grid-cols-1 gap-3 sm:grid-cols-2'
                  aria-label={`${name} trigger events`}
                >
                  {triggers.map((trigger) => (
                    <li
                      key={trigger.id}
                      className='rounded-lg border border-[#2A2A2A] bg-[#242424] p-4'
                    >
                      <div className='mb-2 flex items-center gap-2'>
                        <span className='inline-flex items-center gap-1 rounded-[4px] bg-[#2A2A2A] px-1.5 py-0.5 font-[500] text-[#ECECEC] text-[11px]'>
                          <svg
                            aria-hidden='true'
                            className='h-2.5 w-2.5'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth={2.5}
                            viewBox='0 0 24 24'
                          >
                            <polygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2' />
                          </svg>
                          Event
                        </span>
                      </div>
                      <p className='font-[500] text-[#ECECEC] text-[13px]'>{trigger.name}</p>
                      {trigger.description && (
                        <p className='mt-1 text-[#999] text-[12px] leading-relaxed'>
                          {trigger.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Workflow templates */}
            {matchingTemplates.length > 0 && (
              <section aria-labelledby='templates-heading'>
                <h2 id='templates-heading' className='mb-2 font-[500] text-[#ECECEC] text-[20px]'>
                  Workflow templates
                </h2>
                <p className='mb-6 text-[#999] text-[14px]'>
                  Ready-to-use workflows featuring {name}. Click any to build it instantly.
                </p>
                <ul
                  className='grid grid-cols-1 gap-4 sm:grid-cols-2'
                  aria-label='Workflow templates'
                >
                  {matchingTemplates.map((template) => {
                    const allTypes = [
                      integration.type,
                      ...template.integrationBlockTypes.filter((bt) => bt !== integration.type),
                    ]

                    return (
                      <li key={template.title}>
                        <TemplateCardButton prompt={template.prompt}>
                          {/* Integration pills row */}
                          <div className='mb-3 flex flex-wrap items-center gap-1.5 text-[12px]'>
                            {allTypes.map((bt, idx) => {
                              // Templates may use unversioned keys (e.g. "notion") while the
                              // icon map has versioned keys ("notion_v2") — fall back to _v2.
                              const resolvedBt = byType.get(bt)
                                ? bt
                                : byType.get(`${bt}_v2`)
                                  ? `${bt}_v2`
                                  : bt
                              const int = byType.get(resolvedBt)
                              const intName = int?.name ?? bt
                              return (
                                <span key={bt} className='inline-flex items-center gap-1.5'>
                                  {idx > 0 && (
                                    <span className='text-[#555]' aria-hidden='true'>
                                      →
                                    </span>
                                  )}
                                  <span className='inline-flex items-center gap-1 rounded-[3px] bg-[#2A2A2A] px-1.5 py-0.5 font-[500] text-[#ECECEC]'>
                                    <IntegrationIcon
                                      bgColor={int?.bgColor ?? '#6B7280'}
                                      name={intName}
                                      Icon={blockTypeToIconMap[resolvedBt]}
                                      as='span'
                                      className='h-3.5 w-3.5 rounded-[2px]'
                                      iconClassName='h-2.5 w-2.5'
                                      aria-hidden='true'
                                    />
                                    {intName}
                                  </span>
                                </span>
                              )
                            })}
                          </div>

                          <p className='mb-1 font-[500] text-[#ECECEC] text-[14px]'>
                            {template.title}
                          </p>

                          <p className='mt-3 text-[#555] text-[13px] transition-colors group-hover:text-[#999]'>
                            Try this workflow →
                          </p>
                        </TemplateCardButton>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* Tools */}
            {operations.length > 0 && (
              <section aria-labelledby='tools-heading'>
                <h2 id='tools-heading' className='mb-2 font-[500] text-[#ECECEC] text-[20px]'>
                  Supported tools
                </h2>
                <p className='mb-6 text-[#999] text-[14px]'>
                  {operations.length} {name} tool{operations.length === 1 ? '' : 's'} available in
                  Sim
                </p>
                <ul
                  className='grid grid-cols-1 gap-2 sm:grid-cols-2'
                  aria-label={`${name} supported tools`}
                >
                  {operations.map((op) => (
                    <li
                      key={op.name}
                      className='rounded-[6px] border border-[#2A2A2A] bg-[#242424] px-3.5 py-3'
                    >
                      <p className='font-[500] text-[#ECECEC] text-[13px]'>{op.name}</p>
                      {op.description && (
                        <p className='mt-0.5 text-[#555] text-[12px] leading-relaxed'>
                          {op.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* FAQ */}
            <section aria-labelledby='faq-heading'>
              <h2 id='faq-heading' className='mb-8 font-[500] text-[#ECECEC] text-[20px]'>
                Frequently asked questions
              </h2>
              <IntegrationFAQ faqs={faqs} />
            </section>
          </div>

          {/* Sidebar */}
          <aside className='space-y-5' aria-label='Integration details'>
            {/* Quick details */}
            <div className='rounded-lg border border-[#2A2A2A] bg-[#242424] p-5'>
              <h3 className='mb-4 font-[500] text-[#ECECEC] text-[14px]'>Details</h3>
              <dl className='space-y-3 text-[13px]'>
                {operations.length > 0 && (
                  <div>
                    <dt className='text-[#555]'>Tools</dt>
                    <dd className='text-[#ECECEC]'>{operations.length} supported</dd>
                  </div>
                )}
                {triggers.length > 0 && (
                  <div>
                    <dt className='text-[#555]'>Triggers</dt>
                    <dd className='text-[#ECECEC]'>{triggers.length} available</dd>
                  </div>
                )}
                <div>
                  <dt className='text-[#555]'>Auth</dt>
                  <dd className='text-[#ECECEC]'>
                    {authType === 'oauth'
                      ? 'One-click OAuth'
                      : authType === 'api-key'
                        ? 'API key'
                        : 'None required'}
                  </dd>
                </div>
                <div>
                  <dt className='text-[#555]'>Pricing</dt>
                  <dd className='text-[#ECECEC]'>Free to start</dd>
                </div>
              </dl>
              <div className='mt-5 flex flex-col gap-2'>
                <a
                  href='https://sim.ai'
                  className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] font-[430] font-season text-[#1C1C1C] text-[13px] transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
                >
                  Get started free
                </a>
                <a
                  href={docsUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex h-[32px] w-full items-center justify-center gap-1.5 rounded-[5px] border border-[#3d3d3d] font-[430] font-season text-[#ECECEC] text-[13px] transition-colors hover:bg-[#2A2A2A]'
                >
                  View docs
                  <svg
                    aria-hidden='true'
                    className='h-3 w-3'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth={2}
                    viewBox='0 0 24 24'
                  >
                    <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                    <polyline points='15 3 21 3 21 9' />
                    <line x1='10' x2='21' y1='14' y2='3' />
                  </svg>
                </a>
              </div>
            </div>

            {/* Related integrations — internal linking for SEO */}
            {relatedIntegrations.length > 0 && (
              <div className='rounded-lg border border-[#2A2A2A] bg-[#242424] p-5'>
                <h3 className='mb-4 font-[500] text-[#ECECEC] text-[14px]'>Related integrations</h3>
                <ul className='space-y-2'>
                  {relatedIntegrations.map((rel) => (
                    <li key={rel.slug}>
                      <Link
                        href={`/integrations/${rel.slug}`}
                        className='flex items-center gap-2.5 rounded-[6px] p-1.5 text-[#999] text-[13px] transition-colors hover:bg-[#2A2A2A] hover:text-[#ECECEC]'
                      >
                        <IntegrationIcon
                          bgColor={rel.bgColor}
                          name={rel.name}
                          Icon={blockTypeToIconMap[rel.type]}
                          as='span'
                          className='h-6 w-6 rounded-[4px]'
                          iconClassName='h-3.5 w-3.5'
                          fallbackClassName='text-[10px]'
                          aria-hidden='true'
                        />
                        {rel.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href='/integrations'
                  className='mt-4 block text-[#555] text-[12px] transition-colors hover:text-[#999]'
                >
                  All integrations →
                </Link>
              </div>
            )}
          </aside>
        </div>

        {/* Bottom CTA */}
        <section
          aria-labelledby='cta-heading'
          className='mt-20 rounded-xl border border-[#2A2A2A] bg-[#242424] p-8 text-center sm:p-12'
        >
          {/* Logo pair: Sim × Integration */}
          <div className='mx-auto mb-6 flex items-center justify-center gap-3'>
            <img
              src='/brandbook/logo/small.png'
              alt='Sim'
              className='h-14 w-14 shrink-0 rounded-xl'
            />
            <div className='flex items-center gap-2'>
              <span className='h-px w-5 bg-[#3d3d3d]' aria-hidden='true' />
              <span
                className='flex h-7 w-7 items-center justify-center rounded-full border border-[#3d3d3d]'
                aria-hidden='true'
              >
                <svg
                  className='h-3.5 w-3.5 text-[#666]'
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
            className='mb-3 font-[500] text-[#ECECEC] text-[28px] sm:text-[34px]'
          >
            Start automating {name} today
          </h2>
          <p className='mx-auto mb-8 max-w-[480px] text-[#999] text-[16px] leading-relaxed'>
            Build your first AI workflow with {name} in minutes. Connect to every tool your team
            uses. Free to start — no credit card required.
          </p>
          <a
            href='https://sim.ai'
            className='inline-flex h-[32px] items-center rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] px-[10px] font-[430] font-season text-[#1C1C1C] text-[14px] transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
          >
            Build for free →
          </a>
        </section>
      </div>
    </>
  )
}
