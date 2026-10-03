import { ChipLink } from '@sim/emcn'
import { escapeRegExp } from '@sim/utils/string'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/core/utils/urls'
import {
  type AuthType,
  blockTypeToIconMap,
  type FAQItem,
  formatIntegrationType,
  INTEGRATIONS,
  INTEGRATIONS_UPDATED_AT,
  type Integration,
} from '@/lib/integrations'
import { BackLink } from '@/app/(landing)/components'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'
import { ShareButton } from '@/app/(landing)/components/share-button'
import { IntegrationComparisonSection } from '@/app/(landing)/integrations/(shell)/[slug]/components/integration-comparison-section/integration-comparison-section'
import { IntegrationCtaButton } from '@/app/(landing)/integrations/(shell)/[slug]/components/integration-cta-button'
import { TemplateCardButton } from '@/app/(landing)/integrations/(shell)/[slug]/components/template-card-button'
import { IntegrationIcon } from '@/app/(landing)/integrations/components/integration-icon'
import { INTEGRATION_SEO } from '@/app/(landing)/integrations/data/seo-content'
import { getTemplatesForBlock } from '@/blocks/registry'

const allIntegrations = INTEGRATIONS
const baseUrl = SITE_URL

/**
 * High-connectivity integrations (e.g. Slack, used as a notification target
 * across hundreds of unrelated templates via `alsoIntegrations`) can match
 * many hundreds of templates, ballooning this page's HTML/RSC payload well
 * past Googlebot's 2MB crawl limit. Cap to a bounded, still-generous set,
 * consistent with the related-integrations section's own cap below.
 *
 * `getTemplatesForBlock` returns matches in registry insertion order, not
 * relevance - sorted `featured` first, then owned-by-the-viewing-integration,
 * so the cap can't hide a curated `featured` template (owned or reached via
 * `alsoIntegrations`) behind a larger pile of non-featured owned templates,
 * nor behind unrelated `alsoIntegrations` matches that happen to iterate
 * earlier in the registry.
 */
const MAX_TEMPLATES_SHOWN = 12

/** Fast O(1) lookups - avoids repeated linear scans inside render loops. */
const bySlug = new Map(allIntegrations.map((i) => [i.slug, i]))
const byType = new Map(allIntegrations.map((i) => [i.type, i]))

/**
 * Unknown params must 404 before rendering: `notFound()` during render streams this segment's
 * `loading.tsx` with a 200 status first.
 */
export const dynamicParams = false

/**
 * Returns up to `limit` related integration slugs from the same category, so
 * the section links within the topical cluster (both CRMs, both devops tools).
 *
 * Scoring (additive):
 *   +3 per shared operation name  - strongest signal (same capability)
 *   +2 per shared operation word  - weaker signal (e.g. both have "create" ops)
 *   +1  same auth type            - comparable setup experience
 *
 * Ties are broken by alphabetical slug order for determinism.
 */
function getRelatedSlugs(
  slug: string,
  operations: Integration['operations'],
  authType: AuthType,
  integrationType: Integration['integrationType'],
  limit = 4
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
    .reduce<Array<{ slug: string; score: number }>>((scored, i) => {
      if (i.slug === slug || i.integrationType !== integrationType) return scored
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
      scored.push({ slug: i.slug, score: sharedNames * 3 + sharedWords * 2 + sameAuth })
      return scored
    }, [])
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit)
    .map(({ slug: s }) => s)
}

const AUTH_STEP: Record<AuthType, (name: string) => string> = {
  oauth: (name) =>
    `Connect your ${name} account with one-click OAuth, with no credentials to copy.`,
  'api-key': (name) => `Paste your ${name} API key to authenticate.`,
  none: () => 'No authentication is needed, so the block works as soon as you drop it in.',
}

/** Default H1 and page name, e.g. "Slack integration for AI agents". */
function integrationTitle(name: string): string {
  return `${name} integration for AI agents`
}

