import { ListBucketsCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import {
  assertKnownSizeWithinLimit,
  readNodeStreamToBufferWithLimit,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { OciObjectStorageOperationError } from '@/lib/internal/oci-object-storage/errors'

export const OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const OCI_LIST_BUCKETS_MAX_RESULTS = 10_000

export const OCI_OBJECT_STORAGE_COMMERCIAL_REGIONS = [
  'af-casablanca-1',
  'af-johannesburg-1',
  'ap-batam-1',
  'ap-chuncheon-1',
  'ap-hyderabad-1',
  'ap-kulai-2',
  'ap-melbourne-1',
  'ap-mumbai-1',
  'ap-osaka-1',
  'ap-seoul-1',
  'ap-singapore-1',
  'ap-singapore-2',
  'ap-sydney-1',
  'ap-tokyo-1',
  'ca-montreal-1',
  'ca-toronto-1',
  'eu-amsterdam-1',
  'eu-frankfurt-1',
  'eu-madrid-1',
  'eu-madrid-3',
  'eu-marseille-1',
  'eu-milan-1',
  'eu-paris-1',
  'eu-stockholm-1',
  'eu-turin-1',
  'eu-zurich-1',
  'il-jerusalem-1',
  'me-abudhabi-1',
  'me-dubai-1',
  'me-jeddah-1',
  'me-riyadh-1',
  'mx-monterrey-1',
  'mx-queretaro-1',
  'sa-bogota-1',
  'sa-santiago-1',
  'sa-saopaulo-1',
  'sa-valparaiso-1',
  'sa-vinhedo-1',
  'uk-cardiff-1',
  'uk-london-1',
  'us-ashburn-1',
  'us-chicago-1',
  'us-phoenix-1',
  'us-sanjose-1',
] as const

export type OciObjectStorageCommercialRegion =
  (typeof OCI_OBJECT_STORAGE_COMMERCIAL_REGIONS)[number]

const OCI_COMMERCIAL_REGION_SET = new Set<string>(OCI_OBJECT_STORAGE_COMMERCIAL_REGIONS)
const OCI_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export interface OciObjectStorageConnectionConfig {
  accessKeyId: string
  secretAccessKey: string
  namespace: string
  region: string
}

interface CreateOciObjectStorageClientOptions {
  maxAttempts: 1 | 3
  requestHandler?: S3ClientConfig['requestHandler']
}

interface RawHttpResponse {
  statusCode: number
  headers: Record<string, string>
  body?: unknown
}

interface RawMiddlewareResult {
  response: unknown
}

type RawMiddlewareNext = (args: unknown) => Promise<RawMiddlewareResult>

function ociObjectStorageResponseCompatibilityMiddleware(
  next: RawMiddlewareNext,
  context: { commandName?: string }
) {
  return async (args: unknown): Promise<RawMiddlewareResult> => {
    const result = await next(args)
    if (isRawHttpResponse(result.response)) {
      normalizeOracleResponseHeaders(result.response.headers)
      if (context.commandName === 'ListBucketsCommand') {
        await boundListBucketsResponse(result.response)
      }
    }
    return result
  }
}

function isRawHttpResponse(value: unknown): value is RawHttpResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RawHttpResponse>
  return (
    typeof candidate.statusCode === 'number' &&
    Boolean(candidate.headers) &&
    typeof candidate.headers === 'object'
  )
}

function isNodeReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'on' in value &&
      typeof (value as { on?: unknown }).on === 'function'
  )
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'getReader' in value &&
      typeof (value as { getReader?: unknown }).getReader === 'function'
  )
}

function normalizeOracleResponseHeaders(headers: Record<string, string>): void {
  const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value] as const)
  )
  if (!normalized.get('x-amz-request-id') && normalized.get('opc-request-id')) {
    headers['x-amz-request-id'] = normalized.get('opc-request-id') as string
  }
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (!lowerName.startsWith('opc-meta-')) continue
    const awsName = `x-amz-meta-${lowerName.slice('opc-meta-'.length)}`
    if (!normalized.get(awsName)) headers[awsName] = value
  }
}

