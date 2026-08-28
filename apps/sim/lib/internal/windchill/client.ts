import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  createBasicAuthHeader,
  encodeWindchillOid,
  normalizeServiceRoot,
  sanitizeWindchillError,
} from '@/tools/windchill/utils'

const WINDCHILL_CONTROL_RESPONSE_BYTES = 2 * 1024 * 1024
const WINDCHILL_TIMEOUT_MS = 60_000

interface WindchillSession {
  nonceHeader: string
  nonceValue: string
  cookie: string | null
}

interface WindchillCredentials {
  baseUrl: string
  username: string
  password: string
}

export interface WindchillUploadFile {
  name: string
  mimeType: string
  size: number
  buffer: Buffer
}

export class WindchillProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'WindchillProviderError'
  }
}

function cookieHeader(response: SecureFetchResponse): string | null {
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
  return cookies.length > 0 ? cookies.join('; ') : null
}

async function responseBody(
  response: SecureFetchResponse
): Promise<{ data: unknown; invalidJson: boolean }> {
  const text = await response.text()
  if (!text.trim()) return { data: null, invalidJson: false }
  try {
    return { data: JSON.parse(text) as unknown, invalidJson: false }
  } catch {
    return { data: text, invalidJson: true }
  }
}

function providerMessage(data: unknown, response: SecureFetchResponse): string {
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (isRecordLike(data)) {
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    if (isRecordLike(data.error)) {
      if (typeof data.error.message === 'string' && data.error.message.trim()) {
        return data.error.message.trim()
      }
      if (
        isRecordLike(data.error.message) &&
        typeof data.error.message.value === 'string' &&
        data.error.message.value.trim()
      ) {
        return data.error.message.value.trim()
      }
    }
  }
  return `Windchill request failed with status ${response.status}`
}

async function checkedBody(response: SecureFetchResponse): Promise<unknown> {
  const { data, invalidJson } = await responseBody(response)
  if (!response.ok) {
    throw new WindchillProviderError(
      sanitizeWindchillError(providerMessage(data, response)),
      response.status
    )
  }
  if (invalidJson) {
    throw new WindchillProviderError(
      `Windchill returned invalid JSON with status ${response.status}`,
      502
    )
  }
  return data
}

function ptcRoot(baseUrl: string): string {
  return normalizeServiceRoot(baseUrl).replace(/\/v\d+$/i, '')
}

export function windchillDocumentUrl(baseUrl: string, documentOid: string): string {
  return `${normalizeServiceRoot(baseUrl)}/DocMgmt/Documents('${encodeWindchillOid(documentOid)}')`
}

export async function createWindchillSession(
  params: WindchillCredentials,
  signal?: AbortSignal
): Promise<WindchillSession> {
  const response = await secureFetchWithValidation(
    `${ptcRoot(params.baseUrl)}/PTC/GetCSRFToken()`,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: {
        Authorization: createBasicAuthHeader(params.username, params.password),
        Accept: 'application/json',
      },
      maxRedirects: 0,
      maxResponseBytes: WINDCHILL_CONTROL_RESPONSE_BYTES,
      timeout: WINDCHILL_TIMEOUT_MS,
      signal,
    },
    'baseUrl'
  )
  const data = await checkedBody(response)
  if (!isRecordLike(data)) {
    throw new WindchillProviderError('Windchill returned an invalid CSRF response', 502)
  }
  const nonceHeader = data.NonceKey
  const nonceValue = data.NonceValue
  if (
    typeof nonceHeader !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(nonceHeader) ||
    typeof nonceValue !== 'string' ||
    nonceValue.length === 0 ||
    nonceValue.length > 8192
  ) {
    throw new WindchillProviderError('Windchill returned an invalid CSRF token', 502)
  }
  return { nonceHeader, nonceValue, cookie: cookieHeader(response) }
}

