import type { OciDocumentParams } from '@/tools/oci_document_understanding/types'
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

export function isDocumentJsonWithinLimit(input: unknown, limit: number): boolean {
  return addJsonBytes(input, limit, new Set()) <= limit
}

export const DOCUMENT_INPUT_BYTES = 1024 * 1024
export const DOCUMENT_OUTPUT_BYTES = 8 * 1024 * 1024
export const documentAuthParams = {
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
    description: 'Executor-authorized credential reference',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OCI region in the credential realm; defaults to the credential region',
  },
} satisfies ToolConfig['params']

export const documentOAuth = {
  required: true,
  provider: 'oci_document_understanding',
  credentialKind: 'service-account',
} as const

export const documentAnalysisParams = {
  source: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'file for an authorized Sim file, or objectStorage for Oracle object references',
  },
  file: {
    type: 'file',
    required: false,
    visibility: 'user-only',
    description:
      'Stored Sim UserFile; required only for source=file. JPEG, PNG, PDF or TIFF; at most 8 MB and five pages',
  },
  objects: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'For source=objectStorage: [{namespaceName,bucketName,objectName,pageRange?}]. One object for synchronous analysis; at most 2000 for jobs. No URLs',
  },
  pageRange: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Inline file page ranges, such as ["1-3","5"]. Object references carry their own pageRange',
  },
  features: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Array of {featureType,modelId?}: TEXT_EXTRACTION, TABLE_EXTRACTION, KEY_VALUE_EXTRACTION, DOCUMENT_CLASSIFICATION, LANGUAGE_CLASSIFICATION. Classification supports maxResults; key-value/document classification support model tenancyId. OCR supports selectionMarkDetection and job-only generateSearchablePdf',
  },
  compartmentId: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'OCI processing compartment OCID; required for processor jobs',
  },
  documentType: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Document type hint, such as INVOICE, RECEIPT, PASSPORT, DRIVER_LICENSE or HEALTH_INSURANCE_ID',
  },
  language: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'BCP 47 language hint. Multilingual support depends on feature/model; no explicit model-version switch is sent',
  },
} satisfies ToolConfig['params']

export const documentProjectionParams = {
  pageNumbers: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Original provider page numbers to return, e.g. [1,3]. Does not change paid analysis',
  },
  maxPages: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum returned pages; default 20, maximum 100',
  },
  maxOutputBytes: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Structured output budget; default 1048576, range 16384–8388608 bytes including envelope reserve',
  },
  includeWords: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Include words and valid word-index references; default false',
  },
  includeGeometry: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Include normalized geometry; default false',
  },
} satisfies ToolConfig['params']

export const documentJobParams = {
  jobId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Document Understanding processor job OCID',
  },
} satisfies ToolConfig['params']

export const documentListParams = {
  compartmentId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'OCI compartment OCID to list',
  },
  displayName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact display-name filter',
  },
  lifecycleState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Provider lifecycle filter, such as ACTIVE',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'One-page result limit; default 100, maximum 100',
  },
  page: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Opaque nextPage token from a prior response',
  },
} satisfies ToolConfig['params']

export function documentOperationInput(
  params: OciDocumentParams,
  fields: readonly (keyof OciDocumentParams)[]
) {
  const input: Record<string, unknown> = { credentialId: params.accessToken ?? '' }
  for (const key of ['region', ...fields] as const) {
    if (params[key] !== undefined) input[key] = params[key]
  }
  if (!isDocumentJsonWithinLimit(input, DOCUMENT_INPUT_BYTES)) {
    throw new Error('Document Understanding input exceeds 1 MiB; supply stored file references')
  }
  return input
}
