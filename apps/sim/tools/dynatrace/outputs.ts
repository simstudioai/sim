import type { OutputProperty } from '@/tools/types'

/** Flattened `EntityStub` shape produced by `mapEntityStub`. */
export const entityStubProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Entity ID', nullable: true },
  type: { type: 'string', description: 'Entity type', nullable: true },
  name: { type: 'string', description: 'Entity display name', nullable: true },
}

/** `METag` shape. */
export const tagProperties: Record<string, OutputProperty> = {
  context: { type: 'string', description: 'Tag origin (e.g., AWS, KUBERNETES, CONTEXTLESS)' },
  key: { type: 'string', description: 'Tag key' },
  value: { type: 'string', description: 'Tag value', nullable: true },
  stringRepresentation: { type: 'string', description: 'Tag rendered as a string' },
}

/** Short management zone shape. */
export const managementZoneProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Management zone ID' },
  name: { type: 'string', description: 'Management zone name' },
}

/** Problem comment shape. */
export const commentProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Comment ID' },
  authorName: { type: 'string', description: 'Name of the comment author' },
  content: { type: 'string', description: 'Comment text' },
  context: { type: 'string', description: 'Context of the comment', nullable: true },
  createdAtTimestamp: {
    type: 'number',
    description: 'Creation timestamp in UTC milliseconds',
  },
}

/** Problem shape produced by `mapProblem`. */
export const problemProperties: Record<string, OutputProperty> = {
  problemId: { type: 'string', description: 'Problem ID' },
  displayId: { type: 'string', description: 'Human-readable problem ID (e.g., P-2401234)' },
  title: { type: 'string', description: 'Problem title' },
  status: { type: 'string', description: 'Problem status: OPEN or CLOSED' },
  severityLevel: {
    type: 'string',
    description:
      'AVAILABILITY, CUSTOM_ALERT, ERROR, INFO, MONITORING_UNAVAILABLE, PERFORMANCE, or RESOURCE_CONTENTION',
  },
  impactLevel: {
    type: 'string',
    description: 'APPLICATION, ENVIRONMENT, INFRASTRUCTURE, or SERVICES',
  },
  startTime: { type: 'number', description: 'Problem start in UTC milliseconds' },
  endTime: {
    type: 'number',
    description: 'Problem end in UTC milliseconds, or -1 while the problem is open',
  },
  rootCauseEntity: {
    type: 'object',
    description: 'Entity Dynatrace determined to be the root cause',
    nullable: true,
    properties: entityStubProperties,
  },
  affectedEntities: {
    type: 'array',
    description: 'Entities affected by the problem',
    items: { type: 'object', properties: entityStubProperties },
  },
  impactedEntities: {
    type: 'array',
    description: 'Entities impacted by the problem',
    items: { type: 'object', properties: entityStubProperties },
  },
  managementZones: {
    type: 'array',
    description: 'Management zones the problem belongs to',
    items: { type: 'object', properties: managementZoneProperties },
  },
  entityTags: {
    type: 'array',
    description: 'Tags of the affected entities',
    items: { type: 'object', properties: tagProperties },
  },
  problemFilters: {
    type: 'array',
    description: 'Alerting profiles that matched the problem',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Alerting profile ID' },
        name: { type: 'string', description: 'Alerting profile name' },
      },
    },
  },
  linkedProblemInfo: {
    type: 'object',
    description: 'The problem this one is linked to',
    nullable: true,
    properties: {
      problemId: { type: 'string', description: 'Linked problem ID' },
      displayId: { type: 'string', description: 'Linked problem display ID' },
    },
  },
  evidenceDetails: {
    type: 'json',
    description: 'Evidence behind the problem. Only present when requested via Fields',
    nullable: true,
  },
  impactAnalysis: {
    type: 'json',
    description: 'Estimated user impact. Only present when requested via Fields',
    nullable: true,
  },
  recentComments: {
    type: 'json',
    description: 'Most recent comments. Only present when requested via Fields',
    nullable: true,
  },
}