export async function windchillMutationRequest({
  params,
  session,
  url,
  method,
  body,
  signal,
}: {
  params: Pick<WindchillCredentials, 'username' | 'password'>
  session: WindchillSession
  url: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: createBasicAuthHeader(params.username, params.password),
    Accept: 'application/json',
    [session.nonceHeader]: session.nonceValue,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (session.cookie) headers.Cookie = session.cookie

  const response = await secureFetchWithValidation(
    url,
    {
      profile: 'configuredEndpoint',
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      maxRedirects: 0,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      timeout: WINDCHILL_TIMEOUT_MS,
      signal,
    },
    'baseUrl'
  )
  return checkedBody(response)
}

function stageOneDescriptor(data: unknown): {
  replicaUrl: string
  masterUrl: string
  streamIds: Array<string | number>
  fileNames: Array<string | number>
} {
  const descriptor = isRecordLike(data) && Array.isArray(data.value) ? data.value[0] : null
  if (!isRecordLike(descriptor)) {
    throw new WindchillProviderError('Windchill upload Stage 1 returned no cache descriptor', 502)
  }
  if (
    typeof descriptor.ReplicaUrl !== 'string' ||
    typeof descriptor.MasterUrl !== 'string' ||
    !Array.isArray(descriptor.StreamIds) ||
    !Array.isArray(descriptor.FileNames)
  ) {
    throw new WindchillProviderError(
      'Windchill upload Stage 1 returned an invalid cache descriptor',
      502
    )
  }
  if (descriptor.StreamIds.length !== descriptor.FileNames.length) {
    throw new WindchillProviderError(
      'Windchill upload Stage 1 returned mismatched file identifiers',
      502
    )
  }
  return {
    replicaUrl: descriptor.ReplicaUrl,
    masterUrl: descriptor.MasterUrl,
    streamIds: descriptor.StreamIds.filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number'
    ),
    fileNames: descriptor.FileNames.filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number'
    ),
  }
}

function multipartBody(
  descriptor: ReturnType<typeof stageOneDescriptor>,
  files: WindchillUploadFile[]
): { contentType: string; body: Buffer } {
  if (
    descriptor.streamIds.length !== files.length ||
    descriptor.fileNames.length !== files.length
  ) {
    throw new WindchillProviderError('Windchill upload Stage 1 returned the wrong file count', 502)
  }
  const boundary = `sim-windchill-${generateShortId()}`
  const chunks: Buffer[] = []
  const appendField = (name: string, value: string) => {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    )
  }
  appendField('Master_URL', descriptor.masterUrl)
  appendField(
    'CacheDescriptor_array',
    descriptor.streamIds
      .map(
        (streamId, index) =>
          `${streamId}:${descriptor.fileNames[index]}:${streamId}:${files[index].size};`
      )
      .join(' ')
  )
  files.forEach((file, index) => {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${descriptor.streamIds[index]}"; filename="${file.name.replace(/["\r\n]/g, '_')}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
      ),
      file.buffer,
      Buffer.from('\r\n')
    )
  })
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) }
}

function stageTwoContent(data: unknown): Array<{
  streamId: string | number
  fileSize: number
  encodedInfo: string
}> {
  if (!isRecordLike(data) || !Array.isArray(data.contentInfos)) {
    throw new WindchillProviderError('Windchill upload Stage 2 returned invalid content info', 502)
  }
  return data.contentInfos.map((item) => {
    if (
      !isRecordLike(item) ||
      (typeof item.streamId !== 'string' && typeof item.streamId !== 'number') ||
      typeof item.fileSize !== 'number' ||
      typeof item.encodedInfo !== 'string'
    ) {
      throw new WindchillProviderError(
        'Windchill upload Stage 2 returned invalid content info',
        502
      )
    }
    return { streamId: item.streamId, fileSize: item.fileSize, encodedInfo: item.encodedInfo }
  })
}

