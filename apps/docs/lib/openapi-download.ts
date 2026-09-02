import { isDeepStrictEqual } from 'node:util'
import { OPENAPI_SPEC_FILES } from '@/lib/openapi-specs'
import billingSpec from '@/openapi-v2-billing.json'
import filesAuditSpec from '@/openapi-v2-files-audit.json'
import knowledgeSpec from '@/openapi-v2-knowledge.json'
import logsSpec from '@/openapi-v2-logs.json'
import resourcesSpec from '@/openapi-v2-resources.json'
import tablesSpec from '@/openapi-v2-tables.json'
import workflowsSpec from '@/openapi-v2-workflows.json'

type JsonObject = Record<string, unknown>
type OpenApiSpecFile = (typeof OPENAPI_SPEC_FILES)[number]

const OPENAPI_DOCUMENTS_BY_FILE = {
  'openapi-v2-workflows.json': workflowsSpec,
  'openapi-v2-logs.json': logsSpec,
  'openapi-v2-files-audit.json': filesAuditSpec,
  'openapi-v2-tables.json': tablesSpec,
  'openapi-v2-knowledge.json': knowledgeSpec,
  'openapi-v2-billing.json': billingSpec,
  'openapi-v2-resources.json': resourcesSpec,
} satisfies Record<OpenApiSpecFile, JsonObject>

const OPENAPI_DOCUMENTS = OPENAPI_SPEC_FILES.map((file) => ({
  document: OPENAPI_DOCUMENTS_BY_FILE[file],
  namespace: file
    .replace('openapi-v2-', '')
    .replace('.json', '')
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(''),
}))

interface OpenApiDocumentEntry {
  document: JsonObject
  namespace: string
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[docs] ${label} must be an object`)
  }
  return value as JsonObject
}

function assertSharedValue(documents: JsonObject[], key: string): unknown {
  const value = documents[0]?.[key]
  for (const document of documents.slice(1)) {
    if (!isDeepStrictEqual(document[key], value)) {
      throw new Error(`[docs] OpenAPI documents disagree on ${key}`)
    }
  }
  return value
}

function mergeUniqueEntries(records: JsonObject[], label: string): JsonObject {
  const merged: JsonObject = {}
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (key in merged && !isDeepStrictEqual(merged[key], value)) {
        throw new Error(`[docs] Conflicting OpenAPI ${label}: ${key}`)
      }
      merged[key] = value
    }
  }
  return merged
}

function rewriteComponentReferences(value: unknown, namespace: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteComponentReferences(item, namespace))
  }
  if (!value || typeof value !== 'object') return value

  const rewritten: JsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string') {
      const match = item.match(/^#\/components\/([^/]+)\/(.+)$/)
      rewritten[key] =
        match && match[1] !== 'securitySchemes'
          ? `#/components/${match[1]}/${namespace}_${match[2]}`
          : item
      continue
    }
    rewritten[key] = rewriteComponentReferences(item, namespace)
  }
  return rewritten
}

function mergeComponents(entries: OpenApiDocumentEntry[]): JsonObject {
  const merged: JsonObject = {}

  for (const { document, namespace } of entries) {
    const components = requireObject(document.components, 'components')
    for (const [componentType, value] of Object.entries(components)) {
      const componentEntries = requireObject(value, componentType)
      const existing = requireObject(merged[componentType] ?? {}, componentType)

      if (componentType === 'securitySchemes') {
        merged[componentType] = mergeUniqueEntries([existing, componentEntries], 'security scheme')
        continue
      }

      const namespacedEntries: JsonObject = {}
      for (const [name, component] of Object.entries(componentEntries)) {
        namespacedEntries[`${namespace}_${name}`] = rewriteComponentReferences(component, namespace)
      }
      merged[componentType] = mergeUniqueEntries([existing, namespacedEntries], componentType)
    }
  }

  return merged
}

function mergeTags(documents: JsonObject[]): unknown[] {
  const tagsByName = new Map<string, unknown>()
  for (const document of documents) {
    if (!Array.isArray(document.tags)) throw new Error('[docs] OpenAPI tags must be an array')
    for (const tag of document.tags) {
      const record = requireObject(tag, 'tag')
      if (typeof record.name !== 'string') throw new Error('[docs] OpenAPI tag requires a name')
      const existing = tagsByName.get(record.name)
      if (existing && !isDeepStrictEqual(existing, tag)) {
        throw new Error(`[docs] Conflicting OpenAPI tag: ${record.name}`)
      }
      tagsByName.set(record.name, tag)
    }
  }
  return [...tagsByName.values()]
}

/** Builds the complete public API description from the domain specs used by the reference UI. */
export function createOpenApiDownloadDocument(): JsonObject {
  const entries = OPENAPI_DOCUMENTS
  const documents = entries.map(({ document }) => document)
  if (documents.length === 0) throw new Error('[docs] At least one OpenAPI document is required')

  const info = requireObject(documents[0].info, 'info')
  const version = info.version
  for (const document of documents.slice(1)) {
    const documentInfo = requireObject(document.info, 'info')
    if (documentInfo.version !== version) {
      throw new Error('[docs] OpenAPI documents disagree on info.version')
    }
  }

  return {
    openapi: assertSharedValue(documents, 'openapi'),
    info: {
      title: 'Sim API v2',
      version,
      description: 'Complete OpenAPI description for the Sim API v2.',
    },
    servers: assertSharedValue(documents, 'servers'),
    security: assertSharedValue(documents, 'security'),
    tags: mergeTags(documents),
    paths: mergeUniqueEntries(
      entries.map(({ document, namespace }) =>
        requireObject(rewriteComponentReferences(document.paths, namespace), 'paths')
      ),
      'path'
    ),
    components: mergeComponents(entries),
    'x-generated-by': assertSharedValue(documents, 'x-generated-by'),
  }
}
