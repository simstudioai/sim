import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const text = z.string().max(20_000)
const name = z.string().trim().min(1).max(255)
const id = z.string().trim().uuid()
const optionalText = text.nullish()
const timestamp = z.union([z.number().int(), z.string().max(64)]).nullish()
const strings = z.array(text).max(1000)
const count = z.number().int().nonnegative().nullish()
const links = z
  .array(
    z.object({
      rel: z.string().max(128),
      href: z.string().max(4096),
      method: z.string().max(16).optional(),
    })
  )
  .max(100)
  .nullish()
  .transform((value) => value ?? [])

export const edmLinkEnvelopeSchema = z.object({ links })
export const edmReferenceSchema = z.object({
  id,
  name: optionalText,
  description: optionalText,
  links,
})
const ref = edmReferenceSchema.nullish()
const refs = z
  .array(edmReferenceSchema)
  .max(1000)
  .nullish()
  .transform((value) => value ?? [])
const entity = {
  id,
  name: text,
  description: optionalText,
  objectStatus: optionalText,
  timeCreated: timestamp,
  timeModified: timestamp,
  permittedActions: strings.nullish().transform((value) => value ?? []),
  links,
}

export const edmDimensionSchema = z.object({
  ...entity,
  dimensionType: optionalText,
  connected: z.boolean().nullish(),
  externalName: optionalText,
  isBound: z.boolean().nullish(),
  supportsMapping: z.boolean().nullish(),
  supportsMappingExport: z.boolean().nullish(),
  supportsExtracts: z.boolean().nullish(),
  supportedDirection: optionalText,
  bindings: z
    .array(
      z.object({
        id,
        name: optionalText,
        description: optionalText,
        bindingType: optionalText,
        viewpoint: ref,
        view: ref,
        links,
      })
    )
    .max(1000)
    .nullish()
    .transform((value) => value ?? []),
})
export const edmApplicationSchema = z.object({
  ...entity,
  primaryView: ref,
  supportedDirection: optionalText,
  dimensions: z
    .array(edmDimensionSchema)
    .max(1000)
    .nullish()
    .transform((value) => value ?? []),
})
export const edmViewSchema = z.object({ ...entity, master: z.boolean().nullish() })
export const edmNodeTypeAssignmentSchema = z.object({
  nodeTypeLink: edmReferenceSchema,
  relatedViewpoints: refs,
})
export const edmViewpointSchema = z.object({
  ...entity,
  label: optionalText,
  hasHierarchy: z.boolean().nullish(),
  scope: optionalText,
  bindingType: optionalText,
  viewId: id.nullish(),
  viewName: optionalText,
  applicationLink: ref,
  dimensionLink: ref,
  nodeSetLink: ref,
  hierarchySetLink: ref,
  nodeTypeAssignments: z
    .array(edmNodeTypeAssignmentSchema)
    .max(1000)
    .nullish()
    .transform((value) => value ?? []),
})

const validation = z.object({
  message: optionalText,
  code: optionalText,
  type: optionalText,
  severity: optionalText,
  userCanResolve: z.boolean().nullish(),
  timeCreated: timestamp,
})
export const edmNodeSchema = z.object({
  id,
  name: text,
  description: optionalText,
  nodeType: ref,
  hasChildren: z.boolean().nullish(),
  location: text.nullish(),
  path: refs,
  relationshipId: id.nullish(),
  parentNodeId: id.nullish(),
  parentName: optionalText,
  parentNodeTypeId: id.nullish(),
  childCount: count,
  locationCount: count,
  previousLocation: optionalText,
  nextLocation: optionalText,
  propertyCount: count,
  propertyValues: z
    .array(
      z.object({
        value: optionalText,
        displayValue: optionalText,
        propertyName: optionalText,
        propertyId: id.nullish(),
        origin: optionalText,
        propertyLevel: optionalText,
        labels: strings.nullish().transform((value) => value ?? []),
        readOnly: z.boolean().nullish(),
        validated: z.boolean().nullish(),
      })
    )
    .max(1000)
    .nullish()
    .transform((value) => value ?? []),
  requestItem: z
    .object({
      id,
      name: optionalText,
      description: optionalText,
      actionCount: count,
      nodeTypeName: optionalText,
      nodeTypeId: id.nullish(),
      applicationName: optionalText,
      actionSummary: optionalText,
      validations: z
        .array(validation)
        .max(1000)
        .nullish()
        .transform((value) => value ?? []),
    })
    .nullish(),
  links,
})

const user = z
  .object({
    id: id.nullish(),
    userName: optionalText,
    fullName: optionalText,
  })
  .nullish()
