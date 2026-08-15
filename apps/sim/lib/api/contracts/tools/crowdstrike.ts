import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { CrowdStrikeAggregateQuery } from '@/tools/crowdstrike/types'

const crowdstrikeNullableStringSchema = z.string().nullable()
const crowdstrikeNullableNumberSchema = z.number().nullable()

const crowdstrikePaginationSchema = z
  .object({
    limit: crowdstrikeNullableNumberSchema,
    offset: crowdstrikeNullableNumberSchema,
    total: crowdstrikeNullableNumberSchema,
  })
  .nullable()

const crowdstrikeSensorSchema = z.object({
  agentVersion: crowdstrikeNullableStringSchema,
  cid: crowdstrikeNullableStringSchema,
  deviceId: crowdstrikeNullableStringSchema,
  heartbeatTime: crowdstrikeNullableNumberSchema,
  hostname: crowdstrikeNullableStringSchema,
  idpPolicyId: crowdstrikeNullableStringSchema,
  idpPolicyName: crowdstrikeNullableStringSchema,
  ipAddress: crowdstrikeNullableStringSchema,
  kerberosConfig: crowdstrikeNullableStringSchema,
  ldapConfig: crowdstrikeNullableStringSchema,
  ldapsConfig: crowdstrikeNullableStringSchema,
  machineDomain: crowdstrikeNullableStringSchema,
  ntlmConfig: crowdstrikeNullableStringSchema,
  osVersion: crowdstrikeNullableStringSchema,
  rdpToDcConfig: crowdstrikeNullableStringSchema,
  smbToDcConfig: crowdstrikeNullableStringSchema,
  status: crowdstrikeNullableStringSchema,
  statusCauses: z.array(z.string()),
  tiEnabled: crowdstrikeNullableStringSchema,
})

const crowdstrikeAggregateBucketSchema = z.object({
  count: crowdstrikeNullableNumberSchema,
  from: crowdstrikeNullableNumberSchema,
  keyAsString: crowdstrikeNullableStringSchema,
  label: z.unknown().nullable(),
  stringFrom: crowdstrikeNullableStringSchema,
  stringTo: crowdstrikeNullableStringSchema,
  subAggregates: z.array(z.unknown()),
  to: crowdstrikeNullableNumberSchema,
  value: crowdstrikeNullableNumberSchema,
  valueAsString: crowdstrikeNullableStringSchema,
})

const crowdstrikeAggregateResultSchema = z.object({
  buckets: z.array(crowdstrikeAggregateBucketSchema),
  docCountErrorUpperBound: crowdstrikeNullableNumberSchema,
  name: crowdstrikeNullableStringSchema,
  sumOtherDocCount: crowdstrikeNullableNumberSchema,
})

const crowdstrikeSensorsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    count: z.number(),
    pagination: crowdstrikePaginationSchema,
    sensors: z.array(crowdstrikeSensorSchema),
  }),
})

const crowdstrikeAggregatesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    aggregates: z.array(crowdstrikeAggregateResultSchema),
    count: z.number(),
  }),
})

const CROWDSTRIKE_CLOUDS = ['us-1', 'us-2', 'eu-1', 'us-gov-1', 'us-gov-2'] as const

const baseRequestSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  cloud: z.enum(CROWDSTRIKE_CLOUDS),
})

const dateRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const extendedBoundsSchema = z.object({
  max: z.string(),
  min: z.string(),
})

const rangeSpecSchema = z.object({
  from: z.number(),
  to: z.number(),
})

const aggregateQuerySchema: z.ZodType<CrowdStrikeAggregateQuery> = z.lazy(() =>
  z.object({
    date_ranges: z.array(dateRangeSchema).optional(),
    exclude: z.string().optional(),
    extended_bounds: extendedBoundsSchema.optional(),
    field: z.string().optional(),
    filter: z.string().optional(),
    from: z.number().int().nonnegative().optional(),
    include: z.string().optional(),
    interval: z.string().optional(),
    max_doc_count: z.number().int().nonnegative().optional(),
    min_doc_count: z.number().int().nonnegative().optional(),
    missing: z.string().optional(),
    name: z.string().optional(),
    q: z.string().optional(),
    ranges: z.array(rangeSpecSchema).optional(),
    size: z.number().int().nonnegative().optional(),
    sort: z.string().optional(),
    sub_aggregates: z.array(aggregateQuerySchema).optional(),
    time_zone: z.string().optional(),
    type: z.string().optional(),
  })
)

