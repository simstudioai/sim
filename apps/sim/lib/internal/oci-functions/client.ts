import { z } from 'zod'
import {
  createOciClient,
  type OciAuthenticatedResponse,
  type OciClient,
} from '@/lib/internal/oci/client.server'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'

export const OCI_FUNCTIONS_SERVICE_ID = 'oci-functions'
export const OCI_FUNCTIONS_MANAGEMENT_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_FUNCTIONS_SERVICE_ID,
  serviceName: 'functions',
  hostnameTemplate: 'regional-oci',
})
export const OCI_FUNCTIONS_INVOCATION_POLICY = createOciDiscoveredEndpointPolicy({
  serviceId: OCI_FUNCTIONS_SERVICE_ID,
  serviceName: 'functions',
  hostnameTemplate: 'region-first-oci',
  responsePolicy: OCI_FUNCTIONS_MANAGEMENT_POLICY,
  source: { kind: 'json', path: ['invokeEndpoint'] },
})

export interface PreparedOciFunctionsClient {
  client: OciClient
  managementEndpoint: OciPreparedEndpoint
}

/** Callers supply a resolved, authorized credential and a trusted workspace. */
export async function prepareOciFunctionsClient(binding: {
  credentialId: string
  workspaceId: string
  region?: string
}): Promise<PreparedOciFunctionsClient> {
  const client = await createOciClient({ ...binding, serviceId: OCI_FUNCTIONS_SERVICE_ID })
  const managementEndpoint = await client.prepareStaticEndpoint(OCI_FUNCTIONS_MANAGEMENT_POLICY)
  return { client, managementEndpoint }
}

export class OciFunctionsError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OciFunctionsError'
  }
}

export function ociFunctionsResourcePath(kind: 'applications' | 'functions', id?: string): string {
  return `/20181201/${kind}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`
}

interface ManagementRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: readonly (readonly [string, string])[]
  body?: unknown
  ifMatch?: string
}

/** No write retries: Functions management does not document a retry-token contract. */
export async function requestOciFunctionsManagement(
  prepared: PreparedOciFunctionsClient,
  request: ManagementRequest,
  signal?: AbortSignal
): Promise<OciAuthenticatedResponse> {
  signal?.throwIfAborted()
  const common = {
    endpoint: prepared.managementEndpoint,
    encodedPath: request.path,
    queryPairs: request.query,
    headers: request.ifMatch === undefined ? undefined : { 'if-match': request.ifMatch },
    timeoutMs: 30_000,
    maxResponseBytes: 6_000_000,
    responseHeaders: ['opc-next-page'],
    signal,
  }
  const response = await prepared.client.request(
    request.method === 'POST' || request.method === 'PUT'
      ? {
          ...common,
          method: request.method,
          body: new TextEncoder().encode(JSON.stringify(request.body)),
          contentType: 'application/json',
        }
      : { ...common, method: request.method }
  )
  signal?.throwIfAborted()
  const expected =
    request.method === 'DELETE' || request.path.endsWith('/actions/changeCompartment') ? 204 : 200
  if (response.status !== expected)
    throw new OciFunctionsError('Unexpected OCI Functions response status', 502)
  return response
}

const string = z.string().nullish()
const number = z.number().nullish()
const boolean = z.boolean().nullish()
const strings = z.array(z.string()).nullish()
const tags = z.record(z.string(), z.record(z.string(), z.unknown())).nullish()
const commonResource = {
  id: z.string().min(1),
  compartmentId: string,
  displayName: string,
  lifecycleState: string,
  timeCreated: string,
  timeUpdated: string,
  freeformTags: z.record(z.string(), z.string()).nullish(),
  definedTags: tags,
}
const applicationSummary = z.object({
  ...commonResource,
  subnetIds: strings,
  shape: string,
  networkSecurityGroupIds: strings,
  traceConfig: z.object({ domainId: string, isEnabled: boolean }).nullish(),
  logging: z.object({ lineFormat: string }).nullish(),
  imagePolicyConfig: z
    .object({
      isPolicyEnabled: boolean,
      keyDetails: z.array(z.object({ kmsKeyId: string })).nullish(),
    })
    .nullish(),
  securityAttributes: z
    .record(z.string(), z.record(z.string(), z.object({ value: string, mode: string })))
    .nullish(),
})
const applicationResource = applicationSummary.extend({
  config: z.record(z.string(), z.string()).nullish(),
  syslogUrl: string,
})
const destination = z.object({
  destinationType: z.string(),
  streamId: string,
  queueId: string,
  channelId: string,
  topicId: string,
})
const functionSummary = z.object({
  ...commonResource,
  applicationId: string,
  image: string,
  imageDigest: string,
  invokeEndpoint: string,
  memoryInMBs: number,
  timeoutInSeconds: number,
  detachedModeTimeoutInSeconds: number,
  shape: string,
  provisionedConcurrencyConfig: z.object({ strategy: z.string(), count: number }).nullish(),
  failureDestination: destination.nullish(),
  successDestination: destination.nullish(),
  sourceDetails: z.object({ sourceType: z.string(), pbfListingId: string }).nullish(),
  traceConfig: z.object({ isEnabled: boolean }).nullish(),
})
const functionResource = functionSummary.extend({
  config: z.record(z.string(), z.string()).nullish(),
})

/** Strip undocumented provider fields while retaining documented dynamic configuration maps. */
export function projectOciFunctionsResource(
  response: OciAuthenticatedResponse,
  kind: 'applications' | 'functions',
  list = false
) {
  const schema =
    kind === 'applications'
      ? list
        ? applicationSummary
        : applicationResource
      : list
        ? functionSummary
        : functionResource
  try {
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body))
    return list ? z.array(schema).parse(raw) : schema.parse(raw)
  } catch {
    throw new OciFunctionsError('Invalid OCI Functions resource response', 502)
  }
}

export function ociFunctionsResponseMetadata(response: OciAuthenticatedResponse) {
  return {
    status: response.status,
    ...(response.opcRequestId ? { opcRequestId: response.opcRequestId } : {}),
    ...(response.headers.etag ? { etag: response.headers.etag } : {}),
    ...(response.headers['opc-next-page'] ? { nextPage: response.headers['opc-next-page'] } : {}),
  }
}