export const EDM_TRANSITIONS = [
  'SUBMIT',
  'APPROVE',
  'PUSHBACK',
  'REJECT',
  'WITHDRAW',
  'RECALL',
  'COMMIT',
  'CLOSE',
] as const
export const edmRequestSchema = z.object({
  id,
  title: optionalText,
  description: optionalText,
  priority: optionalText,
  origin: optionalText,
  requestType: optionalText,
  status: optionalText,
  stage: optionalText,
  requestNumber: count,
  timeCreated: timestamp,
  timeModified: timestamp,
  timeSubmitted: timestamp,
  blockedUntil: timestamp,
  notes: optionalText,
  itemCount: count,
  commentCount: count,
  validationErrorCount: count,
  attachmentCount: count,
  actionCount: count,
  commentRequiredOnTransition: z.boolean().nullish(),
  validTransitionActions: z
    .array(z.enum(EDM_TRANSITIONS))
    .max(8)
    .nullish()
    .transform((value) => value ?? []),
  viewId: id.nullish(),
  viewName: optionalText,
  createdByUser: user,
  modifiedByUser: user,
  submittedByUser: user,
  assignedToUser: user,
  owner: user,
  sourceRequest: ref,
  subscriptions: refs,
  autoSubmitted: z.boolean().nullish(),
  links,
})
const subscription = z.object({
  id,
  name: optionalText,
  description: optionalText,
  sourceViewpoint: ref,
  targetViewpoint: ref,
  sourceRequest: id.nullish(),
  targetRequest: id.nullish(),
  subscriptionStatus: optionalText,
  message: optionalText,
  assigneeName: optionalText,
  timeCreated: timestamp,
  timeModified: timestamp,
})
export const edmLineageSchema = z.object({
  requestLineageNodes: z
    .array(
      z.object({
        id,
        title: optionalText,
        origin: optionalText,
        status: optionalText,
        autoSubmitted: z.boolean().nullish(),
        sourceRequest: ref,
        timeCreated: timestamp,
        viewpoints: refs,
        incompleteSubscriptions: z
          .array(subscription)
          .max(1000)
          .nullish()
          .transform((value) => value ?? []),
        links,
      })
    )
    .max(1000),
  subscriptionInstances: z
    .array(subscription)
    .max(1000)
    .nullish()
    .transform((value) => value ?? []),
  links,
})
export const edmJobSchema = z.object({
  id,
  description: optionalText,
  origin: optionalText,
  status: z.enum(['PENDING', 'RUNNING', 'ERROR', 'COMPLETED']),
  error: optionalText,
  created: timestamp,
  lastModified: timestamp,
  jobSize: count,
  jobProgress: count,
  links,
})
/** Oracle documents only JsonNode for result; no operation-specific result paths are inferred. */
export const edmJobResultSchema = edmJobSchema
  .omit({ error: true, jobSize: true, jobProgress: true })
  .extend({
    result: z.unknown(),
  })
export const edmMappingKeysSchema = z.object({
  mapKeys: z
    .array(
      z.object({
        location: text,
        sourceNodeType: ref,
        targetNodeType: ref,
        defaultLocation: z.boolean().nullish(),
      })
    )
    .max(1000),
})
export function edmPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).max(5000),
    hasMore: z.boolean().nullish(),
    count,
    totalResults: count,
    limit: count,
    offset: count,
    links,
  })
}

const auth = {
  oauthCredential: z.string().trim().min(1).max(1024),
  accessToken: z.string().min(1).max(8192),
  instanceUrl: z.string().trim().min(1).max(2048),
}
const maxResults = z.number().int().min(1).max(500).default(200)
const view = { viewId: id }
const viewpoint = { ...view, viewpointId: id }
const request = { requestId: id }
const job = { jobRunId: id }
const wait = {
  waitForCompletion: z.boolean().default(true),
  maxWaitSeconds: z.number().int().min(1).max(240).default(120),
}
const fileName = name.refine(
  (value) => !/[\\/\r\n\u0000]/.test(value) && value !== '.' && value !== '..',
  'File name must be a single file name, not a path'
)
const fileOutput = { fileName, ...wait }
const dimensionNames = { applicationName: name, dimensionName: name }
const viewpointNames = { viewName: name, viewpointName: name }
const expansion = z
  .enum([
    'propertyValues::none',
    'propertyValues::all',
    'propertyValues::columnVisible',
    'propertyValues::locationVisible',
    'requestItem.validations',
    'bestLocationRtl',
  ])
  .optional()
