import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  associatedResponseSchema,
  discoveryResponseSchema,
  driftResponseSchema,
  jobResponseSchema,
  logResponseSchema,
  OCI_RESOURCE_MANAGER_FILE_LIMIT,
  OCI_RESOURCE_MANAGER_ZIP_LIMIT,
  OciResourceManagerError,
  outputResponseSchema,
  type PreparedOciResourceManagerClient,
  parseResponse,
  providerResponseSchema,
  type ResourceManagerRequest,
  requestResourceManager,
  resourcePath,
  responseJson,
  stackResponseSchema,
  templateResponseSchema,
  versionResponseSchema,
  workResponseSchema,
} from '@/lib/internal/oci-resource-manager/client'
import type { OciResourceManagerOperation } from '@/lib/internal/oci-resource-manager/input'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { parseRawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'
import type {
  OciResourceManagerParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'

const logger = createLogger('OciResourceManager')
export interface OciResourceManagerContext {
  prepared: PreparedOciResourceManagerClient
  userId: string
  workspaceId: string
  workflowId: string
  executionId?: string
  requestId: string
  signal?: AbortSignal
}
export const OCI_RESOURCE_MANAGER_MUTATIONS = new Set<OciResourceManagerOperation>([
  'create_stack',
  'update_stack',
  'delete_stack',
  'change_stack_compartment',
  'update_job',
  'plan',
  'apply',
  'destroy',
  'import_state',
  'plan_rollback',
  'apply_rollback',
  'cancel_job',
  'detect_drift',
])
const pageKeys = ['limit', 'page']
const listKeys = [
  ...pageKeys,
  'compartmentId',
  'id',
  'displayName',
  'lifecycleState',
  'sortBy',
  'sortOrder',
]
const logKeys = [
  ...pageKeys,
  'type',
  'levelGreaterThanOrEqualTo',
  'sortOrder',
  'timestampGreaterThanOrEqualTo',
  'timestampLessThanOrEqualTo',
]
const stackKeys = [
  'displayName',
  'description',
  'terraformVersion',
  'variables',
  'customTerraformProvider',
  'freeformTags',
  'definedTags',
]
function pick(input: object, keys: readonly string[]): Record<string, unknown> {
  const record = input as Record<string, unknown>
  return Object.fromEntries(
    keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
  )
}
function query(
  input: OciResourceManagerParams,
  keys: readonly string[],
  paginated = false
): [string, string][] {
  const values = pick(input, keys)
  if (paginated && values.limit === undefined) values.limit = 50
  return Object.entries(values).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map(
      (entry) => [key, String(entry)] as [string, string]
    )
  )
}
function normalize<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item ?? null]))
}
export function projectResource(
  kind: 'stack' | 'job',
  raw: unknown,
  input: Pick<OciResourceManagerParams, 'includeVariables' | 'variableNames' | 'includeSource'> = {}
) {
  const parsed =
    kind === 'stack'
      ? parseResponse(stackResponseSchema, raw)
      : parseResponse(jobResponseSchema, raw)
  const { variables, configSource, ...metadata } = parsed
  return {
    ...normalize(metadata),
    ...(input.includeVariables
      ? {
          variables: Object.fromEntries(
            (input.variableNames ?? [])
              .filter((name) => variables && Object.hasOwn(variables, name))
              .map((name) => [name, variables?.[name]])
          ),
        }
      : {}),
    ...(input.includeSource ? { configSource: configSource ? normalize(configSource) : null } : {}),
  }
}
async function fileBytes(
  input: unknown,
  limit: number,
  context: OciResourceManagerContext
): Promise<Buffer> {
  context.signal?.throwIfAborted()
  const raw = parseRawFileInput(input)
  if (!raw) throw new OciResourceManagerError('Provide an uploaded file reference')
  const file = processSingleFileToUserFile(raw, context.requestId, logger)
  if (!file?.key) throw new OciResourceManagerError('Provide an uploaded file reference')
  const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
  if (denied) throw new OciResourceManagerError('File not found', denied.status)
  if (file.size > limit)
    throw new OciResourceManagerError('File exceeds the operation byte limit', 413)
  try {
    const result = await downloadServableFileFromStorage(file, context.requestId, logger, {
      maxBytes: limit,
      signal: context.signal,
    })
    if (result.buffer.byteLength > limit)
      throw new OciResourceManagerError('File exceeds the operation byte limit', 413)
    return result.buffer
  } catch (error) {
    if (error instanceof OciResourceManagerError) throw error
    throw new OciResourceManagerError(
      'Unable to read uploaded file',
      isPayloadSizeLimitError(error) ? 413 : 400
    )
  }
}
async function storeFile(
  bytes: Uint8Array,
  name: string,
  contentType: string,
  context: OciResourceManagerContext
): Promise<UserFile> {
  context.signal?.throwIfAborted()
  if (bytes.byteLength > OCI_RESOURCE_MANAGER_FILE_LIMIT)
    throw new OciResourceManagerError('Download exceeds the file byte limit', 413)
  const buffer = Buffer.from(bytes)
  if (context.executionId)
    return uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      buffer,
      name,
      contentType,
      context.userId
    )
  return uploadCopilotFile({ buffer, fileName: name, contentType, userId: context.userId })
}
async function sourceDetails(input: OciResourceManagerParams, context: OciResourceManagerContext) {
  if (!input.configSource) return undefined
  return {
    ...input.configSource,
    ...(input.file
      ? {
          zipFileBase64Encoded: (
            await fileBytes(input.file, OCI_RESOURCE_MANAGER_ZIP_LIMIT, context)
          ).toString('base64'),
        }
      : {}),
  }
}
async function requireSuccessfulJob(
  id: string,
  stackId: string,
  operation: string,
  context: OciResourceManagerContext
) {
  const response = await requestResourceManager(
    context.prepared,
    { method: 'GET', path: resourcePath('jobs', id) },
    context.signal
  )
  const job = parseResponse(jobResponseSchema, responseJson(response))
  if (job.stackId !== stackId || job.operation !== operation || job.lifecycleState !== 'SUCCEEDED')
    throw new OciResourceManagerError(`Select a successful ${operation} job from the same stack`)
}