async function boundListBucketsResponse(response: RawHttpResponse): Promise<void> {
  const declaredLength = Number(response.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength >= 0) {
    assertKnownSizeWithinLimit(
      declaredLength,
      OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      'OCI bucket listing'
    )
  }

  const body = response.body
  if (body === undefined || body === null) return
  if (typeof body === 'string') {
    assertKnownSizeWithinLimit(
      Buffer.byteLength(body),
      OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      'OCI bucket listing'
    )
    return
  }
  if (body instanceof Uint8Array) {
    assertKnownSizeWithinLimit(
      body.byteLength,
      OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      'OCI bucket listing'
    )
    return
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    assertKnownSizeWithinLimit(
      body.byteLength,
      OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      'OCI bucket listing'
    )
    return
  }
  if (isNodeReadableStream(body)) {
    response.body = await readNodeStreamToBufferWithLimit(body, {
      maxBytes: OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      label: 'OCI bucket listing',
    })
    return
  }
  if (isWebReadableStream(body)) {
    response.body = await readStreamToBufferWithLimit(body, {
      maxBytes: OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
      label: 'OCI bucket listing',
    })
  }
}

export function normalizeOciNamespace(namespace: string): string {
  const normalized = namespace.trim().toLowerCase()
  if (!OCI_NAMESPACE_PATTERN.test(normalized)) {
    throw new Error('OCI namespace must be a valid lowercase DNS label')
  }
  return normalized
}

export function normalizeOciCommercialRegion(region: string): OciObjectStorageCommercialRegion {
  const normalized = region.trim().toLowerCase()
  if (!OCI_COMMERCIAL_REGION_SET.has(normalized)) {
    throw new Error('OCI region must be a supported public commercial OC1 region')
  }
  return normalized as OciObjectStorageCommercialRegion
}

export function buildOciObjectStorageEndpoint(namespace: string, region: string): string {
  const safeNamespace = normalizeOciNamespace(namespace)
  const safeRegion = normalizeOciCommercialRegion(region)
  return `https://${safeNamespace}.compat.objectstorage.${safeRegion}.oci.customer-oci.com`
}

export function createOciObjectStorageClient(
  config: OciObjectStorageConnectionConfig,
  options: CreateOciObjectStorageClientOptions
): S3Client {
  const region = normalizeOciCommercialRegion(config.region)
  const client = new S3Client({
    region,
    endpoint: buildOciObjectStorageEndpoint(config.namespace, region),
    forcePathStyle: true,
    followRegionRedirects: false,
    maxAttempts: options.maxAttempts,
    retryMode: 'standard',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(options.requestHandler ? { requestHandler: options.requestHandler } : {}),
  })
  client.middlewareStack.addRelativeTo(
    ociObjectStorageResponseCompatibilityMiddleware as Parameters<
      typeof client.middlewareStack.addRelativeTo
    >[0],
    {
      name: 'ociObjectStorageResponseCompatibilityMiddleware',
      relation: 'after',
      toMiddleware: 'deserializerMiddleware',
      override: true,
    }
  )
  return client
}

export async function sendOciListBuckets(client: S3Client, signal?: AbortSignal) {
  const response = await client.send(new ListBucketsCommand({}), { abortSignal: signal })
  if ((response.Buckets?.length ?? 0) > OCI_LIST_BUCKETS_MAX_RESULTS) {
    throw new OciObjectStorageOperationError(
      `OCI bucket listing exceeds the ${OCI_LIST_BUCKETS_MAX_RESULTS.toLocaleString('en-US')}-bucket Sim limit`,
      413
    )
  }
  return response
}

export async function withOciObjectStorageClient<T>(
  config: OciObjectStorageConnectionConfig,
  maxAttempts: 1 | 3,
  execute: (client: S3Client) => Promise<T>
): Promise<T> {
  const client = createOciObjectStorageClient(config, { maxAttempts })
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}
