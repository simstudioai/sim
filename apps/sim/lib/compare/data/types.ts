/**
 * Data model for "Sim vs {Competitor}" comparison pages.
 *
 * This module intentionally contains no UI. It is the data layer only.
 * Every {@link Fact} carries a source so comparison claims can be audited
 * before they are ever rendered. A page-rendering layer can be built on
 * top of {@link CompetitorProfile} later without touching this schema.
 */
import type { ComponentType, SVGProps } from 'react'

/** Where a fact came from, and when it was last checked. */
export interface FactSource {
  /** Publicly reachable URL that substantiates this fact (pricing page, docs, changelog, etc). */
  url: string
  /** Short human label for the source, e.g. "n8n Pricing page". */
  label: string
  /** ISO date (YYYY-MM-DD) the source was last checked. */
  asOf: string
}

/** A single comparable data point (one cell in a comparison table row). */
export interface Fact {
  /** The value to display, already formatted for reading (e.g. "750 tasks/mo", "Yes", "$29.99/mo"). */
  value: string
  /**
   * A compact, scannable restatement of `value` (roughly 3-10 words) for
   * dense contexts like the comparison table and key-differences strip.
   * Must not introduce any claim not already in `value`/`detail`. It is a
   * compression of the same fact, not a new one. Falls back to `value` when
   * absent.
   */
  shortValue?: string
  /** Optional longer explanation shown on hover/expand. */
  detail?: string
  /** Whether this fact was corroborated against a live primary source or is a best-effort estimate. */
  confidence: 'verified' | 'estimated' | 'unknown'
  /** Primary sources backing this fact. Empty only when confidence is 'unknown'. */
  sources: FactSource[]
}

/**
 * Canonical fact keys shared by every competitor profile, grouped into the
 * row categories used by comparison tables (mirrors the category grouping
 * used by competitor "vs" pages: platform, AI capabilities, integrations,
 * pricing, security/compliance, support).
 */
