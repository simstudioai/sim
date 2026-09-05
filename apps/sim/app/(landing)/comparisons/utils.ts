import {
  type CompetitorProfile,
  claudeCoworkProfile,
  crewaiProfile,
  dustProfile,
  type Fact,
  type FactSource,
  flowiseProfile,
  gumloopProfile,
  langchainProfile,
  langflowProfile,
  makeProfile,
  microsoftCopilotProfile,
  n8nProfile,
  openaiAgentkitProfile,
  openClawProfile,
  pipedreamProfile,
  powerAutomateProfile,
  retoolProfile,
  simProfile,
  stackaiProfile,
  tinesProfile,
  vellumProfile,
  workatoProfile,
  zapierProfile,
} from '@/lib/compare/data'

export interface ComparisonFaq {
  question: string
  answer: string
}

/** Every competitor Sim is compared against, in display/build order. */
export const ALL_COMPETITORS: CompetitorProfile[] = [
  n8nProfile,
  zapierProfile,
  makeProfile,
  gumloopProfile,
  workatoProfile,
  retoolProfile,
  pipedreamProfile,
  openaiAgentkitProfile,
  tinesProfile,
  stackaiProfile,
  powerAutomateProfile,
  vellumProfile,
  claudeCoworkProfile,
  langflowProfile,
  flowiseProfile,
  microsoftCopilotProfile,
  openClawProfile,
  dustProfile,
  crewaiProfile,
  langchainProfile,
]

const COMPETITOR_BY_SLUG = new Map(ALL_COMPETITORS.map((c) => [c.id, c]))

export function getCompetitorBySlug(slug: string): CompetitorProfile | null {
  return COMPETITOR_BY_SLUG.get(slug) ?? null
}

/** Includes card citations as well as table facts; brand lookups are not claim reviews. */
function getProfileSources(profile: CompetitorProfile): FactSource[] {
  return [
    ...Object.values(profile.facts).flatMap((group) =>
      Object.values<Fact>(group).flatMap((fact) => fact.sources)
    ),
    ...profile.standoutFeatures.map(({ source }) => source),
    ...profile.limitations.map(({ source }) => source),
  ]
}

function sourceTimestamp(source: FactSource): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.asOf)) return null
  const timestamp = Date.parse(`${source.asOf}T00:00:00.000Z`)
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === source.asOf
    ? timestamp
    : null
}

/** Latest citation review, for modification metadata rather than a full-page verification claim. */
export function getLatestVerifiedDate(profile: CompetitorProfile): Date {
  const timestamps = getProfileSources(profile)
    .map(sourceTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null)
  return new Date(Math.max(0, ...timestamps))
}

/** A page-wide review cannot be newer than any of its citations, including Sim's shared claims. */
export function getComparisonReviewDate(profiles: CompetitorProfile[]): Date | null {
  if (profiles.length === 0) return null
  const timestamps: number[] = []
  for (const profile of profiles) {
    const facts = Object.values(profile.facts).flatMap((group) => Object.values<Fact>(group))
    if (facts.some((fact) => fact.confidence !== 'unknown' && fact.sources.length === 0))
      return null
    const sources = getProfileSources(profile)
    if (sources.length === 0) return null
    for (const source of sources) {
      const timestamp = sourceTimestamp(source)
      if (timestamp === null) return null
      timestamps.push(timestamp)
    }
  }
  return new Date(Math.min(...timestamps))
}

/** Sim's own latest-verified date, identical across every competitor page, computed once. */
export const SIM_LATEST_VERIFIED = getLatestVerifiedDate(simProfile)

/**
 * A short, atomic "who should pick which platform" verdict. The single
 * block most comparison-page readers (and AI answer engines asked "should I
 * use Sim or {competitor}") are actually looking for. Both sentences name
 * both products explicitly and stay factual, drawing on the competitor's own
 * documented standout feature rather than a generic claim.
 */
export interface ComparisonVerdict {
  chooseSim: string
  chooseCompetitor: string
}

export function buildBottomLine(competitor: CompetitorProfile): ComparisonVerdict {
  const strength = competitor.standoutFeatures[0]
  const chooseCompetitor = strength
    ? `Choose ${competitor.name} if you specifically need ${lowercaseFirst(strength.title)}: ${strength.description}`
    : `Choose ${competitor.name} if its specific strengths, documented above, matter more to your team than an AI-native, self-hostable workspace.`

  return {
    chooseSim: `Choose Sim for a self-hostable AI workflow workspace with multiple model providers, collaborative editing, and human approval steps. Check plan eligibility and separate Enterprise license terms for governance and environment-management features.`,
    chooseCompetitor,
  }
}

/**
 * Builds the FAQ set for a "Sim vs {Competitor}" page. Answer-first, each
 * question/answer pair is independently quotable per the landing GEO rules,
 * and every answer names "Sim" and the competitor explicitly. Every answer
 * draws on a real, sourced {@link Fact} field rather than a generic claim,
 * and no two questions repeat the same answer.
 */
