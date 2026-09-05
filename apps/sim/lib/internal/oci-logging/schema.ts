import { z } from 'zod'

const id = z.string().trim().min(1).max(255)
const name = z.string().min(1).max(255)
const timestamp = z.string().datetime({ offset: true })
const entryTimestamp = z.string().datetime({ offset: true, precision: 3 })
const stringMap = z.record(z.string(), z.string())
const tags = {
  freeformTags: stringMap.optional(),
  definedTags: z.record(z.string(), stringMap).optional(),
}
const lifecycle = z.enum(['CREATING', 'ACTIVE', 'UPDATING', 'INACTIVE', 'DELETING', 'FAILED'])
const logType = z.enum(['CUSTOM', 'SERVICE'])
const archiving = z.object({ isEnabled: z.boolean().optional() }).strict()
const source = z
  .object({
    sourceType: z.literal('OCISERVICE'),
    service: z.string().min(1).max(64),
    resource: id,
    category: z.string().min(1).max(64),
    parameters: stringMap.optional(),
  })
  .strict()
const configuration = z
  .object({
    source,
    compartmentId: id.optional(),
    archiving: archiving.optional(),
  })
  .strict()
const updateConfiguration = z
  .object({
    source: z.object({ parameters: stringMap.optional() }).strict(),
    archiving: archiving.optional(),
  })
  .strict()
const pagination = {
  limit: z.number().int().min(1).max(1000).optional(),
  page: z.string().min(1).max(512).optional(),
}
const sorting = {
  sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
}
const groupFields = {
  displayName: name.optional(),
  description: z.string().min(1).max(400).optional(),
  ...tags,
}
const logFields = {
  displayName: name.optional(),
  isEnabled: z.boolean().optional(),
  retentionDuration: z.number().int().min(30).max(180).multipleOf(30).optional(),
  ...tags,
}
const ifMatch = z.string().min(1).max(4096).optional()
const retryToken = z.string().min(1).max(64).optional()

export const ociLoggingCredentialSchema = z.object({
  ociCredential: z.string().trim().min(1),
  region: z.string().trim().min(1).optional(),
})

export const ociLoggingInputSchemas = {
  list_log_groups: z.object({
    compartmentId: id,
    isCompartmentIdInSubtree: z.boolean().optional(),
    displayName: name.optional(),
    ...pagination,
    ...sorting,
  }),
  get_log_group: z.object({ logGroupId: id }),
  create_log_group: z.object({
    ...groupFields,
    compartmentId: id,
    displayName: name,
    retryToken,
  }),
  update_log_group: z.object({ ...groupFields, logGroupId: id, ifMatch }),
  delete_log_group: z.object({ logGroupId: id, ifMatch }),
  list_logs: z.object({
    logGroupId: id,
    logType: logType.optional(),
    sourceService: z.string().min(1).max(64).optional(),
    sourceResource: id.optional(),
    displayName: name.optional(),
    lifecycleState: lifecycle.optional(),
    ...pagination,
    ...sorting,
  }),
  get_log: z.object({ logGroupId: id, logId: id }),
  create_log: z.object({
    ...logFields,
    logGroupId: id,
    displayName: name,
    logType,
    configuration: configuration.optional(),
    retryToken,
  }),
  update_log: z.object({
    ...logFields,
    logGroupId: id,
    logId: id,
    configuration: updateConfiguration.optional(),
    ifMatch,
  }),
  delete_log: z.object({ logGroupId: id, logId: id, ifMatch }),
  search_logs: z
    .object({
      searchQuery: z.string().min(1),
      timeStart: timestamp,
      timeEnd: timestamp,
      isReturnFieldInfo: z.boolean().optional(),
      ...pagination,
      page: z.string().min(1).max(1024).optional(),
    })
    .refine(
      (input) => {
        const duration = Date.parse(input.timeEnd) - Date.parse(input.timeStart)
        return duration > 0 && duration <= 14 * 24 * 60 * 60 * 1000
      },
      {
        message: 'Search timestamps must define a positive window of at most 14 days',
        path: ['timeEnd'],
      }
    ),
  put_logs: z.object({
    logId: id,
    logEntryBatches: z
      .array(
        z
          .object({
            source: z.string(),
            type: z.string(),
            subject: z.string().optional(),
            defaultlogentrytime: entryTimestamp,
            entries: z
              .array(
                z
                  .object({
                    data: z.string(),
                    id: z.string().min(1).max(255),
                    time: entryTimestamp.optional(),
                  })
                  .strict()
                  .refine(
                    (entry) =>
                      new TextEncoder().encode(JSON.stringify(entry)).byteLength < 1_000_000,
                    { message: 'Each serialized log entry must be smaller than 1 MB' }
                  )
              )
              .min(1),
          })
          .strict()
      )
      .min(1),
  }),
  get_work_request: z.object({ workRequestId: id }),
  list_work_request_errors: z.object({ workRequestId: id, ...pagination }),
  list_saved_searches: z.object({
    compartmentId: id,
    logSavedSearchId: id.optional(),
    name: name.optional(),
    ...pagination,
    ...sorting,
  }),
  get_saved_search: z.object({ logSavedSearchId: id }),
}

