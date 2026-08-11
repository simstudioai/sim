import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { billingOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/billing'
import { filesAuditOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/files-audit'
import { knowledgeOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/knowledge'
import { logsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/logs'
import { resourcesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/resources'
import { tablesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/tables'
import { workflowsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/workflows'
import { generateOpenApiDocument, serializeOpenApiDocument } from './generator'

type JsonObject = Record<string, unknown>

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

const DOCUMENTS = [
  workflowsOpenApiDocument,
  logsOpenApiDocument,
  filesAuditOpenApiDocument,
  tablesOpenApiDocument,
  knowledgeOpenApiDocument,
  billingOpenApiDocument,
  resourcesOpenApiDocument,
] as const

const EXPECTED_OPERATION_COUNTS = new Map<string, number>([
  ['apps/docs/openapi-v2-workflows.json', 21],
  ['apps/docs/openapi-v2-logs.json', 2],
  ['apps/docs/openapi-v2-files-audit.json', 21],
  ['apps/docs/openapi-v2-tables.json', 43],
  ['apps/docs/openapi-v2-knowledge.json', 18],
  ['apps/docs/openapi-v2-billing.json', 2],
  ['apps/docs/openapi-v2-resources.json', 21],
])

function getOperation(spec: JsonObject, path: string, method: string): JsonObject {
  const paths = spec.paths as JsonObject
  return (paths[path] as JsonObject)[method] as JsonObject
}

function operations(spec: JsonObject): JsonObject[] {
  const result: JsonObject[] = []
  for (const pathItem of Object.values(spec.paths as JsonObject)) {
    for (const [method, operation] of Object.entries(pathItem as JsonObject)) {
      if (HTTP_METHODS.has(method)) result.push(operation as JsonObject)
    }
  }
  return result
}

function isStructuredObject(schema: JsonObject): boolean {
  return schema.type === 'object' || schema.properties !== undefined
}

function anonymousPayloadObjects(schema: JsonObject, location: string): string[] {
  if (schema.$ref !== undefined) return []

  const anonymous = isStructuredObject(schema) ? [location] : []
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const variants = schema[keyword]
    if (!Array.isArray(variants)) continue
    for (const [index, variant] of variants.entries()) {
      anonymous.push(
        ...anonymousPayloadObjects(variant as JsonObject, `${location}.${keyword}[${index}]`)
      )
    }
  }
  return anonymous
}

function anonymousTopLevelResponseObjects(spec: JsonObject): string[] {
  const anonymous: string[] = []
  const schemas = ((spec.components as JsonObject).schemas ?? {}) as JsonObject

  for (const [routePath, pathItem] of Object.entries(spec.paths as JsonObject)) {
    for (const [method, operationValue] of Object.entries(pathItem as JsonObject)) {
      if (!HTTP_METHODS.has(method)) continue
      const operation = operationValue as JsonObject
      for (const [status, responseValue] of Object.entries(operation.responses as JsonObject)) {
        if (!/^[23]/.test(status)) continue
        const response = responseValue as JsonObject
        const content = response.content as JsonObject | undefined
        const media = content?.['application/json'] as JsonObject | undefined
        const responseSchema = media?.schema as JsonObject | undefined
        if (!responseSchema) continue

        const responseSchemaName =
          typeof responseSchema.$ref === 'string'
            ? responseSchema.$ref.split('/').at(-1)
            : undefined
        const rootSchema = responseSchemaName
          ? (schemas[responseSchemaName] as JsonObject)
          : responseSchema
        const context = `${method.toUpperCase()} ${routePath} ${status}`

        for (const keyword of ['anyOf', 'oneOf'] as const) {
          const variants = rootSchema[keyword]
          if (!Array.isArray(variants)) continue
          for (const [index, variant] of variants.entries()) {
            anonymous.push(
              ...anonymousPayloadObjects(
                variant as JsonObject,
                `${context} response.${keyword}[${index}]`
              )
            )
          }
        }

        const properties = rootSchema.properties as JsonObject | undefined
        const dataSchema = properties?.data as JsonObject | undefined
        if (!dataSchema) continue
        anonymous.push(...anonymousPayloadObjects(dataSchema, `${context} data`))

        const arrays: JsonObject[] = dataSchema.type === 'array' ? [dataSchema] : []
        for (const keyword of ['anyOf', 'oneOf'] as const) {
          const variants = dataSchema[keyword]
          if (!Array.isArray(variants)) continue
          arrays.push(...(variants as JsonObject[]).filter((variant) => variant.type === 'array'))
        }
        for (const arraySchema of arrays) {
          const items = arraySchema.items as JsonObject | undefined
          if (items) {
            anonymous.push(...anonymousPayloadObjects(items, `${context} data[]`))
          }
        }
      }
    }
  }

  return anonymous
}

describe('generated OpenAPI documents', () => {
  it('covers the complete public v2 operation surface with canonical errors', () => {
    const outputs = DOCUMENTS.map((document) => document.output)
    expect(new Set(outputs).size).toBe(DOCUMENTS.length)

    let totalOperations = 0
    for (const document of DOCUMENTS) {
      const spec = generateOpenApiDocument(document)
      const documentOperations = operations(spec)
      const expectedCount = EXPECTED_OPERATION_COUNTS.get(document.output)

      expect(expectedCount).toBeDefined()
      expect(documentOperations).toHaveLength(expectedCount as number)
      expect(spec['x-generated-by']).toBe('scripts/generate-openapi.ts')
      totalOperations += documentOperations.length

      const schemas = (spec.components as JsonObject).schemas as JsonObject
      expect(Object.keys(schemas).filter((name) => name.startsWith('__schema'))).toEqual([])

      for (const operation of documentOperations) {
        const responses = operation.responses as JsonObject
        expect(responses['401']).toEqual({
          $ref: '#/components/responses/Unauthorized',
        })
        expect(responses['429']).toEqual({
          $ref: '#/components/responses/RateLimited',
        })
        expect(responses['503']).toEqual({
          $ref: '#/components/responses/ServiceUnavailable',
        })
      }
    }

    expect(totalOperations).toBe(128)
  })

  it('documents mixed workflow execution and resume responses', () => {
    const spec = generateOpenApiDocument(workflowsOpenApiDocument)
    const execute = getOperation(spec, '/api/v2/workflows/{id}/execute', 'post')
    const executeResponses = execute.responses as JsonObject
    const executeOk = executeResponses['200'] as JsonObject
    const executeQueued = executeResponses['202'] as JsonObject
    const executeOkContent = executeOk.content as JsonObject
    const executeQueuedContent = executeQueued.content as JsonObject

    expect((spec.tags as JsonObject[]).map((tag) => tag.name)).toEqual([
      'Workflows',
      'Workflow Runs',
    ])
    expect(execute.tags).toEqual(['Workflows'])
    expect(execute.security).toEqual([{ apiKey: [] }, {}])
    expect(Object.keys(executeOkContent).sort()).toEqual(['application/json', 'text/event-stream'])
    expect(Object.keys(executeQueuedContent)).toEqual(['application/json'])

    const resume = getOperation(spec, '/api/v2/workflows/{id}/runs/{runId}/resume', 'post')
    const resumeResponses = resume.responses as JsonObject
    const resumeOkContent = (resumeResponses['200'] as JsonObject).content as JsonObject
    const resumeQueuedContent = (resumeResponses['202'] as JsonObject).content as JsonObject
    const resumeOkSchema = (resumeOkContent['application/json'] as JsonObject).schema as JsonObject
    const resumeQueuedSchema = (resumeQueuedContent['application/json'] as JsonObject)
      .schema as JsonObject

    expect(resumeResponses).toHaveProperty('200')
    expect(resumeResponses).toHaveProperty('202')
    expect(resume.tags).toEqual(['Workflow Runs'])
    expect(resumeOkSchema.$ref).toBe('#/components/schemas/ResumeWorkflowSyncResponse')
    expect(resumeQueuedSchema.$ref).toBe('#/components/schemas/ResumeWorkflowQueuedResponse')

    const listRuns = getOperation(spec, '/api/v2/workflows/{id}/runs', 'get')
    const getRun = getOperation(spec, '/api/v2/workflows/{id}/runs/{runId}', 'get')
    const cancelRun = getOperation(spec, '/api/v2/workflows/{id}/runs/{runId}/cancel', 'post')
    expect(listRuns.tags).toEqual(['Workflow Runs'])
    expect(getRun.tags).toEqual(['Workflow Runs'])
    expect(cancelRun.tags).toEqual(['Workflow Runs'])
  })

  it('documents multipart uploads, dual-status secret sets, and nullable file shares', () => {
    const knowledgeSpec = generateOpenApiDocument(knowledgeOpenApiDocument)
    const upload = getOperation(knowledgeSpec, '/api/v2/knowledge/{id}/documents', 'post')
    const uploadBody = upload.requestBody as JsonObject
    const uploadContent = uploadBody.content as JsonObject
    const uploadSchemaRef = (uploadContent['multipart/form-data'] as JsonObject)
      .schema as JsonObject
    const knowledgeSchemas = (knowledgeSpec.components as JsonObject).schemas as JsonObject
    const uploadSchemaName = (uploadSchemaRef.$ref as string).split('/').at(-1) as string
    const uploadSchema = knowledgeSchemas[uploadSchemaName] as JsonObject
    const uploadProperties = uploadSchema.properties as JsonObject

    expect(Object.keys(uploadContent)).toEqual(['multipart/form-data'])
    expect(uploadProperties.file).toMatchObject({ type: 'string', format: 'binary' })

    const resourcesSpec = generateOpenApiDocument(resourcesOpenApiDocument)
    const setSecret = getOperation(resourcesSpec, '/api/v2/secrets/{name}', 'put')
    expect(
      Object.keys(setSecret.responses as JsonObject).filter((status) => status.startsWith('2'))
    ).toEqual(['200', '201'])

    const filesSpec = generateOpenApiDocument(filesAuditOpenApiDocument)
    const fileSchemas = (filesSpec.components as JsonObject).schemas as JsonObject
    const fileMetadata = fileSchemas.V2FileMetadata as JsonObject
    const fileMetadataProperties = fileMetadata.properties as JsonObject
    const share = fileMetadataProperties.share as JsonObject

    expect(share.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]))
  })

  it('documents public resource owner email addresses', () => {
    const knowledgeSpec = generateOpenApiDocument(knowledgeOpenApiDocument)
    const knowledgeSchemas = (knowledgeSpec.components as JsonObject).schemas as JsonObject
    const knowledgeBase = knowledgeSchemas.V2KnowledgeBase as JsonObject
    const knowledgeBaseProperties = knowledgeBase.properties as JsonObject

    const tablesSpec = generateOpenApiDocument(tablesOpenApiDocument)
    const tableSchemas = (tablesSpec.components as JsonObject).schemas as JsonObject
    const table = tableSchemas.V2ApiTable as JsonObject
    const tableProperties = table.properties as JsonObject

    expect(knowledgeBaseProperties.ownerEmail).toMatchObject({ type: 'string', format: 'email' })
    expect(tableProperties.ownerEmail).toMatchObject({ type: 'string', format: 'email' })
  })

  it('keeps billing as its own API reference group', () => {
    const spec = generateOpenApiDocument(billingOpenApiDocument)
    expect((spec.tags as JsonObject[]).map((tag) => tag.name)).toEqual(['Billing'])
    expect(getOperation(spec, '/api/v2/billing/status', 'get').tags).toEqual(['Billing'])
    expect(getOperation(spec, '/api/v2/billing/logs', 'get').tags).toEqual(['Billing'])
  })

  it('documents workspace details as a named schema without internal mode', () => {
    const resourcesSpec = generateOpenApiDocument(resourcesOpenApiDocument)
    const schemas = (resourcesSpec.components as JsonObject).schemas as JsonObject
    const response = schemas.GetWorkspaceResponse as JsonObject
    const responseProperties = response.properties as JsonObject
    const data = responseProperties.data as JsonObject
    const workspace = schemas.V2Workspace as JsonObject
    const workspaceProperties = workspace.properties as JsonObject

    expect(data.$ref).toBe('#/components/schemas/V2Workspace')
    expect(workspace.title).toBe('Workspace')
    expect(workspaceProperties).not.toHaveProperty('mode')
    expect(workspaceProperties).toEqual(
      expect.objectContaining({
        id: expect.objectContaining({ type: 'string' }),
        name: expect.objectContaining({ type: 'string' }),
        memberCount: expect.objectContaining({ type: 'integer' }),
      })
    )
  })

  it('uses named schemas for top-level response objects and list items', () => {
    for (const document of DOCUMENTS) {
      expect(anonymousTopLevelResponseObjects(generateOpenApiDocument(document))).toEqual([])
    }
  })

  it('places audit logs at the bottom of every localized API reference sidebar', () => {
    for (const locale of ['en', 'de', 'es', 'fr', 'ja', 'zh']) {
      const metaPath = path.resolve(
        process.cwd(),
        `apps/docs/content/docs/${locale}/api-reference/meta.json`
      )
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { pages: string[] }
      expect(meta.pages.at(-1)).toBe('(generated)/audit-logs')
    }
  })

  it('keeps localized execution guides on the v2 request and run-status wire shape', () => {
    for (const locale of ['de', 'es', 'fr', 'ja', 'zh']) {
      const guideRoot = path.resolve(
        process.cwd(),
        `apps/docs/content/docs/${locale}/api-reference`
      )
      const authentication = readFileSync(path.join(guideRoot, 'authentication.mdx'), 'utf8')
      const gettingStarted = readFileSync(path.join(guideRoot, 'getting-started.mdx'), 'utf8')
      const guides = `${authentication}\n${gettingStarted}`

      expect(guides).not.toContain('"inputs"')
      expect(guides).not.toContain('{ inputs:')
      expect(guides).not.toContain('/api/jobs/')
      expect(gettingStarted).not.toContain('jobId')
      expect(gettingStarted).toContain('-d \'{"input": {}, "async": true}\'')
      expect(gettingStarted).toContain(
        '/api/v2/workflows/{workflowId}/runs/{runId}?includeOutput=true'
      )
      expect(gettingStarted).toContain('"runId"')
    }
  })

  it('serializes all documents deterministically', () => {
    for (const document of DOCUMENTS) {
      expect(serializeOpenApiDocument(document)).toBe(serializeOpenApiDocument(document))
    }
  })
})