export function buildComparisonFaqs(competitor: CompetitorProfile): ComparisonFaq[] {
  const name = competitor.name
  const facts = competitor.facts
  const faqs: ComparisonFaq[] = [
    {
      question: `Is Sim a good alternative to ${name}?`,
      answer: `Sim is an AI workspace where teams build and run agents visually, conversationally, or with code. ${ensurePeriod(competitor.oneLiner)} Compare deployment, pricing, and governance requirements. Sim's core is Apache-2.0 licensed; Enterprise features have separate terms.`,
    },
    {
      question: `What is the main difference between Sim and ${name}?`,
      answer: buildKeyDifferenceAnswer(competitor),
    },
    {
      question: `Does Sim support self-hosting compared to ${name}?`,
      answer: `Sim's core can be self-hosted with Docker or Kubernetes; Enterprise licensing and external service requirements are separate. ${name}'s self-hosting position: ${describeFact(facts.platform.selfHostOption)}`,
    },
    {
      question: `How does Sim's pricing compare to ${name}?`,
      answer: `Sim uses ${describeFact(simProfile.facts.pricing.pricingModel)} ${name} uses ${describeFact(facts.pricing.pricingModel)}`,
    },
    {
      question: `Is Sim more secure than ${name}?`,
      answer: `Security depends on product scope, configuration, and your requirements. Sim: ${describeFact(simProfile.facts.security.compliance)} ${name}: ${describeFact(facts.security.compliance)} Check the Security & compliance rows above for SSO, audit logging, and data residency.`,
    },
    {
      question: `Which has stronger AI agent capabilities, Sim or ${name}?`,
      answer: `Sim: ${describeFact(simProfile.facts.aiCapabilities.multiLlmSupport)} ${name}: ${describeFact(facts.aiCapabilities.multiLlmSupport)} Compare the AI rows for retrieval, tool use, approvals, and evaluation capabilities; availability can vary by product surface and plan.`,
    },
    {
      question: `What are ${name}'s documented limitations compared to Sim?`,
      answer: buildLimitationAnswer(competitor),
    },
    {
      question: `Can I migrate from ${name} to Sim?`,
      answer: `Plan to map ${name}'s triggers, actions, credentials, and data into Sim's workflow model. Rebuild and validate a representative automation in Sim before deciding how to migrate the rest.`,
    },
  ]

  if (competitor.isWorkflowBuilder === false) {
    faqs.push({
      question: `Is ${name} a workflow builder like Sim?`,
      answer: `${ensurePeriod(competitor.oneLiner)} Sim provides a visual workflow canvas with API and chat deployment. Compare the specific product surfaces and deployment models described above.`,
    })
  }

  return faqs
}

function buildKeyDifferenceAnswer(competitor: CompetitorProfile): string {
  const topFeature = competitor.standoutFeatures[0]
  const topLimitation = competitor.limitations[0]
  const parts = [
    `Sim combines a workflow canvas, natural-language assistance, multiple model providers, and a document knowledge base.`,
  ]
  if (topFeature) {
    parts.push(`${competitor.name}'s standout capability is ${formatClaim(topFeature)}`)
  }
  if (topLimitation) {
    parts.push(`One documented limitation of ${competitor.name} is ${formatClaim(topLimitation)}`)
  }
  return parts.join(' ')
}

/**
 * A dedicated "what's wrong with the competitor" answer, distinct from
 * {@link buildKeyDifferenceAnswer} (which leads with Sim's own strengths).
 * Walks every documented limitation rather than just the first, so the
 * answer stays substantive even for a two-limitation profile.
 */
function buildLimitationAnswer(competitor: CompetitorProfile): string {
  if (competitor.limitations.length === 0) {
    return `No specific limitations of ${competitor.name} are documented in this comparison yet. See the feature-by-feature table above for a full side-by-side of every category.`
  }
  const parts = competitor.limitations.map(formatClaim)
  return `Documented limitations of ${competitor.name} include ${parts.join('; ')}`
}

/** Renders a titled claim (a standout feature or limitation) as "lowercased title: description". */
function formatClaim(item: { title: string; description: string }): string {
  return `${lowercaseFirst(item.title)}: ${item.description}`
}

/** Appends a period if `value` doesn't already end in sentence-closing punctuation. */
export function ensurePeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`
}

/**
 * Lowercases the first letter of `value`, unless its leading word is an acronym
 * (e.g. "AI", "SSO", "MCP") or a CamelCase brand name (e.g. "LangChain",
 * "OpenClaw", "CrewAI") - detected by 2+ uppercase letters anywhere in that
 * word, not just consecutive at the start, since lowercasing either would
 * mangle a proper noun ("langChain", "openClaw").
 */
export function lowercaseFirst(value: string): string {
  if (value.length === 0) return value
  const leadingWord = value.match(/^[A-Za-z]+/)?.[0] ?? ''
  const upperCaseCount = (leadingWord.match(/[A-Z]/g) ?? []).length
  if (upperCaseCount >= 2) return value
  return value.charAt(0).toLowerCase() + value.slice(1)
}

/** Preserves qualifications, negation, and decimal numbers when stitching a fact into an answer. */
function summarizeFact(value: string): string {
  return ensurePeriod(lowercaseFirst(value))
}

/** Keeps confidence labels and source-scope qualifications in independently quoted FAQ answers. */
function describeFact(fact: Fact): string {
  const confidence =
    fact.confidence === 'verified'
      ? ''
      : `${fact.confidence === 'estimated' ? 'Estimate' : 'Unverified'}: `
  const summary = summarizeFact(fact.value)
  return `${confidence}${summary}${fact.detail ? ` ${ensurePeriod(fact.detail)}` : ''}`
}
