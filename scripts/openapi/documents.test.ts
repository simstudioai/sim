import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import { MAX_ID_LENGTH } from '../../apps/sim/lib/api/contracts/primitives'
import { billingOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/billing'
import { filesAuditOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/files-audit'
import { knowledgeOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/knowledge'
import { logsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/logs'
import { resourcesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/resources'
import {
  FOLDER_TREE_TOO_LARGE,
  RUN_RETENTION,
  WORKSPACE_API_KEY_DENIED,
  WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND,
} from '../../apps/sim/lib/api/contracts/v2/openapi/shared'
import { tablesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/tables'
import { workflowsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/workflows'
import { MAX_AGENT_TOOLS_PER_BLOCK } from '../../apps/sim/lib/api/contracts/v2/workflows'
import { MAX_MCP_TOOL_NAME_BYTES } from '../../apps/sim/lib/mcp/constants'
import { generateOpenApiDocument, serializeOpenApiDocument } from './generator'

type JsonObject = Record<string, unknown>

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const MAX_DESCRIPTION_WORDS = 80

const DOCUMENTS = [
  workflowsOpenApiDocument,
  logsOpenApiDocument,
  filesAuditOpenApiDocument,
  tablesOpenApiDocument,
  knowledgeOpenApiDocument,
  billingOpenApiDocument,
  resourcesOpenApiDocument,
] as const

/** Reads route admission policy without importing its database and provider implementations. */
async function routeApplicationOperation(routePath: string, method: string): Promise<unknown> {
  const sourcePath = path.resolve(
    import.meta.dirname,
    '../../apps/sim/app',
    `.${routePath}`,
    'route.ts'
  )
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let handler: ts.Expression | undefined
  const imports = new Map<string, { module: string; name: string }>()
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === method) {
      handler = node.initializer
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          imports.set(item.name.text, {
            module: node.moduleSpecifier.text,
            name: item.propertyName?.text ?? item.name.text,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!handler || !ts.isCallExpression(handler))
    throw new Error(`Missing ${method} handler: ${sourcePath}`)
  let operation: ts.Expression | undefined
  const options = handler.arguments[0]
  if (options && ts.isObjectLiteralExpression(options)) {
    const property = options.properties.find(
      (item) => ts.isPropertyAssignment(item) && item.name.getText(source) === 'operation'
    )
    if (property && ts.isPropertyAssignment(property)) operation = property.initializer
  } else {
    function findAdmission(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['admitV2Request', 'admitOptionalV2Request'].includes(node.expression.text)
      ) {
        if (operation) throw new Error(`Ambiguous admission policy: ${sourcePath}`)
        operation = node.arguments[1]
      }
      ts.forEachChild(node, findAdmission)
    }
    findAdmission(handler)
  }
  if (
    !operation ||
    !ts.isPropertyAccessExpression(operation) ||
    !ts.isIdentifier(operation.expression)
  ) {
    throw new Error(`Unresolved admission policy: ${sourcePath}`)
  }
  const imported = imports.get(operation.expression.text)
  if (!imported || !imported.module.endsWith('/operations')) {
    throw new Error(`Admission policy must reference its operation registry: ${sourcePath}`)
  }
  const registryModule = (await import(imported.module)) as Record<string, Record<string, unknown>>
  return registryModule[imported.name]?.[operation.name.text]
}

const EXPECTED_OPERATION_COUNTS = new Map<string, number>([
  ['apps/docs/openapi-v2-workflows.json', 38],
  ['apps/docs/openapi-v2-logs.json', 3],
  ['apps/docs/openapi-v2-files-audit.json', 29],
  ['apps/docs/openapi-v2-tables.json', 53],
  ['apps/docs/openapi-v2-knowledge.json', 45],
  ['apps/docs/openapi-v2-billing.json', 2],
  ['apps/docs/openapi-v2-resources.json', 51],
])

const generatedDocuments = new Map<(typeof DOCUMENTS)[number], JsonObject>()

function generatedDocument(document: (typeof DOCUMENTS)[number]): JsonObject {
  const cached = generatedDocuments.get(document)
  if (cached) return cached

  const generated = generateOpenApiDocument(document)
  generatedDocuments.set(document, generated)
  return generated
}

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

function oversizedDescriptions(value: unknown, location: string, out: string[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => oversizedDescriptions(item, `${location}[${index}]`, out))
    return
  }

  for (const [key, nested] of Object.entries(value as JsonObject)) {
    const nestedLocation = `${location}.${key}`
    if (key === 'description' && typeof nested === 'string') {
      const wordCount = nested.trim() ? nested.trim().split(/\s+/).length : 0
      if (wordCount > MAX_DESCRIPTION_WORDS) {
        out.push(`${nestedLocation} (${wordCount} words)`)
      }
      continue
    }
    oversizedDescriptions(nested, nestedLocation, out)
  }
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
  it('documents the canonical operation and its public API OAuth scope', async () => {
    for (const document of DOCUMENTS) {
      for (const route of document.routes) {
        const runtimeOperation = await routeApplicationOperation(
          route.contract.path,
          route.contract.method
        )
        expect(runtimeOperation, `${route.contract.method} ${route.contract.path}`).toBe(
          route.operation.applicationOperation
        )
        const generated = getOperation(
          generatedDocument(document),
          route.contract.path.replace(/\[([^\]]+)\]/g, '{$1}'),
          route.contract.method.toLowerCase()
        )
        expect(generated['x-sim-operation']).toBe(route.operation.applicationOperation.id)
        const operationScope = route.operation.applicationOperation.oauthScope
        expect(generated['x-oauth-scope']).toBe(
          operationScope === 'search:read' ? 'api:read' : operationScope
        )
      }
    }
  })

  it('keeps every description concise without padding simple fields', () => {
    const outliers: string[] = []
    for (const document of DOCUMENTS) {
      oversizedDescriptions(generatedDocument(document), document.output, outliers)
    }

    expect(outliers).toEqual([])
  })

  it('covers the complete public v2 operation surface with canonical errors', () => {
    const outputs = DOCUMENTS.map((document) => document.output)
    expect(new Set(outputs).size).toBe(DOCUMENTS.length)

    let totalOperations = 0
    for (const document of DOCUMENTS) {
      const spec = generatedDocument(document)
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
    expect(totalOperations).toBe(221)
  })

  it('documents mixed workflow execution and resume responses', () => {
    const spec = generatedDocument(workflowsOpenApiDocument)
    const execute = getOperation(spec, '/api/v2/workflows/{workflowId}/execute', 'post')
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
    expect(execute.security).toEqual([{ apiKey: [] }, { oauthBearer: [] }, {}])
    expect(Object.keys(executeOkContent).sort()).toEqual([
      'application/json',
      'application/x-ndjson',
      'text/event-stream',
    ])
    expect(Object.keys(executeQueuedContent)).toEqual(['application/json'])

    const resume = getOperation(spec, '/api/v2/workflows/{workflowId}/runs/{runId}/resume', 'post')
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

    const listRuns = getOperation(spec, '/api/v2/workflows/{workflowId}/runs', 'get')
    const getRun = getOperation(spec, '/api/v2/workflows/{workflowId}/runs/{runId}', 'get')
    const cancelRun = getOperation(
      spec,
      '/api/v2/workflows/{workflowId}/runs/{runId}/cancel',
      'post'
    )
    expect(listRuns.tags).toEqual(['Workflow Runs'])
    expect(getRun.tags).toEqual(['Workflow Runs'])
    expect(cancelRun.tags).toEqual(['Workflow Runs'])
  })

  it('documents multipart uploads, dual-status secret sets, and nullable file shares', () => {
    const knowledgeSpec = generatedDocument(knowledgeOpenApiDocument)
    const upload = getOperation(
      knowledgeSpec,
      '/api/v2/knowledge/{knowledgeBaseId}/documents',
      'post'
    )
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

    const resourcesSpec = generatedDocument(resourcesOpenApiDocument)
    const setSecret = getOperation(resourcesSpec, '/api/v2/secrets/{name}', 'put')
    expect(
      Object.keys(setSecret.responses as JsonObject).filter((status) => status.startsWith('2'))
    ).toEqual(['200', '201'])

    const filesSpec = generatedDocument(filesAuditOpenApiDocument)
    const fileSchemas = (filesSpec.components as JsonObject).schemas as JsonObject
    const fileMetadata = fileSchemas.V2FileMetadata as JsonObject
    const fileMetadataProperties = fileMetadata.properties as JsonObject
    const share = fileMetadataProperties.share as JsonObject

    expect(share.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]))
  })

  it('documents public resource owner email addresses', () => {
    const knowledgeSpec = generatedDocument(knowledgeOpenApiDocument)
    const knowledgeSchemas = (knowledgeSpec.components as JsonObject).schemas as JsonObject
    const knowledgeBase = knowledgeSchemas.V2KnowledgeBase as JsonObject
    const knowledgeBaseProperties = knowledgeBase.properties as JsonObject

    const tablesSpec = generatedDocument(tablesOpenApiDocument)
    const tableSchemas = (tablesSpec.components as JsonObject).schemas as JsonObject
    const table = tableSchemas.V2ApiTable as JsonObject
    const tableProperties = table.properties as JsonObject

    expect(knowledgeBaseProperties.ownerEmail).toMatchObject({ type: 'string', format: 'email' })
    expect(tableProperties.ownerEmail).toMatchObject({ type: 'string', format: 'email' })
  })

  it('omits feature-flagged table column types', () => {
    expect(JSON.stringify(generatedDocument(tablesOpenApiDocument))).not.toContain('"ttl"')
  })

  it('keeps billing as its own API reference group', () => {
    const spec = generatedDocument(billingOpenApiDocument)
    expect((spec.tags as JsonObject[]).map((tag) => tag.name)).toEqual(['Billing'])
    expect(getOperation(spec, '/api/v2/billing/status', 'get').tags).toEqual(['Billing'])
    expect(getOperation(spec, '/api/v2/billing/logs', 'get').tags).toEqual(['Billing'])
  })

  it('documents workspace details as a named schema without internal mode', () => {
    const resourcesSpec = generatedDocument(resourcesOpenApiDocument)
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

  it('publishes Agent tools as integration, custom, MCP tool, and advanced MCP schemas', () => {
    const workflowsSpec = generatedDocument(workflowsOpenApiDocument)
    const schemas = (workflowsSpec.components as JsonObject).schemas as JsonObject
    const agentToolInput = schemas.AgentToolInput as JsonObject
    const agentTool = schemas.AgentTool as JsonObject
    const agentToolVariants = agentTool.oneOf as JsonObject[]
    const integrationTool = schemas.AgentIntegrationTool as JsonObject
    const integrationProperties = integrationTool.properties as JsonObject
    const customTool = schemas.AgentCustomTool as JsonObject
    const customToolVariants = customTool.anyOf as JsonObject[]
    const inlineCustomToolProperties = customToolVariants[1].properties as JsonObject
    const inlineCustomToolSchema = inlineCustomToolProperties.schema as JsonObject
    const inlineCustomToolSchemaProperties = inlineCustomToolSchema.properties as JsonObject
    const inlineFunction = inlineCustomToolSchemaProperties.function as JsonObject
    const inlineFunctionProperties = inlineFunction.properties as JsonObject
    const mcpTool = schemas.AgentMcpTool as JsonObject
    const mcpProperties = mcpTool.properties as JsonObject
    const mcpParams = mcpProperties.params as JsonObject
    const mcpParamIdentity = (mcpParams.allOf as JsonObject[])[0]
    const mcpParamProperties = mcpParamIdentity.properties as JsonObject

    expect(agentToolVariants).toEqual([
      { $ref: '#/components/schemas/AgentIntegrationTool' },
      { $ref: '#/components/schemas/AgentCustomTool' },
      { $ref: '#/components/schemas/AgentMcpTool' },
      { $ref: '#/components/schemas/AgentMcpServerAdvanced' },
    ])
    expect(agentToolInput).toEqual(
      expect.objectContaining({ type: 'array', maxItems: MAX_AGENT_TOOLS_PER_BLOCK })
    )
    expect(integrationProperties).toEqual(
      expect.objectContaining({
        type: expect.objectContaining({ type: 'string', pattern: expect.any(String) }),
        operation: expect.objectContaining({ type: 'string' }),
        usageControl: expect.objectContaining({ enum: ['auto', 'force', 'none'] }),
        params: expect.objectContaining({ type: 'object' }),
      })
    )
    expect(customTool).toHaveProperty('anyOf')
    expect(inlineFunctionProperties.name).toEqual(
      expect.objectContaining({ type: 'string', maxLength: 64 })
    )
    expect((mcpProperties.type as JsonObject).const).toBe('mcp')
    expect(mcpParamProperties).toEqual(
      expect.objectContaining({
        serverId: expect.objectContaining({ type: 'string', maxLength: MAX_ID_LENGTH }),
        toolName: expect.objectContaining({
          type: 'string',
          maxLength: MAX_MCP_TOOL_NAME_BYTES,
        }),
      })
    )
    expect(JSON.stringify(schemas.WorkflowEditOperation)).toContain(
      '#/components/schemas/AgentToolInput'
    )
  })

  it('uses named schemas for top-level response objects and list items', () => {
    for (const document of DOCUMENTS) {
      expect(anonymousTopLevelResponseObjects(generatedDocument(document))).toEqual([])
    }
  })

  it('places audit logs at the bottom of the API reference sidebar', () => {
    const metaPath = path.resolve(process.cwd(), 'apps/docs/content/docs/api-reference/meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { pages: string[] }
    expect(meta.pages.at(-1)).toBe('(generated)/audit-logs')
  })

  it('keeps the execution guides on the v2 request and run-status wire shape', () => {
    const guideRoot = path.resolve(process.cwd(), 'apps/docs/content/docs/api-reference')
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
  })

  it('serializes all documents deterministically', () => {
    for (const document of DOCUMENTS) {
      expect(serializeOpenApiDocument(document)).toBe(serializeOpenApiDocument(document))
    }
  })
})

/**
 * Documented error sets.
 *
 * The 413 sweep runs over all seven documents rather than the two families it
 * first audited: the gaps the narrower scope was written around are closed, and
 * leaving it narrow would let a new body-carrying operation in any other family
 * ship without publishing the 413 its body read raises.
 */
describe('documented error sets', () => {
  /**
   * A v2 JSON route whose contract declares a body reads that body through
   * `parseJsonBody` under `DEFAULT_MAX_JSON_BODY_BYTES` *before* schema
   * validation, with the builders supplying `V2_PARSE_DEFAULTS`. So an
   * oversized body is a real 413 on every one of them, and an operation that
   * does not publish it is documenting a response its callers can hit. The
   * converse does not hold — several bodyless folder reads publish 413 because
   * materializing an oversized folder tree raises one — so this is one
   * directional.
   */
  it.each(
    DOCUMENTS.flatMap((document) =>
      document.routes
        .filter((route) => route.contract.body !== undefined)
        .map((route) => [route.operation.operationId, route.operation.errors] as const)
    )
  )('%s publishes the 413 its body read can raise', (_operationId, errors) => {
    expect(errors).toContain('PayloadTooLarge')
  })

  /**
   * The file list resolves its `folderPath` filter through the capped folder
   * path index, so an oversized workspace tree is a 413 here exactly as it is on
   * the knowledge, workflow, and table lists.
   */
  it('publishes the folder-tree 413 the file list can raise', () => {
    const listFiles = filesAuditOpenApiDocument.routes.find(
      (route) => route.operation.operationId === 'listFiles'
    )?.operation

    expect(listFiles?.errors).toContain('PayloadTooLarge')
    expect(listFiles?.description).toContain(FOLDER_TREE_TOO_LARGE)
  })

  /**
   * `listAuditLogs` has no not-found path to publish. It throws only
   * `validation` (a bad cursor, a workspaceId outside the organization),
   * `resolveEnterpriseAuditAccess` returns 403 shapes only, and an empty
   * selection is an empty page. `getAuditLog` does 404 and keeps it.
   */
  it('does not publish a 404 the audit-log list cannot emit', () => {
    const spec = generatedDocument(filesAuditOpenApiDocument)
    expect(
      Object.keys(getOperation(spec, '/api/v2/audit-logs', 'get').responses as JsonObject)
    ).not.toContain('404')
    expect(
      Object.keys(
        getOperation(spec, '/api/v2/audit-logs/{auditLogId}', 'get').responses as JsonObject
      )
    ).toContain('404')
  })

  /**
   * `files.share.update` denies the workspace key through its principal-kind
   * list, which raises `PrincipalKindAuthorizationError` — not one of the
   * cross-tenant errors the concealment policy rewrites — so the caller sees
   * 403. The description claimed 404.
   */
  it('describes the file-share workspace-key refusal as the 403 it renders', () => {
    const description = filesAuditOpenApiDocument.routes.find(
      (route) => route.operation.operationId === 'upsertFileShare'
    )?.operation.description

    expect(description).toContain(WORKSPACE_API_KEY_DENIED)
    expect(description).not.toContain(WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND)
  })
})

/**
 * Shared parameter vocabulary.
 *
 * `cursor` and `sortOrder` appear on dozens of operations across the seven
 * documents, and each is sourced from one schema in `contracts/v2/shared.ts`. A
 * caller reading two families back to back cannot tell a reworded copy from a
 * different contract, so a divergence is a defect rather than a style choice.
 * This pins each to one string; a list that hand-rolls its own `cursor` fails
 * here.
 *
 * `startDate`/`endDate` are deliberately excluded: the run-window pair and the
 * billing usage window share a name but filter different sequences.
 */
describe('shared parameter descriptions do not fork', () => {
  const SINGLE_VOICE_PARAMETERS = ['cursor', 'sortOrder'] as const

  const descriptionsByParameter = new Map<string, Set<string>>()
  for (const document of DOCUMENTS) {
    const spec = generatedDocument(document)
    for (const operation of operations(spec)) {
      for (const parameter of (operation.parameters ?? []) as JsonObject[]) {
        const name = parameter.name as string
        if (!SINGLE_VOICE_PARAMETERS.includes(name as (typeof SINGLE_VOICE_PARAMETERS)[number])) {
          continue
        }
        const seen = descriptionsByParameter.get(name) ?? new Set<string>()
        seen.add(parameter.description as string)
        descriptionsByParameter.set(name, seen)
      }
    }
  }

  it.each(SINGLE_VOICE_PARAMETERS)('publishes one description for %s', (name) => {
    expect([...(descriptionsByParameter.get(name) ?? [])]).toHaveLength(1)
  })
})

/**
 * The run-retention window is the one fact that explains an empty run list on a
 * workflow reporting a non-zero `runCount`, and it is published on both reads
 * over `workflow_execution_logs` from one constant. Pinning both keeps a future
 * trim from silently dropping it off one of them.
 */
describe('run retention is published on both run reads', () => {
  it.each([
    [logsOpenApiDocument, 'listLogs'],
    [workflowsOpenApiDocument, 'listWorkflowRunsV2'],
  ] as const)('%#: names the retention window', (document, operationId) => {
    const description = document.routes.find((route) => route.operation.operationId === operationId)
      ?.operation.description

    expect(description).toContain(RUN_RETENTION)
  })
})

/**
 * Every published tag needs a sidebar entry, or its operations are
 * unbrowsable.
 *
 * The specs and the reference nav are generated from different places, so a new
 * tag group ships complete — paths, schemas, examples — and simply never
 * appears in the docs. `Catalog` and `Meta` did exactly that: six operations
 * were published and unreachable, and nothing failed.
 */
describe('api-reference navigation coverage', () => {
  it('lists every published tag group in the sidebar', () => {
    const tags = new Set<string>()
    for (const output of EXPECTED_OPERATION_COUNTS.keys()) {
      const spec = JSON.parse(readFileSync(path.resolve(process.cwd(), output), 'utf8')) as {
        tags?: Array<{ name: string }>
      }
      for (const tag of spec.tags ?? []) tags.add(tag.name)
    }
    expect(tags.size).toBeGreaterThan(0)

    const meta = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), 'apps/docs/content/docs/api-reference/meta.json'),
        'utf8'
      )
    ) as { pages: string[] }
    const slugs = new Set(meta.pages.map((page) => page.split('/').at(-1)))
    const missing = [...tags].filter((tag) => !slugs.has(tag.toLowerCase().replaceAll(' ', '-')))
    missing.sort()
    expect(missing, 'sidebar is missing a published tag group').toEqual([])
  })
})
