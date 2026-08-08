import type { OutputProperty } from '@/tools/types'

/**
 * Nested shapes below are transcribed from the Dynatrace API reference so that
 * downstream blocks can reference a field directly rather than digging through
 * an opaque blob. A bare `type: 'json'` is used ONLY where the payload is
 * genuinely dynamic — a schema-defined settings value, a type-dependent entity
 * property bag, user-supplied metadata, or a shape the reference names without
 * expanding. Each of those carries a description saying so.
 */

/**
 * A raw `EntityStub` as it appears NESTED inside a passthrough blob — still in
 * the API's `{ entityId: { id, type }, name }` form, unlike the top-level stubs
 * which `mapEntityStub` flattens.
 */
const rawEntityStubProperties: Record<string, OutputProperty> = {
  entityId: {
    type: 'json',
    description: 'Identifier of the entity',
    properties: {
      id: { type: 'string', description: 'Entity ID' },
      type: { type: 'string', description: 'Entity type' },
    },
  },
  name: { type: 'string', description: 'Entity display name' },
}

/** A source-code location, as attached to attacks and code-level vulnerabilities. */
const codeLocationProperties: Record<string, OutputProperty> = {
  className: { type: 'string', description: 'Class the code sits in', nullable: true },
  fileName: { type: 'string', description: 'Source file', nullable: true },
  functionName: { type: 'string', description: 'Function name', nullable: true },
  displayName: { type: 'string', description: 'Human-readable location' },
  lineNumber: { type: 'number', description: 'Line number', nullable: true },
  columnNumber: { type: 'number', description: 'Column number', nullable: true },
  returnType: { type: 'string', description: 'Return type', nullable: true },
  parameterTypes: {
    type: 'json',
    description: 'Parameter types, with a truncation marker when the list was cut short',
  },
}

/** A vulnerable function reference. */
const vulnerableFunctionProperties: Record<string, OutputProperty> = {
  className: { type: 'string', description: 'Class the function sits in' },
  filePath: { type: 'string', description: 'Path to the source file' },
  functionName: { type: 'string', description: 'Function name' },
}

/** `EvidenceDetails` — root-cause evidence, present only when requested via Fields. */
const evidenceDetailsProperties: Record<string, OutputProperty> = {
  totalCount: { type: 'number', description: 'Number of evidence entries' },
  details: {
    type: 'array',
    description: 'The evidence entries themselves',
    items: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: 'Name of the evidence' },
        evidenceType: {
          type: 'string',
          description: 'AVAILABILITY_EVIDENCE, EVENT, MAINTENANCE_WINDOW, METRIC, or TRANSACTIONAL',
        },
        startTime: { type: 'number', description: 'Evidence start in UTC milliseconds' },
        rootCauseRelevant: {
          type: 'boolean',
          description: 'Whether Davis considered this evidence root-cause relevant',
        },
        entity: {
          type: 'json',
          description: 'Entity the evidence belongs to',
          properties: rawEntityStubProperties,
        },
        groupingEntity: {
          type: 'json',
          description: 'Entity the evidence is grouped under',
          properties: rawEntityStubProperties,
        },
      },
    },
  },
}

/** `ImpactAnalysis` — estimated user impact, present only when requested via Fields. */
const impactAnalysisProperties: Record<string, OutputProperty> = {
  impacts: {
    type: 'array',
    description: 'One entry per impacted application, service, or mobile app',
    items: {
      type: 'object',
      properties: {
        impactType: {
          type: 'string',
          description: 'APPLICATION, CUSTOM_APPLICATION, MOBILE, or SERVICE',
        },
        impactedEntity: {
          type: 'json',
          description: 'The impacted entity',
          properties: rawEntityStubProperties,
        },
        estimatedAffectedUsers: {
          type: 'number',
          description: 'Users Davis estimates were affected',
        },
      },
    },
  },
}