/** Monitored entity shape produced by `mapEntity`. */
export const entityProperties: Record<string, OutputProperty> = {
  entityId: { type: 'string', description: 'Entity ID (e.g., HOST-06F288EE2A930951)' },
  type: { type: 'string', description: 'Entity type (e.g., HOST, SERVICE)' },
  displayName: { type: 'string', description: 'Entity display name' },
  firstSeenTms: { type: 'number', description: 'First seen timestamp in UTC milliseconds' },
  lastSeenTms: { type: 'number', description: 'Last seen timestamp in UTC milliseconds' },
  properties: { type: 'json', description: 'Type-specific entity properties' },
  tags: {
    type: 'array',
    description: 'Tags of the entity',
    items: { type: 'object', properties: tagProperties },
  },
  managementZones: {
    type: 'array',
    description: 'Management zones of the entity',
    items: { type: 'object', properties: managementZoneProperties },
  },
  icon: { type: 'json', description: 'Icon of the entity', nullable: true },
  fromRelationships: { type: 'json', description: 'Relationships originating at this entity' },
  toRelationships: { type: 'json', description: 'Relationships pointing at this entity' },
}

/** Event shape produced by `mapEvent`. */
export const eventProperties: Record<string, OutputProperty> = {
  eventId: { type: 'string', description: 'Event ID' },
  eventType: { type: 'string', description: 'Event type' },
  title: { type: 'string', description: 'Event title' },
  startTime: { type: 'number', description: 'Event start in UTC milliseconds' },
  endTime: { type: 'number', description: 'Event end in UTC milliseconds', nullable: true },
  status: { type: 'string', description: 'Event status: OPEN or CLOSED' },
  correlationId: { type: 'string', description: 'Correlation ID of the event', nullable: true },
  frequentEvent: { type: 'boolean', description: 'Whether the event is a frequent event' },
  underMaintenance: {
    type: 'boolean',
    description: 'Whether the event occurred during a maintenance window',
  },
  suppressAlert: { type: 'boolean', description: 'Whether alerting is suppressed' },
  suppressProblem: { type: 'boolean', description: 'Whether problem creation is suppressed' },
  entityId: {
    type: 'object',
    description: 'Entity the event belongs to',
    nullable: true,
    properties: entityStubProperties,
  },
  properties: {
    type: 'array',
    description: 'Event properties',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Property key' },
        value: { type: 'string', description: 'Property value' },
      },
    },
  },
  managementZones: {
    type: 'array',
    description: 'Management zones of the event',
    items: { type: 'object', properties: managementZoneProperties },
  },
  entityTags: {
    type: 'array',
    description: 'Tags of the related entity',
    items: { type: 'object', properties: tagProperties },
  },
}

/** Metric descriptor shape produced by `mapMetricDescriptor`. */
export const metricDescriptorProperties: Record<string, OutputProperty> = {
  metricId: { type: 'string', description: 'Metric key, including any transformations' },
  displayName: { type: 'string', description: 'Metric display name', nullable: true },
  description: { type: 'string', description: 'Metric description', nullable: true },
  unit: { type: 'string', description: 'Metric unit', nullable: true },
  unitDisplayFormat: { type: 'string', description: 'Preferred unit format', nullable: true },
  tags: { type: 'array', description: 'Metric tags', items: { type: 'string' } },
  billable: { type: 'boolean', description: 'Whether the metric is billable', nullable: true },
  dduBillable: { type: 'boolean', description: 'Whether the metric consumes DDUs', nullable: true },
  created: { type: 'number', description: 'Creation timestamp in UTC ms', nullable: true },
  lastWritten: { type: 'number', description: 'Last write timestamp in UTC ms', nullable: true },
  aggregationTypes: {
    type: 'array',
    description: 'Supported aggregations',
    items: { type: 'string' },
  },
  defaultAggregation: { type: 'json', description: 'Default aggregation', nullable: true },
  dimensionDefinitions: { type: 'json', description: 'Dimension definitions of the metric' },
  dimensionCardinalities: { type: 'json', description: 'Estimated dimension cardinalities' },
  transformations: {
    type: 'array',
    description: 'Supported transformations',
    items: { type: 'string' },
  },
  entityType: {
    type: 'array',
    description: 'Entity types the metric can be split by',
    items: { type: 'string' },
  },
  minimumValue: { type: 'number', description: 'Smallest allowed value', nullable: true },
  maximumValue: { type: 'number', description: 'Largest allowed value', nullable: true },
  rootCauseRelevant: { type: 'boolean', description: 'Root-cause relevant', nullable: true },
  impactRelevant: { type: 'boolean', description: 'Impact relevant', nullable: true },
  metricValueType: { type: 'json', description: 'Value type of the metric', nullable: true },
  latency: { type: 'number', description: 'Expected write latency in minutes', nullable: true },
  metricSelector: {
    type: 'string',
    description: 'Selector the descriptor was resolved from',
    nullable: true,
  },
  scalar: { type: 'boolean', description: 'Whether the result is a single value', nullable: true },
  resolutionInfSupported: {
    type: 'boolean',
    description: 'Whether resolution=Inf is supported',
    nullable: true,
  },
  warnings: { type: 'array', description: 'Warnings for this metric', items: { type: 'string' } },
}

