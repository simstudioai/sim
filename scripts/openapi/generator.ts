import { omit } from '@sim/utils/object'
import { z } from 'zod'
import type { AnyApiRouteContract, ApiSchema } from '@/lib/api/contracts/types'
import type {
  OpenApiDocumentDefinition,
  OpenApiOperationMetadata,
  OpenApiRouteDefinition,
} from '@/lib/api/openapi/types'

type JsonObject = Record<string, unknown>

const HTTP_SUCCESS_MIN = 200
const HTTP_SUCCESS_MAX = 299
const HTTP_ERROR_MIN = 400
const HTTP_ERROR_MAX = 599
const SCHEMA_SHAPE_KEYS = new Set([
  '$ref',
  'type',
  'properties',
  'items',
  'prefixItems',
  'oneOf',
  'anyOf',
  'allOf',
  'enum',
  'const',
  'not',
  'additionalProperties',
])

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nonEmpty(value: string, label: string): void {
  invariant(value.trim().length > 0, `${label} is required`)
}

function schemaMetadata(schema: ApiSchema, label: string): z.core.GlobalMeta {
  const metadata = z.globalRegistry.get(schema)
  invariant(metadata, `${label} is missing Zod metadata`)
  nonEmpty(metadata.title ?? '', `${label} metadata.title`)
  nonEmpty(metadata.description ?? '', `${label} metadata.description`)
  return metadata
}

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs)
  if (!value || typeof value !== 'object') return value

  const result: JsonObject = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$ref' && typeof entry === 'string' && entry.startsWith('#/$defs/')) {
      result[key] = entry.replace('#/$defs/', '#/components/schemas/')
      continue
    }
    result[key] = rewriteRefs(entry)
  }
  return result
}

function sanitizeSchema(value: unknown): JsonObject {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'Expected JSON Schema')
  return omit(rewriteRefs(value) as JsonObject, ['$schema', '$id', 'id'])
}

function addComponent(
  components: JsonObject,
  name: string,
  schema: JsonObject,
  label: string
): void {
  const existing = components[name]
  if (existing !== undefined) {
    invariant(
      JSON.stringify(existing) === JSON.stringify(schema),
      `${label} conflicts with the existing ${name} component`
    )
    return
  }
  components[name] = schema
}

function validateNoSilentOpaqueSchemas(schema: JsonObject, label: string, path = '<root>'): void {
  const keys = Object.keys(schema)
  if (!keys.some((key) => SCHEMA_SHAPE_KEYS.has(key))) {
    nonEmpty(
      typeof schema.description === 'string' ? schema.description : '',
      `${label} opaque schema at ${path} description`
    )
  }

  const properties = schema.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [name, property] of Object.entries(properties as JsonObject)) {
      invariant(property && typeof property === 'object', `${label}.${name} is not a schema`)
      validateNoSilentOpaqueSchemas(property as JsonObject, label, `${path}.${name}`)
    }
  }
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    validateNoSilentOpaqueSchemas(schema.items as JsonObject, label, `${path}[]`)
  }
  for (const keyword of ['prefixItems', 'oneOf', 'anyOf', 'allOf'] as const) {
    const variants = schema[keyword]
    if (!Array.isArray(variants)) continue
    for (const [index, variant] of variants.entries()) {
      invariant(variant && typeof variant === 'object', `${label} ${keyword} entry is not a schema`)
      validateNoSilentOpaqueSchemas(variant as JsonObject, label, `${path}.${keyword}[${index}]`)
    }
  }
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object' &&
    !Array.isArray(schema.additionalProperties)
  ) {
    validateNoSilentOpaqueSchemas(
      schema.additionalProperties as JsonObject,
      label,
      `${path}.additionalProperties`
    )
  }
}

function generateSchema(
  schema: ApiSchema,
  io: 'input' | 'output',
  components: JsonObject,
  label: string,
  includeRootComponent = true
): { name: string; schema: JsonObject; metadata: z.core.GlobalMeta } {
  const metadata = schemaMetadata(schema, label)
  const { $defs: definitions, ...generated } = z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    cycles: 'throw',
    reused: 'inline',
    override: ({ zodSchema, path }) => {
      const current = zodSchema as ApiSchema
      validateExamples(
        current,
        z.globalRegistry.get(current)?.examples,
        io,
        `${label} at ${path.join('.') || '<root>'}`
      )
    },
  }) as JsonObject

  if (definitions !== undefined) {
    invariant(
      definitions && typeof definitions === 'object' && !Array.isArray(definitions),
      `${label} emitted invalid $defs`
    )
    for (const [name, definition] of Object.entries(definitions as JsonObject)) {
      const component = sanitizeSchema(definition)
      validateNoSilentOpaqueSchemas(component, `${label} component ${name}`)
      addComponent(components, name, component, label)
    }
  }

  const name = metadata.id
  nonEmpty(name ?? '', `${label} metadata.id`)
  const output = sanitizeSchema(generated)
  validateNoSilentOpaqueSchemas(output, label)
  if (includeRootComponent) addComponent(components, name as string, output, label)
  return { name: name as string, schema: output, metadata }
}

