import { z } from 'zod'
import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import type { OracleEpmClientResponse } from '@/lib/internal/oracle-epm/types'

/**
 * Verified projections of Oracle's Narrative Reporting OpenAPI 2026.04.07.
 * Collection envelopes are not interchangeable with the bare POV/prompt arrays.
 * @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/openapi.json
 */
const optionalText = z
  .string()
  .max(16_384)
  .nullish()
  .transform((value) => value ?? null)
const optionalBoolean = z
  .boolean()
  .nullish()
  .transform((value) => value ?? null)
const optionalNumber = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null)
const identifier = z.string().trim().min(1, 'Resource ID is required').max(255)
const optionalInput = z.string().trim().max(4_096).optional()
const strings = z
  .array(z.string().max(16_384))
  .max(1_000)
  .nullish()
  .transform((value) => value ?? [])

export const narrativeAuthSchema = z.object({
  oauthCredential: z.string().min(1, 'An Oracle EPM credential is required').max(255),
  accessToken: z.string().min(1, 'Resolved Oracle EPM credentials are required').max(4_096),
  instanceUrl: z.string().min(1, 'A credential-bound environment URL is required').max(2_048),
})

export const narrativeListInputSchema = narrativeAuthSchema.extend({
  folderId: identifier.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  q: optionalInput,
  orderBy: optionalInput,
})
export const narrativeResourceInputSchema = narrativeAuthSchema.extend({ resourceId: identifier })
export const narrativeDownloadInputSchema = narrativeResourceInputSchema.extend({
  fileName: z.string().trim().min(1).max(255).optional(),
  format: z.enum(['pdf', 'xlsx']).default('pdf'),
  globalPov: optionalInput,
  prompts: optionalInput,
})
export const narrativeCreateFolderInputSchema = narrativeAuthSchema.extend({
  name: z.string().trim().min(1, 'Folder name is required').max(255),
  description: optionalInput,
  systemPath: optionalInput,
})
export const narrativeCreateFileInputSchema = narrativeCreateFolderInputSchema.extend({
  systemPath: z.string().trim().min(1, 'Library folder path is required').max(4_096),
  providerFile: z.string().trim().min(1, 'Provider file ID or name is required').max(4_096),
  mimeType: z.enum([
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'text/csv',
    'font/ttf',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.ms-word',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
  overwrite: z.boolean().default(false),
})
export const narrativeWaitInputSchema = narrativeResourceInputSchema.extend({
  maxWaitSeconds: z.number().int().min(10).max(240).default(120),
})
export const narrativeExportInputSchema = narrativeAuthSchema
  .extend({
    artifactName: z.string().trim().min(1, 'Artifact name is required').max(4_096),
    artifactType: z
      .enum([
        'ReportPackageResourceType',
        'ReportResourceType',
        'ReportSnapshotResourceType',
        'FolderResourceType',
        'FileResourceType',
        'FontResourceType',
        'BurstingDefinitionResourceType',
        'BookResourceType',
      ])
      .optional(),
    exportLocation: z.enum(['Temporary', 'Library', 'File']).default('Temporary'),
    exportFormat: z.enum(['Native', 'File', 'LCM']).default('Native'),
    exportLibraryFolder: optionalInput,
    saveAsFile: optionalInput,
    applicationName: optionalInput,
    errorFile: optionalInput,
  })
  .superRefine((input, context) => {
    if (input.exportFormat !== 'LCM') return
    if (!input.applicationName)
      context.addIssue({
        code: 'custom',
        path: ['applicationName'],
        message: 'LCM export requires an application name',
      })
    if (input.artifactType && input.artifactType !== 'ReportResourceType')
      context.addIssue({
        code: 'custom',
        path: ['artifactType'],
        message: 'LCM export supports reports only',
      })
  })
export const narrativeImportInputSchema = narrativeAuthSchema.extend({
  importFile: z.string().trim().min(1, 'Import file is required').max(4_096),
  importLocation: z.enum(['Temporary', 'Library', 'File']).optional(),
  importFormat: z.enum(['Native', 'File']).default('Native'),
  importFolder: optionalInput,
  deleteAfterImport: z.boolean().default(false),
  importPermissions: z.boolean().default(false),
  overwrite: z.boolean().default(false),
  errorFile: optionalInput,
})
export const narrativeSnapshotInputSchema = narrativeAuthSchema
  .extend({
    reportId: identifier.optional(),
    reportName: optionalInput,
    globalPov: optionalInput,
    prompts: optionalInput,
    libraryLocation: optionalInput,
    snapShotName: optionalInput,
    /** Oracle documents this job parameter as a string, not a JSON boolean. */
    overwrite: z.enum(['true', 'false']).optional(),
  })
  .refine((input) => Boolean(input.reportId || input.reportName), {
    path: ['reportId'],
    message: 'Report ID or report name is required',
  })
export const narrativeRefreshInputSchema = narrativeAuthSchema.extend({
  reportPackageName: z.string().trim().min(1, 'Report package name is required').max(4_096),
  refreshableSources: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
})

const timestamps = {
  createdBy: optionalText,
  creationDate: optionalText,
  modifiedDate: optionalText,
  lastAccessed: optionalText,
}
export const narrativeArtifactSchema = z.object({
  artifactId: identifier,
  name: z.string().max(16_384),
  description: optionalText,
  type: optionalText,
  typeID: optionalText,
  typeLabel: optionalText,
  pathName: optionalText,
  systemPath: optionalText,
  mimeType: optionalText,
  modifiedBy: optionalText,
  favorite: optionalBoolean,
  ordinal: optionalNumber,
  ...timestamps,
})
export const narrativeMemberSchema = z.object({
  memberId: optionalText,
  name: optionalText,
  alias: optionalText,
})
export const narrativePovSchema = z.object({
  dimensionId: optionalText,
  name: optionalText,
  hidden: optionalBoolean,
  fixedSelection: optionalBoolean,
  suggestedMembers: z
    .array(narrativeMemberSchema)
    .max(1_000)
    .nullish()
    .transform((v) => v ?? []),
})
export const narrativePromptSchema = z.object({
  promptId: optionalText,
  label: optionalText,
  dimensionName: optionalText,
  allowMultipleSelections: optionalBoolean,
  sourceElement: optionalText,
  sourceType: optionalText,
  suggestedMembers: z
    .array(narrativeMemberSchema)
    .max(1_000)
    .nullish()
    .transform((v) => v ?? []),
  defaultSelection: z
    .array(narrativeMemberSchema)
    .max(1_000)
    .nullish()
    .transform((v) => v ?? []),
})
export const narrativeReportSchema = z.object({
  reportId: identifier,
  name: z.string().max(16_384),
  description: optionalText,
  instanceType: z
    .enum(['editor', 'result', 'snapshot'])
    .nullish()
    .transform((v) => v ?? null),
  datasourceNames: strings,
  validationMessages: strings,
  invalidFields: strings,
  ...timestamps,
})
export const narrativeBookSchema = z.object({
  bookId: identifier,
  name: z.string().max(16_384),
  description: optionalText,
  pathName: optionalText,
  systemPath: optionalText,
  primaryDatasource: optionalText,
  datasourceNames: strings,
  validationMessages: strings,
  ...timestamps,
})
export const narrativeReportPackageSchema = z.object({
  reportPackageId: identifier,
  name: z.string().max(16_384),
  description: optionalText,
  libraryPath: optionalText,
  reportPackageType: optionalText,
  createdBy: optionalText,
  creationDate: optionalText,
  modifiedBy: optionalText,
  modifiedDate: optionalText,
})

/** Both spellings are documented: the schema uses jobId, the official examples jobID. */
export const narrativeJobSchema = z
  .object({
    jobId: identifier.optional(),
    jobID: identifier.optional(),
    status: z.number().int(),
    descriptiveStatus: optionalText,
    details: optionalText,
    jobName: optionalText,
    /** REFRESH_RP_DS is documented for submission but omitted from Oracle's response enum. */
    jobType: optionalText,
  })
  .superRefine((job, context) => {
    if (!job.jobId && !job.jobID)
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Oracle job response is missing its ID',
      })
    if (job.jobId && job.jobID && job.jobId !== job.jobID)
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'Oracle job response has conflicting IDs',
      })
  })
  .transform(({ jobID, jobId, ...job }) => ({ ...job, jobId: (jobId ?? jobID)! }))