/** SLO shape produced by `mapSlo`. */
export const sloProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'SLO ID' },
  name: { type: 'string', description: 'SLO name' },
  description: { type: 'string', description: 'SLO description', nullable: true },
  enabled: { type: 'boolean', description: 'Whether the SLO is enabled' },
  target: { type: 'number', description: 'Target success rate' },
  warning: { type: 'number', description: 'Warning threshold' },
  timeframe: { type: 'string', description: 'Evaluation timeframe of the SLO' },
  filter: { type: 'string', description: 'Entity filter of the SLO', nullable: true },
  evaluationType: { type: 'string', description: 'Evaluation type of the SLO' },
  evaluatedPercentage: { type: 'number', description: 'Calculated SLO value', nullable: true },
  status: { type: 'string', description: 'SLO status: SUCCESS, WARNING, or FAILURE' },
  error: { type: 'string', description: 'Error that prevented evaluation', nullable: true },
  errorBudget: { type: 'number', description: 'Remaining error budget', nullable: true },
  errorBudgetBurnRate: { type: 'json', description: 'Error budget burn rate', nullable: true },
  metricKey: { type: 'string', description: 'Metric key of the SLO', nullable: true },
  metricName: { type: 'string', description: 'Metric name of the SLO', nullable: true },
  metricExpression: { type: 'string', description: 'Metric expression', nullable: true },
  relatedOpenProblems: { type: 'number', description: 'Open related problems', nullable: true },
  relatedTotalProblems: { type: 'number', description: 'Total related problems', nullable: true },
}

/** Security problem shape produced by `mapSecurityProblem`. */
export const securityProblemProperties: Record<string, OutputProperty> = {
  securityProblemId: { type: 'string', description: 'Security problem ID' },
  displayId: { type: 'string', description: 'Human-readable security problem ID' },
  status: { type: 'string', description: 'Status: OPEN or RESOLVED' },
  muted: { type: 'boolean', description: 'Whether the security problem is muted' },
  title: { type: 'string', description: 'Security problem title' },
  technology: {
    type: 'string',
    description: 'DOTNET, GO, JAVA, KUBERNETES, NODE_JS, PHP, or PYTHON',
  },
  vulnerabilityType: { type: 'string', description: 'CODE_LEVEL, RUNTIME, or THIRD_PARTY' },
  packageName: { type: 'string', description: 'Affected package name', nullable: true },
  externalVulnerabilityId: {
    type: 'string',
    description: 'External vulnerability ID',
    nullable: true,
  },
  cveIds: { type: 'array', description: 'Related CVE IDs', items: { type: 'string' } },
  url: { type: 'string', description: 'Link to the security problem in Dynatrace', nullable: true },
  firstSeenTimestamp: { type: 'number', description: 'First seen in UTC milliseconds' },
  lastUpdatedTimestamp: { type: 'number', description: 'Last update in UTC milliseconds' },
  lastOpenedTimestamp: {
    type: 'number',
    description: 'Last opened in UTC milliseconds',
    nullable: true,
  },
  lastResolvedTimestamp: {
    type: 'number',
    description: 'Last resolved in UTC milliseconds',
    nullable: true,
  },
  riskAssessment: {
    type: 'json',
    description: 'Davis risk assessment. Only present when requested via Fields',
    nullable: true,
  },
  managementZones: {
    type: 'array',
    description: 'Management zones. Only present when requested via Fields',
    items: { type: 'object', properties: managementZoneProperties },
  },
  globalCounts: {
    type: 'json',
    description: 'Global affected-entity counts. Only present when requested via Fields',
    nullable: true,
  },
  codeLevelVulnerabilityDetails: {
    type: 'json',
    description: 'Code-level vulnerability details. Only present when requested via Fields',
    nullable: true,
  },
}

