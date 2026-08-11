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
    expect(resumeOkSchema.$ref).toBe('#/components/schemas/ResumeWorkflowSyncResponse')
    expect(resumeQueuedSchema.$ref).toBe('#/components/schemas/ResumeWorkflowQueuedResponse')
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

  it('serializes all documents deterministically', () => {
    for (const document of DOCUMENTS) {
      expect(serializeOpenApiDocument(document)).toBe(serializeOpenApiDocument(document))
    }
  })
})