export async function uploadWindchillContent({
  params,
  documentOid,
  files,
  primaryContent,
  signal,
}: {
  params: WindchillCredentials
  documentOid: string
  files: WindchillUploadFile[]
  primaryContent: boolean
  signal?: AbortSignal
}): Promise<string[]> {
  const session = await createWindchillSession(params, signal)
  const documentUrl = windchillDocumentUrl(params.baseUrl, documentOid)
  const stageOne = await windchillMutationRequest({
    params,
    session,
    url: `${documentUrl}/PTC.DocMgmt.UploadStage1Action`,
    method: 'POST',
    body: { NoOfFiles: files.length },
    signal,
  })
  const descriptor = stageOneDescriptor(stageOne)
  const multipart = multipartBody(descriptor, files)
  const stageTwoResponse = await secureFetchWithValidation(
    descriptor.replicaUrl,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: { 'Content-Type': multipart.contentType, Accept: 'application/json' },
      body: multipart.body,
      maxRedirects: 0,
      maxResponseBytes: WINDCHILL_CONTROL_RESPONSE_BYTES,
      timeout: WINDCHILL_TIMEOUT_MS,
      signal,
    },
    'ReplicaUrl'
  )
  const uploaded = stageTwoContent(await checkedBody(stageTwoResponse))
  if (uploaded.length !== files.length) {
    throw new WindchillProviderError('Windchill upload Stage 2 returned the wrong file count', 502)
  }
  const byStreamId = new Map(uploaded.map((item) => [String(item.streamId), item]))
  const contentInfo = descriptor.streamIds.map((streamId, index) => {
    const uploadedItem = byStreamId.get(String(streamId))
    if (!uploadedItem) {
      throw new WindchillProviderError('Windchill upload Stage 2 omitted a file', 502)
    }
    return {
      StreamId: streamId,
      EncodedInfo: uploadedItem.encodedInfo,
      FileName: files[index].name,
      PrimaryContent: primaryContent,
      MimeType: files[index].mimeType,
      FileSize: uploadedItem.fileSize,
    }
  })
  await windchillMutationRequest({
    params,
    session,
    url: `${documentUrl}/PTC.DocMgmt.UploadStage3Action`,
    method: 'POST',
    body: { ContentInfo: contentInfo },
    signal,
  })
  return files.map((file) => file.name)
}

/**
 * Resolves the signed vault URL that serves a content item's bytes.
 *
 * Windchill has no OData media-stream segment for content. The documented path is a typed
 * navigation to `Content/URL`, which returns a short-lived signed WindchillGW/WindchillAuthGW
 * download URL on the same origin as the service root.
 */
export async function resolveWindchillContentUrl({
  params,
  contentPath,
  signal,
}: {
  params: WindchillCredentials
  contentPath: string
  signal?: AbortSignal
}): Promise<string> {
  const response = await secureFetchWithValidation(
    `${contentPath}/PTC.ApplicationData/Content/URL`,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: {
        Authorization: createBasicAuthHeader(params.username, params.password),
        Accept: 'application/json',
      },
      maxRedirects: 0,
      maxResponseBytes: WINDCHILL_CONTROL_RESPONSE_BYTES,
      timeout: WINDCHILL_TIMEOUT_MS,
      signal,
    },
    'baseUrl'
  )
  const data = await checkedBody(response)
  const value = isRecordLike(data) ? data.value : null
  if (typeof value !== 'string' || value.length === 0) {
    throw new WindchillProviderError('Windchill did not return a content download URL', 502)
  }

  const serviceRoot = new URL(normalizeServiceRoot(params.baseUrl))
  let resolved: URL
  try {
    resolved = new URL(value, `${serviceRoot.toString()}/`)
  } catch {
    throw new WindchillProviderError('Windchill returned an invalid content download URL', 502)
  }
  if (
    resolved.protocol !== 'https:' ||
    resolved.origin !== serviceRoot.origin ||
    resolved.username ||
    resolved.password ||
    resolved.hash
  ) {
    throw new WindchillProviderError(
      'Windchill content download URL must remain on the configured HTTPS origin',
      502
    )
  }
  return resolved.toString()
}

export async function downloadWindchillContent({
  params,
  url,
  maxBytes,
  signal,
}: {
  params: Pick<WindchillCredentials, 'username' | 'password'>
  url: string
  maxBytes: number
  signal?: AbortSignal
}): Promise<{
  buffer: Buffer
  contentType: string
  contentDisposition: string | null
}> {
  const response = await secureFetchWithValidation(
    url,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: { Authorization: createBasicAuthHeader(params.username, params.password) },
      stripAuthOnRedirect: true,
      maxResponseBytes: maxBytes,
      timeout: WINDCHILL_TIMEOUT_MS,
      signal,
    },
    'contentUrl'
  )
  if (!response.ok) await checkedBody(response)
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: response.headers.get('content-disposition'),
  }
}