/**
 * Falcon treats an empty query param as an empty FQL expression rather than an
 * absent one, so a blank string must be rejected instead of forwarded.
 */
const nonBlankQuerySchema = (label: string) =>
  z.string().trim().min(1, `${label} must not be empty`).optional()

const querySensorsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_sensors'),
  filter: nonBlankQuerySchema('Filter'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(200, 'Limit must be at most 200')
    .optional(),
  offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
  sort: nonBlankQuerySchema('Sort'),
})

const getSensorDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_sensor_details'),
  ids: z
    .array(z.string().trim().min(1, 'Sensor IDs must not be empty'))
    .min(1, 'At least one sensor ID is required')
    .max(5000, 'CrowdStrike supports up to 5000 sensor IDs per request'),
})

const getSensorAggregatesSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_sensor_aggregates'),
  aggregateQuery: aggregateQuerySchema,
})

const idsSchema = (max: number, label: string) =>
  z
    .array(z.string().trim().min(1, `${label} must not be empty`))
    .min(1, `At least one ${label} is required`)
    .max(max, `CrowdStrike supports up to ${max} ${label} values per request`)

const crowdstrikeErrorsSchema = z.array(
  z.object({
    code: crowdstrikeNullableNumberSchema,
    id: crowdstrikeNullableStringSchema,
    message: crowdstrikeNullableStringSchema,
  })
)

const crowdstrikeCursorPaginationSchema = z
  .object({
    after: crowdstrikeNullableStringSchema,
    limit: crowdstrikeNullableNumberSchema,
    offset: crowdstrikeNullableNumberSchema,
    total: crowdstrikeNullableNumberSchema,
  })
  .nullable()

const crowdstrikeSpotlightPaginationSchema = z
  .object({
    after: crowdstrikeNullableStringSchema,
    limit: crowdstrikeNullableNumberSchema,
    total: crowdstrikeNullableNumberSchema,
  })
  .nullable()

const crowdstrikeAlertSchema = z.object({
  compositeId: crowdstrikeNullableStringSchema,
  id: crowdstrikeNullableStringSchema,
  cid: crowdstrikeNullableStringSchema,
  aggregateId: crowdstrikeNullableStringSchema,
  agentId: crowdstrikeNullableStringSchema,
  deviceId: crowdstrikeNullableStringSchema,
  hostname: crowdstrikeNullableStringSchema,
  name: crowdstrikeNullableStringSchema,
  displayName: crowdstrikeNullableStringSchema,
  description: crowdstrikeNullableStringSchema,
  type: crowdstrikeNullableStringSchema,
  product: crowdstrikeNullableStringSchema,
  platform: crowdstrikeNullableStringSchema,
  severity: crowdstrikeNullableNumberSchema,
  severityName: crowdstrikeNullableStringSchema,
  confidence: crowdstrikeNullableNumberSchema,
  status: crowdstrikeNullableStringSchema,
  assignedToName: crowdstrikeNullableStringSchema,
  assignedToUid: crowdstrikeNullableStringSchema,
  assignedToUuid: crowdstrikeNullableStringSchema,
  tactic: crowdstrikeNullableStringSchema,
  tacticId: crowdstrikeNullableStringSchema,
  technique: crowdstrikeNullableStringSchema,
  techniqueId: crowdstrikeNullableStringSchema,
  scenario: crowdstrikeNullableStringSchema,
  objective: crowdstrikeNullableStringSchema,
  resolution: crowdstrikeNullableStringSchema,
  showInUi: z.boolean().nullable(),
  tags: z.array(z.string()),
  filename: crowdstrikeNullableStringSchema,
  filepath: crowdstrikeNullableStringSchema,
  cmdline: crowdstrikeNullableStringSchema,
  sha256: crowdstrikeNullableStringSchema,
  sha1: crowdstrikeNullableStringSchema,
  md5: crowdstrikeNullableStringSchema,
  userName: crowdstrikeNullableStringSchema,
  userId: crowdstrikeNullableStringSchema,
  patternId: crowdstrikeNullableNumberSchema,
  falconHostLink: crowdstrikeNullableStringSchema,
  controlGraphId: crowdstrikeNullableStringSchema,
  external: z.boolean().nullable(),
  emailSent: z.boolean().nullable(),
  isAggregated: z.boolean().nullable(),
  isFalconPlatformIoa: z.boolean().nullable(),
  dataDomains: z.array(z.string()),
  iocValues: z.array(z.string()),
  linkedCaseIds: z.array(z.string()),
  linkedBehavioralDetections: z.array(z.string()),
  timestamp: crowdstrikeNullableStringSchema,
  createdTimestamp: crowdstrikeNullableStringSchema,
  updatedTimestamp: crowdstrikeNullableStringSchema,
  crawledTimestamp: crowdstrikeNullableStringSchema,
  contextTimestamp: crowdstrikeNullableStringSchema,
})