/** Additional fields the single security problem endpoint returns. */
export const securityProblemDetailsProperties: Record<string, OutputProperty> = {
  ...securityProblemProperties,
  description: { type: 'string', description: 'Vulnerability description', nullable: true },
  remediationDescription: {
    type: 'string',
    description: 'How to remediate the vulnerability',
    nullable: true,
  },
  muteStateChangeInProgress: {
    type: 'boolean',
    description: 'Whether a mute state change is in progress',
    nullable: true,
  },
  affectedEntities: {
    type: 'array',
    description: 'IDs of affected process group instances',
    items: { type: 'string' },
  },
  exposedEntities: {
    type: 'array',
    description: 'IDs of publicly exposed entities',
    items: { type: 'string' },
  },
  reachableDataAssets: {
    type: 'array',
    description: 'IDs of entities with reachable data assets',
    items: { type: 'string' },
  },
  vulnerableComponents: { type: 'json', description: 'Vulnerable components' },
  filteredCounts: {
    type: 'json',
    description: 'Counts within the management zone filter',
    nullable: true,
  },
  events: { type: 'json', description: 'Lifecycle events of the security problem' },
  entryPoints: { type: 'json', description: 'Entry points into the vulnerability', nullable: true },
  relatedEntities: { type: 'json', description: 'Related entities', nullable: true },
  relatedAttacks: { type: 'json', description: 'Related attacks', nullable: true },
  relatedContainerImages: { type: 'json', description: 'Related container images', nullable: true },
}

/** Shared pagination outputs of the Environment API v2 list endpoints. */
export const totalCountOutput: OutputProperty = {
  type: 'number',
  description: 'Total number of matching entries',
  nullable: true,
}

export const pageSizeOutput: OutputProperty = {
  type: 'number',
  description: 'Number of entries in this page',
  nullable: true,
}

export const nextPageKeyOutput: OutputProperty = {
  type: 'string',
  description: 'Cursor for the next page. Null on the last page',
  nullable: true,
}

export const warningsOutput: OutputProperty = {
  type: 'array',
  description: 'Warnings returned alongside the result',
  items: { type: 'string' },
}

/** Per-problem summary a batch mute/unmute returns. */
export const muteSummaryOutput: OutputProperty = {
  type: 'array',
  description: 'One entry per requested security problem',
  items: {
    type: 'object',
    properties: {
      securityProblemId: { type: 'string', description: 'Security problem ID' },
      muteStateChangeTriggered: {
        type: 'boolean',
        description: 'False when the problem was already in the requested state',
      },
      reason: {
        type: 'string',
        description: 'ALREADY_MUTED or ALREADY_UNMUTED when no change was triggered',
        nullable: true,
      },
    },
  },
}

/** Remediation item shape produced by `mapRemediationItem`. */
export const remediationItemProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Remediation item ID' },
  name: { type: 'string', description: 'Name of the affected component' },
  entityIds: {
    type: 'array',
    description: 'Entities the remediation item covers',
    items: { type: 'string' },
  },
  firstAffectedTimestamp: {
    type: 'number',
    description: 'First affected, in UTC milliseconds',
    nullable: true,
  },
  resolvedTimestamp: {
    type: 'number',
    description: 'Resolved, in UTC milliseconds',
    nullable: true,
  },
  vulnerabilityState: { type: 'string', description: 'VULNERABLE or RESOLVED' },
  assessment: { type: 'json', description: 'Exposure and reachability assessment', nullable: true },
  muteState: { type: 'json', description: 'Mute state, reason, and author', nullable: true },
  remediationProgress: {
    type: 'json',
    description: 'Affected and unaffected entities',
    nullable: true,
  },
  trackingLink: { type: 'json', description: 'External tracking link', nullable: true },
  vulnerableComponents: { type: 'json', description: 'Vulnerable components of the item' },
}