/** Human-readable catalog refresh date for the visible last-updated line. */
const UPDATED_AT_DISPLAY = new Date(`${INTEGRATIONS_UPDATED_AT}T00:00:00Z`).toLocaleDateString(
  'en-US',
  { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
)

/**
 * Ensures autogenerated prose can be safely composed with a following sentence.
 */
function sentenceWithTerminalPunctuation(value: string): string {
  const trimmedValue = value.trim()
  return /[.!?]$/.test(trimmedValue) ? trimmedValue : `${trimmedValue}.`
}

/**
 * Server-side rewrite of bare integration names in a curated template prompt
 * to `@`-mention form (`Slack` → `@Slack`) so the prompt chips with brand
 * icons once it is populated into the Mothership home input after signup -
 * the home auto-mention pipeline only chips token-starting `@` mentions, so
 * curated prompts must opt in.
 *
 * Unlike the workspace surface, which calls `mentionifyIntegrations` from
 * `@/blocks/integration-matcher`, this runs only over the handful of names a
 * template actually references (its owner + `otherBlockTypes`) and lives in a
 * Server Component, so it never pulls the full block/tool/icon registry into
 * the landing client bundle. Whole-token, longest-first matching with
 * lookarounds mirrors the canonical matcher; idempotent on already-prefixed
 * names.
 */
function mentionifyPromptForNames(prompt: string, names: readonly string[]): string {
  const unique = Array.from(new Set(names.filter((n) => n.trim().length >= 2))).sort(
    (a, b) => b.length - a.length
  )
  if (unique.length === 0) return prompt
  const regex = new RegExp(
    `(?<![A-Za-z0-9_@])(${unique.map(escapeRegExp).join('|')})(?![A-Za-z0-9_])`,
    'gi'
  )
  return prompt.replace(regex, (match) => `@${match}`)
}

/**
 * Turns a Title Case tool name into a mid-sentence phrase (`Get Markets` →
 * `get markets`). Only plain capitalized words are lowercased, so acronyms
 * (`PR`), mixed-case brands (`GitHub`), and the integration's own name survive.
 */
function toPhrase(toolName: string, integrationName: string): string {
  const keep = new Set(integrationName.split(/\s+/))
  return toolName
    .split(' ')
    .map((word) => (!keep.has(word) && /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(' ')
}

/**
 * The ordered integration-icon chain for a template card - one tile per block
 * type in flow order, separated by arrows. Resolves each type through its
 * versioned aliases so v2/v3 blocks reuse the base icon and name.
 */
function TemplateIconRow({ allTypes }: { allTypes: string[] }) {
  return (
    <>
      {allTypes.map((bt, idx) => {
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
              <span className='text-[11px] text-[var(--text-subtle)]' aria-hidden='true'>
                →
              </span>
            )}
            <IntegrationIcon
              bgColor={int?.bgColor ?? 'var(--surface-active)'}
              name={int?.name ?? bt}
              Icon={ToolIcon}
              as='span'
              className='size-6 rounded-[4px]'
              iconClassName='size-3.5'
              fallbackClassName='text-[10px]'
              aria-hidden='true'
            />
          </span>
        )
      })}
    </>
  )
}