const crowdstrikeHostGroupSchema = z.object({
  id: crowdstrikeNullableStringSchema,
  name: crowdstrikeNullableStringSchema,
  description: crowdstrikeNullableStringSchema,
  groupType: crowdstrikeNullableStringSchema,
  assignmentRule: crowdstrikeNullableStringSchema,
  createdBy: crowdstrikeNullableStringSchema,
  createdTimestamp: crowdstrikeNullableStringSchema,
  modifiedBy: crowdstrikeNullableStringSchema,
  modifiedTimestamp: crowdstrikeNullableStringSchema,
})

const crowdstrikeIndicatorSchema = z.object({
  id: crowdstrikeNullableStringSchema,
  type: crowdstrikeNullableStringSchema,
  value: crowdstrikeNullableStringSchema,
  action: crowdstrikeNullableStringSchema,
  mobileAction: crowdstrikeNullableStringSchema,
  severity: crowdstrikeNullableStringSchema,
  description: crowdstrikeNullableStringSchema,
  source: crowdstrikeNullableStringSchema,
  appliedGlobally: z.boolean().nullable(),
  platforms: z.array(z.string()),
  hostGroups: z.array(z.string()),
  tags: z.array(z.string()),
  expiration: crowdstrikeNullableStringSchema,
  expired: z.boolean().nullable(),
  deleted: z.boolean().nullable(),
  fromParent: z.boolean().nullable(),
  parentCidName: crowdstrikeNullableStringSchema,
  createdBy: crowdstrikeNullableStringSchema,
  createdOn: crowdstrikeNullableStringSchema,
  modifiedBy: crowdstrikeNullableStringSchema,
  modifiedOn: crowdstrikeNullableStringSchema,
  metadata: z
    .object({
      avHits: crowdstrikeNullableNumberSchema,
      companyName: crowdstrikeNullableStringSchema,
      fileDescription: crowdstrikeNullableStringSchema,
      fileVersion: crowdstrikeNullableStringSchema,
      filename: crowdstrikeNullableStringSchema,
      originalFilename: crowdstrikeNullableStringSchema,
      productName: crowdstrikeNullableStringSchema,
      productVersion: crowdstrikeNullableStringSchema,
      signed: z.boolean().nullable(),
    })
    .nullable(),
})

