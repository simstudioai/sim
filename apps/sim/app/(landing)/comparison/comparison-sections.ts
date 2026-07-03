import type { ComparisonFacts, CompetitorProfile, Fact } from '@/lib/compare/data'

/**
 * The one place a {@link ComparisonFacts} group is read back out of a profile
 * by group key. Every render-side consumer (the table, key-differences strip,
 * JSON-LD builder) needs this same lookup; centralizing it here means there is
 * exactly one cast to reason about instead of one per call site.
 */
export function getFactGroup<G extends keyof ComparisonFacts>(
  profile: CompetitorProfile,
  group: G
): Record<string, Fact> {
  return profile.facts[group] as Record<string, Fact>
}

/**
 * One row in a comparison table section. Maps a human label to a fact key
 * within a {@link ComparisonFacts} group. `key` is intentionally `string`
 * (rather than a per-group `keyof` union) so a single array can hold rows
 * for every group without TypeScript collapsing the distributed generic to
 * `never`; correctness is enforced once, by construction, in
 * {@link COMPARISON_SECTIONS} below, and the renderer reads through it.
 */
export interface ComparisonRowDef {
  key: string
  label: string
}

/** One section of the comparison table, mirroring a {@link ComparisonFacts} group. */
export interface ComparisonSectionDef {
  group: keyof ComparisonFacts
  title: string
  rows: ComparisonRowDef[]
}

/**
 * Type-checks a section's rows against its own group's actual fact keys
 * (via the per-call generic `G`), then widens to the plain `ComparisonRowDef`
 * shape used by {@link COMPARISON_SECTIONS}. This is where row-key
 * correctness is actually enforced. A typo here fails the build.
 */
function defineSection<G extends keyof ComparisonFacts>(section: {
  group: G
  title: string
  rows: Array<{ key: keyof ComparisonFacts[G]; label: string }>
}): ComparisonSectionDef {
  return section as ComparisonSectionDef
}

/**
 * Canonical section/row order for rendering a {@link ComparisonFacts} profile
 * pair as a table. Single source of truth for row labels. Add a field here
 * once and every comparison page picks it up.
 */
export const COMPARISON_SECTIONS: ComparisonSectionDef[] = [
  defineSection({
    group: 'platform',
    title: 'Platform',
    rows: [
      { key: 'builderType', label: 'Builder type' },
      { key: 'learningCurve', label: 'Learning curve' },
      { key: 'selfHostOption', label: 'Self-hosting' },
      { key: 'deploymentOptions', label: 'Deployment options' },
      { key: 'templates', label: 'Templates' },
      { key: 'license', label: 'License' },
      { key: 'environmentPromotion', label: 'Environment promotion' },
      { key: 'versionControlDepth', label: 'Version control' },
      { key: 'realtimeCollaboration', label: 'Realtime collaboration' },
      { key: 'nativeFileStorage', label: 'Native file storage' },
    ],
  }),
  defineSection({
    group: 'pricing',
    title: 'Pricing',
    rows: [
      { key: 'pricingModel', label: 'Pricing model' },
      { key: 'entryPaidPlan', label: 'Entry paid plan' },
      { key: 'freeTier', label: 'Free tier' },
      { key: 'byok', label: 'Bring your own key' },
    ],
  }),
  defineSection({
    group: 'security',
    title: 'Security & compliance',
    rows: [
      { key: 'soc2', label: 'SOC 2' },
      { key: 'dataResidency', label: 'Data residency' },
      { key: 'rbac', label: 'Role-based access control' },
      { key: 'auditLogging', label: 'Audit logging' },
      { key: 'additionalCompliance', label: 'Additional compliance' },
      { key: 'modelAndToolGovernance', label: 'Model & tool governance' },
      { key: 'credentialGovernance', label: 'Credential governance' },
      { key: 'sso', label: 'Single sign-on (SSO)' },
      { key: 'piiRedaction', label: 'PII redaction' },
      { key: 'dataRetention', label: 'Custom data retention' },
      { key: 'whiteLabeling', label: 'White-labeling' },
    ],
  }),
  defineSection({
    group: 'aiCapabilities',
    title: 'AI capabilities',
    rows: [
      { key: 'multiLlmSupport', label: 'Multi-LLM support' },
      { key: 'agentReasoningBlocks', label: 'Agent reasoning blocks' },
      { key: 'naturalLanguageBuilding', label: 'Natural-language building' },
      { key: 'knowledgeBaseRag', label: 'Knowledge base / RAG' },
      { key: 'mcpSupport', label: 'MCP support' },
      { key: 'evaluationGuardrails', label: 'Evaluation & guardrails' },
      { key: 'humanInTheLoop', label: 'Human-in-the-loop' },
      { key: 'generativeMedia', label: 'Generative media' },
      { key: 'dynamicToolUse', label: 'Dynamic tool use' },
      { key: 'modelFallback', label: 'Automatic model fallback' },
      { key: 'agentSkills', label: 'Agent skills' },
      { key: 'nativeChatDeployment', label: 'Native chat deployment' },
      { key: 'parallelExecution', label: 'Parallel execution' },
      { key: 'a2aProtocol', label: 'Agent2Agent (A2A) protocol' },
    ],
  }),
  defineSection({
    group: 'integrations',
    title: 'Integrations',
    rows: [
      { key: 'integrationCount', label: 'Integrations' },
      { key: 'triggerTypes', label: 'Trigger types' },
      { key: 'customCodeSteps', label: 'Custom code steps' },
      { key: 'apiPublishing', label: 'API publishing' },
      { key: 'extensibilitySdk', label: 'SDKs & extensibility' },
      { key: 'mcpPublishing', label: 'Publish as MCP server' },
    ],
  }),
  defineSection({
    group: 'observability',
    title: 'Observability & durability',
    rows: [
      { key: 'tracingDepth', label: 'Tracing & observability' },
      { key: 'durabilityModel', label: 'Durability & retries' },
      { key: 'failureAlerting', label: 'Failure alerting' },
      { key: 'dataDrains', label: 'Data drains' },
      { key: 'asyncExecution', label: 'Async execution' },
      { key: 'executionLimits', label: 'Execution limits' },
      { key: 'partialFailureHandling', label: 'Partial-failure handling' },
    ],
  }),
  defineSection({
    group: 'support',
    title: 'Support',
    rows: [
      { key: 'supportChannels', label: 'Support channels' },
      { key: 'sla', label: 'SLA' },
      { key: 'community', label: 'Community' },
      { key: 'academy', label: 'Academy / training' },
    ],
  }),
]