/** Attack shape produced by `mapAttack`. */
export const attackProperties: Record<string, OutputProperty> = {
  attackId: { type: 'string', description: 'Attack ID' },
  displayId: { type: 'string', description: 'Human-readable attack ID' },
  displayName: { type: 'string', description: 'Attack display name' },
  attackType: {
    type: 'string',
    description: 'COMMAND_INJECTION, JNDI_INJECTION, SQL_INJECTION, or SSRF',
  },
  state: { type: 'string', description: 'ALLOWLISTED, BLOCKED, or EXPLOITED' },
  technology: { type: 'string', description: 'DOTNET, GO, JAVA, or NODE_JS' },
  timestamp: { type: 'number', description: 'Occurrence time in UTC milliseconds' },
  attackTarget: { type: 'json', description: 'Targeted host or database', nullable: true },
  attacker: { type: 'json', description: 'Source IP and geo location', nullable: true },
  affectedEntities: { type: 'json', description: 'Affected process groups', nullable: true },
  entrypoint: { type: 'json', description: 'Entry point and payload', nullable: true },
  request: { type: 'json', description: 'The offending request', nullable: true },
  securityProblem: { type: 'json', description: 'Related security problem', nullable: true },
  vulnerability: { type: 'json', description: 'Exploited vulnerability', nullable: true },
  managementZones: {
    type: 'array',
    description: 'Management zones of the attack',
    items: { type: 'object', properties: managementZoneProperties },
  },
}

/** Settings schema descriptor shape. */
export const settingsSchemaProperties: Record<string, OutputProperty> = {
  schemaId: { type: 'string', description: 'Schema ID (e.g., builtin:alerting.profile)' },
  displayName: { type: 'string', description: 'Human-readable schema name', nullable: true },
  latestSchemaVersion: { type: 'string', description: 'Latest schema version', nullable: true },
  maturity: {
    type: 'string',
    description: 'GENERAL_AVAILABILITY, EARLY_ADOPTER, or PREVIEW',
    nullable: true,
  },
  multiObject: {
    type: 'boolean',
    description: 'Whether a scope may hold several objects of this schema',
    nullable: true,
  },
  ordered: { type: 'boolean', description: 'Whether objects are ordered', nullable: true },
  ownerBasedAccessControl: {
    type: 'boolean',
    description: 'Whether owner-based access control applies',
    nullable: true,
  },
}

/** Settings object shape. */
export const settingsObjectProperties: Record<string, OutputProperty> = {
  objectId: { type: 'string', description: 'Settings object ID' },
  schemaId: { type: 'string', description: 'Schema the object belongs to' },
  schemaVersion: { type: 'string', description: 'Schema version', nullable: true },
  scope: { type: 'string', description: 'Scope the object applies to' },
  value: { type: 'json', description: 'The configuration itself, shaped by its schema' },
  author: { type: 'string', description: 'Who created the object', nullable: true },
  created: { type: 'number', description: 'Creation time in UTC milliseconds', nullable: true },
  modified: { type: 'number', description: 'Last change in UTC milliseconds', nullable: true },
  updateToken: {
    type: 'string',
    description: 'Optimistic-concurrency token to pass back on update or delete',
    nullable: true,
  },
  externalId: { type: 'string', description: 'External ID, if set', nullable: true },
  summary: { type: 'string', description: 'Short summary of the object', nullable: true },
  searchSummary: { type: 'string', description: 'Searchable summary', nullable: true },
}

/** Synthetic monitor short representation. */
export const syntheticMonitorProperties: Record<string, OutputProperty> = {
  entityId: { type: 'string', description: 'Monitor entity ID (e.g., SYNTHETIC_TEST-...)' },
  name: { type: 'string', description: 'Monitor name' },
  type: { type: 'string', description: 'BROWSER or HTTP' },
  enabled: { type: 'boolean', description: 'Whether the monitor is enabled' },
}