const crowdstrikeVulnerabilitySchema = z.object({
  id: crowdstrikeNullableStringSchema,
  aid: crowdstrikeNullableStringSchema,
  cid: crowdstrikeNullableStringSchema,
  status: crowdstrikeNullableStringSchema,
  confidence: crowdstrikeNullableStringSchema,
  vulnerabilityId: crowdstrikeNullableStringSchema,
  createdTimestamp: crowdstrikeNullableStringSchema,
  updatedTimestamp: crowdstrikeNullableStringSchema,
  closedTimestamp: crowdstrikeNullableStringSchema,
  cve: z
    .object({
      id: crowdstrikeNullableStringSchema,
      baseScore: crowdstrikeNullableNumberSchema,
      severity: crowdstrikeNullableStringSchema,
      exprtRating: crowdstrikeNullableStringSchema,
      exploitStatus: crowdstrikeNullableNumberSchema,
      exploitabilityScore: crowdstrikeNullableNumberSchema,
      impactScore: crowdstrikeNullableNumberSchema,
      remediationLevel: crowdstrikeNullableStringSchema,
      description: crowdstrikeNullableStringSchema,
      publishedDate: crowdstrikeNullableStringSchema,
      vector: crowdstrikeNullableStringSchema,
      types: z.array(z.string()),
      isCisaKev: z.boolean().nullable(),
      cisaDueDate: crowdstrikeNullableStringSchema,
    })
    .nullable(),
  app: z
    .object({
      productNameNormalized: crowdstrikeNullableStringSchema,
      productNameVersion: crowdstrikeNullableStringSchema,
      vendorNormalized: crowdstrikeNullableStringSchema,
    })
    .nullable(),
  hostInfo: z
    .object({
      hostname: crowdstrikeNullableStringSchema,
      localIp: crowdstrikeNullableStringSchema,
      machineDomain: crowdstrikeNullableStringSchema,
      osVersion: crowdstrikeNullableStringSchema,
      platform: crowdstrikeNullableStringSchema,
      productTypeDesc: crowdstrikeNullableStringSchema,
      assetCriticality: crowdstrikeNullableStringSchema,
      internetExposure: crowdstrikeNullableStringSchema,
      tags: z.array(z.string()),
      groups: z.array(z.string()),
    })
    .nullable(),
  remediationIds: z.array(z.string()),
  remediations: z.array(
    z.object({
      id: crowdstrikeNullableStringSchema,
      title: crowdstrikeNullableStringSchema,
      action: crowdstrikeNullableStringSchema,
      type: crowdstrikeNullableStringSchema,
      link: crowdstrikeNullableStringSchema,
      reference: crowdstrikeNullableStringSchema,
      vendorUrl: crowdstrikeNullableStringSchema,
    })
  ),
  suppressionInfo: z
    .object({
      isSuppressed: z.boolean().nullable(),
      reason: crowdstrikeNullableStringSchema,
    })
    .nullable(),
})

const crowdstrikeFalconUserSchema = z
  .object({
    uuid: crowdstrikeNullableStringSchema,
    email: crowdstrikeNullableStringSchema,
    fullName: crowdstrikeNullableStringSchema,
  })
  .nullable()

const crowdstrikeCaseSchema = z.object({
  id: crowdstrikeNullableStringSchema,
  cid: crowdstrikeNullableStringSchema,
  name: crowdstrikeNullableStringSchema,
  description: crowdstrikeNullableStringSchema,
  descriptionFormat: crowdstrikeNullableStringSchema,
  status: crowdstrikeNullableStringSchema,
  severity: crowdstrikeNullableNumberSchema,
  severityLevel: crowdstrikeNullableStringSchema,
  referenceId: crowdstrikeNullableStringSchema,
  version: crowdstrikeNullableNumberSchema,
  tags: z.array(z.string()),
  assignedTo: crowdstrikeFalconUserSchema,
  createdBy: crowdstrikeFalconUserSchema,
  lastUpdatedBy: crowdstrikeFalconUserSchema,
  createdTimestamp: crowdstrikeNullableStringSchema,
  updatedTimestamp: crowdstrikeNullableStringSchema,
  startTimestamp: crowdstrikeNullableStringSchema,
  endTimestamp: crowdstrikeNullableStringSchema,
  templateId: crowdstrikeNullableStringSchema,
  templateName: crowdstrikeNullableStringSchema,
  slaId: crowdstrikeNullableStringSchema,
  slaName: crowdstrikeNullableStringSchema,
  isReadOnly: z.boolean().nullable(),
})

const successOutput = <T extends z.ZodTypeAny>(output: T) =>
  z.object({ success: z.literal(true), output })

const crowdstrikeAlertIdsResponseSchema = successOutput(
  z.object({
    alertIds: z.array(z.string()),
    count: z.number(),
    pagination: crowdstrikePaginationSchema,
  })
)

const crowdstrikeHostGroupIdsResponseSchema = successOutput(
  z.object({
    hostGroupIds: z.array(z.string()),
    count: z.number(),
    pagination: crowdstrikePaginationSchema,
  })
)

const crowdstrikeCaseIdsResponseSchema = successOutput(
  z.object({
    caseIds: z.array(z.string()),
    count: z.number(),
    pagination: crowdstrikePaginationSchema,
  })
)

const crowdstrikeIndicatorIdsResponseSchema = successOutput(
  z.object({
    indicatorIds: z.array(z.string()),
    count: z.number(),
    pagination: crowdstrikeCursorPaginationSchema,
  })
)