export async function executeOciResourceManagerOperation(
  operation: OciResourceManagerOperation,
  input: OciResourceManagerParams,
  context: OciResourceManagerContext
): Promise<OciResourceManagerResponse> {
  const scopedPath = (suffix: string) =>
    input.scope === 'stack'
      ? resourcePath('stacks', input.stackId, suffix)
      : resourcePath('jobs', input.jobId, suffix)
  let request: ResourceManagerRequest
  let resultKey = ''
  let itemSchema: z.ZodType = z.object({})
  let collection = false
  let wrapped = false
  let fileName: string | undefined
  let contentType = 'application/octet-stream'
  switch (operation) {
    case 'create_stack':
      request = {
        method: 'POST',
        path: resourcePath('stacks'),
        body: {
          compartmentId: input.compartmentId,
          ...pick(input, stackKeys),
          configSource: await sourceDetails(input, context),
        },
        retryToken: input.retryToken,
      }
      resultKey = 'stack'
      break
    case 'update_stack':
      request = {
        method: 'PUT',
        path: resourcePath('stacks', input.stackId),
        body: {
          ...pick(input, [...stackKeys, 'isThirdPartyProviderExperienceEnabled']),
          ...(input.configSource ? { configSource: await sourceDetails(input, context) } : {}),
        },
        ifMatch: input.ifMatch,
      }
      resultKey = 'stack'
      break
    case 'get_stack':
      request = { method: 'GET', path: resourcePath('stacks', input.stackId) }
      resultKey = 'stack'
      break
    case 'list_stacks':
      request = { method: 'GET', path: resourcePath('stacks'), query: query(input, listKeys, true) }
      resultKey = 'stacks'
      collection = true
      itemSchema = stackResponseSchema
      break
    case 'delete_stack':
      request = {
        method: 'DELETE',
        path: resourcePath('stacks', input.stackId),
        ifMatch: input.ifMatch,
        expectedStatus: 204,
      }
      break
    case 'change_stack_compartment':
      request = {
        method: 'POST',
        path: resourcePath('stacks', input.stackId, '/actions/changeCompartment'),
        body: { compartmentId: input.compartmentId },
        ifMatch: input.ifMatch,
        retryToken: input.retryToken,
        expectedStatus: 202,
      }
      break
    case 'plan':
    case 'apply':
    case 'destroy':
    case 'import_state':
    case 'plan_rollback':
    case 'apply_rollback': {
      const details: Record<string, unknown> = {
        operation: operation === 'import_state' ? 'IMPORT_TF_STATE' : operation.toUpperCase(),
        ...pick(input, ['isProviderUpgradeRequired', 'terraformAdvancedOptions']),
      }
      if (operation === 'apply') {
        details.executionPlanStrategy = input.executionPlanStrategy
        if (input.executionPlanStrategy === 'FROM_PLAN_JOB_ID') {
          await requireSuccessfulJob(input.executionPlanJobId!, input.stackId!, 'PLAN', context)
          details.executionPlanJobId = input.executionPlanJobId
        }
      }
      if (operation === 'destroy') details.executionPlanStrategy = 'AUTO_APPROVED'
      if (operation === 'import_state')
        details.tfStateBase64Encoded = (
          await fileBytes(input.file, OCI_RESOURCE_MANAGER_FILE_LIMIT, context)
        ).toString('base64')
      if (operation === 'plan_rollback') {
        await requireSuccessfulJob(input.targetRollbackJobId!, input.stackId!, 'APPLY', context)
        details.targetRollbackJobId = input.targetRollbackJobId
      }
      if (operation === 'apply_rollback') {
        await requireSuccessfulJob(
          input.executionPlanRollbackJobId!,
          input.stackId!,
          'PLAN_ROLLBACK',
          context
        )
        details.executionPlanRollbackStrategy = 'FROM_PLAN_ROLLBACK_JOB_ID'
        details.executionPlanRollbackJobId = input.executionPlanRollbackJobId
      }
      request = {
        method: 'POST',
        path: resourcePath('jobs'),
        body: {
          ...pick(input, ['stackId', 'displayName', 'freeformTags', 'definedTags']),
          jobOperationDetails: details,
        },
        retryToken: input.retryToken,
      }
      resultKey = 'job'
      break
    }
    case 'get_job':
      request = { method: 'GET', path: resourcePath('jobs', input.jobId) }
      resultKey = 'job'
      break
    case 'update_job':
      request = {
        method: 'PUT',
        path: resourcePath('jobs', input.jobId),
        body: pick(input, ['displayName', 'freeformTags', 'definedTags']),
        ifMatch: input.ifMatch,
      }
      resultKey = 'job'
      break
    case 'list_jobs':
      request = {
        method: 'GET',
        path: resourcePath('jobs'),
        query: query(input, [...listKeys, 'stackId'], true),
      }
      resultKey = 'jobs'
      collection = true
      itemSchema = jobResponseSchema
      break
    case 'cancel_job':
      request = {
        method: 'DELETE',
        path: resourcePath('jobs', input.jobId),
        query: query(input, ['isForced']),
        ifMatch: input.ifMatch,
        expectedStatus: 202,
      }
      break
    case 'get_job_logs':
      request = {
        method: 'GET',
        path: resourcePath('jobs', input.jobId, '/logs'),
        query: query(input, logKeys, true),
      }
      resultKey = 'logs'
      collection = true
      itemSchema = logResponseSchema
      break
    case 'download_job_logs':
      request = {
        method: 'GET',
        path: resourcePath(
          'jobs',
          input.jobId,
          input.kind === 'detailed' ? '/detailedLogContent' : '/logs/content'
        ),
        binary: true,
      }
      fileName = 'resource-manager-job.log'
      contentType = 'text/plain'
      break
    case 'download_configuration':
      request = { method: 'GET', path: scopedPath('/tfConfig'), binary: true }
      fileName = 'resource-manager-configuration.zip'
      contentType = 'application/zip'
      break
    case 'download_state':
      request = { method: 'GET', path: scopedPath('/tfState'), binary: true }
      fileName = 'resource-manager.tfstate'
      break
    case 'download_plan':
      request = {
        method: 'GET',
        path: resourcePath('jobs', input.jobId, '/tfPlan'),
        query: query(input, ['tfPlanFormat']),
        binary: true,
      }
      fileName =
        input.tfPlanFormat === 'JSON' ? 'resource-manager-plan.json' : 'resource-manager.tfplan'
      break
    case 'list_job_outputs':
      request = {
        method: 'GET',
        path: resourcePath('jobs', input.jobId, '/outputs'),
        query: query(input, [...pageKeys, 'compartmentId'], true),
      }
      resultKey = 'outputs'
      collection = true
      wrapped = true
      itemSchema = outputResponseSchema
      break
    case 'list_associated_resources':
      request = {
        method: 'GET',
        path: scopedPath('/associatedResources'),
        query: query(input, [...pageKeys, 'compartmentId', 'terraformResourceType'], true),
      }
      resultKey = 'resources'
      collection = true
      wrapped = true
      itemSchema = associatedResponseSchema
      break
    case 'detect_drift':
      request = {
        method: 'POST',
        path: resourcePath('stacks', input.stackId, '/actions/detectDrift'),
        body: pick(input, ['resourceAddresses', 'isProviderUpgradeRequired']),
        ifMatch: input.ifMatch,
        retryToken: input.retryToken,
        expectedStatus: 202,
      }
      break
    case 'list_drift_details':
      request = {
        method: 'POST',
        path: resourcePath('stacks', input.stackId, '/actions/listResourceDriftDetails'),
        query: query(input, [...pageKeys, 'workRequestId', 'resourceDriftStatus'], true),
      }
      resultKey = 'driftDetails'
      collection = true
      wrapped = true
      itemSchema = driftResponseSchema
      break
    case 'list_work_requests':
      request = {
        method: 'GET',
        path: resourcePath('workRequests'),
        query: query(input, [...pageKeys, 'compartmentId', 'resourceId'], true),
      }
      resultKey = 'workRequests'
      collection = true
      itemSchema = workResponseSchema
      break
    case 'get_work_request':
      request = { method: 'GET', path: resourcePath('workRequests', input.workRequestId) }
      resultKey = 'workRequest'
      break
    case 'list_work_request_errors':
      request = {
        method: 'GET',
        path: resourcePath('workRequests', input.workRequestId, '/errors'),
        query: query(input, [...pageKeys, 'compartmentId', 'sortOrder'], true),
      }
      resultKey = 'errors'
      collection = true
      itemSchema = logResponseSchema
      break
    case 'get_work_request_logs': {
      const terraform = input.kind === 'terraform'
      const file = input.outputMode === 'file'
      request = {
        method: 'GET',
        path: resourcePath(
          'workRequests',
          input.workRequestId,
          terraform ? `/logEntries${file ? '/content' : ''}` : '/logs'
        ),
        query: file
          ? undefined
          : query(input, terraform ? logKeys : [...pageKeys, 'compartmentId', 'sortOrder'], true),
        binary: file,
      }
      if (file) {
        fileName = 'resource-manager-work-request.log'
        contentType = 'text/plain'
      } else {
        resultKey = 'logs'
        collection = true
        wrapped = terraform
        itemSchema = logResponseSchema
      }
      break
    }
    case 'list_terraform_versions':
      request = {
        method: 'GET',
        path: '/20180917/terraformVersions',
        query: query(input, ['compartmentId']),
      }
      resultKey = 'versions'
      collection = true
      wrapped = true
      itemSchema = versionResponseSchema
      break
    case 'list_configuration_source_providers':
      request = {
        method: 'GET',
        path: '/20180917/configurationSourceProviders',
        query: query(
          input,
          [
            ...pageKeys,
            'compartmentId',
            'configurationSourceProviderId',
            'displayName',
            'configSourceProviderType',
            'sortBy',
            'sortOrder',
          ],
          true
        ),
      }
      resultKey = 'providers'
      collection = true
      wrapped = true
      itemSchema = providerResponseSchema
      break
    case 'list_templates':
      request = {
        method: 'GET',
        path: '/20180917/templates',
        query: query(
          input,
          [
            ...pageKeys,
            'compartmentId',
            'templateCategoryId',
            'templateId',
            'displayName',
            'sortBy',
            'sortOrder',
          ],
          true
        ),
      }
      resultKey = 'templates'
      collection = true
      wrapped = true
      itemSchema = templateResponseSchema
      break
    case 'list_resource_discovery_services':
      request = {
        method: 'GET',
        path: '/20180917/resourceDiscoveryServices',
        query: query(input, ['compartmentId']),
      }
      resultKey = 'services'
      collection = true
      wrapped = true
      itemSchema = discoveryResponseSchema
      break
  }
  const response = await requestResourceManager(context.prepared, request, context.signal)
  const output: OciResourceManagerResponse['output'] = {
    status: response.status,
    opcRequestId: response.opcRequestId,
    etag: response.headers.etag,
    nextPage: response.headers['opc-next-page'],
    workRequestId: response.headers['opc-work-request-id'],
  }
  if (fileName) output.file = await storeFile(response.body, fileName, contentType, context)
  else if (response.status === 202 || response.status === 204)
    Object.assign(output, {
      ...pick(input, ['stackId', 'jobId']),
      accepted: response.status === 202,
    })
  else {
    const raw = responseJson(response)
    if (collection) {
      const rows = wrapped
        ? parseResponse(z.object({ items: z.array(itemSchema).max(1000) }), raw).items
        : parseResponse(z.array(itemSchema).max(1000), raw)
      output[resultKey] = rows.map((row) => {
        if (resultKey === 'stacks' || resultKey === 'jobs')
          return projectResource(resultKey === 'stacks' ? 'stack' : 'job', row)
        const value = normalize(row as Record<string, unknown>)
        if (!input.includeMessages) value.message = undefined
        if (!input.includeAttributes) value.attributes = undefined
        if (!input.includeProperties) {
          value.actualProperties = undefined
          value.expectedProperties = undefined
        }
        if (
          resultKey === 'outputs' &&
          (!input.includeValues ||
            !input.outputNames?.includes(String(value.outputName)) ||
            (value.isSensitive !== false && !input.includeSensitive))
        )
          value.outputValue = undefined
        return value
      })
    } else if (resultKey === 'stack' || resultKey === 'job')
      output[resultKey] = projectResource(resultKey, raw, input)
    else output.workRequest = normalize(parseResponse(workResponseSchema, raw))
  }
  return { success: true, output }
}