function objectProperties(
  schema: ApiSchema,
  components: JsonObject,
  label: string
): { properties: JsonObject; required: Set<string> } {
  const generatedSchema = generateSchema(schema, 'input', components, label, false)
  const generated = generatedSchema.schema
  invariant(generated.type === 'object', `${label} must generate an object schema`)
  invariant(
    generated.properties &&
      typeof generated.properties === 'object' &&
      !Array.isArray(generated.properties),
    `${label} must generate object properties`
  )
  return {
    properties: generated.properties as JsonObject,
    required: new Set((generated.required as string[] | undefined) ?? []),
  }
}

function parametersFor(
  schema: ApiSchema | undefined,
  location: 'path' | 'query' | 'header',
  components: JsonObject,
  label: string
): JsonObject[] {
  if (!schema) return []
  const { properties, required } = objectProperties(schema, components, label)
  return Object.entries(properties).map(([name, property]) => {
    invariant(property && typeof property === 'object', `${label}.${name} is not a schema`)
    const description = (property as JsonObject).description
    nonEmpty(typeof description === 'string' ? description : '', `${label}.${name} description`)
    return {
      name,
      in: location,
      required: location === 'path' || required.has(name),
      description,
      schema: property,
    }
  })
}

function contractPathToOpenApi(path: string): string {
  nonEmpty(path, 'Contract path')
  const converted = path.replace(/\[([^\]]+)\]/g, '{$1}')
  invariant(!converted.includes('[') && !converted.includes(']'), `Invalid contract path ${path}`)
  return converted
}

function contractStatuses(contract: AnyApiRouteContract): number[] {
  const configured = contract.response.status
  const statuses =
    configured === undefined ? [200] : Array.isArray(configured) ? [...configured] : [configured]
  invariant(statuses.length > 0, `${contract.method} ${contract.path} has no success status`)
  const minimum = contract.response.mode === 'redirect' ? 300 : HTTP_SUCCESS_MIN
  const maximum = contract.response.mode === 'redirect' ? 399 : HTTP_SUCCESS_MAX
  for (const status of statuses) {
    invariant(
      Number.isInteger(status) && status >= minimum && status <= maximum,
      `${contract.method} ${contract.path} has invalid success status ${status}`
    )
  }
  return statuses
}

function successContent(
  route: OpenApiRouteDefinition,
  components: JsonObject,
  label: string
): JsonObject | undefined {
  const { response } = route.contract
  const contentTypes = route.operation.success.contentTypes

  if (response.mode === 'empty' || response.mode === 'redirect') {
    invariant(!contentTypes, `${label} ${response.mode} response cannot declare content types`)
    if (response.mode === 'redirect') {
      invariant(
        route.operation.success.headers?.includes('Location'),
        `${label} redirect response must document the Location header`
      )
    }
    return undefined
  }

  if (response.mode === 'json') {
    invariant(!contentTypes, `${label} JSON response content type is fixed`)
    const schema = route.schemas.response
    invariant(schema, `${label} is missing its documented response schema`)
    const generated = generateSchema(schema, 'output', components, `${label} response`)
    validateExamples(schema, generated.metadata.examples, 'output', `${label} response`)
    return {
      'application/json': { schema: { $ref: `#/components/schemas/${generated.name}` } },
    }
  }

  invariant(contentTypes?.length, `${label} ${response.mode} response requires content types`)
  const schema =
    response.mode === 'binary' ? { type: 'string', format: 'binary' } : { type: 'string' }
  return Object.fromEntries(contentTypes.map((contentType) => [contentType, { schema }]))
}

function validateExamples(
  schema: ApiSchema,
  examples: unknown,
  io: 'input' | 'output',
  label: string
): void {
  if (examples === undefined) return
  invariant(
    Array.isArray(examples) && examples.length > 0,
    `${label} examples must be a non-empty array`
  )
  for (const [index, example] of examples.entries()) {
    const result = schema.safeParse(example)
    invariant(
      result.success,
      `${label} example ${index + 1} is invalid for the ${io} schema: ${result.error?.issues[0]?.message ?? 'validation failed'}`
    )
  }
}