const crowdstrikeVulnerabilityIdsResponseSchema = successOutput(
  z.object({
    vulnerabilityIds: z.array(z.string()),
    count: z.number(),
    pagination: crowdstrikeSpotlightPaginationSchema,
  })
)

const crowdstrikeAlertsResponseSchema = successOutput(
  z.object({
    alerts: z.array(crowdstrikeAlertSchema),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeUpdatedAlertsResponseSchema = successOutput(
  z.object({
    updatedIds: z.array(z.string()),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeAffectedEntitiesResponseSchema = successOutput(
  z.object({
    affected: z.array(
      z.object({
        id: crowdstrikeNullableStringSchema,
        path: crowdstrikeNullableStringSchema,
      })
    ),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeHostGroupsResponseSchema = successOutput(
  z.object({
    hostGroups: z.array(crowdstrikeHostGroupSchema),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeIndicatorsResponseSchema = successOutput(
  z.object({
    indicators: z.array(crowdstrikeIndicatorSchema),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeDeletedIndicatorsResponseSchema = successOutput(
  z.object({
    deletedIds: z.array(z.string()),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeVulnerabilitiesResponseSchema = successOutput(
  z.object({
    vulnerabilities: z.array(crowdstrikeVulnerabilitySchema),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeRtrSessionResponseSchema = successOutput(
  z.object({
    sessionId: crowdstrikeNullableStringSchema,
    deviceId: crowdstrikeNullableStringSchema,
    platform: crowdstrikeNullableStringSchema,
    pwd: crowdstrikeNullableStringSchema,
    offlineQueued: z.boolean().nullable(),
    existingAidSessions: crowdstrikeNullableNumberSchema,
    createdAt: crowdstrikeNullableStringSchema,
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeRtrCommandResponseSchema = successOutput(
  z.object({
    cloudRequestId: crowdstrikeNullableStringSchema,
    sessionId: crowdstrikeNullableStringSchema,
    queuedCommandOffline: z.boolean().nullable(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeRtrCommandStatusResponseSchema = successOutput(
  z.object({
    complete: z.boolean().nullable(),
    stdout: crowdstrikeNullableStringSchema,
    stderr: crowdstrikeNullableStringSchema,
    baseCommand: crowdstrikeNullableStringSchema,
    sessionId: crowdstrikeNullableStringSchema,
    taskId: crowdstrikeNullableStringSchema,
    sequenceId: crowdstrikeNullableNumberSchema,
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeRtrDeleteSessionResponseSchema = successOutput(
  z.object({
    sessionId: z.string(),
    deleted: z.boolean(),
    errors: crowdstrikeErrorsSchema,
  })
)

const crowdstrikeCasesResponseSchema = successOutput(
  z.object({
    cases: z.array(crowdstrikeCaseSchema),
    count: z.number(),
    errors: crowdstrikeErrorsSchema,
  })
)

const queryAlertsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_alerts'),
  filter: nonBlankQuerySchema('Filter'),
  q: nonBlankQuerySchema('Query'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(10000, 'Limit must be at most 10000')
    .optional(),
  offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
  sort: nonBlankQuerySchema('Sort'),
  includeHidden: z.boolean().optional(),
})

const getAlertDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_alert_details'),
  compositeIds: idsSchema(1000, 'composite alert ID'),
  includeHidden: z.boolean().optional(),
})

const ALERT_STATUSES = ['new', 'in_progress', 'reopened', 'closed'] as const

const updateAlertsSchema = baseRequestSchema
  .extend({
    operation: z.literal('crowdstrike_update_alerts'),
    compositeIds: idsSchema(1000, 'composite alert ID'),
    updateStatus: z
      .enum(ALERT_STATUSES, {
        message: 'updateStatus must be new, in_progress, reopened, or closed',
      })
      .optional(),
    assignToUuid: z.string().trim().min(1, 'assignToUuid cannot be empty').optional(),
    assignToUserId: z.string().trim().min(1, 'assignToUserId cannot be empty').optional(),
    assignToName: z.string().trim().min(1, 'assignToName cannot be empty').optional(),
    unassign: z.boolean().optional(),
    appendComment: z.string().trim().min(1, 'appendComment cannot be empty').optional(),
    addTag: z.string().trim().min(1, 'addTag cannot be empty').optional(),
    removeTag: z.string().trim().min(1, 'removeTag cannot be empty').optional(),
    removeTagsByPrefix: z.string().trim().min(1, 'removeTagsByPrefix cannot be empty').optional(),
    showInUi: z.boolean().optional(),
    actionParameters: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Action parameter name cannot be empty'),
          value: z.string(),
        })
      )
      .max(50, 'At most 50 action parameters are supported')
      .optional(),
    includeHidden: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasAction =
      value.updateStatus !== undefined ||
      value.assignToUuid !== undefined ||
      value.assignToUserId !== undefined ||
      value.assignToName !== undefined ||
      value.unassign === true ||
      value.appendComment !== undefined ||
      value.addTag !== undefined ||
      value.removeTag !== undefined ||
      value.removeTagsByPrefix !== undefined ||
      value.showInUi !== undefined ||
      (value.actionParameters?.length ?? 0) > 0

    if (!hasAction) {
      ctx.addIssue({
        code: 'custom',
        path: ['actionParameters'],
        message:
          'Supply at least one alert update: updateStatus, assignToUuid, assignToUserId, assignToName, unassign, appendComment, addTag, removeTag, removeTagsByPrefix, showInUi, or actionParameters',
      })
    }
  })

const HOST_ACTIONS = ['contain', 'lift_containment', 'hide_host', 'unhide_host'] as const

const performHostActionSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_perform_host_action'),
  actionName: z.enum(HOST_ACTIONS, {
    message: 'actionName must be contain, lift_containment, hide_host, or unhide_host',
  }),
  deviceIds: idsSchema(5000, 'host agent ID'),
})

const queryHostGroupsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_host_groups'),
  filter: nonBlankQuerySchema('Filter'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(5000, 'Limit must be at most 5000')
    .optional(),
  offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
  sort: nonBlankQuerySchema('Sort'),
})

const getHostGroupDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_host_group_details'),
  hostGroupIds: idsSchema(500, 'host group ID'),
})

const HOST_GROUP_ACTIONS = ['add-hosts', 'remove-hosts'] as const

const performHostGroupActionSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_perform_host_group_action'),
  actionName: z.enum(HOST_GROUP_ACTIONS, {
    message: 'actionName must be add-hosts or remove-hosts',
  }),
  hostGroupId: z.string().trim().min(1, 'hostGroupId is required'),
  deviceIds: idsSchema(5000, 'host agent ID'),
})

const queryIndicatorsSchema = baseRequestSchema
  .extend({
    operation: z.literal('crowdstrike_query_indicators'),
    filter: nonBlankQuerySchema('Filter'),
    limit: z
      .number()
      .int()
      .min(1, 'Limit must be at least 1')
      .max(2000, 'Limit must be at most 2000')
      .optional(),
    offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
    after: nonBlankQuerySchema('After cursor'),
    sort: nonBlankQuerySchema('Sort'),
  })
  .superRefine((value, ctx) => {
    if (value.offset !== undefined && value.after !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message: 'after cannot be combined with offset; pick one pagination mode',
      })
    }
  })

const getIndicatorDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_indicator_details'),
  indicatorIds: idsSchema(1000, 'indicator ID'),
})

const indicatorPayloadSchema = z.record(z.string(), z.unknown())

const createIndicatorsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_create_indicators'),
  indicators: z
    .array(indicatorPayloadSchema)
    .min(1, 'At least one indicator is required')
    .max(200, 'CrowdStrike supports up to 200 indicators per request'),
  comment: z.string().optional(),
  retrodetects: z.boolean().optional(),
  ignoreWarnings: z.boolean().optional(),
})

const updateIndicatorsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_update_indicators'),
  indicators: z
    .array(indicatorPayloadSchema)
    .min(1, 'At least one indicator is required')
    .max(200, 'CrowdStrike supports up to 200 indicators per request'),
  comment: z.string().optional(),
  retrodetects: z.boolean().optional(),
  ignoreWarnings: z.boolean().optional(),
})

const deleteIndicatorsSchema = baseRequestSchema
  .extend({
    operation: z.literal('crowdstrike_delete_indicators'),
    indicatorIds: idsSchema(1000, 'indicator ID').optional(),
    filter: z.string().trim().min(1, 'filter cannot be empty').optional(),
    comment: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.filter && !value.indicatorIds?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['indicatorIds'],
        message: 'Supply indicatorIds or a filter selecting the indicators to delete',
      })
    }
  })

const queryVulnerabilitiesSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_vulnerabilities'),
  filter: z.string().trim().min(1, 'Spotlight requires a filter expression'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(400, 'Limit must be at most 400')
    .optional(),
  after: nonBlankQuerySchema('After cursor'),
  sort: nonBlankQuerySchema('Sort'),
})

const getVulnerabilityDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_vulnerability_details'),
  vulnerabilityIds: idsSchema(400, 'vulnerability ID'),
})

const initRtrSessionSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_init_rtr_session'),
  deviceId: z.string().trim().min(1, 'deviceId is required'),
  queueOffline: z.boolean().optional(),
  origin: z.string().optional(),
})

const executeRtrCommandSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_execute_rtr_command'),
  sessionId: z.string().trim().min(1, 'sessionId is required'),
  baseCommand: z.string().trim().min(1, 'baseCommand is required'),
  commandString: z.string().trim().min(1, 'commandString is required'),
})

const getRtrCommandStatusSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_rtr_command_status'),
  cloudRequestId: z.string().trim().min(1, 'cloudRequestId is required'),
  sequenceId: z.number().int().nonnegative('sequenceId must be 0 or greater').optional(),
})

const deleteRtrSessionSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_delete_rtr_session'),
  sessionId: z.string().trim().min(1, 'sessionId is required'),
})

const queryCasesSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_cases'),
  filter: nonBlankQuerySchema('Filter'),
  q: nonBlankQuerySchema('Query'),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(10000, 'Limit must be at most 10000')
    .optional(),
  offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
  sort: nonBlankQuerySchema('Sort'),
})

const getCaseDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_case_details'),
  caseIds: idsSchema(1000, 'case ID'),
})

export const crowdstrikeQueryBodySchema = z.discriminatedUnion('operation', [
  querySensorsSchema,
  getSensorDetailsSchema,
  getSensorAggregatesSchema,
  queryAlertsSchema,
  getAlertDetailsSchema,
  updateAlertsSchema,
  performHostActionSchema,
  queryHostGroupsSchema,
  getHostGroupDetailsSchema,
  performHostGroupActionSchema,
  queryIndicatorsSchema,
  getIndicatorDetailsSchema,
  createIndicatorsSchema,
  updateIndicatorsSchema,
  deleteIndicatorsSchema,
  queryVulnerabilitiesSchema,
  getVulnerabilityDetailsSchema,
  initRtrSessionSchema,
  executeRtrCommandSchema,
  getRtrCommandStatusSchema,
  deleteRtrSessionSchema,
  queryCasesSchema,
  getCaseDetailsSchema,
])

