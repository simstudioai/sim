import { isPlainRecord } from '@sim/utils/object'
import type { z } from 'zod'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient, type OciClient } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import { operationSchemas, resourceSchema } from '@/lib/internal/oci-devops/schema'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { OCI_SERVICE_ID } from '@/lib/oauth/types'
import type {
  OciDevopsAction,
  OciDevopsResource,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'

const ENDPOINT_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_SERVICE_ID,
  serviceName: 'devops',
  hostnameTemplate: 'regional-oci',
})
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_INPUT_BYTES = 256 * 1024

interface OperationDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query: readonly string[]
  bodyFields: readonly string[]
  wrapper?: string
  parent?: string
  status: number
  list: boolean
  identity?: string
}

export const operationDefinitions = {
  approve_deployment: {
    method: 'POST',
    path: '/deployments/{deploymentId}/actions/approve',
    query: [],
    bodyFields: ['action', 'deployStageId', 'reason'],
    status: 200,
    list: false,
    identity: 'id',
  },
  cancel_build_run: {
    method: 'POST',
    path: '/buildRuns/{buildRunId}/actions/cancel',
    query: [],
    bodyFields: ['reason'],
    status: 202,
    list: false,
    identity: 'id',
  },
  cancel_deployment: {
    method: 'POST',
    path: '/deployments/{deploymentId}/actions/cancel',
    query: [],
    bodyFields: ['reason'],
    status: 200,
    list: false,
    identity: 'id',
  },
  create_build_pipeline: {
    method: 'POST',
    path: '/buildPipelines',
    query: [],
    bodyFields: [
      'buildPipelineParameters',
      'definedTags',
      'description',
      'displayName',
      'freeformTags',
      'projectId',
    ],
    status: 201,
    list: false,
    identity: 'id',
  },
  create_build_pipeline_stage: {
    method: 'POST',
    path: '/buildPipelineStages',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'stage',
    parent: 'buildPipelineId',
    identity: 'id',
  },
  create_build_run: {
    method: 'POST',
    path: '/buildRuns',
    query: [],
    bodyFields: [
      'buildPipelineId',
      'buildRunArguments',
      'commitInfo',
      'definedTags',
      'displayName',
      'freeformTags',
    ],
    status: 200,
    list: false,
    identity: 'id',
  },
  create_connection: {
    method: 'POST',
    path: '/connections',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'connection',
    parent: 'projectId',
    identity: 'id',
  },
  create_deploy_artifact: {
    method: 'POST',
    path: '/deployArtifacts',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'artifact',
    parent: 'projectId',
    identity: 'id',
  },
  create_deploy_environment: {
    method: 'POST',
    path: '/deployEnvironments',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'environment',
    parent: 'projectId',
    identity: 'id',
  },
  create_deploy_pipeline: {
    method: 'POST',
    path: '/deployPipelines',
    query: [],
    bodyFields: [
      'definedTags',
      'deployPipelineParameters',
      'description',
      'displayName',
      'freeformTags',
      'projectId',
    ],
    status: 201,
    list: false,
    identity: 'id',
  },
  create_deploy_stage: {
    method: 'POST',
    path: '/deployStages',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'stage',
    parent: 'deployPipelineId',
    identity: 'id',
  },
  create_deployment: {
    method: 'POST',
    path: '/deployments',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    wrapper: 'deployment',
    parent: 'deployPipelineId',
    identity: 'id',
  },
  create_project: {
    method: 'POST',
    path: '/projects',
    query: [],
    bodyFields: [
      'compartmentId',
      'definedTags',
      'description',
      'freeformTags',
      'name',
      'notificationConfig',
    ],
    status: 201,
    list: false,
    identity: 'id',
  },
  create_repository: {
    method: 'POST',
    path: '/repositories',
    query: [],
    bodyFields: [
      'defaultBranch',
      'definedTags',
      'description',
      'freeformTags',
      'mirrorRepositoryConfig',
      'name',
      'parentRepositoryId',
      'projectId',
      'repositoryType',
    ],
    status: 201,
    list: false,
    identity: 'id',
  },
  create_trigger: {
    method: 'POST',
    path: '/triggers',
    query: [],
    bodyFields: [],
    status: 201,
    list: false,
    wrapper: 'trigger',
    parent: 'projectId',
    identity: 'id',
  },
  delete_build_pipeline: {
    method: 'DELETE',
    path: '/buildPipelines/{buildPipelineId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_build_pipeline_stage: {
    method: 'DELETE',
    path: '/buildPipelineStages/{buildPipelineStageId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_connection: {
    method: 'DELETE',
    path: '/connections/{connectionId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_deploy_artifact: {
    method: 'DELETE',
    path: '/deployArtifacts/{deployArtifactId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_deploy_environment: {
    method: 'DELETE',
    path: '/deployEnvironments/{deployEnvironmentId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_deploy_pipeline: {
    method: 'DELETE',
    path: '/deployPipelines/{deployPipelineId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_deploy_stage: {
    method: 'DELETE',
    path: '/deployStages/{deployStageId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_project: {
    method: 'DELETE',
    path: '/projects/{projectId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_repository: {
    method: 'DELETE',
    path: '/repositories/{repositoryId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  delete_trigger: {
    method: 'DELETE',
    path: '/triggers/{triggerId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
  },
  get_build_pipeline: {
    method: 'GET',
    path: '/buildPipelines/{buildPipelineId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_build_pipeline_stage: {
    method: 'GET',
    path: '/buildPipelineStages/{buildPipelineStageId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_build_run: {
    method: 'GET',
    path: '/buildRuns/{buildRunId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_commit: {
    method: 'GET',
    path: '/repositories/{repositoryId}/commits/{commitId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'commitId',
  },
  get_connection: {
    method: 'GET',
    path: '/connections/{connectionId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_deploy_artifact: {
    method: 'GET',
    path: '/deployArtifacts/{deployArtifactId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_deploy_environment: {
    method: 'GET',
    path: '/deployEnvironments/{deployEnvironmentId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_deploy_pipeline: {
    method: 'GET',
    path: '/deployPipelines/{deployPipelineId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_deploy_stage: {
    method: 'GET',
    path: '/deployStages/{deployStageId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_deployment: {
    method: 'GET',
    path: '/deployments/{deploymentId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_project: {
    method: 'GET',
    path: '/projects/{projectId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_repository: {
    method: 'GET',
    path: '/repositories/{repositoryId}',
    query: ['fields'],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_trigger: {
    method: 'GET',
    path: '/triggers/{triggerId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  get_work_request: {
    method: 'GET',
    path: '/workRequests/{workRequestId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
  list_build_pipeline_stages: {
    method: 'GET',
    path: '/buildPipelineStages',
    query: [
      'id',
      'buildPipelineId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_build_pipelines: {
    method: 'GET',
    path: '/buildPipelines',
    query: [
      'id',
      'projectId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_build_runs: {
    method: 'GET',
    path: '/buildRuns',
    query: [
      'id',
      'buildPipelineId',
      'projectId',
      'compartmentId',
      'displayName',
      'lifecycleState',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_commits: {
    method: 'GET',
    path: '/repositories/{repositoryId}/commits',
    query: [
      'refName',
      'excludeRefName',
      'filePath',
      'timestampGreaterThanOrEqualTo',
      'timestampLessThanOrEqualTo',
      'commitMessage',
      'authorName',
      'limit',
      'page',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'commitId',
  },
  list_connections: {
    method: 'GET',
    path: '/connections',
    query: [
      'id',
      'projectId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'connectionType',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_deploy_artifacts: {
    method: 'GET',
    path: '/deployArtifacts',
    query: [
      'id',
      'projectId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_deploy_environments: {
    method: 'GET',
    path: '/deployEnvironments',
    query: [
      'projectId',
      'compartmentId',
      'id',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_deploy_pipelines: {
    method: 'GET',
    path: '/deployPipelines',
    query: [
      'id',
      'projectId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_deploy_stages: {
    method: 'GET',
    path: '/deployStages',
    query: [
      'id',
      'deployPipelineId',
      'compartmentId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_deployments: {
    method: 'GET',
    path: '/deployments',
    query: [
      'deployPipelineId',
      'id',
      'compartmentId',
      'projectId',
      'lifecycleState',
      'displayName',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
      'timeCreatedLessThan',
      'timeCreatedGreaterThanOrEqualTo',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_paths: {
    method: 'GET',
    path: '/repositories/{repositoryId}/paths',
    query: [
      'ref',
      'pathsInSubtree',
      'folderPath',
      'limit',
      'page',
      'displayName',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
  },
  list_projects: {
    method: 'GET',
    path: '/projects',
    query: [
      'id',
      'compartmentId',
      'lifecycleState',
      'name',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_refs: {
    method: 'GET',
    path: '/repositories/{repositoryId}/refs',
    query: ['refType', 'commitId', 'limit', 'page', 'refName', 'sortOrder', 'sortBy'],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'refName',
  },
  list_repositories: {
    method: 'GET',
    path: '/repositories',
    query: [
      'compartmentId',
      'projectId',
      'repositoryId',
      'lifecycleState',
      'name',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_triggers: {
    method: 'GET',
    path: '/triggers',
    query: [
      'compartmentId',
      'projectId',
      'lifecycleState',
      'displayName',
      'id',
      'limit',
      'page',
      'sortOrder',
      'sortBy',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  list_work_request_errors: {
    method: 'GET',
    path: '/workRequests/{workRequestId}/errors',
    query: ['page', 'limit', 'sortOrder', 'sortBy'],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'code',
  },
  list_work_requests: {
    method: 'GET',
    path: '/workRequests',
    query: [
      'compartmentId',
      'workRequestId',
      'status',
      'resourceId',
      'page',
      'limit',
      'sortOrder',
      'sortBy',
      'operationTypeMultiValueQuery',
    ],
    bodyFields: [],
    status: 200,
    list: true,
    identity: 'id',
  },
  update_build_pipeline: {
    method: 'PUT',
    path: '/buildPipelines/{buildPipelineId}',
    query: [],
    bodyFields: [
      'buildPipelineParameters',
      'definedTags',
      'description',
      'displayName',
      'freeformTags',
    ],
    status: 202,
    list: false,
    identity: 'id',
  },
  update_build_pipeline_stage: {
    method: 'PUT',
    path: '/buildPipelineStages/{buildPipelineStageId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'stage',
    identity: 'id',
  },
  update_build_run: {
    method: 'PUT',
    path: '/buildRuns/{buildRunId}',
    query: [],
    bodyFields: ['definedTags', 'displayName', 'freeformTags'],
    status: 200,
    list: false,
    identity: 'id',
  },
  update_connection: {
    method: 'PUT',
    path: '/connections/{connectionId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'connection',
    identity: 'id',
  },
  update_deploy_artifact: {
    method: 'PUT',
    path: '/deployArtifacts/{deployArtifactId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'artifact',
    identity: 'id',
  },
  update_deploy_environment: {
    method: 'PUT',
    path: '/deployEnvironments/{deployEnvironmentId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'environment',
    identity: 'id',
  },
  update_deploy_pipeline: {
    method: 'PUT',
    path: '/deployPipelines/{deployPipelineId}',
    query: [],
    bodyFields: [
      'definedTags',
      'deployPipelineParameters',
      'description',
      'displayName',
      'freeformTags',
    ],
    status: 202,
    list: false,
    identity: 'id',
  },
  update_deploy_stage: {
    method: 'PUT',
    path: '/deployStages/{deployStageId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'stage',
    identity: 'id',
  },
  update_deployment: {
    method: 'PUT',
    path: '/deployments/{deploymentId}',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    wrapper: 'deployment',
    identity: 'id',
  },
  update_project: {
    method: 'PUT',
    path: '/projects/{projectId}',
    query: [],
    bodyFields: ['definedTags', 'description', 'freeformTags', 'notificationConfig'],
    status: 202,
    list: false,
    identity: 'id',
  },
  update_repository: {
    method: 'PUT',
    path: '/repositories/{repositoryId}',
    query: [],
    bodyFields: [
      'defaultBranch',
      'definedTags',
      'description',
      'freeformTags',
      'mirrorRepositoryConfig',
      'name',
      'repositoryType',
    ],
    status: 200,
    list: false,
    identity: 'id',
  },
  update_trigger: {
    method: 'PUT',
    path: '/triggers/{triggerId}',
    query: [],
    bodyFields: [],
    status: 202,
    list: false,
    wrapper: 'trigger',
    identity: 'id',
  },
  validate_connection: {
    method: 'POST',
    path: '/connections/{connectionId}/actions/validate',
    query: [],
    bodyFields: [],
    status: 200,
    list: false,
    identity: 'id',
  },
} satisfies Record<OciDevopsAction, OperationDefinition>

/** A child-owned error containing only safe status and input-field diagnostics. */
export class OciDevopsError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'OciDevopsError'
  }
}

export function parseOperationInput(
  action: OciDevopsAction,
  input: unknown
): Record<string, unknown> {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    throw new OciDevopsError(400, 'OCI DevOps input must be JSON')
  }
  if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) {
    throw new OciDevopsError(413, 'OCI DevOps input exceeds 256 KiB')
  }
  const schema: z.ZodType<Record<string, unknown>> = operationSchemas[action]
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].slice(
      0,
      3
    )
    throw new OciDevopsError(
      400,
      `Invalid OCI DevOps input fields: ${fields.join(', ') || 'input'}`
    )
  }
  return parsed.data
}

/** Credential membership and workspace resolution precede all provider work. */
export async function executeOciDevopsOperation(
  action: OciDevopsAction,
  rawInput: unknown,
  context: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<OciDevopsResponse> {
  signal?.throwIfAborted()
  const input = parseOperationInput(action, rawInput)
  if (!context.userId || !context.workspaceId) {
    throw new OciDevopsError(401, 'OCI DevOps requires an authenticated workspace context')
  }
  const access = await authorizeCredentialUseForAuth(
    { success: true, userId: context.userId, authType: AuthType.INTERNAL_JWT },
    {
      credentialId: String(input.oauthCredential),
      callerUserId: context.userId,
      workspaceId: context.workspaceId,
      ...(context.workflowId ? { workflowId: context.workflowId } : {}),
    }
  )
  if (!access.ok || !access.resolvedCredentialId || access.workspaceId !== context.workspaceId) {
    throw new OciDevopsError(403, 'OCI credential is unavailable in this workspace')
  }
  const client = await createOciClient({
    credentialId: access.resolvedCredentialId,
    workspaceId: context.workspaceId,
    serviceId: OCI_SERVICE_ID,
    region: typeof input.region === 'string' ? input.region : undefined,
  })
  return requestOciDevopsOperation(client, action, input, signal)
}

function projectResource(raw: unknown, identity?: string): OciDevopsResource {
  if (!isPlainRecord(raw) || (identity && (typeof raw[identity] !== 'string' || !raw[identity]))) {
    throw new OciDevopsError(502, 'OCI DevOps returned an invalid resource')
  }
  const parsed = resourceSchema.safeParse(raw)
  if (!parsed.success)
    throw new OciDevopsError(502, 'OCI DevOps returned invalid resource metadata')
  const resource = parsed.data
  const state = resource.lifecycleState ?? resource.status
  const terminal = state === 'SUCCEEDED' || state === 'FAILED' || state === 'CANCELED'
  return { ...resource, terminal, succeeded: terminal ? state === 'SUCCEEDED' : null }
}

function responseHeader(
  headers: Readonly<Record<string, string>>,
  key: string,
  max: number
): string | undefined {
  const value = headers[key]
  if (value === undefined) return undefined
  if (!value || value.length > max || /[\r\n\x00]/.test(value)) {
    throw new OciDevopsError(502, 'OCI DevOps returned an invalid response header')
  }
  return value
}

/** Shared provider primitive for already-authorized operations and server selectors. */
export async function requestOciDevopsOperation(
  client: OciClient,
  action: OciDevopsAction,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<OciDevopsResponse> {
  const definition: OperationDefinition = operationDefinitions[action]
  const endpoint = await client.prepareStaticEndpoint(ENDPOINT_POLICY)
  const path = definition.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) throw new OciDevopsError(400, `Missing ${key}`)
    return encodeURIComponent(value.trim())
  })
  const queryPairs: [string, string][] = []
  for (const key of definition.query) {
    const value = input[key]
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) queryPairs.push([key, String(item)])
  }
  const headers: Record<string, string> = {}
  if (typeof input.ifMatch === 'string') headers['if-match'] = input.ifMatch
  const common = {
    endpoint,
    encodedPath: `/20210630${path}`,
    queryPairs,
    headers,
    timeoutMs: 30_000,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    responseHeaders: ['opc-next-page', 'opc-work-request-id', 'retry-after'],
    signal,
  }
  const tokenRetry =
    typeof input.retryToken === 'string'
      ? { kind: 'tokenized' as const, retryToken: input.retryToken, maxAttempts: 3 }
      : undefined
  let body: Record<string, unknown> = {}
  if (definition.wrapper) {
    const configuration = input[definition.wrapper]
    if (!isPlainRecord(configuration))
      throw new OciDevopsError(400, 'Invalid resource configuration')
    body = { ...configuration }
    if (definition.parent) body[definition.parent] = input[definition.parent]
    if (definition.wrapper === 'connection' && typeof body.secretId === 'string') {
      body.accessToken = body.secretId
      body.secretId = undefined
    }
  } else {
    for (const field of definition.bodyFields) {
      if (input[field] !== undefined) body[field] = input[field]
    }
  }
  const response =
    definition.method === 'GET'
      ? await client.request({ ...common, method: 'GET', retry: { kind: 'safe', maxAttempts: 3 } })
      : definition.method === 'DELETE'
        ? await client.request({ ...common, method: 'DELETE' })
        : await client.request({
            ...common,
            method: definition.method,
            contentType: 'application/json',
            body:
              action === 'validate_connection'
                ? new Uint8Array()
                : new TextEncoder().encode(JSON.stringify(body)),
            ...(tokenRetry ? { retry: tokenRetry } : {}),
          })
  if (response.status !== definition.status) {
    throw new OciClientError('request_failed', {
      status: response.status,
      opcRequestId: response.opcRequestId,
    })
  }
  const output: OciDevopsResponse['output'] = {
    accepted: definition.method !== 'GET',
    etag: responseHeader(response.headers, 'etag', 1024),
    requestId: response.opcRequestId,
    workRequestId: responseHeader(response.headers, 'opc-work-request-id', 255),
  }
  if (action === 'get_work_request') {
    const retryAfter = responseHeader(response.headers, 'retry-after', 64)
    if (retryAfter !== undefined) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0)
        output.retryAfterSeconds = Math.min(300, Math.max(1, seconds))
    }
  }
  if (definition.method === 'DELETE') return { success: true, output }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body))
  } catch {
    throw new OciDevopsError(502, 'OCI DevOps returned invalid JSON')
  }
  if (definition.list) {
    if (!isPlainRecord(raw) || !Array.isArray(raw.items) || raw.items.length > 100) {
      throw new OciDevopsError(502, 'OCI DevOps returned an invalid or oversized page')
    }
    output.items = raw.items.map((item) => projectResource(item, definition.identity))
    output.nextPage = responseHeader(response.headers, 'opc-next-page', 4096)
  } else {
    output.resource = projectResource(raw, definition.identity)
  }
  signal?.throwIfAborted()
  return { success: true, output }
}