function requestBodyFor(
  route: OpenApiRouteDefinition,
  components: JsonObject,
  label: string
): JsonObject | undefined {
  if (!route.contract.body) return undefined
  const schema = route.schemas.body
  invariant(schema, `${label} is missing its documented body schema`)
  const generated = generateSchema(schema, 'input', components, `${label} body`)
  validateExamples(schema, generated.metadata.examples, 'input', `${label} body`)
  return {
    required: !schema.safeParse(undefined).success,
    description: generated.metadata.description,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${generated.name}` },
      },
    },
  }
}

function referencedHeaders(headerNames: readonly string[] | undefined): JsonObject | undefined {
  if (!headerNames?.length) return undefined
  return Object.fromEntries(
    headerNames.map((name) => [name, { $ref: `#/components/headers/${name}` }])
  )
}

function operationFor(
  route: OpenApiRouteDefinition,
  definition: OpenApiDocumentDefinition,
  components: JsonObject
): JsonObject {
  const { contract, operation, schemas } = route
  const label = `${contract.method} ${contract.path}`
  validateOperationMetadata(operation, definition, label)

  invariant(
    Boolean(contract.params) === Boolean(schemas.params),
    `${label} params metadata mismatch`
  )
  invariant(Boolean(contract.query) === Boolean(schemas.query), `${label} query metadata mismatch`)
  invariant(Boolean(contract.body) === Boolean(schemas.body), `${label} body metadata mismatch`)
  invariant(
    Boolean(contract.headers) === Boolean(schemas.headers),
    `${label} headers metadata mismatch`
  )
  invariant(
    (contract.response.mode === 'json') === Boolean(schemas.response),
    `${label} response metadata mismatch`
  )

  const parameters = [
    ...parametersFor(schemas.params, 'path', components, `${label} params`),
    ...parametersFor(schemas.query, 'query', components, `${label} query`),
    ...parametersFor(schemas.headers, 'header', components, `${label} headers`),
  ]
  const pathParameterNames = new Set(
    [...contract.path.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1])
  )
  const documentedPathNames = new Set(
    parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name)
  )
  invariant(
    JSON.stringify([...pathParameterNames].sort()) ===
      JSON.stringify([...documentedPathNames].sort()),
    `${label} path parameters do not match the contract path`
  )

  const responses: JsonObject = {}
  const content = successContent(route, components, label)
  for (const status of contractStatuses(contract)) {
    responses[String(status)] = {
      description: operation.success.description,
      ...(referencedHeaders(operation.success.headers)
        ? { headers: referencedHeaders(operation.success.headers) }
        : {}),
      ...(content ? { content } : {}),
    }
  }
  for (const errorId of operation.errors) {
    const error = definition.errorResponses[errorId]
    invariant(error, `${label} references unknown error response ${errorId}`)
    responses[String(error.status)] = { $ref: `#/components/responses/${errorId}` }
  }

  const requestBody = requestBodyFor(route, components, label)
  return {
    operationId: operation.operationId,
    summary: operation.summary,
    description: operation.description,
    tags: [...operation.tags],
    ...(operation.deprecated === undefined ? {} : { deprecated: operation.deprecated }),
    ...(operation.security === undefined ? {} : { security: operation.security }),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(requestBody ? { requestBody } : {}),
    responses,
  }
}

function validateOperationMetadata(
  operation: OpenApiOperationMetadata,
  definition: OpenApiDocumentDefinition,
  label: string
): void {
  nonEmpty(operation.operationId, `${label} operationId`)
  nonEmpty(operation.summary, `${label} summary`)
  nonEmpty(operation.description, `${label} description`)
  nonEmpty(operation.success.description, `${label} success description`)
  invariant(operation.tags.length > 0, `${label} must declare at least one tag`)
  for (const tag of operation.tags) {
    invariant(
      definition.tags.some((entry) => entry.name === tag),
      `${label} references unknown tag ${tag}`
    )
  }
  invariant(operation.errors.length > 0, `${label} must declare error responses`)
  const errorStatuses = operation.errors.map((errorId) => {
    const response = definition.errorResponses[errorId]
    invariant(response, `${label} references unknown error response ${errorId}`)
    return response.status
  })
  invariant(
    new Set(errorStatuses).size === errorStatuses.length,
    `${label} repeats an error status`
  )
  invariant(errorStatuses.includes(401), `${label} must document a 401 response`)
  invariant(errorStatuses.includes(429), `${label} must document a 429 response`)

  for (const header of operation.success.headers ?? []) {
    invariant(definition.headers[header], `${label} references unknown success header ${header}`)
  }
  validateSecurity(operation.security ?? definition.security, definition, label)
}