/** `CommentsList` — the paged comment envelope. */
const commentsListProperties: Record<string, OutputProperty> = {
  totalCount: { type: 'number', description: 'Total comments on the problem' },
  pageSize: { type: 'number', description: 'Comments in this page' },
  nextPageKey: { type: 'string', description: 'Cursor for the next page', nullable: true },
  comments: {
    type: 'array',
    description: 'The comments themselves',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Comment ID' },
        authorName: { type: 'string', description: 'Author of the comment' },
        content: { type: 'string', description: 'Comment text' },
        context: { type: 'string', description: 'Context of the comment', nullable: true },
        createdAtTimestamp: { type: 'number', description: 'Created in UTC milliseconds' },
      },
    },
  },
}

/** Davis risk assessment of a vulnerability. */
const riskAssessmentProperties: Record<string, OutputProperty> = {
  riskLevel: { type: 'string', description: 'CRITICAL, HIGH, MEDIUM, LOW, or NONE' },
  riskScore: { type: 'number', description: 'Davis risk score' },
  riskVector: { type: 'string', description: 'Risk vector string' },
  baseRiskLevel: { type: 'string', description: 'CVSS base risk level' },
  baseRiskScore: { type: 'number', description: 'CVSS base score' },
  baseRiskVector: { type: 'string', description: 'CVSS base vector' },
  exposure: { type: 'string', description: 'PUBLIC_NETWORK, NOT_DETECTED, or NOT_AVAILABLE' },
  dataAssets: { type: 'string', description: 'REACHABLE, NOT_DETECTED, or NOT_AVAILABLE' },
  publicExploit: { type: 'string', description: 'AVAILABLE or NOT_AVAILABLE' },
  vulnerableFunctionUsage: {
    type: 'string',
    description: 'IN_USE, NOT_IN_USE, or NOT_AVAILABLE',
  },
  assessmentAccuracy: { type: 'string', description: 'FULL, REDUCED, or NOT_AVAILABLE' },
  assessmentAccuracyDetails: {
    type: 'json',
    description: 'Why the assessment accuracy is reduced, as a reducedReasons array',
  },
}

/** Environment-wide counts attached to a vulnerability. */
const globalCountsProperties: Record<string, OutputProperty> = {
  affectedNodes: { type: 'number', description: 'Affected nodes' },
  affectedProcessGroups: { type: 'number', description: 'Affected process groups' },
  affectedProcessGroupInstances: {
    type: 'number',
    description: 'Affected process group instances',
  },
  exposedProcessGroups: { type: 'number', description: 'Publicly exposed process groups' },
  reachableDataAssets: { type: 'number', description: 'Reachable data assets' },
  relatedApplications: { type: 'number', description: 'Related applications' },
  relatedAttacks: { type: 'number', description: 'Related attacks' },
  relatedHosts: { type: 'number', description: 'Related hosts' },
  relatedKubernetesClusters: { type: 'number', description: 'Related Kubernetes clusters' },
  relatedKubernetesWorkloads: { type: 'number', description: 'Related Kubernetes workloads' },
  relatedServices: { type: 'number', description: 'Related services' },
  vulnerableComponents: { type: 'number', description: 'Vulnerable components' },
}

/** Code-level vulnerability detail. */
const codeLevelVulnerabilityDetailsProperties: Record<string, OutputProperty> = {
  type: {
    type: 'string',
    description: 'CMD_INJECTION, IMPROPER_INPUT_VALIDATION, SQL_INJECTION, or SSRF',
  },
  vulnerabilityLocation: { type: 'string', description: 'Where the vulnerability sits' },
  shortVulnerabilityLocation: { type: 'string', description: 'Shortened location' },
  vulnerableFunction: { type: 'string', description: 'The vulnerable function' },
  processGroupIds: {
    type: 'array',
    description: 'Process groups carrying the vulnerability',
    items: { type: 'string' },
  },
  processGroups: {
    type: 'array',
    description: 'Process group names',
    items: { type: 'string' },
  },
  vulnerableFunctionInput: {
    type: 'json',
    description: 'What reached the vulnerable function, as a type plus tainted input segments',
  },
}