/** A single provider page, never an eager traversal of the repository. */
export function narrativePageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).max(100),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().optional(),
    count: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
    totalResults: z.number().int().nonnegative().optional(),
  })
}

export type NarrativeAuth = z.output<typeof narrativeAuthSchema>
export type NarrativeListInput = z.output<typeof narrativeListInputSchema>
export type NarrativeResourceInput = z.output<typeof narrativeResourceInputSchema>
export type NarrativeDownloadInput = z.output<typeof narrativeDownloadInputSchema>
export type NarrativeCreateFolderInput = z.output<typeof narrativeCreateFolderInputSchema>
export type NarrativeCreateFileInput = z.output<typeof narrativeCreateFileInputSchema>
export type NarrativeWaitInput = z.output<typeof narrativeWaitInputSchema>
export type NarrativeExportInput = z.output<typeof narrativeExportInputSchema>
export type NarrativeImportInput = z.output<typeof narrativeImportInputSchema>
export type NarrativeSnapshotInput = z.output<typeof narrativeSnapshotInputSchema>
export type NarrativeRefreshInput = z.output<typeof narrativeRefreshInputSchema>
export type NarrativeJob = z.output<typeof narrativeJobSchema>

/** Validates a bounded provider response without exposing provider values in schema errors. */
export function parseNarrativeJson<T extends z.ZodType>(
  schema: T,
  response: OracleEpmClientResponse,
  expectedStatus = 200
): z.output<T> {
  if (response.status !== expectedStatus || !('data' in response)) {
    throw oracleEpmLocalError('invalid_response')
  }
  const parsed = schema.safeParse(response.data)
  if (!parsed.success) throw oracleEpmLocalError('invalid_response')
  return parsed.data
}
