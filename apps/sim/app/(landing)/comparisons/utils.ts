import {
  type CompetitorProfile,
  claudeCoworkProfile,
  crewaiProfile,
  dustProfile,
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
  sources: FactSource[]
}

/** Keeps one citation per URL when a summary combines multiple sourced facts. */
function mergeSources(...groups: FactSource[][]): FactSource[] {
  const sources = new Map<string, FactSource>()
  for (const source of groups.flat()) {
    const existing = sources.get(source.url)
    if (!existing || source.asOf > existing.asOf) sources.set(source.url, source)
  }
  return [...sources.values()]
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
  simPoints: ComparisonChoicePoint[]
  competitorPoints: ComparisonChoicePoint[]
}

export interface ComparisonChoicePoint {
  title: string
  description: string
  sources: FactSource[]
}

export function buildBottomLine(competitor: CompetitorProfile): ComparisonVerdict {
  const strength = competitor.standoutFeatures[0]
  const chooseCompetitor = strength
    ? `Choose ${competitor.name} if you specifically need ${lowercaseFirst(strength.title)}: ${strength.description}`
    : `Choose ${competitor.name} if its specific strengths, documented above, matter more to your team than an AI-native, self-hostable workspace.`

  return {
    chooseSim: `Choose Sim if you want an open-source, self-hostable AI workspace that treats AI agents as first-class citizens: native multi-LLM support, real-time multiplayer editing, environment promotion (dev/qa/prod), human-in-the-loop approvals, and enterprise governance (SSO, credential-level permissions, audit logs) built in rather than bolted on.`,
    chooseCompetitor,
    simPoints: [
      {
        title: 'Open source and self-hostable',
        description:
          'Run your AI workspace under Apache 2.0, with Docker and Kubernetes deployment options.',
        sources: mergeSources(
          simProfile.facts.platform.license.sources,
          simProfile.facts.platform.selfHostOption.sources
        ),
      },
      {
        title: 'AI agents with human approvals',
        description:
          'Build with multiple models and approval steps that pause a run and resume it later.',
        sources: mergeSources(
          simProfile.facts.aiCapabilities.multiLlmSupport.sources,
          simProfile.facts.aiCapabilities.humanInTheLoop.sources
        ),
      },
      {
        title: 'Collaboration across environments',
        description:
          'Build together in real time, then fork and promote changes between dev, QA, and production.',
        sources: mergeSources(
          simProfile.facts.platform.realtimeCollaboration.sources,
          simProfile.facts.platform.environmentPromotion.sources
        ),
      },
      {
        title: 'Enterprise access controls',
        description:
          'Manage SSO, credential-level permissions, and audit logs in the same workspace.',
        sources: mergeSources(
          simProfile.facts.security.sso.sources,
          simProfile.facts.security.credentialGovernance.sources,
          simProfile.facts.security.auditLogging.sources
        ),
      },
    ],
    competitorPoints: competitor.standoutFeatures.slice(0, 4).map((feature) => ({
      title: feature.title,
      description: feature.shortDescription ?? feature.description,
      sources: [feature.source],
    })),
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
      answer: `Sim is an open-source AI workspace where teams build, deploy, and manage AI agents visually, conversationally, or with code. ${ensurePeriod(competitor.oneLiner)} Teams considering a switch typically weigh licensing (Sim is Apache 2.0 and self-hostable), pricing model, and how AI-native the platform's agent-building experience is.`,
      sources: mergeSources(
        simProfile.facts.platform.builderType.sources,
        simProfile.facts.platform.license.sources,
        simProfile.facts.platform.selfHostOption.sources,
        facts.platform.builderType.sources
      ),
    },
    {
      question: `What is the main difference between Sim and ${name}?`,
      answer: buildKeyDifferenceAnswer(competitor),
      sources: mergeSources(
        simProfile.facts.aiCapabilities.multiLlmSupport.sources,
        simProfile.facts.aiCapabilities.naturalLanguageBuilding.sources,
        simProfile.facts.aiCapabilities.knowledgeBaseRag.sources,
        competitor.standoutFeatures.slice(0, 1).map((item) => item.source),
        competitor.limitations.slice(0, 1).map((item) => item.source)
      ),
    },
    {
      question: `Does Sim support self-hosting compared to ${name}?`,
      answer: `Sim can be self-hosted via Docker or Kubernetes under an Apache 2.0 license, in addition to a managed cloud-hosted plan. ${name}'s self-hosting position: ${ensurePeriod(firstSentence(facts.platform.selfHostOption.value))}`,
      sources: mergeSources(
        simProfile.facts.platform.selfHostOption.sources,
        simProfile.facts.platform.license.sources,
        simProfile.facts.platform.deploymentOptions.sources,
        facts.platform.selfHostOption.sources
      ),
    },
    {
      question: `How does Sim's pricing compare to ${name}?`,
      answer: `Sim uses ${summarizeFact(simProfile.facts.pricing.pricingModel.value)} ${name} uses ${summarizeFact(facts.pricing.pricingModel.value)}`,
      sources: mergeSources(
        simProfile.facts.pricing.pricingModel.sources,
        facts.pricing.pricingModel.sources
      ),
    },
    {
      question: `Is Sim more secure than ${name}?`,
      answer: `Security is a like-for-like comparison, not a one-line verdict. Sim: ${summarizeFact(simProfile.facts.security.compliance.value)} ${name}: ${summarizeFact(facts.security.compliance.value)} Check the Security & compliance rows above for the full breakdown, including SSO, audit logging, and data residency.`,
      sources: mergeSources(
        simProfile.facts.security.compliance.sources,
        facts.security.compliance.sources
      ),
    },
    {
      question: `Which has stronger AI agent capabilities, Sim or ${name}?`,
      answer: `Sim: ${summarizeFact(simProfile.facts.aiCapabilities.multiLlmSupport.value)} ${name}: ${summarizeFact(facts.aiCapabilities.multiLlmSupport.value)} Sim also ships native human-in-the-loop approvals, a hybrid vector-plus-keyword knowledge base, and an in-editor AI Copilot that can read execution logs and directly edit the workflow to fix a failed run.`,
      sources: mergeSources(
        simProfile.facts.aiCapabilities.multiLlmSupport.sources,
        facts.aiCapabilities.multiLlmSupport.sources,
        simProfile.facts.aiCapabilities.humanInTheLoop.sources,
        simProfile.facts.aiCapabilities.knowledgeBaseRag.sources,
        simProfile.facts.aiCapabilities.naturalLanguageBuilding.sources
      ),
    },
    {
      question: `What are ${name}'s documented limitations compared to Sim?`,
      answer: buildLimitationAnswer(competitor),
      sources: mergeSources(competitor.limitations.map((item) => item.source)),
    },
    {
      question: `Can I migrate from ${name} to Sim?`,
      answer: `There is no automated one-click migration tool between ${name} and Sim. Workflows and automations need to be rebuilt in Sim's visual builder, natural-language Chat surface, or API. Most teams start by recreating their highest-value automation first to validate the switch before migrating the rest.`,
      sources: [],
    },
  ]

  if (competitor.isWorkflowBuilder === false) {
    faqs.push({
      question: `Is ${name} a workflow builder like Sim?`,
      answer: `Not in the same sense. ${competitor.oneLiner} Sim, by contrast, is a visual and code-based workflow builder that deploys agents as REST APIs, scheduled jobs, or chat interfaces, so the two solve different parts of the AI agent problem rather than competing feature-for-feature.`,
      sources: mergeSources(
        facts.platform.builderType.sources,
        simProfile.facts.platform.builderType.sources,
        simProfile.facts.platform.deploymentOptions.sources
      ),
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

/**
 * Composes {@link firstSentence} + {@link lowercaseFirst} + {@link ensurePeriod} for
 * stitching a fact value mid-sentence. Strips a leading "Yes:"/"No:" (or the
 * comma-separated "Yes,"/"No,") token first so boolean facts don't produce
 * mid-sentence "yes: ..."/"no: ..." fragments.
 */
function summarizeFact(value: string): string {
  const stripped = value.replace(/^(Yes|No)(?![a-zA-Z])(?:[:,]\s*)?/, '').trim()
  const base = stripped.length > 0 ? stripped : value
  return ensurePeriod(lowercaseFirst(firstSentence(base)))
}