/** Joins items into readable prose: "a", "a and b", or "a, b, and c". */
function toProseList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** Human-readable authentication method, as stated in the at-a-glance facts. */
const AUTH_LABEL: Record<AuthType, string> = {
  oauth: 'OAuth',
  'api-key': 'API key',
  none: 'None required',
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Tool and trigger counts as one phrase, e.g. `"19 tools and 1 trigger"`; `''` when both are zero. */
function capabilityPhrase(integration: Integration): string {
  return [
    integration.operations.length > 0 ? pluralize(integration.operations.length, 'tool') : null,
    integration.triggers.length > 0 ? pluralize(integration.triggers.length, 'trigger') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' and ')
}

const META_DESCRIPTION_MAX = 160

/**
 * Meta description built from registry facts: the block description, then a
 * sample of the integration's actual tools, then its trigger count. Whole
 * sentences are kept while they fit, so the description never cuts mid-word.
 */
function buildMetaDescription(integration: Integration): string {
  const { name, description, operations, triggers } = integration
  const sentences = [sentenceWithTerminalPunctuation(description)]
  if (operations.length > 0) {
    const sample = operations.slice(0, 3).map((o) => toPhrase(o.name, name))
    const remaining = operations.length - sample.length
    sentences.push(
      `Sim AI agents can ${toProseList(remaining > 0 ? [...sample, pluralize(remaining, `more ${name} action`)] : sample)}.`
    )
  }
  if (triggers.length > 0) {
    sentences.push(
      `${name} events can start agents through ${pluralize(triggers.length, 'trigger')}.`
    )
  }
  return sentences.reduce((text, sentence) => {
    const next = `${text} ${sentence}`
    return next.length <= META_DESCRIPTION_MAX ? next : text
  })
}

/** "a" vs "an" for a service name; U-names read as "you", so they take "a". */
function articleFor(name: string): string {
  return /^[aeio]/i.test(name) ? 'an' : 'a'
}

/**
 * Generates the per-integration FAQ from catalog facts only: the block
 * description, its tool and trigger names and descriptions, and its auth
 * method. Catalog-generic questions live once on the /integrations index FAQ
 * instead of repeating across every page.
 */
function buildFAQs(integration: Integration): FAQItem[] {
  const { name, description, operations, triggers, authType } = integration
  const opCount = operations.length
  const triggerCount = triggers.length
  const topOpNames = operations.slice(0, 5).map((o) => o.name)
  const firstOp = operations[0]
  const capability = capabilityPhrase(integration)
  const triggerNames = triggers.map((t) => t.name)
  const triggerListPhrase =
    triggerCount > 6
      ? `${triggerNames.slice(0, 6).join(', ')}, and ${triggerCount - 6} more`
      : toProseList(triggerNames)
  const connectFinalStep = firstOp
    ? `Pick a tool such as "${firstOp.name}", wire up its inputs, and click Run.`
    : triggerCount > 0
      ? `Choose the ${name} event you want to listen for, and your agent runs whenever it occurs.`
      : `Configure the block's inputs and click Run.`

  return [
    {
      question: `What is Sim's ${name} integration?`,
      answer: `Sim's ${name} integration ${capability ? `adds ${capability} to` : `connects ${name} to`} the AI agents you build in Sim's visual workflow builder. ${sentenceWithTerminalPunctuation(description)}`,
    },
    ...(opCount > 0
      ? [
          {
            question: `What can I automate with ${name} in Sim?`,
            answer: `You can ${toProseList(topOpNames.map((n) => toPhrase(n, name)))} with ${name} in Sim${
              opCount > 5 ? `, plus ${opCount - 5} more ${name} tools listed on this page` : ''
            }. ${opCount === 1 ? 'It runs' : 'Each runs'} as a tool inside an AI agent, so the agent can combine ${name} with any other connected service and apply LLM reasoning between steps.`,
          },
        ]
      : []),
    {
      question: `How do I connect ${name} to Sim?`,
      answer: `(1) Create a free account at sim.ai. (2) Create an agent in your workspace. (3) Drag ${articleFor(name)} ${name} block onto the workflow builder. (4) ${AUTH_STEP[authType](name)} (5) ${connectFinalStep}`,
    },
    ...(firstOp && opCount >= 2
      ? [
          {
            question: `How do I ${toPhrase(firstOp.name, name)} with ${name} in Sim?`,
            answer: `Add ${articleFor(name)} ${name} block to your agent and select "${firstOp.name}" as the tool.${
              firstOp.description ? ` ${sentenceWithTerminalPunctuation(firstOp.description)}` : ''
            } Fill in the required fields. Inputs can reference outputs from earlier steps, such as text generated by an AI block or data fetched from another integration.`,
          },
        ]
      : []),
    ...(triggerCount > 0
      ? [
          {
            question: `Can ${name} events start a Sim agent automatically?`,
            answer: `Yes. Sim supports ${pluralize(triggerCount, 'trigger')} for ${name}: ${triggerListPhrase}. Add ${articleFor(name)} ${name} trigger to your agent, and every matching ${name} event starts a run with the event data available to the rest of the workflow.`,
          },
        ]
      : []),
  ]
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

  const { name, operations } = integration
  const opSample = operations
    .slice(0, 3)
    .map((o) => o.name)
    .join(', ')
  const categoryLabel = formatIntegrationType(integration.integrationType)
  const seo = INTEGRATION_SEO[slug]
  const metaDesc = seo?.description ?? buildMetaDescription(integration)
  const defaultTitle = integrationTitle(name)
  const pageUrl = `${baseUrl}/integrations/${slug}`

  return {
    // A hand-authored SEO title is rendered verbatim (it carries its own brand
    // suffix); otherwise the default flows through the root `%s | Sim` template.
    title: seo?.title ? { absolute: seo.title } : defaultTitle,
    description: metaDesc,
    keywords: seo?.keywords ?? [
      `${name} automation`,
      `${name} integration`,
      `automate ${name}`,
      `connect ${name}`,
      `${name} AI agent`,
      `${name} AI automation`,
      ...(opSample ? [`${name} ${opSample}`] : []),
      `${categoryLabel} integration`,
      ...(integration.tags ?? []).map((tag) => `${name} ${tag.replace(/-/g, ' ')}`),
      ...(integration.triggerCount > 0 ? [`${name} webhook`, `${name} trigger`] : []),
      'AI workspace integrations',
      'AI agent integrations',
      'AI agent builder',
    ],
    // og:image/twitter:image come from the sibling opengraph-image.tsx -
    // Next serves it at a hash-suffixed URL, so hardcoding it here 404s.
    openGraph: {
      title: seo?.title ?? `${defaultTitle} | Sim`,
      description: metaDesc,
      url: pageUrl,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: seo?.title ?? `${defaultTitle} | Sim`,
      description: metaDesc,
    },
    alternates: { canonical: pageUrl },
  }
}

export default async function IntegrationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const integration = bySlug.get(slug)
  if (!integration) notFound()

  const { name, description, longDescription, bgColor, docsUrl, operations, triggers, authType } =
    integration

  const landingContent = integration.landingContent
  const seo = INTEGRATION_SEO[slug]
  const overviewBody = seo?.overview ?? longDescription

  const IconComponent = blockTypeToIconMap[integration.type]
  const categoryLabel = formatIntegrationType(integration.integrationType)
  const relatedSlugs = getRelatedSlugs(slug, operations, authType, integration.integrationType)
  const relatedIntegrations = relatedSlugs
    .map((s) => bySlug.get(s))
    .filter((i): i is Integration => i !== undefined)
  const faqs = seo?.faqs ?? buildFAQs(integration)
  const capability = capabilityPhrase(integration)
  const pageUrl = `${baseUrl}/integrations/${slug}`
  const matchingTemplates = getTemplatesForBlock(integration.type)
    .sort(
      (a, b) =>
        Number(b.featured ?? false) - Number(a.featured ?? false) ||
        Number(b.isOwner) - Number(a.isOwner)
    )
    .slice(0, MAX_TEMPLATES_SHOWN)

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
      { '@type': 'ListItem', position: 3, name, item: pageUrl },
    ],
  }

  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name: integrationTitle(name),
    description,
    isPartOf: { '@id': `${baseUrl}#website` },
    publisher: { '@id': `${baseUrl}#organization` },
    about: { '@type': 'Thing', name },
    inLanguage: 'en-US',
    dateModified: INTEGRATIONS_UPDATED_AT,
    ...(integration.tags?.length
      ? { keywords: integration.tags.map((tag) => tag.replace(/-/g, ' ')).join(', ') }
      : {}),
    ...(operations.length + triggers.length > 0
      ? {
          mainEntity: {
            '@type': 'ItemList',
            name: `${name} tools and triggers in Sim`,
            numberOfItems: operations.length + triggers.length,
            itemListElement: [...operations, ...triggers].map((item, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name: item.name,
              description: item.description,
            })),
          },
        }
      : {}),
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
    <section className='bg-[var(--bg)]'>
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={webPageJsonLd} />
      <JsonLd data={faqJsonLd} />

      {/* Hero */}
      <div className='mx-auto w-full max-w-[1728px] px-10 pt-[112px] max-sm:pt-20 max-md:px-7 max-lg:px-8 max-xl:px-9'>
        <div className='mb-6'>
          <BackLink href='/integrations' label='Back to Integrations' />
        </div>

        {/* Hero content */}
        <div className='mb-6 flex items-center gap-5'>
          <IntegrationIcon
            bgColor={bgColor}
            name={name}
            Icon={IconComponent}
            className='size-12 rounded-xl border border-[var(--border-1)]'
            iconClassName='size-6'
            fallbackClassName='text-[20px]'
            aria-hidden='true'
          />
          <div>
            <h1
              id='integration-heading'
              className='text-[28px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em] sm:text-[36px] lg:text-[44px]'
            >
              {seo?.h1 ?? integrationTitle(name)}
            </h1>
          </div>
        </div>

        <p className='mb-3 max-w-[700px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
          {seo?.tagline ?? description}
        </p>

        <p className='sr-only'>
          {name} is a Sim integration in the {categoryLabel} category. Sim is the AI workspace where
          teams build and deploy AI agents. Sim&apos;s {name} integration provides{' '}
          {capability || `a ${name} connection`} that AI agents can use inside Sim&apos;s visual
          workflow builder.{' '}
          {authType === 'oauth'
            ? `${name} connects with one-click OAuth.`
            : authType === 'api-key'
              ? `${name} connects with an API key.`
              : `${name} requires no authentication.`}{' '}
          Free to start at sim.ai.
        </p>

        {/* CTAs */}
        <div className='flex flex-wrap gap-2'>
          <IntegrationCtaButton label='Start building free'>
            Start building free
          </IntegrationCtaButton>
          <ChipLink
            href={docsUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='border border-[var(--border-1)]'
          >
            View docs
          </ChipLink>
          <ShareButton url={pageUrl} title={`${name} Integration`} />
        </div>

        <p className='mt-5 text-[var(--text-muted)] text-xs'>
          Last updated <time dateTime={INTEGRATIONS_UPDATED_AT}>{UPDATED_AT_DISPLAY}</time>
        </p>
      </div>

      {/* Full-width divider */}
      <div className='mt-8 h-px w-full bg-[var(--border)]' />

      {/* Border-railed content */}
      <div className='mx-10 max-w-[1648px] border-[var(--border)] border-x max-md:mx-7 max-lg:mx-8 max-xl:mx-9 min-[1728px]:mx-auto'>
        {/* Overview + at-a-glance facts */}
        <section aria-labelledby='overview-heading' className='px-6 py-10'>
          <h2
            id='overview-heading'
            className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
          >
            What Sim agents can do with {name}
          </h2>
          {overviewBody && (
            <p className='text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
              {overviewBody}
            </p>
          )}
          <dl className='mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-5'>
            {[
              { term: 'Category', detail: categoryLabel },
              { term: 'Authentication', detail: AUTH_LABEL[authType] },
              { term: 'Tools', detail: String(operations.length) },
              { term: 'Triggers', detail: String(triggers.length) },
            ].map(({ term, detail }) => (
              <div key={term} className='flex flex-col gap-1'>
                <dt className='text-[var(--text-muted)] text-xs'>{term}</dt>
                <dd className='text-[var(--text-primary)]'>{detail}</dd>
              </div>
            ))}
            <div className='flex flex-col gap-1'>
              <dt className='text-[var(--text-muted)] text-xs'>Documentation</dt>
              <dd>
                <a
                  href={docsUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-[var(--text-primary)] underline underline-offset-2'
                >
                  {name} docs
                </a>
              </dd>
            </div>
          </dl>
        </section>
        <div className='h-px w-full bg-[var(--border)]' />

        {/* Install / Add to workspace (integration-specific) */}
        {landingContent?.install && (
          <>
            <section aria-labelledby='install-heading' className='px-6 py-10'>
              <h2
                id='install-heading'
                className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                {landingContent.install.heading}
              </h2>
              <p className='mb-6 max-w-[700px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
                {landingContent.install.intro}
              </p>
              <ol className='space-y-4' aria-label={`Steps to add ${name}`}>
                {landingContent.install.steps.map((item, index) => (
                  <li key={item.title} className='flex gap-4'>
                    <span
                      className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-1)] text-[11px] text-[var(--text-muted)]'
                      aria-hidden='true'
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className='mb-1 text-[15px] text-[var(--text-primary)] tracking-[-0.02em]'>
                        {item.title}
                      </h3>
                      <p className='text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'>
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className='mt-8 flex flex-wrap gap-2'>
                <IntegrationCtaButton label={`Add to ${name}`}>Add to {name}</IntegrationCtaButton>
              </div>
            </section>
            <div className='h-px w-full bg-[var(--border)]' />
          </>
        )}

        {/* Privacy & data (integration-specific) */}
        {landingContent?.privacy && (
          <>
            <section aria-labelledby='privacy-heading' className='px-6 py-10'>
              <h2
                id='privacy-heading'
                className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                Privacy & data
              </h2>
              <p className='max-w-[700px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
                {landingContent.privacy.body}{' '}
                <Link
                  href={landingContent.privacy.href}
                  className='text-[var(--text-primary)] underline underline-offset-2 hover:text-[var(--text-primary)]'
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </section>
            <div className='h-px w-full bg-[var(--border)]' />
          </>
        )}

        {/* AI-generated content disclaimer (integration-specific) */}
        {landingContent?.aiDisclaimer && (
          <>
            <section aria-labelledby='ai-disclaimer-heading' className='px-6 py-10'>
              <h2
                id='ai-disclaimer-heading'
                className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                AI-generated content
              </h2>
              <p className='max-w-[700px] text-[var(--text-body)] text-base leading-[150%] tracking-[0.02em]'>
                {landingContent.aiDisclaimer}
              </p>
            </section>
            <div className='h-px w-full bg-[var(--border)]' />
          </>
        )}

        {/* How to automate */}
        <section aria-labelledby='how-it-works-heading' className='px-6 py-10'>
          <h2
            id='how-it-works-heading'
            className='mb-6 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
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
                title: `Add ${articleFor(name)} ${name} block`,
                body:
                  authType === 'oauth'
                    ? `Open your workspace, drag ${articleFor(name)} ${name} block onto the workflow builder, and connect your account with one-click OAuth.`
                    : authType === 'api-key'
                      ? `Open your workspace, drag ${articleFor(name)} ${name} block onto the workflow builder, and paste in your ${name} API key.`
                      : `Open your workspace, drag ${articleFor(name)} ${name} block onto the workflow builder. No authentication is needed.`,
              },
              {
                step: '03',
                title: 'Configure, connect, and run',
                body: `Pick the tool you need, wire in an AI agent for reasoning or data transformation, and run. Your ${name} automation is live.`,
              },
            ].map(({ step, title, body }) => (
              <li key={step} className='flex gap-4'>
                <span
                  className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-1)] text-[11px] text-[var(--text-muted)]'
                  aria-hidden='true'
                >
                  {step}
                </span>
                <div>
                  <h3 className='mb-1 text-[15px] text-[var(--text-primary)] tracking-[-0.02em]'>
                    {title}
                  </h3>
                  <p className='text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'>
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className='h-px w-full bg-[var(--border)]' />

        {seo?.comparison && (
          <>
            <IntegrationComparisonSection comparison={seo.comparison} />
            <div className='h-px w-full bg-[var(--border)]' />
          </>
        )}

        {/* Triggers - rows */}
        {triggers.length > 0 && (
          <section aria-labelledby='triggers-heading'>
            <div className='px-6 pt-10 pb-4'>
              <div className='mb-2 flex items-center gap-2.5'>
                <span className='relative flex size-2' aria-hidden='true'>
                  <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                  <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
                </span>
                <h2
                  id='triggers-heading'
                  className='text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
                >
                  {name} triggers
                </h2>
              </div>
              <p className='text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'>
                {seo?.triggersIntro ?? (
                  <>
                    Add {articleFor(name)} {name} trigger to a Sim agent and it starts a run
                    whenever one of these {name} events occurs.
                  </>
                )}
              </p>
            </div>
            <div className='h-px w-full bg-[var(--border)]' />
            {triggers.map((trigger) => (
              <div key={trigger.id}>
                <div className='flex items-start gap-4 px-6 py-4'>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                      {trigger.name}
                    </h3>
                    {trigger.description && (
                      <p className='text-[var(--text-muted)] text-caption leading-[150%]'>
                        {trigger.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className='h-px w-full bg-[var(--border)]' />
              </div>
            ))}
          </section>
        )}

        {/* Workflow templates - horizontal cards */}
        {matchingTemplates.length > 0 && (
          <section aria-labelledby='templates-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='templates-heading'
                className='mb-2 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                Agent templates
              </h2>
              <p className='text-[14px] text-[var(--text-body)] tracking-[0.02em]'>
                {seo?.templatesIntro ??
                  `Ready-to-use templates featuring ${name}. Click any to build it instantly.`}
              </p>
            </div>
            <div className='h-px w-full bg-[var(--border)]' />
            {(() => {
              const isOdd = matchingTemplates.length % 2 === 1
              const pairedTemplates = isOdd ? matchingTemplates.slice(0, -1) : matchingTemplates
              const lastTemplate = isOdd ? matchingTemplates[matchingTemplates.length - 1] : null

              const resolveTypes = (template: (typeof matchingTemplates)[number]) => [
                integration.type,
                ...template.otherBlockTypes,
              ]

              const resolveDisplayName = (bt: string): string | null => {
                const resolvedBt = byType.get(bt)
                  ? bt
                  : byType.get(`${bt}_v2`)
                    ? `${bt}_v2`
                    : byType.get(`${bt}_v3`)
                      ? `${bt}_v3`
                      : bt
                return byType.get(resolvedBt)?.name ?? null
              }

              /**
               * The curated template prompt rewritten so the integrations it
               * references chip in the home input after signup. Computed
               * server-side from the template's own integration set - never the
               * full registry - so the visible card text stays raw while the
               * stored prompt opts into mention treatment.
               */
              const storedPrompt = (template: (typeof matchingTemplates)[number]) =>
                mentionifyPromptForNames(
                  template.prompt,
                  resolveTypes(template)
                    .map(resolveDisplayName)
                    .filter((n): n is string => n !== null)
                )

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
                              prompt={storedPrompt(template)}
                              className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                            >
                              <div className='flex items-center gap-1.5'>
                                <TemplateIconRow allTypes={resolveTypes(template)} />
                              </div>
                              <div className='flex flex-col gap-2'>
                                <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                                  {template.title}
                                </h3>
                                <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                                  {template.prompt}
                                </p>
                              </div>
                            </TemplateCardButton>
                          ))}
                        </nav>
                        <div className='h-px w-full bg-[var(--border)]' />
                      </div>
                    )
                  })}

                  {/* Last template as a full-width row when odd */}
                  {lastTemplate && (
                    <>
                      <TemplateCardButton
                        prompt={storedPrompt(lastTemplate)}
                        className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--surface-hover)]'
                      >
                        <div className='flex items-center gap-1.5'>
                          <TemplateIconRow allTypes={resolveTypes(lastTemplate)} />
                        </div>
                        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                          <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                            {lastTemplate.title}
                          </h3>
                          <p className='line-clamp-1 text-[var(--text-muted)] text-caption leading-[150%]'>
                            {lastTemplate.prompt}
                          </p>
                        </div>
                      </TemplateCardButton>
                      <div className='h-px w-full bg-[var(--border)]' />
                    </>
                  )}
                </>
              )
            })()}
          </section>
        )}

        {/* Supported tools - rows */}
        {operations.length > 0 && (
          <section aria-labelledby='tools-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='tools-heading'
                className='mb-2 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                {name} tools
              </h2>
              <p className='text-[14px] text-[var(--text-body)] tracking-[0.02em]'>
                {pluralize(operations.length, `${name} tool`)} available to Sim agents
                {seo?.toolsSubtitleSuffix ?? ''}.
              </p>
            </div>
            <div className='h-px w-full bg-[var(--border)]' />
            {operations.map((op) => (
              <div key={op.name}>
                <div className='flex items-start gap-4 px-6 py-4'>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                      {op.name}
                    </h3>
                    {op.description && (
                      <p className='text-[var(--text-muted)] text-caption leading-[150%]'>
                        {op.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className='h-px w-full bg-[var(--border)]' />
              </div>
            ))}
          </section>
        )}

        {seo?.narrativeComparison && (
          <>
            <section
              id={seo.narrativeComparison.id}
              aria-labelledby={`${seo.narrativeComparison.id}-heading`}
              className='px-6 py-10'
            >
              <h2
                id={`${seo.narrativeComparison.id}-heading`}
                className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                {seo.narrativeComparison.heading}
              </h2>
              <div className='max-w-[900px] space-y-4'>
                {seo.narrativeComparison.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className='text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
            <div className='h-px w-full bg-[var(--border)]' />
          </>
        )}

        {/* FAQ - full width */}
        <section aria-labelledby='faq-heading' className='px-6 py-10'>
          <h2
            id='faq-heading'
            className='mb-8 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
          >
            Frequently asked questions
          </h2>
          <LandingFAQ faqs={faqs} />
        </section>

        <div className='h-px w-full bg-[var(--border)]' />

        {/* Related integrations - horizontal cards with vertical dividers (blog featured pattern) */}
        {relatedIntegrations.length > 0 && (
          <section aria-labelledby='related-heading'>
            <div className='px-6 pt-10 pb-4'>
              <h2
                id='related-heading'
                className='text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
              >
                Related {categoryLabel} integrations
              </h2>
            </div>
            <div className='h-px w-full bg-[var(--border)]' />
            <nav aria-label='Related integrations' className='flex flex-col sm:flex-row'>
              {relatedIntegrations.map((rel) => (
                <Link
                  key={rel.slug}
                  href={`/integrations/${rel.slug}`}
                  className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                >
                  <IntegrationIcon
                    bgColor={rel.bgColor}
                    name={rel.name}
                    Icon={blockTypeToIconMap[rel.type]}
                    as='span'
                    className='size-10 rounded-xl border border-[var(--border-1)]'
                    aria-hidden='true'
                  />
                  <div className='flex flex-col gap-2'>
                    <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
                      {rel.name}
                    </h3>
                    <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                      {rel.description}
                    </p>
                  </div>
                </Link>
              ))}
            </nav>
            <div className='h-px w-full bg-[var(--border)]' />
          </section>
        )}
      </div>

      {/* Closing full-width divider */}
      <div className='-mt-px h-px w-full bg-[var(--border)]' />
    </section>
  )
}