export const crowdstrikeQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/crowdstrike/query',
  body: crowdstrikeQueryBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      crowdstrikeSensorsResponseSchema,
      crowdstrikeAggregatesResponseSchema,
      crowdstrikeAlertIdsResponseSchema,
      crowdstrikeAlertsResponseSchema,
      crowdstrikeUpdatedAlertsResponseSchema,
      crowdstrikeAffectedEntitiesResponseSchema,
      crowdstrikeHostGroupIdsResponseSchema,
      crowdstrikeHostGroupsResponseSchema,
      crowdstrikeIndicatorIdsResponseSchema,
      crowdstrikeIndicatorsResponseSchema,
      crowdstrikeDeletedIndicatorsResponseSchema,
      crowdstrikeVulnerabilityIdsResponseSchema,
      crowdstrikeVulnerabilitiesResponseSchema,
      crowdstrikeRtrSessionResponseSchema,
      crowdstrikeRtrCommandResponseSchema,
      crowdstrikeRtrCommandStatusResponseSchema,
      crowdstrikeRtrDeleteSessionResponseSchema,
      crowdstrikeCaseIdsResponseSchema,
      crowdstrikeCasesResponseSchema,
    ]),
  },
})

export type CrowdstrikeQueryBody = ContractBody<typeof crowdstrikeQueryContract>
export type CrowdstrikeQueryBodyInput = ContractBodyInput<typeof crowdstrikeQueryContract>
export type CrowdstrikeQueryResponse = ContractJsonResponse<typeof crowdstrikeQueryContract>
