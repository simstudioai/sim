import {
  type CompetitorProfile,
  claudeCoworkProfile,
  flowiseProfile,
  gumloopProfile,
  langflowProfile,
  makeProfile,
  n8nProfile,
  openaiAgentkitProfile,
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
]

const COMPETITOR_BY_SLUG = new Map(ALL_COMPETITORS.map((c) => [c.id, c]))

export function getCompetitorBySlug(slug: string): CompetitorProfile | null {
  return COMPETITOR_BY_SLUG.get(slug) ?? null
}

/**
 * The most recent `asOf` date across every fact source in a profile. Used as
 * the sitemap `lastModified` for that competitor's comparison page, so the
 * sitemap reflects when the underlying facts were actually last verified.
 */
export function getLatestVerifiedDate(profile: CompetitorProfile): Date {
  let latest = 0
  for (const group of Object.values(profile.facts)) {
    for (const fact of Object.values(group as Record<string, { sources: { asOf: string }[] }>)) {
      for (const source of fact.sources) {
        const time = new Date(source.asOf).getTime()
        if (!Number.isNaN(time) && time > latest) {
          latest = time
        }
      }
    }
  }
  return latest > 0 ? new Date(latest) : new Date()
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
    chooseSim: `Choose Sim if you want an open-source, self-hostable AI workspace that treats AI agents as first-class citizens: native multi-LLM support, real-time multiplayer editing, environment promotion (dev/qa/prod), human-in-the-loop approvals, and enterprise governance (SSO, credential-level permissions, audit logs) built in rather than bolted on.`,
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
      answer: `Sim is an open-source AI workspace where teams build, deploy, and manage AI agents visually, conversationally, or with code. ${name} is ${lowercaseFirst(competitor.oneLiner)} Teams considering a switch typically weigh licensing (Sim is Apache 2.0 and self-hostable), pricing model, and how AI-native the platform's agent-building experience is.`,
    },
    {
      question: `What is the main difference between Sim and ${name}?`,
      answer: buildKeyDifferenceAnswer(competitor),
    },
    {
      question: `Does Sim support self-hosting, unlike ${name}?`,
      answer: `Sim can be self-hosted via Docker or Kubernetes under an Apache 2.0 license, in addition to a managed cloud-hosted plan. ${name}'s self-hosting position: ${ensurePeriod(firstSentence(facts.platform.selfHostOption.value))}`,
    },
    {
      question: `How does Sim's pricing compare to ${name}?`,
      answer: `Sim uses ${summarizeFact(simProfile.facts.pricing.pricingModel.value)} ${name} uses ${summarizeFact(facts.pricing.pricingModel.value)}`,
    },
    {
      question: `Is Sim more secure than ${name}?`,
      answer: `Security is a like-for-like comparison, not a one-line verdict. Sim: ${summarizeFact(simProfile.facts.security.additionalCompliance.value)} ${name}: ${summarizeFact(facts.security.additionalCompliance.value)} Check the Security & compliance rows above for the full breakdown, including SSO, audit logging, and data residency.`,
    },
    {
      question: `Which has stronger AI agent capabilities, Sim or ${name}?`,
      answer: `Sim: ${summarizeFact(simProfile.facts.aiCapabilities.multiLlmSupport.value)} ${name}: ${summarizeFact(facts.aiCapabilities.multiLlmSupport.value)} Sim also ships native human-in-the-loop approvals, a hybrid vector-plus-keyword knowledge base, and an in-editor AI Copilot that can read execution logs and directly edit the workflow to fix a failed run.`,
    },
    {
      question: `What are ${name}'s documented limitations compared to Sim?`,
      answer: buildLimitationAnswer(competitor),
    },
    {
      question: `Can I migrate from ${name} to Sim?`,
      answer: `There is no automated one-click migration tool between ${name} and Sim. Workflows and automations need to be rebuilt in Sim's visual builder, natural-language Chat surface, or API. Most teams start by recreating their highest-value automation first to validate the switch before migrating the rest.`,
    },
  ]

  if (competitor.isWorkflowBuilder === false) {
    faqs.push({
      question: `Is ${name} a workflow builder like Sim?`,
      answer: `Not in the same sense. ${competitor.oneLiner} Sim, by contrast, is a visual and code-based workflow builder that deploys agents as REST APIs, scheduled jobs, or chat interfaces, so the two solve different parts of the AI agent problem rather than competing feature-for-feature.`,
    })
  }

  return faqs
}

function buildKeyDifferenceAnswer(competitor: CompetitorProfile): string {
  const topFeature = competitor.standoutFeatures[0]
  const topLimitation = competitor.limitations[0]
  const parts = [
    `Sim is built specifically as an AI agent workspace, with native multi-LLM support, an in-editor AI Copilot, and a knowledge base with hybrid vector + keyword search.`,
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

function firstSentence(value: string): string {
  const match = value.match(/^[^.]+\./)
  return match ? match[0] : value
}

/** Appends a period if `value` doesn't already end in sentence-closing punctuation. */
function ensurePeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`
}

/** Lowercases the first letter of `value`, unless it starts with an acronym (e.g. "AI", "SSO", "MCP"). */
export function lowercaseFirst(value: string): string {
  if (value.length === 0) return value
  // Leave a leading acronym (2+ consecutive capitals, e.g. "AI", "SSO", "MCP") alone.
  if (/^[A-Z]{2,}/.test(value)) return value
  return value.charAt(0).toLowerCase() + value.slice(1)
}

/** Composes {@link firstSentence} + {@link lowercaseFirst} + {@link ensurePeriod} for stitching a fact value mid-sentence. */
function summarizeFact(value: string): string {
  return ensurePeriod(lowercaseFirst(firstSentence(value)))
}