/** A vulnerable component of a security problem or remediation item. */
const vulnerableComponentProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Component ID' },
  displayName: { type: 'string', description: 'Component display name' },
  shortName: { type: 'string', description: 'Short component name' },
  fileName: { type: 'string', description: 'File the component ships as' },
  numberOfAffectedEntities: { type: 'number', description: 'Entities affected by it' },
  affectedEntities: {
    type: 'array',
    description: 'IDs of the affected entities',
    items: { type: 'string' },
  },
}

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
    properties: evidenceDetailsProperties,
  },
  impactAnalysis: {
    type: 'json',
    description: 'Estimated user impact. Only present when requested via Fields',
    nullable: true,
    properties: impactAnalysisProperties,
  },
  recentComments: {
    type: 'json',
    description: 'Most recent comments. Only present when requested via Fields',
    nullable: true,
    properties: commentsListProperties,
  },
}

/** Monitored entity shape produced by `mapEntity`. */
export const entityProperties: Record<string, OutputProperty> = {
  entityId: { type: 'string', description: 'Entity ID (e.g., HOST-06F288EE2A930951)' },
  type: { type: 'string', description: 'Entity type (e.g., HOST, SERVICE)' },
  displayName: { type: 'string', description: 'Entity display name' },
  firstSeenTms: { type: 'number', description: 'First seen timestamp in UTC milliseconds' },
  lastSeenTms: { type: 'number', description: 'Last seen timestamp in UTC milliseconds' },
  properties: {
    type: 'json',
    description:
      'Entity properties. Keys depend on the entity type (a HOST and a SERVICE carry different ones), so the shape is dynamic',
  },
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
  icon: {
    type: 'json',
    description: 'Icon of the entity',
    nullable: true,
    properties: {
      customIconPath: { type: 'string', description: 'Path to a custom icon', nullable: true },
      primaryIconType: { type: 'string', description: 'Primary icon type' },
      secondaryIconType: { type: 'string', description: 'Secondary icon type', nullable: true },
    },
  },
  fromRelationships: {
    type: 'json',
    description:
      'Relationships originating at this entity, keyed by relationship name. Keys depend on the entity type',
  },
  toRelationships: {
    type: 'json',
    description:
      'Relationships pointing at this entity, keyed by relationship name. Keys depend on the entity type',
  },
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
  defaultAggregation: {
    type: 'json',
    description: 'Default aggregation',
    nullable: true,
    properties: {
      type: { type: 'string', description: 'Aggregation type, e.g. avg or percentile' },
      parameter: { type: 'number', description: 'Aggregation parameter', nullable: true },
    },
  },
  dimensionDefinitions: {
    type: 'array',
    description: 'Dimension definitions of the metric',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Dimension key' },
        name: { type: 'string', description: 'Dimension name' },
        displayName: { type: 'string', description: 'Human-readable dimension name' },
        index: { type: 'number', description: 'Dimension index', nullable: true },
        type: { type: 'string', description: 'Dimension value type' },
      },
    },
  },
  dimensionCardinalities: {
    type: 'array',
    description: 'Estimated dimension cardinalities',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Dimension key' },
        estimate: { type: 'number', description: 'Estimated distinct values' },
        relative: { type: 'number', description: 'Cardinality relative to the metric' },
      },
    },
  },
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
  metricValueType: {
    type: 'json',
    description: 'Value type of the metric',
    nullable: true,
    properties: { type: { type: 'string', description: 'Value type, e.g. score or unknown' } },
  },
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
  errorBudgetBurnRate: {
    type: 'json',
    description: 'Error budget burn rate',
    nullable: true,
    properties: {
      burnRateType: { type: 'string', description: 'FAST, SLOW, or NONE' },
      burnRateValue: { type: 'number', description: 'Current burn rate' },
      burnRateVisualizationEnabled: {
        type: 'boolean',
        description: 'Whether the burn rate is shown on the SLO',
      },
      estimatedTimeToConsumeErrorBudget: {
        type: 'number',
        description: 'Hours until the error budget is exhausted at this rate',
      },
      fastBurnThreshold: { type: 'number', description: 'Threshold considered a fast burn' },
      sloValue: { type: 'number', description: 'SLO value the burn rate was computed from' },
    },
  },
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
    properties: riskAssessmentProperties,
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
    properties: globalCountsProperties,
  },
  codeLevelVulnerabilityDetails: {
    type: 'json',
    description: 'Code-level vulnerability details. Only present when requested via Fields',
    nullable: true,
    properties: codeLevelVulnerabilityDetailsProperties,
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
  vulnerableComponents: {
    type: 'array',
    description: 'Vulnerable components',
    items: { type: 'object', properties: vulnerableComponentProperties },
  },
  filteredCounts: {
    type: 'json',
    description:
      'Counts within the management zone filter. The API reference names this FilteredCountsDto without expanding it, so the fields are not enumerated here',
    nullable: true,
  },
  events: {
    type: 'json',
    description:
      'Lifecycle events of the security problem. The reference names SecurityProblemEvent without expanding it',
  },
  entryPoints: {
    type: 'json',
    description:
      'Entry points into the vulnerability. The reference names EntryPoints without expanding it',
    nullable: true,
  },
  relatedEntities: {
    type: 'json',
    description: 'Related entities. The reference names RelatedEntitiesList without expanding it',
    nullable: true,
  },
  relatedAttacks: {
    type: 'json',
    description: 'Related attacks. The reference names RelatedAttacksList without expanding it',
    nullable: true,
  },
  relatedContainerImages: {
    type: 'json',
    description:
      'Related container images. The reference names RelatedContainerList without expanding it',
    nullable: true,
  },
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
  assessment: {
    type: 'json',
    description: 'Exposure and reachability assessment',
    nullable: true,
    properties: {
      assessmentAccuracy: { type: 'string', description: 'FULL, REDUCED, or NOT_AVAILABLE' },
      dataAssets: { type: 'string', description: 'REACHABLE, NOT_DETECTED, or NOT_AVAILABLE' },
      exposure: { type: 'string', description: 'PUBLIC_NETWORK, NOT_DETECTED, or NOT_AVAILABLE' },
      numberOfDataAssets: { type: 'number', description: 'Reachable data assets' },
      vulnerableFunctionUsage: {
        type: 'string',
        description: 'IN_USE, NOT_IN_USE, or NOT_AVAILABLE',
      },
      vulnerableFunctionRestartRequired: {
        type: 'boolean',
        description: 'Whether a restart is needed to pick up the fix',
      },
      assessmentAccuracyDetails: {
        type: 'json',
        description: 'Why accuracy is reduced',
        properties: {
          reducedReasons: {
            type: 'array',
            description:
              'LIMITED_AGENT_SUPPORT, LIMITED_BY_CONFIGURATION, or LIMITED_BY_SERVICE_DETECTION_V2',
            items: { type: 'string' },
          },
        },
      },
      vulnerableFunctionsInUse: {
        type: 'array',
        description: 'Vulnerable functions in use',
        items: { type: 'object', properties: vulnerableFunctionProperties },
      },
      vulnerableFunctionsNotInUse: {
        type: 'array',
        description: 'Vulnerable functions not in use',
        items: { type: 'object', properties: vulnerableFunctionProperties },
      },
      vulnerableFunctionsNotAvailable: {
        type: 'array',
        description: 'Vulnerable functions whose usage could not be determined',
        items: { type: 'object', properties: vulnerableFunctionProperties },
      },
    },
  },
  muteState: {
    type: 'json',
    description: 'Mute state, reason, and author',
    nullable: true,
    properties: {
      muted: { type: 'boolean', description: 'Whether the item is muted' },
      reason: {
        type: 'string',
        description:
          'AFFECTED, CONFIGURATION_NOT_AFFECTED, FALSE_POSITIVE, IGNORE, INITIAL_STATE, OTHER, or VULNERABLE_CODE_NOT_IN_USE',
      },
      comment: { type: 'string', description: 'Comment recorded with the mute', nullable: true },
      user: { type: 'string', description: 'Who set the mute state' },
      lastUpdatedTimestamp: { type: 'number', description: 'Last change in UTC milliseconds' },
    },
  },
  remediationProgress: {
    type: 'json',
    description: 'Affected and unaffected entities',
    nullable: true,
    properties: {
      affectedEntities: {
        type: 'array',
        description: 'Entities still affected',
        items: { type: 'string' },
      },
      unaffectedEntities: {
        type: 'array',
        description: 'Entities already remediated',
        items: { type: 'string' },
      },
    },
  },
  trackingLink: {
    type: 'json',
    description: 'External tracking link',
    nullable: true,
    properties: {
      url: { type: 'string', description: 'Link to the tracking ticket' },
      displayName: { type: 'string', description: 'Label for the link' },
      user: { type: 'string', description: 'Who set the link' },
      lastUpdatedTimestamp: { type: 'number', description: 'Last change in UTC milliseconds' },
    },
  },
  vulnerableComponents: {
    type: 'array',
    description: 'Vulnerable components of the item',
    items: { type: 'object', properties: vulnerableComponentProperties },
  },
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
  attackTarget: {
    type: 'json',
    description: 'Targeted host or database',
    nullable: true,
    properties: {
      entityId: { type: 'string', description: 'ID of the targeted entity' },
      name: { type: 'string', description: 'Name of the targeted entity' },
    },
  },
  attacker: {
    type: 'json',
    description: 'Source IP and geo location',
    nullable: true,
    properties: {
      sourceIp: { type: 'string', description: 'Source IP of the attack' },
      location: {
        type: 'json',
        description: 'Geo location of the source IP',
        properties: {
          city: { type: 'string', description: 'City', nullable: true },
          country: { type: 'string', description: 'Country', nullable: true },
          countryCode: { type: 'string', description: 'ISO country code', nullable: true },
        },
      },
    },
  },
  affectedEntities: {
    type: 'json',
    description: 'Affected process groups',
    nullable: true,
    properties: {
      processGroup: {
        type: 'json',
        description: 'Affected process group',
        properties: {
          id: { type: 'string', description: 'Process group ID' },
          name: { type: 'string', description: 'Process group name' },
        },
      },
      processGroupInstance: {
        type: 'json',
        description: 'Affected process group instance',
        properties: {
          id: { type: 'string', description: 'Process group instance ID' },
          name: { type: 'string', description: 'Process group instance name' },
        },
      },
    },
  },
  entrypoint: {
    type: 'json',
    description: 'Entry point and payload',
    nullable: true,
    properties: {
      codeLocation: {
        type: 'json',
        description: 'Where in the code the attack entered',
        properties: codeLocationProperties,
      },
      entrypointFunction: {
        type: 'json',
        description: 'The entry-point function',
        properties: codeLocationProperties,
      },
      payload: {
        type: 'array',
        description: 'Payload values passed in',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Payload parameter name' },
            type: { type: 'string', description: 'Payload parameter type' },
            value: { type: 'string', description: 'Payload parameter value' },
          },
        },
      },
    },
  },
  request: {
    type: 'json',
    description: 'The offending request',
    nullable: true,
    properties: {
      host: { type: 'string', description: 'Host the request hit' },
      path: { type: 'string', description: 'Request path' },
      url: { type: 'string', description: 'Full request URL' },
      protocolDetails: {
        type: 'json',
        description: 'Protocol-specific detail, including HTTP method, headers, and parameters',
      },
    },
  },
  securityProblem: {
    type: 'json',
    description: 'Related security problem',
    nullable: true,
    properties: {
      securityProblemId: { type: 'string', description: 'ID of the exploited security problem' },
      assessment: {
        type: 'json',
        description: 'Exposure assessment at the time of the attack',
        properties: {
          dataAssets: { type: 'string', description: 'Data asset reachability' },
          exposure: { type: 'string', description: 'Network exposure' },
          numberOfReachableDataAssets: {
            type: 'number',
            description: 'Reachable data assets',
          },
        },
      },
    },
  },
  vulnerability: {
    type: 'json',
    description: 'Exploited vulnerability',
    nullable: true,
    properties: {
      vulnerabilityId: { type: 'string', description: 'ID of the vulnerability' },
      displayName: { type: 'string', description: 'Vulnerability display name' },
      codeLocation: {
        type: 'json',
        description: 'Where the vulnerability sits in the code',
        properties: codeLocationProperties,
      },
      vulnerableFunction: {
        type: 'json',
        description: 'The vulnerable function',
        properties: codeLocationProperties,
      },
      vulnerableFunctionInput: {
        type: 'json',
        description: 'The tainted input that reached the vulnerable function',
      },
    },
  },
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
  value: {
    type: 'json',
    description:
      'The configuration itself. Its shape is defined by the object schema, so it is genuinely dynamic — read an existing object of the same schema to learn the fields',
  },
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
