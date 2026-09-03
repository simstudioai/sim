import { DefaultRequestSigner, SimpleAuthenticationDetailsProvider } from 'oci-common'

export type OciRequestMethod = 'GET' | 'HEAD' | 'DELETE' | 'POST' | 'PUT' | 'PATCH'

export interface OciSigningCredentials {
  readonly tenancyId: string
  readonly userId: string
  readonly fingerprint: string
  readonly privateKey: string
  readonly passphrase?: string
}

export interface SignedOciRequest {
  readonly method: OciRequestMethod
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

const BODY_METHODS: ReadonlySet<OciRequestMethod> = new Set(['POST', 'PUT', 'PATCH'])

export const OCI_SIGNING_CONTROLLED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'host',
  'date',
  'x-date',
  'content-length',
  'content-type',
  'x-content-sha256',
])

function assertServiceHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (OCI_SIGNING_CONTROLLED_HEADERS.has(name.toLowerCase())) {
      throw new Error(`OCI service header is signing-controlled: ${name}`)
    }
    if (
      typeof value !== 'string' ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error('OCI service headers must not contain control characters')
    }
  }
}

/** Signs one finalized OCI request without consulting local OCI configuration. */
export async function signOciRequest(params: {
  credentials: OciSigningCredentials
  method: OciRequestMethod
  url: string
  serviceHeaders?: Readonly<Record<string, string>>
  body?: string
  contentType?: string
}): Promise<SignedOciRequest> {
  const serviceHeaders = params.serviceHeaders ?? {}
  assertServiceHeaders(serviceHeaders)
  const hasBodyMethod = BODY_METHODS.has(params.method)
  if (!hasBodyMethod && params.body !== undefined) {
    throw new Error(`${params.method} requests must not include a body`)
  }
  if (params.body !== undefined && typeof params.body !== 'string') {
    throw new Error('OCI request bodies must be finalized strings')
  }
  if (params.contentType !== undefined && !hasBodyMethod) {
    throw new Error('OCI content type is only valid for requests with signed bodies')
  }
  if (
    params.contentType !== undefined &&
    (params.contentType.length === 0 ||
      params.contentType.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(params.contentType))
  ) {
    throw new Error('OCI content type must not contain control characters')
  }

  const body = hasBodyMethod ? (params.body ?? '') : undefined
  const headers = new Headers(serviceHeaders)
  headers.set('x-date', new Date().toUTCString())
  if (hasBodyMethod) headers.set('content-type', params.contentType ?? 'application/json')

  const provider = new SimpleAuthenticationDetailsProvider(
    params.credentials.tenancyId,
    params.credentials.userId,
    params.credentials.fingerprint,
    params.credentials.privateKey,
    params.credentials.passphrase ?? null
  )
  const signer = new DefaultRequestSigner(provider)
  await signer.signHttpRequest({
    method: params.method,
    uri: params.url,
    headers,
    ...(body !== undefined ? { body } : {}),
  })
  headers.delete('date')

  return {
    method: params.method,
    url: params.url,
    headers: Object.fromEntries(headers.entries()),
    ...(body !== undefined ? { body } : {}),
  }
}