function validateSecurity(
  requirements: readonly Readonly<Record<string, readonly string[]>>[],
  definition: OpenApiDocumentDefinition,
  label: string
): void {
  invariant(requirements.length > 0, `${label} must declare a security requirement`)
  for (const requirement of requirements) {
    invariant(Object.keys(requirement).length > 0, `${label} has an empty security requirement`)
    for (const scheme of Object.keys(requirement)) {
      invariant(
        definition.securitySchemes[scheme],
        `${label} references unknown security scheme ${scheme}`
      )
    }
  }
}

function errorComponents(definition: OpenApiDocumentDefinition, schemas: JsonObject): JsonObject {
  const generated = generateSchema(
    definition.errorSchema,
    'output',
    schemas,
    'OpenAPI error schema'
  )
  validateExamples(
    definition.errorSchema,
    generated.metadata.examples,
    'output',
    'OpenAPI error schema'
  )
  const responses: JsonObject = {}
  for (const [id, response] of Object.entries(definition.errorResponses)) {
    nonEmpty(id, 'Error response id')
    nonEmpty(response.description, `${id} description`)
    invariant(
      Number.isInteger(response.status) &&
        response.status >= HTTP_ERROR_MIN &&
        response.status <= HTTP_ERROR_MAX,
      `${id} has invalid error status ${response.status}`
    )
    for (const header of response.headers ?? []) {
      invariant(definition.headers[header], `${id} references unknown response header ${header}`)
    }
    responses[id] = {
      description: response.description,
      ...(referencedHeaders(response.headers)
        ? { headers: referencedHeaders(response.headers) }
        : {}),
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${generated.name}` },
        },
      },
    }
  }
  return responses
}

export function generateOpenApiDocument(definition: OpenApiDocumentDefinition): JsonObject {
  nonEmpty(definition.output, 'OpenAPI output')
  nonEmpty(definition.info.title, 'OpenAPI info.title')
  nonEmpty(definition.info.description, 'OpenAPI info.description')
  nonEmpty(definition.info.version, 'OpenAPI info.version')
  invariant(definition.routes.length > 0, 'OpenAPI document has no routes')
  validateSecurity(definition.security, definition, 'OpenAPI document')

  const schemas: JsonObject = {}
  const responses = errorComponents(definition, schemas)
  const paths: JsonObject = {}
  const operationIds = new Set<string>()
  const routeKeys = new Set<string>()

  for (const route of definition.routes) {
    const openApiPath = contractPathToOpenApi(route.contract.path)
    const method = route.contract.method.toLowerCase()
    const routeKey = `${method.toUpperCase()} ${openApiPath}`
    invariant(!routeKeys.has(routeKey), `Duplicate OpenAPI route ${routeKey}`)
    routeKeys.add(routeKey)
    invariant(
      !operationIds.has(route.operation.operationId),
      `Duplicate operationId ${route.operation.operationId}`
    )
    operationIds.add(route.operation.operationId)
    const pathItem = (paths[openApiPath] ?? {}) as JsonObject
    pathItem[method] = operationFor(route, definition, schemas)
    paths[openApiPath] = pathItem
  }

  for (const [name, header] of Object.entries(definition.headers)) {
    schemaMetadata(header.schema, `${name} header schema`)
  }

  return {
    openapi: '3.1.0',
    info: definition.info,
    servers: definition.servers,
    tags: definition.tags,
    security: definition.security,
    paths,
    components: {
      securitySchemes: definition.securitySchemes,
      headers: Object.fromEntries(
        Object.entries(definition.headers).map(([name, header]) => {
          const metadata = schemaMetadata(header.schema, `${name} header schema`)
          return [
            name,
            {
              description: metadata.description,
              schema: sanitizeSchema(
                z.toJSONSchema(header.schema, {
                  io: 'output',
                  unrepresentable: 'throw',
                  cycles: 'throw',
                })
              ),
            },
          ]
        })
      ),
      responses,
      schemas,
    },
    'x-generated-by': 'scripts/generate-openapi.ts',
  }
}

export function serializeOpenApiDocument(definition: OpenApiDocumentDefinition): string {
  return `${JSON.stringify(generateOpenApiDocument(definition), null, 2)}\n`
}

export { contractPathToOpenApi }
