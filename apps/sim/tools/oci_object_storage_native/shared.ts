import type { ToolConfig } from '@/tools/types'

function jsonStringBytes(value: string, limit: number): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    if (bytes > limit) return bytes
    const code = value.charCodeAt(index)
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2
    } else if (code <= 0x1f) {
      bytes += 6
    } else if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function primitiveJsonBytes(value: unknown, limit: number): number | null {
  if (value === null) return 4
  switch (typeof value) {
    case 'string':
      return jsonStringBytes(value, limit)
    case 'boolean':
      return value ? 4 : 5
    case 'number':
      return Number.isFinite(value) ? String(value).length : 4
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt')
    case 'undefined':
    case 'function':
    case 'symbol':
      return null
    default:
      return null
  }
}

function addJsonBytes(
  value: unknown,
  limit: number,
  seen: Set<object>,
  arrayEntry = false,
  depth = 0
): number {
  if (depth > 32) throw new TypeError('JSON nesting exceeds 32 levels')
  const primitiveBytes = primitiveJsonBytes(value, limit)
  if (primitiveBytes !== null) return primitiveBytes
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return arrayEntry ? 4 : 0
  }
  if (value instanceof Date) return jsonStringBytes(value.toJSON(), limit)
  if (!value || typeof value !== 'object') return 0
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON')
  seen.add(value)

  let bytes = 2
  let emitted = false
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (emitted) bytes += 1
      bytes += addJsonBytes(entry, limit - bytes, seen, true, depth + 1)
      emitted = true
      if (bytes > limit) break
    }
  } else {
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      const entry = (value as Record<string, unknown>)[key]
      const entryBytes = addJsonBytes(entry, limit - bytes, seen, false, depth + 1)
      if (
        entryBytes === 0 &&
        (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol')
      ) {
        continue
      }
      if (emitted) bytes += 1
      bytes += jsonStringBytes(key, limit - bytes) + 1 + entryBytes
      emitted = true
      if (bytes > limit) break
    }
  }
  seen.delete(value)
  return bytes
}

export function isOciNativeJsonWithinLimit(input: unknown, limit: number): boolean {
  return addJsonBytes(input, limit, new Set()) <= limit
}

export const OCI_NATIVE_JSON_BYTES = 8 * 1024 * 1024
export const ociNativeAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Connected OCI API signing-key service account',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Server-internal executor-authorized credential reference',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OCI region override in the credential realm; defaults to the credential region',
  },
  namespace: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Object Storage namespace; omitted values are discovered with GetNamespace',
  },
} satisfies ToolConfig['params']

export const ociNativeOAuth = {
  required: true,
  provider: 'oci_object_storage_native',
  credentialKind: 'service-account',
} as const

/** Only the credential reference inserted by the authorized executor can cross this boundary. */
export function createOciNativeOperationInput<
  T extends { oauthCredential: string; accessToken?: string },
>(params: T, fields: readonly string[] = []) {
  const values = params as T & Record<string, unknown>
  const input: Record<string, unknown> = { credentialId: params.accessToken ?? '' }
  for (const field of ['region', 'namespace', ...fields]) {
    if (values[field] !== undefined) input[field] = values[field]
  }
  if (!isOciNativeJsonWithinLimit(input, OCI_NATIVE_JSON_BYTES)) {
    throw new Error('OCI request exceeds 8 MiB of JSON; use a file for larger uploads')
  }
  return input
}
