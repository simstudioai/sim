import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import type { OciResourceManagerParams } from '@/tools/oci_resource_manager/types'

const id = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value !== '.' && value !== '..')
const text = z.string().min(1)
const strings = z.record(z.string(), z.string())
const tags = {
  freeformTags: strings.optional(),
  definedTags: z.record(z.string(), strings).optional(),
}
const source = { workingDirectory: text.optional() }
const git = {
  configurationSourceProviderId: id,
  repositoryUrl: z.string().url().optional(),
  branchName: text.optional(),
}
const bitbucket = { ...git, projectId: text.optional(), repositoryId: text.optional() }
const devops = { projectId: id, repositoryId: id, branchName: text.max(255).optional() }
const bucket = { region: text, namespace: text, bucketName: text }

/** The public ZIP source uses a stored file; only the operation builds Oracle's base64 field. */
export const createConfigSourceSchema = z.discriminatedUnion('configSourceType', [
  z.object({ ...source, configSourceType: z.literal('ZIP_UPLOAD') }).strict(),
  z.object({ ...source, ...git, configSourceType: z.literal('GIT_CONFIG_SOURCE') }).strict(),
  z
    .object({
      ...source,
      ...git,
      repositoryUrl: z.string().url(),
      workspaceId: text,
      configSourceType: z.literal('BITBUCKET_CLOUD_CONFIG_SOURCE'),
    })
    .strict(),
  z
    .object({
      ...source,
      ...bitbucket,
      repositoryUrl: z.string().url(),
      configSourceType: z.literal('BITBUCKET_SERVER_CONFIG_SOURCE'),
    })
    .strict(),
  z.object({ ...source, ...devops, configSourceType: z.literal('DEVOPS_CONFIG_SOURCE') }).strict(),
  z
    .object({ ...source, ...bucket, configSourceType: z.literal('OBJECT_STORAGE_CONFIG_SOURCE') })
    .strict(),
  z
    .object({ ...source, templateId: id, configSourceType: z.literal('TEMPLATE_CONFIG_SOURCE') })
    .strict(),
  z
    .object({
      ...source,
      compartmentId: id,
      region: text,
      servicesToDiscover: z.array(text).max(100).optional(),
      configSourceType: z.literal('COMPARTMENT_CONFIG_SOURCE'),
    })
    .strict(),
])
export const updateConfigSourceSchema = z.discriminatedUnion('configSourceType', [
  z.object({ ...source, configSourceType: z.literal('ZIP_UPLOAD') }).strict(),
  z.object({ ...source, ...git, configSourceType: z.literal('GIT_CONFIG_SOURCE') }).strict(),
  z
    .object({
      ...source,
      ...git,
      workspaceId: text.optional(),
      configSourceType: z.literal('BITBUCKET_CLOUD_CONFIG_SOURCE'),
    })
    .strict(),
  z
    .object({
      ...source,
      ...bitbucket,
      configSourceType: z.literal('BITBUCKET_SERVER_CONFIG_SOURCE'),
    })
    .strict(),
  z.object({ ...source, ...devops, configSourceType: z.literal('DEVOPS_CONFIG_SOURCE') }).strict(),
  z
    .object({
      ...source,
      region: text.optional(),
      namespace: text.optional(),
      bucketName: text.optional(),
      configSourceType: z.literal('OBJECT_STORAGE_CONFIG_SOURCE'),
    })
    .strict(),
])
const variables = strings.superRefine((value, ctx) => {
  if (
    Object.keys(value).length > 250 ||
    Object.entries(value).some(([key, entry]) => Buffer.byteLength(key + entry, 'utf8') > 8192)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Variables allow 250 entries and 8192 UTF-8 bytes per name and value',
    })
  }
})
const stackSettings = {
  displayName: text.max(255).optional(),
  description: z.string().max(400).optional(),
  terraformVersion: text.max(255).optional(),
  variables: variables.optional(),
  customTerraformProvider: z.object(bucket).strict().optional(),
  ...tags,
}
const auth = { oauthCredential: id, region: text.optional() }
const page = { limit: z.number().int().min(1).max(1000).optional(), page: text.max(512).optional() }
const sort = {
  sortBy: z.enum(['TIMECREATED', 'DISPLAYNAME']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
}
const list = { ...page, ...sort, displayName: text.optional(), id: id.optional() }
const etag = { ifMatch: text.max(1024).optional() }
const token = {
  retryToken: text
    .refine(
      (v) => Buffer.byteLength(v, 'utf8') <= 512 && !/[\u0000-\u001f\u007f]/.test(v),
      'Retry token must be at most 512 bytes without control characters'
    )
    .optional(),
}
const stack = { stackId: id }
const job = { jobId: id }
const work = { workRequestId: id }
const advanced = z
  .object({
    isRefreshRequired: z.boolean().optional(),
    parallelism: z.number().int().min(1).max(1000).optional(),
    detailedLogLevel: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']).optional(),
  })
  .strict()
const submission = {
  ...stack,
  ...token,
  displayName: text.max(255).optional(),
  ...tags,
  isProviderUpgradeRequired: z.boolean().optional(),
}
const planned = { ...submission, terraformAdvancedOptions: advanced.optional() }
const reveal = { includeMessages: z.boolean().optional() }
const logs = {
  ...page,
  type: z.array(z.literal('TERRAFORM_CONSOLE')).max(1).optional(),
  levelGreaterThanOrEqualTo: z
    .enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
    .optional(),
  sortOrder: sort.sortOrder,
  timestampGreaterThanOrEqualTo: z.string().datetime({ offset: true }).optional(),
  timestampLessThanOrEqualTo: z.string().datetime({ offset: true }).optional(),
}
const scoped = { scope: z.enum(['stack', 'job']), stackId: id.optional(), jobId: id.optional() }
const selected = {
  variableNames: z.array(text).max(250).optional(),
  includeVariables: z.boolean().optional(),
}
const schema = <T extends z.ZodRawShape>(shape: T) => z.object({ ...auth, ...shape })

export const ociResourceManagerInputSchemas = {
  list_stacks: schema({
    compartmentId: id,
    ...list,
    lifecycleState: z.enum(['CREATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED']).optional(),
  }),
  get_stack: schema({ ...stack, ...selected, includeSource: z.boolean().optional() }),
  create_stack: schema({
    compartmentId: id,
    configSource: createConfigSourceSchema,
    file: FileInputSchema.optional(),
    ...stackSettings,
    ...token,
  }),
  update_stack: schema({
    ...stack,
    configSource: updateConfigSourceSchema.optional(),
    file: FileInputSchema.optional(),
    ...stackSettings,
    isThirdPartyProviderExperienceEnabled: z.literal(true).optional(),
    ...etag,
  }),
  delete_stack: schema({ ...stack, ...etag, confirmDelete: z.literal(true) }),
  change_stack_compartment: schema({ ...stack, compartmentId: id, ...etag, ...token }),
  list_jobs: schema({
    stackId: id,
    compartmentId: id.optional(),
    ...list,
    lifecycleState: z
      .enum(['ACCEPTED', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED', 'CANCELING', 'CANCELED'])
      .optional(),
  }),
  get_job: schema({ ...job, ...selected, includeSource: z.boolean().optional() }),
  update_job: schema({ ...job, displayName: text.max(255).optional(), ...tags, ...etag }),
  plan: schema(planned),
  apply: schema({
    ...planned,
    executionPlanStrategy: z.enum(['FROM_PLAN_JOB_ID', 'AUTO_APPROVED']),
    executionPlanJobId: id.optional(),
    confirmApply: z.literal(true),
  }),
  destroy: schema({ ...planned, confirmDestroy: z.literal(true) }),
  import_state: schema({
    ...submission,
    file: FileInputSchema,
    confirmStateReplacement: z.literal(true),
  }),
  plan_rollback: schema({ ...planned, targetRollbackJobId: id }),
  apply_rollback: schema({
    ...planned,
    executionPlanRollbackJobId: id,
    confirmApply: z.literal(true),
  }),
  cancel_job: schema({
    ...job,
    ...etag,
    isForced: z.boolean().optional(),
    confirmForce: z.literal(true).optional(),
  }),
  get_job_logs: schema({ ...job, ...logs, ...reveal }),
  download_job_logs: schema({ ...job, kind: z.enum(['console', 'detailed']) }),
  download_configuration: schema(scoped),
  download_state: schema(scoped),
  download_plan: schema({ ...job, tfPlanFormat: z.enum(['BINARY', 'JSON']).optional() }),
  list_job_outputs: schema({
    ...job,
    compartmentId: id.optional(),
    ...page,
    outputNames: z.array(text).max(250).optional(),
    includeValues: z.boolean().optional(),
    includeSensitive: z.boolean().optional(),
  }),
  list_associated_resources: schema({
    ...scoped,
    compartmentId: id.optional(),
    terraformResourceType: text.optional(),
    ...page,
    includeAttributes: z.boolean().optional(),
  }),
  detect_drift: schema({
    ...stack,
    ...etag,
    ...token,
    resourceAddresses: z.array(text).max(1000).optional(),
    isProviderUpgradeRequired: z.boolean().optional(),
  }),
  list_drift_details: schema({
    ...stack,
    workRequestId: id.optional(),
    resourceDriftStatus: z
      .array(z.enum(['NOT_CHECKED', 'IN_SYNC', 'MODIFIED', 'DELETED']))
      .max(4)
      .optional(),
    ...page,
    includeProperties: z.boolean().optional(),
  }),
  list_work_requests: schema({ compartmentId: id, resourceId: id.optional(), ...page }),
  get_work_request: schema(work),
  list_work_request_errors: schema({
    ...work,
    compartmentId: id.optional(),
    ...page,
    sortOrder: sort.sortOrder,
    ...reveal,
  }),
  get_work_request_logs: schema({
    ...work,
    kind: z.enum(['service', 'terraform']),
    outputMode: z.enum(['entries', 'file']).optional(),
    compartmentId: id.optional(),
    ...logs,
    ...reveal,
  }),
  list_terraform_versions: schema({ compartmentId: id.optional() }),
  list_configuration_source_providers: schema({
    compartmentId: id,
    configurationSourceProviderId: id.optional(),
    configSourceProviderType: z
      .enum([
        'GITHUB_ACCESS_TOKEN',
        'GITLAB_ACCESS_TOKEN',
        'BITBUCKET_CLOUD_ACCESS_TOKEN',
        'BITBUCKET_SERVER_ACCESS_TOKEN',
      ])
      .optional(),
    ...page,
    ...sort,
    displayName: text.optional(),
  }),
  list_templates: schema({
    compartmentId: id.optional(),
    templateCategoryId: text.optional(),
    templateId: id.optional(),
    displayName: text.optional(),
    ...page,
    ...sort,
  }),
  list_resource_discovery_services: schema({ compartmentId: id.optional() }),
}
export type OciResourceManagerOperation = keyof typeof ociResourceManagerInputSchemas
export type OciResourceManagerInput = z.infer<
  (typeof ociResourceManagerInputSchemas)[OciResourceManagerOperation]
>

export function parseOciResourceManagerInput(
  operation: OciResourceManagerOperation,
  input: unknown
) {
  const parsed = ociResourceManagerInputSchemas[operation].safeParse(input)
  if (!parsed.success)
    throw new Error(
      'Invalid OCI Resource Manager parameters; check required fields, types, and limits'
    )
  const value: OciResourceManagerParams = parsed.data
  if (
    'scope' in value &&
    (value.scope === 'stack' ? !value.stackId || value.jobId : !value.jobId || value.stackId)
  )
    throw new Error('Provide only the ID matching the selected scope')
  if ('includeVariables' in value && value.includeVariables && !value.variableNames?.length)
    throw new Error('Select variable names before revealing values')
  if ('includeValues' in value && value.includeValues && !value.outputNames?.length)
    throw new Error('Select output names before revealing values')
  if ('isForced' in value && value.isForced && !value.confirmForce)
    throw new Error('Forced cancellation requires confirmation')
  if (
    'executionPlanStrategy' in value &&
    (value.executionPlanStrategy === 'FROM_PLAN_JOB_ID'
      ? !value.executionPlanJobId
      : value.executionPlanJobId !== undefined)
  )
    throw new Error('Select a plan ID only for FROM_PLAN_JOB_ID')
  if (
    (operation === 'create_stack' || operation === 'update_stack') &&
    value.file &&
    value.configSource?.configSourceType !== 'ZIP_UPLOAD'
  )
    throw new Error('Configuration files require ZIP_UPLOAD source')
  if (
    operation === 'create_stack' &&
    value.configSource?.configSourceType === 'ZIP_UPLOAD' &&
    !value.file
  )
    throw new Error('ZIP_UPLOAD requires an uploaded file')
  if (
    operation === 'get_work_request_logs' &&
    'kind' in value &&
    value.kind === 'service' &&
    'outputMode' in value &&
    value.outputMode === 'file'
  )
    throw new Error('File output is available only for Terraform work-request logs')
  if (operation === 'get_work_request_logs' && 'kind' in value) {
    const filters = [
      'type',
      'levelGreaterThanOrEqualTo',
      'timestampGreaterThanOrEqualTo',
      'timestampLessThanOrEqualTo',
    ] as const
    if (value.kind === 'service' && filters.some((key) => value[key] !== undefined))
      throw new Error('Terraform log filters are unavailable for service logs')
    if (
      'outputMode' in value &&
      value.outputMode === 'file' &&
      ([...filters, 'limit', 'page', 'sortOrder', 'compartmentId'] as const).some(
        (key) => value[key] !== undefined
      )
    )
      throw new Error('Log file downloads do not support entry filters')
    if (value.kind === 'terraform' && value.compartmentId !== undefined)
      throw new Error('Terraform work-request logs do not accept a compartment filter')
  }
  return value
}