export interface ComparisonFacts {
  platform: {
    builderType: Fact
    learningCurve: Fact
    selfHostOption: Fact
    deploymentOptions: Fact
    templates: Fact
    license: Fact
    /** Dev/qa/prod-style environment promotion. Forking or cloning a full project/workspace and pushing/pulling changes between environments, not just versioning one workflow. */
    environmentPromotion: Fact
    /** History/versioning depth: deploy rollback, diff/compare views, undo/redo (client vs. server persisted), branching. */
    versionControlDepth: Fact
    /** Live concurrent multi-user editing of the same workflow/canvas (cursors, selections, synced operations), distinct from async sharing or file-level locking. */
    realtimeCollaboration: Fact
    /** A native file storage system with folder hierarchy, link-based sharing (with auth options like password/SSO), and deleted-item recovery, versus only per-block file handling. */
    nativeFileStorage: Fact
    /** A native spreadsheet-like data table feature (not an external DB connector), including row/column limits and spreadsheet keyboard navigation (arrow keys, copy-paste). */
    dataTables: Fact
    /** An inline rich-text/WYSIWYG markdown editor for documents stored in the platform, versus a plain textarea or raw-source view only. */
    richTextEditor: Fact
    /** Calling one saved workflow as a reusable step inside another workflow (composition/nesting), versus only being able to duplicate or manually re-wire the same logic per workflow. */
    subWorkflows: Fact
  }
  aiCapabilities: {
    multiLlmSupport: Fact
    agentReasoningBlocks: Fact
    naturalLanguageBuilding: Fact
    knowledgeBaseRag: Fact
    mcpSupport: Fact
    evaluationGuardrails: Fact
    /** A dedicated mechanism for a run to pause and wait on human approval/input mid-workflow, distinct from a plain delay/wait step. */
    humanInTheLoop: Fact
    /** Built-in image, video, and audio (TTS/STT) generation blocks/nodes, and which providers. */
    generativeMedia: Fact
    /** Whether an agent can dynamically browse and pick tools at inference time from a broad pool, vs. only calling tools the workflow author pre-wired into that step. */
    dynamicToolUse: Fact
    /** Whether a failed/rate-limited LLM call automatically retries against a different model or provider, vs. surfacing the failure. */
    modelFallback: Fact
    /** Reusable, named prompt/knowledge snippets a builder defines once and invokes by reference across agents, distinct from a one-off system prompt. */
    agentSkills: Fact
    /** A native, publicly deployable conversational chat surface for an agent, versus only a form/API/webhook deployment target. */
    nativeChatDeployment: Fact
    /** Whether knowledge-base search results and their debugging views expose individual chunk-level detail (chunk index/content), not just whole-document results. */
    kbChunkVisibility: Fact
    /** Native support for fanning a run out into multiple branches that execute concurrently and join back into a single result, versus sequential-only execution or manual workarounds. */
    parallelExecution: Fact
    /** Support for the Agent2Agent (A2A) protocol, the emerging open standard for one AI agent to discover and call another agent as a peer, distinct from ordinary MCP tool-calling. */
    a2aProtocol: Fact
    /** A dedicated for-each/while loop container that iterates a set of steps over a list or a fixed count, distinct from a Parallel block's concurrent fan-out. */
    loopIteration: Fact
  }
  integrations: {
    integrationCount: Fact
    triggerTypes: Fact
    customCodeSteps: Fact
    apiPublishing: Fact
    /** Official client SDKs, plugin/custom-node development kits, and a marketplace for community-built integrations. */
    extensibilitySdk: Fact
    /** Publishing a deployed workflow itself as a callable MCP server for external AI tools to consume, the reverse direction of ordinary MCP client support. */
    mcpPublishing: Fact
  }
  pricing: {
    pricingModel: Fact
    entryPaidPlan: Fact
    freeTier: Fact
    byok: Fact
  }
  security: {
    soc2: Fact
    dataResidency: Fact
    rbac: Fact
    auditLogging: Fact
    /** Compliance certifications beyond a bare SOC2 mention. HIPAA, ISO 27001, GDPR-specific attestations, PCI, FedRAMP, etc. */
    additionalCompliance: Fact
    /** Admin-configurable restrictions on which LLM providers/models members may use, and which specific tools/integrations a role can call. Finer-grained than plain workspace admin/write/read. */
    modelAndToolGovernance: Fact
    /** Restricting which specific stored credentials/connections a role or permission group may use, distinct from feature-level RBAC or integration-level allow/deny. */
    credentialGovernance: Fact
    /** Replacing vendor branding (logo, product name, theme colors) with the customer's own across the workspace/deployed-app UI. */
    whiteLabeling: Fact
    /** Org-configurable retention windows for execution logs, soft-deleted resources, and similar data, versus a fixed platform-wide default. */
    dataRetention: Fact
    /** Detecting and redacting/blocking PII (emails, SSNs, etc.) in workflow content or retained logs, distinct from generic output-validation guardrails. */
    piiRedaction: Fact
    /** SAML/OIDC single sign-on with organization auto-provisioning on first login. */
    sso: Fact
  }
  /**
   * Production-readiness signals that matter once feature parity is
   * established: whether a customer can see what happened inside a run,
   * whether the platform recovers from failure on its own, and whether a
   * failed run is even visible without the user going to look for it.
   */
  observability: {
    tracingDepth: Fact
    /** Automatic retries, checkpointing, and replay of a past execution with its original inputs. */
    durabilityModel: Fact
    /** Being notified (not just able to look up) that a run failed or crossed a cost/latency threshold. */
    failureAlerting: Fact
    /** Continuously exporting execution/audit/usage data to an external destination (S3, BigQuery, Datadog, webhook, etc.), versus only viewing it in-product. */
    dataDrains: Fact
    /** Triggering a run to execute in the background and polling or otherwise checking back for its result later, versus only a synchronous request that blocks until the run finishes. */
    asyncExecution: Fact
    /** Concrete published or verified numbers for how long a single execution/request may run and how many can run concurrently, since long-running agent workflows commonly hit these ceilings in practice. */
    executionLimits: Fact
    /** Whether one failing step can be routed to an error-handling path so the rest of the run continues, versus a single failure always halting the entire execution. */
    partialFailureHandling: Fact
  }
  support: {
    supportChannels: Fact
    sla: Fact
    community: Fact
    /** Founding year, funding/stage, or other market-maturity signal. Relevant because a newer vendor carries real switching risk for an enterprise buyer. */
    companyMaturity: Fact
    /** A structured learning resource (courses, certification, tutorials) beyond ad hoc docs/blog content. */
    academy: Fact
  }
}