const resourceFields = {
  ...tags,
  systemTags: z
    .record(z.string(), z.record(z.string(), z.union([z.string(), z.number().int(), z.boolean()])))
    .optional(),
  timeCreated: timestamp.optional(),
  timeLastModified: timestamp.optional(),
}
export const logGroupSchema = z.object({
  id,
  compartmentId: id,
  displayName: name,
  description: z.string().optional(),
  lifecycleState: lifecycle.optional(),
  ...resourceFields,
})
export const logSchema = z.object({
  id,
  logGroupId: id,
  displayName: name,
  logType,
  lifecycleState: lifecycle,
  compartmentId: id.optional(),
  tenancyId: id.optional(),
  configuration: configuration.optional(),
  isEnabled: z.boolean().optional(),
  retentionDuration: z.number().int().optional(),
  ...resourceFields,
})
export const savedSearchSummarySchema = z.object({
  id,
  compartmentId: id,
  name,
  query: z.string().optional(),
  description: z.string().optional(),
  lifecycleState: lifecycle.optional(),
  ...resourceFields,
})
export const savedSearchSchema = savedSearchSummarySchema.extend({
  query: z.string().min(1).max(4096),
})
export const workRequestSchema = z.object({
  id,
  compartmentId: id,
  operationType: z.enum([
    'CREATE_LOG',
    'UPDATE_LOG',
    'DELETE_LOG',
    'MOVE_LOG',
    'CREATE_LOG_GROUP',
    'UPDATE_LOG_GROUP',
    'DELETE_LOG_GROUP',
    'MOVE_LOG_GROUP',
    'CREATE_CONFIGURATION',
    'UPDATE_CONFIGURATION',
    'DELETE_CONFIGURATION',
    'MOVE_CONFIGURATION',
  ]),
  status: z.enum(['ACCEPTED', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED', 'CANCELLING', 'CANCELED']),
  percentComplete: z.number(),
  resources: z.array(
    z.object({
      actionType: z.enum(['CREATED', 'UPDATED', 'DELETED', 'IN_PROGRESS', 'RELATED']),
      entityType: z.string(),
      identifier: z.string(),
      entityUri: z.string().optional(),
    })
  ),
  timeAccepted: timestamp,
  timeStarted: timestamp.optional(),
  timeFinished: timestamp.optional(),
})
export const workRequestErrorSchema = z.object({ code: z.string(), message: z.string(), timestamp })
export const searchResponseSchema = z.object({
  results: z
    .array(z.object({ data: z.record(z.string(), z.unknown()) }))
    .optional()
    .default([]),
  fields: z
    .array(
      z.object({
        fieldName: z.string().min(1).max(1024),
        fieldType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'ARRAY']),
      })
    )
    .optional()
    .default([]),
  summary: z.object({
    resultCount: z.number().int().optional(),
    fieldCount: z.number().int().optional(),
  }),
})
