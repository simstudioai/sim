import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import { billingOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/billing'
import { filesAuditOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/files-audit'
import { knowledgeOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/knowledge'
import { logsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/logs'
import { resourcesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/resources'
import { tablesOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/tables'
import { workflowsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/workflows'
import { generateOpenApiDocument } from './generator'

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
  ['apps/docs/openapi-v2-workflows.json', 58],
  ['apps/docs/openapi-v2-logs.json', 3],
  ['apps/docs/openapi-v2-files-audit.json', 35],
  ['apps/docs/openapi-v2-tables.json', 53],
  ['apps/docs/openapi-v2-knowledge.json', 45],
  ['apps/docs/openapi-v2-billing.json', 2],
  ['apps/docs/openapi-v2-resources.json', 92],
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

function _oversizedDescriptions(value: unknown, location: string, out: string[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => _oversizedDescriptions(item, `${location}[${index}]`, out))
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
    _oversizedDescriptions(nested, nestedLocation, out)
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

function _anonymousTopLevelResponseObjects(spec: JsonObject): string[] {
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
    expect(totalOperations).toBe(288)
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
})