const nodeDetail = { ...viewpoint, nodeId: id, requestId: id.optional(), expand: expansion }
const positiveInteger = z.number().int().min(1).max(2_147_483_647)
const filterName = name.refine((value) => !value.includes(','), 'Select one value per filter')
const parseJson = (value: unknown) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
const stringList = z.preprocess(parseJson, z.array(name).min(1).max(100))
function operation<T extends string, S extends z.ZodRawShape>(action: T, fields: S) {
  return z.object({ ...auth, operation: z.literal(`oracle_epm_edm_${action}`), ...fields })
}

export const edmInputSchemas = {
  list_applications: operation('list_applications', {
    applicationId: id.optional(),
    permission: z
      .enum(['owner', 'datamanager', 'participant', 'participant_with_write'])
      .optional(),
    maxResults,
  }).refine(
    (value) => !value.applicationId || !value.permission,
    'Choose applicationId or permission, not both'
  ),
  list_dimensions: operation('list_dimensions', { applicationId: id, maxResults }),
  list_views: operation('list_views', {
    dimensionId: id.optional(),
    objectStatus: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    maxResults,
  }).refine(
    (value) => !value.dimensionId || !value.objectStatus,
    'Choose dimensionId or objectStatus, not both'
  ),
  list_viewpoints: operation('list_viewpoints', {
    ...view,
    dimensionId: id.optional(),
    applicationId: id.optional(),
    maxResults,
  }).refine(
    (value) => !value.dimensionId || !value.applicationId,
    'Choose dimensionId or applicationId, not both'
  ),
  list_node_types: operation('list_node_types', { ...viewpoint, maxResults }),
  get_node_type: operation('get_node_type', { ...viewpoint, nodeTypeId: id }),
  list_nodes: operation('list_nodes', {
    ...viewpoint,
    scope: z.enum(['all', 'top', 'children', 'request']).default('top'),
    parentNodeId: id.optional(),
    requestId: id.optional(),
    expand: expansion,
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    fromId: name.optional(),
    toId: name.optional(),
    orderBy: z.enum(['hsConfig:asc', 'hsConfig:desc']).optional(),
  }).superRefine((value, ctx) => {
    if (value.scope === 'children' && !value.parentNodeId)
      ctx.addIssue({
        code: 'custom',
        path: ['parentNodeId'],
        message: 'parentNodeId is required for children',
      })
    if (value.scope === 'request' && !value.requestId)
      ctx.addIssue({
        code: 'custom',
        path: ['requestId'],
        message: 'requestId is required for request nodes',
      })
    if (value.parentNodeId && value.scope !== 'children')
      ctx.addIssue({
        code: 'custom',
        path: ['parentNodeId'],
        message: 'parentNodeId requires children scope',
      })
    if (value.requestId && value.scope !== 'request')
      ctx.addIssue({
        code: 'custom',
        path: ['requestId'],
        message: 'requestId requires request scope',
      })
    if (value.fromId && value.toId)
      ctx.addIssue({
        code: 'custom',
        path: ['toId'],
        message: 'fromId and toId cannot be combined',
      })
  }),
  get_node: operation('get_node', nodeDetail),
  get_node_at_location: operation('get_node_at_location', {
    ...nodeDetail,
    location: name.refine(
      (value) => value.split(',').every((part) => id.safeParse(part).success),
      'Location must contain comma-separated node UUIDs'
    ),
  }),
  browse_hierarchy: operation('browse_hierarchy', {
    ...viewpoint,
    maxDepth: z.number().int().min(0).max(3).default(2),
    maxNodes: z.number().int().min(1).max(500).default(200),
    pageSize: z.number().int().min(1).max(100).default(50),
    maxRequests: z.number().int().min(1).max(100).default(50),
  }),
  create_request: operation('create_request', {
    ...view,
    title: name.optional(),
    description: text.optional(),
    notes: text.optional(),
    priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']).optional(),
    timeLabelName: name.optional(),
  }),
  get_request: operation('get_request', request),
  query_requests: operation('query_requests', {
    lastDays: z.number().int().min(1).max(90).optional(),
    fromDate: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    toDate: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    myActivity: z
      .enum(['Assigned', 'Collaborated', 'Submitted', 'Invited', 'Contributed', 'Managed'])
      .optional(),
    owner: filterName.optional(),
    priority: z.enum(['None', 'Low', 'Medium', 'High']).optional(),
    requestNumber: positiveInteger.optional(),
    requestType: z.enum(['Interactive', 'Subscription', 'Import', 'Consolidation']).optional(),
    stage: z.enum(['Submit', 'Approved', 'Commit', 'Closed']).optional(),
    status: z
      .enum([
        'Draft',
        'In Flight',
        'Recalled',
        'Pushed Back',
        'Completed',
        'Rejected',
        'Blocked',
        'Consolidated',
      ])
      .optional(),
    timeLabelName: filterName.optional(),
    viewName: filterName.optional(),
    expandWorkflow: z.boolean().optional(),
    maxResults,
  }).superRefine((value, ctx) => {
    if (value.fromDate !== undefined || value.toDate !== undefined) {
      if (
        value.lastDays !== undefined ||
        value.fromDate === undefined ||
        value.toDate === undefined ||
        value.toDate < value.fromDate ||
        value.toDate - value.fromDate > 90 * 86400
      )
        ctx.addIssue({
          code: 'custom',
          path: ['fromDate'],
          message:
            'Provide fromDate and toDate in epoch seconds, at most 90 days apart, without lastDays',
        })
    }
  }),
  get_request_lineage: operation('get_request_lineage', request),
  assign_request: operation('assign_request', {
    requestNumber: positiveInteger,
    userName: name,
    comment: text.optional(),
  }),
  delete_request: operation('delete_request', request),
  upload_request_attachment: operation('upload_request_attachment', {
    ...request,
    file: FileInputSchema,
    fileName: fileName.optional(),
  }),
  generate_request_attachment: operation('generate_request_attachment', {
    ...request,
    ...fileOutput,
    overwrite: z.boolean().optional(),
    items: z.preprocess(
      parseJson,
      z
        .array(
          z.object({
            viewpoint: name,
            data: z
              .array(z.object({ header: name, value: text }))
              .min(1)
              .max(100),
          })
        )
        .min(1)
        .max(1000)
    ),
  }),
  import_request_attachment: operation('import_request_attachment', {
    ...request,
    attachmentId: id,
    sheetNames: stringList,
    ...wait,
  }),
  transition_request: operation('transition_request', {
    ...request,
    action: z.enum(EDM_TRANSITIONS),
    comment: text.optional(),
    transitionWithWarning: z.boolean().optional(),
    ...wait,
  }),
  get_job_status: operation('get_job_status', job),
  get_job_result: operation('get_job_result', {
    ...job,
    downloadFile: z.boolean().default(false),
    fileName: fileName.optional(),
  }),
  validate_viewpoint: operation('validate_viewpoint', {
    ...viewpointNames,
    ...fileOutput,
    requestNumber: positiveInteger.optional(),
  }),
  get_mapping_keys: operation('get_mapping_keys', { dimensionId: id, bindingId: id }),
  export_mappings: operation('export_mappings', {
    ...dimensionNames,
    ...fileOutput,
    mappingLocation: name,
    connection: name.optional(),
  }),
  import_dimension: operation('import_dimension', {
    ...dimensionNames,
    ...fileOutput,
    file: FileInputSchema.optional(),
    connection: name.optional(),
    importOption: z.enum(['ResetDimension', 'ReplaceNodes', 'Merge']),
  }).refine(
    (value) => !(value.file && value.connection),
    'A Sim file upload cannot be combined with a configured connection'
  ),
  load_viewpoint: operation('load_viewpoint', {
    ...viewpointNames,
    ...fileOutput,
    file: FileInputSchema.optional(),
    purpose: name,
    loadOption: z.enum(['ReplaceNodes', 'Merge']),
  }),
  export_dimension: operation('export_dimension', {
    ...dimensionNames,
    ...fileOutput,
    connection: name.optional(),
  }),
  incremental_export_dimension: operation('incremental_export_dimension', {
    ...dimensionNames,
    ...fileOutput,
    bindingNames: stringList,
    nodeChangeTypes: z.preprocess(
      parseJson,
      z
        .array(z.enum(['NEW', 'UPDATED']))
        .min(1)
        .max(2)
        .refine(
          (values) => new Set(values).size === values.length,
          'Node change types must be unique'
        )
    ),
    since: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    sinceLastExportOfType: z.enum(['FULL', 'INCREMENTAL']).optional(),
    connectionName: name.optional(),
  }).refine(
    (value) => (value.since !== undefined) !== (value.sinceLastExportOfType !== undefined),
    'Provide exactly one of since or sinceLastExportOfType'
  ),
  extract_dimension_viewpoint: operation('extract_dimension_viewpoint', {
    ...dimensionNames,
    ...fileOutput,
    extractName: name,
    connection: name.optional(),
    fromTime: name.optional(),
    toTime: name.optional(),
    requestNumber: positiveInteger.optional(),
  }),
}
