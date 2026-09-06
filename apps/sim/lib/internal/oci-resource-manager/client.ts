import { z } from 'zod'
import {
  createOciClient,
  type OciAuthenticatedResponse,
  type OciClient,
} from '@/lib/internal/oci/client.server'
import {
  createOciStaticEndpointPolicy,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'

export const OCI_RESOURCE_MANAGER_SERVICE_ID = 'oci-resource-manager'
export const OCI_RESOURCE_MANAGER_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_RESOURCE_MANAGER_SERVICE_ID,
  serviceName: 'resourcemanager',
  hostnameTemplate: 'regional',
})
export const OCI_RESOURCE_MANAGER_JSON_LIMIT = 6_000_000
export const OCI_RESOURCE_MANAGER_FILE_LIMIT = 100 * 1024 * 1024
export const OCI_RESOURCE_MANAGER_ZIP_LIMIT = 11_000_000
export interface PreparedOciResourceManagerClient {
  client: OciClient
  endpoint: OciPreparedEndpoint
}
export class OciResourceManagerError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export async function prepareOciResourceManagerClient(binding: {
  credentialId: string
  workspaceId: string
  region?: string
}): Promise<PreparedOciResourceManagerClient> {
  const client = await createOciClient({ ...binding, serviceId: OCI_RESOURCE_MANAGER_SERVICE_ID })
  return { client, endpoint: await client.prepareStaticEndpoint(OCI_RESOURCE_MANAGER_POLICY) }
}
export function resourcePath(kind: 'stacks' | 'jobs' | 'workRequests', id?: string, suffix = '') {
  return `/20180917/${kind}${id === undefined ? '' : `/${encodeURIComponent(id)}`}${suffix}`
}
export interface ResourceManagerRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  query?: readonly (readonly [string, string])[]
  ifMatch?: string
  retryToken?: string
  binary?: boolean
  expectedStatus?: number
}
export async function requestResourceManager(
  prepared: PreparedOciResourceManagerClient,
  request: ResourceManagerRequest,
  signal?: AbortSignal
) {
  const common = {
    endpoint: prepared.endpoint,
    encodedPath: request.path,
    queryPairs: request.query,
    headers: request.ifMatch ? { 'if-match': request.ifMatch } : undefined,
    responseHeaders: ['opc-next-page', 'opc-work-request-id'],
    timeoutMs: 60_000,
    maxResponseBytes: request.binary
      ? OCI_RESOURCE_MANAGER_FILE_LIMIT
      : OCI_RESOURCE_MANAGER_JSON_LIMIT,
    signal,
  }
  const retry = request.retryToken
    ? { kind: 'tokenized' as const, maxAttempts: 2, retryToken: request.retryToken }
    : undefined
  const response = await prepared.client.request(
    request.method === 'POST' || request.method === 'PUT'
      ? {
          ...common,
          method: request.method,
          contentType: 'application/json',
          body:
            request.body === undefined
              ? new Uint8Array()
              : new TextEncoder().encode(JSON.stringify(request.body)),
          retry,
        }
      : request.method === 'GET'
        ? { ...common, method: 'GET', retry: { kind: 'safe', maxAttempts: 2 } }
        : { ...common, method: 'DELETE' }
  )
  if (response.status !== (request.expectedStatus ?? 200))
    throw new OciResourceManagerError('Unexpected OCI Resource Manager response status', 502)
  return response
}
export function responseJson(response: OciAuthenticatedResponse): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    throw new OciResourceManagerError('Invalid OCI Resource Manager JSON response', 502)
  }
}
const string = z.string().nullish()
const stringMap = z.record(z.string(), z.string()).nullish()
const common = {
  id: z.string().min(1),
  compartmentId: string,
  displayName: string,
  lifecycleState: string,
  timeCreated: string,
}
export const stackResponseSchema = z.object({
  ...common,
  terraformVersion: string,
  stackDriftStatus: string,
  timeDriftLastChecked: string,
  variables: stringMap,
  configSource: z
    .object({
      configSourceType: string,
      workingDirectory: string,
      compartmentId: string,
      servicesToDiscover: z.array(z.string()).nullish(),
      configurationSourceProviderId: string,
      repositoryUrl: string,
      branchName: string,
      region: string,
      namespace: string,
      bucketName: string,
      projectId: string,
      repositoryId: string,
      workspaceId: string,
    })
    .nullish(),
})
export const jobResponseSchema = z.object({
  ...common,
  stackId: z.string().min(1),
  operation: string,
  timeFinished: string,
  failureDetails: z.object({ code: string }).nullish(),
  variables: stringMap,
  jobOperationDetails: z
    .object({
      operation: string,
      executionPlanStrategy: string,
      executionPlanJobId: string,
      executionPlanRollbackStrategy: string,
      executionPlanRollbackJobId: string,
      targetRollbackJobId: string,
    })
    .nullish(),
  cancellationDetails: z.object({ isForced: z.boolean().nullish() }).nullish(),
  configSource: z.object({ configSourceRecordType: string, commitId: string }).nullish(),
})
export const workResponseSchema = z.object({
  id: z.string().min(1),
  compartmentId: string,
  operationType: string,
  status: string,
  percentComplete: z.number().nullish(),
  timeAccepted: string,
  timeStarted: string,
  timeFinished: string,
  resources: z
    .array(
      z.object({ actionType: string, entityType: string, identifier: string, entityUri: string })
    )
    .nullish(),
})
export const logResponseSchema = z.object({
  type: string,
  level: string,
  timestamp: string,
  message: string,
  code: string,
})
export const outputResponseSchema = z.object({
  outputName: string,
  outputType: string,
  isSensitive: z.boolean().nullish(),
  outputValue: string,
})
export const associatedResponseSchema = z.object({
  resourceId: string,
  resourceName: string,
  resourceType: string,
  resourceAddress: string,
  region: string,
  timeCreated: string,
  attributes: stringMap,
})
export const driftResponseSchema = z.object({
  stackId: string,
  compartmentId: string,
  resourceId: string,
  resourceName: string,
  resourceType: string,
  resourceDriftStatus: string,
  timeDriftChecked: string,
  actualProperties: stringMap,
  expectedProperties: stringMap,
})
export const providerResponseSchema = z.object({ ...common, configSourceProviderType: string })
export const templateResponseSchema = z.object({ ...common, isFreeTier: z.boolean().nullish() })
export const versionResponseSchema = z.object({
  name: z.string(),
  isDefault: z.boolean().nullish(),
})
export const discoveryResponseSchema = z.object({ name: z.string(), discoveryScope: string })
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new OciResourceManagerError('Unexpected OCI Resource Manager response shape', 502)
  return result.data
}