/** Brand icon + colors for a competitor, sourced from a brand-intelligence lookup rather than the vendor's own docs. */
export interface CompetitorBrand {
  /** Icon component from @/components/icons rendering this competitor's logo. */
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /**
   * Whether `icon` already renders a full, self-contained brand-colored
   * square (a fetched app-store-style icon) rather than a bare transparent
   * glyph. Self-framed icons fill their tile edge-to-edge; non-self-framed
   * icons render small and centered on a plain tile background.
   */
  selfFramed?: boolean
  /** Brand hex colors, most prominent first. */
  colors: string[]
  /** Brand-intelligence-sourced company description. Distinct from {@link CompetitorProfile.oneLiner}, which is independently fact-checked; this is a secondary, unverified reference. */
  description?: string
  /** Industry / sub-industry classifications from the brand-intelligence source. */
  industries?: string[]
  /** Social profile links from the brand-intelligence source. */
  socials?: Array<{ type: string; url: string }>
  /** Where this brand data was sourced from (e.g. "Context.dev brand-intelligence API"). */
  source: string
  /** ISO date (YYYY-MM-DD) this brand data was looked up. */
  asOf: string
}

/** One competitor (or Sim itself) as a comparable profile. */
export interface CompetitorProfile {
  /** kebab-case identifier, e.g. "n8n", "openai-agentkit". */
  id: string
  /** Display name, e.g. "n8n", "OpenAI AgentKit". */
  name: string
  /** Marketing website root, used as the default citation target. */
  website: string
  /** One-sentence, neutral description of what the product is. */
  oneLiner: string
  /**
   * Whether this competitor is, categorically, a visual workflow/automation
   * builder like Sim. Defaults to `true` when omitted. Set `false` for a
   * product that isn't (an interactive desktop agent) or has documented
   * ambiguity about its current platform identity, so comparison-page FAQs
   * can ask a category-clarifying question instead of a peer feature-gap one.
   */
  isWorkflowBuilder?: boolean
  /** Logo icon and brand colors, when available. */
  brand?: CompetitorBrand
  /** Free-text list of standout features, each independently sourced. */
  standoutFeatures: Array<{
    title: string
    description: string
    /** A one-sentence (<~18 word) restatement of `description` for dense card UIs. Falls back to `description` when absent. */
    shortDescription?: string
    source: FactSource
  }>
  /** Free-text list of documented gaps/limitations, each independently sourced. */
  limitations: Array<{
    title: string
    description: string
    /** A one-sentence (<~18 word) restatement of `description` for dense card UIs. Falls back to `description` when absent. */
    shortDescription?: string
    source: FactSource
  }>
  facts: ComparisonFacts
}

/** A fact awaiting verification. Used as an intermediate research artifact, never shipped. */
export function unknownFact(reason?: string): Fact {
  return {
    value: 'Unknown',
    detail: reason,
    confidence: 'unknown',
    sources: [],
  }
}

/**
 * Broad grouping for {@link SimFeature} entries. A single feature catalog
 * entry belongs to exactly one category, but can carry additional
 * {@link SimFeature.tags} for cross-cutting filtering (e.g. an "enterprise"
 * tag on a feature that's primarily categorized as "security-compliance").
 */
export type FeatureCategory =
  | 'deployment-api'
  | 'human-in-the-loop'
  | 'enterprise-governance'
  | 'knowledge-base-search'
  | 'data-tables'
  | 'files'
  | 'ai-capabilities'
  | 'collaboration'
  | 'observability'
  | 'security-compliance'
  | 'environments-enterprise'
  | 'version-control'
  | 'durability-observability'
  | 'generative-media'
  | 'control-flow-execution'

/**
 * One entry in Sim's full feature catalog. Deliberately more granular than
 * {@link ComparisonFacts}, which only covers the small set of rows every
 * competitor page needs. The catalog is the superset a page builder can
 * filter down from (by category or tag) when a given "Sim vs X" page only
 * wants to surface the features relevant to that competitor.
 */
export interface SimFeature {
  /** kebab-case identifier, e.g. "streaming-api", "human-in-the-loop-approval". */
  id: string
  /** Display name, e.g. "Streaming API responses". */
  name: string
  category: FeatureCategory
  /** Additional cross-cutting labels for filtering (e.g. "enterprise", "beta"). */
  tags: string[]
  /** Neutral, factual description of what the feature does. */
  description: string
  /** Optional note on why this is differentiated vs. the competitive landscape. Must stay factual, not promotional. */
  competitiveNote?: string
  sources: FactSource[]
}

export function featuresByCategory(
  features: SimFeature[],
  category: FeatureCategory
): SimFeature[] {
  return features.filter((f) => f.category === category)
}

export function featuresByTag(features: SimFeature[], tag: string): SimFeature[] {
  return features.filter((f) => f.tags.includes(tag))
}
