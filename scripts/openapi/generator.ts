import { omit } from '@sim/utils/object'
import Ajv2020 from 'ajv/dist/2020'
import { z } from 'zod'
import type { AnyApiRouteContract, ApiSchema } from '@/lib/api/contracts/types'
import type {
  OpenApiDocumentDefinition,
  OpenApiOperationMetadata,
  OpenApiRouteDefinition,
  OpenApiStatusSuccessMetadata,
} from '@/lib/api/openapi/types'

type JsonObject = Record<string, unknown>
type SchemaIo = 'input' | 'output'

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
const SCHEMA_DOCUMENTATION_KEYS = new Set([
  'title',
  'description',
  'examples',
  'example',
  'deprecated',
])
const outputExampleValidator = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false,
})
const comparableSchemaCache = new WeakMap<ApiSchema, Map<SchemaIo, unknown>>()
const generatedSchemaCache = new WeakMap<ApiSchema, Map<SchemaIo, JsonObject>>()
const outputValidatorCache = new WeakMap<
  ApiSchema,
  ReturnType<typeof outputExampleValidator.compile>
>()

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

function stripSchemaDocumentation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaDocumentation)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SCHEMA_DOCUMENTATION_KEYS.has(key))
      .map(([key, entry]) => [key, stripSchemaDocumentation(entry)])
  )
}

function stripLegacySchemaIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLegacySchemaIds)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key !== 'id' || typeof entry !== 'string')
      .map(([key, entry]) => [key, stripLegacySchemaIds(entry)])
  )
}

function omitEnumValuesFromOpenApi(
  metadata: z.core.GlobalMeta | undefined,
  schema: JsonObject,
  label: string
): void {
  const omittedValues = metadata?.omitEnumValuesFromOpenApi
  if (omittedValues === undefined) return

  invariant(
    Array.isArray(omittedValues) && omittedValues.length > 0,
    `${label} omitEnumValuesFromOpenApi must be a non-empty array`
  )
  invariant(
    Array.isArray(schema.enum),
    `${label} omitEnumValuesFromOpenApi requires an enum schema`
  )
  for (const value of omittedValues) {
    invariant(schema.enum.includes(value), `${label} omits an enum value that does not exist`)
  }

  schema.enum = schema.enum.filter((value) => !omittedValues.includes(value))
  invariant(schema.enum.length > 0, `${label} cannot omit every enum value`)
  Reflect.deleteProperty(schema, 'omitEnumValuesFromOpenApi')
}

function comparableSchema(schema: ApiSchema, io: SchemaIo): unknown {
  const cached = comparableSchemaCache.get(schema)?.get(io)
  if (cached) return cached

  const comparable = stripSchemaDocumentation(
    sanitizeSchema(
      z.toJSONSchema(schema, {
        io,
        target: 'draft-2020-12',
        unrepresentable: 'any',
        cycles: 'ref',
        reused: 'inline',
      })
    )
  )
  const byIo = comparableSchemaCache.get(schema) ?? new Map<SchemaIo, unknown>()
  byIo.set(io, comparable)
  comparableSchemaCache.set(schema, byIo)
  return comparable
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
      const propertySchema = property as JsonObject
      if (!propertySchema.$ref) {
        nonEmpty(
          typeof propertySchema.description === 'string' ? propertySchema.description : '',
          `${label} property at ${path}.${name} description`
        )
      }
      validateNoSilentOpaqueSchemas(propertySchema, label, `${path}.${name}`)
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
  io: SchemaIo,
  components: JsonObject,
  label: string,
  includeRootComponent = true
): { name: string; schema: JsonObject; metadata: z.core.GlobalMeta } {
  const metadata = schemaMetadata(schema, label)
  let generatedWithDefinitions = generatedSchemaCache.get(schema)?.get(io)
  if (!generatedWithDefinitions) {
    generatedWithDefinitions = z.toJSONSchema(schema, {
      io,
      target: 'draft-2020-12',
      unrepresentable: 'any',
      cycles: 'ref',
      reused: 'inline',
      override: ({ zodSchema, jsonSchema, path }) => {
        const current = zodSchema as ApiSchema
        const metadata = z.globalRegistry.get(current)
        const schemaLabel = `${label} at ${path.join('.') || '<root>'}`
        validateExamples(current, metadata?.examples, io, schemaLabel)
        omitEnumValuesFromOpenApi(metadata, jsonSchema as JsonObject, schemaLabel)
      },
    }) as JsonObject
    const byIo = generatedSchemaCache.get(schema) ?? new Map<SchemaIo, JsonObject>()
    byIo.set(io, generatedWithDefinitions)
    generatedSchemaCache.set(schema, byIo)
  }
  const { $defs: definitions, ...generated } = generatedWithDefinitions

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

/**
 * Whether a request slice declares no keys at all, i.e. `z.object({}).strict()`.
 *
 * A v2 contract states that an endpoint takes no query params by declaring
 * `query: noInputSchema` rather than by omitting `query`, because an omitted
 * slice is the one `parseRequest` skips validating entirely. That distinction is
 * load-bearing at runtime and invisible to the spec: either way the operation
 * publishes zero parameters.
 */
function declaresNoKeys(schema: ApiSchema): boolean {
  const def = (schema as { def?: { type?: string; shape?: Record<string, unknown> } }).def
  return def?.type === 'object' && Object.keys(def.shape ?? {}).length === 0
}

function parametersFor(
  schema: ApiSchema | undefined,
  location: 'path' | 'query' | 'header',
  components: JsonObject,
  label: string
): JsonObject[] {
  if (!schema) return []
  /**
   * Short-circuited ahead of `objectProperties`, which would otherwise demand
   * the `.meta({ id })` and the non-empty `properties` an empty schema has
   * nothing to supply, and would register a component no operation references.
   */
  if (declaresNoKeys(schema)) return []
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

function defaultSuccessContent(
  route: OpenApiRouteDefinition,
  components: JsonObject,
  label: string
): JsonObject | undefined {
  const { response } = route.contract
  invariant(!('byStatus' in route.operation.success), `${label} requires status-specific content`)
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

function statusSuccessContent(
  route: OpenApiRouteDefinition,
  status: number,
  success: OpenApiStatusSuccessMetadata,
  components: JsonObject,
  label: string
): JsonObject | undefined {
  const { response } = route.contract
  if (response.mode !== 'json') {
    invariant(
      !success.additionalContentTypes,
      `${label} non-JSON response cannot declare additional content types`
    )
    return defaultSuccessContent(
      { ...route, operation: { ...route.operation, success } },
      components,
      label
    )
  }

  const schema = route.schemas.responses?.[status] ?? route.schemas.response
  invariant(schema, `${label} is missing its documented response schema`)
  const generated = generateSchema(schema, 'output', components, `${label} response`)
  validateExamples(schema, generated.metadata.examples, 'output', `${label} response`)
  const content: JsonObject = {
    'application/json': { schema: { $ref: `#/components/schemas/${generated.name}` } },
  }
  for (const contentType of success.additionalContentTypes ?? []) {
    invariant(contentType !== 'application/json', `${label} repeats the JSON content type`)
    content[contentType] = { schema: { type: 'string' } }
  }
  return content
}

function validateExamples(schema: ApiSchema, examples: unknown, io: SchemaIo, label: string): void {
  if (examples === undefined) return
  invariant(
    Array.isArray(examples) && examples.length > 0,
    `${label} examples must be a non-empty array`
  )
  for (const [index, example] of examples.entries()) {
    if (io === 'input') {
      const result = schema.safeParse(example)
      invariant(
        result.success,
        `${label} example ${index + 1} is invalid for the input schema: ${result.error?.issues[0]?.message ?? 'validation failed'}`
      )
      continue
    }
    let validate = outputValidatorCache.get(schema)
    if (!validate) {
      const outputSchema = z.toJSONSchema(schema, {
        io: 'output',
        target: 'draft-2020-12',
        unrepresentable: 'any',
        cycles: 'ref',
        reused: 'inline',
      })
      validate = outputExampleValidator.compile(stripLegacySchemaIds(outputSchema))
      outputValidatorCache.set(schema, validate)
    }
    invariant(
      validate(example),
      `${label} example ${index + 1} is invalid for the output schema: ${outputExampleValidator.errorsText(validate.errors)}`
    )
  }
}

function requestBodyFor(
  route: OpenApiRouteDefinition,
  components: JsonObject,
  label: string
): JsonObject | undefined {
  const requestBody = route.schemas.requestBody
  const schema = route.schemas.body ?? requestBody?.schema
  if (!schema) return undefined
  const generated = generateSchema(schema, 'input', components, `${label} body`)
  validateExamples(schema, generated.metadata.examples, 'input', `${label} body`)
  const contentTypes = requestBody?.contentTypes ?? ['application/json']
  invariant(contentTypes.length > 0, `${label} request body must declare a content type`)
  invariant(
    new Set(contentTypes).size === contentTypes.length,
    `${label} request body repeats a content type`
  )
  for (const contentType of contentTypes) {
    nonEmpty(contentType, `${label} request body content type`)
  }
  return {
    required: !schema.safeParse(undefined).success,
    description: generated.metadata.description,
    content: Object.fromEntries(
      contentTypes.map((contentType) => [
        contentType,
        { schema: { $ref: `#/components/schemas/${generated.name}` } },
      ])
    ),
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
    !(contract.body && schemas.requestBody),
    `${label} cannot declare both a contract body and a documentation-only request body`
  )
  invariant(
    Boolean(contract.headers) === Boolean(schemas.headers),
    `${label} headers metadata mismatch`
  )
  invariant(
    (contract.response.mode === 'json') === Boolean(schemas.response),
    `${label} response metadata mismatch`
  )

  const documentedContractSchemas = [
    ['params', contract.params, schemas.params, 'input'],
    ['query', contract.query, schemas.query, 'input'],
    ['body', contract.body, schemas.body, 'input'],
    ['headers', contract.headers, schemas.headers, 'input'],
    [
      'response',
      contract.response.mode === 'json' ? contract.response.schema : undefined,
      schemas.response,
      'output',
    ],
  ] as const
  for (const [name, contractSchema, documentedSchema, io] of documentedContractSchemas) {
    if (!contractSchema) continue
    invariant(documentedSchema, `${label} is missing its documented ${name} schema`)
    invariant(
      contractSchema === documentedSchema ||
        JSON.stringify(comparableSchema(contractSchema, io)) ===
          JSON.stringify(comparableSchema(documentedSchema, io)),
      `${label} documented ${name} schema does not match the contract schema`
    )
  }

  invariant(
    !schemas.responses || contract.response.mode === 'json',
    `${label} non-JSON response cannot declare status-specific schemas`
  )
  if (schemas.response) {
    schemaMetadata(schemas.response, `${label} contract response schema`)
  }
  const contractStatusSchemas =
    contract.response.mode === 'json' ? contract.response.statusSchemas : undefined
  invariant(
    Boolean(contractStatusSchemas) === Boolean(schemas.responses),
    `${label} status-specific contract schema metadata mismatch`
  )
  if (contractStatusSchemas && schemas.responses) {
    const contractSchemaStatuses = Object.keys(contractStatusSchemas).map(Number)
    const documentedSchemaStatuses = Object.keys(schemas.responses).map(Number)
    const expectedStatuses = contractStatuses(contract)
    for (const [name, statuses] of [
      ['contract', contractSchemaStatuses],
      ['documented', documentedSchemaStatuses],
    ] as const) {
      invariant(
        JSON.stringify([...statuses].sort((a, b) => a - b)) ===
          JSON.stringify([...expectedStatuses].sort((a, b) => a - b)),
        `${label} ${name} status-specific schemas do not match the contract statuses`
      )
    }
    for (const status of expectedStatuses) {
      invariant(
        contractStatusSchemas[status] === schemas.responses[status] ||
          JSON.stringify(comparableSchema(contractStatusSchemas[status], 'output')) ===
            JSON.stringify(comparableSchema(schemas.responses[status], 'output')),
        `${label} documented schema for status ${status} does not match the contract schema`
      )
    }
  }

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
  const statuses = contractStatuses(contract)
  if ('byStatus' in operation.success) {
    const documentedStatuses = Object.keys(operation.success.byStatus)
      .map(Number)
      .sort((a, b) => a - b)
    invariant(
      JSON.stringify(documentedStatuses) === JSON.stringify([...statuses].sort((a, b) => a - b)),
      `${label} status-specific responses do not match the contract statuses`
    )
    const schemaStatuses = Object.keys(schemas.responses ?? {}).map(Number)
    invariant(
      schemaStatuses.every((status) => documentedStatuses.includes(status)),
      `${label} status-specific schemas include an undocumented status`
    )
    for (const status of statuses) {
      const success = operation.success.byStatus[status]
      invariant(success, `${label} is missing success metadata for status ${status}`)
      const content = statusSuccessContent(route, status, success, components, `${label} ${status}`)
      responses[String(status)] = {
        description: success.description,
        ...(referencedHeaders(success.headers)
          ? { headers: referencedHeaders(success.headers) }
          : {}),
        ...(content ? { content } : {}),
      }
    }
  } else {
    invariant(
      !schemas.responses,
      `${label} cannot declare status-specific schemas without status-specific success metadata`
    )
    const content = defaultSuccessContent(route, components, label)
    for (const status of statuses) {
      responses[String(status)] = {
        description: operation.success.description,
        ...(referencedHeaders(operation.success.headers)
          ? { headers: referencedHeaders(operation.success.headers) }
          : {}),
        ...(content ? { content } : {}),
      }
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
    description: operation.applicationOperation.oauthScope
      ? `${operation.description}\n\nOAuth scope: \`${operation.applicationOperation.oauthScope}\`.`
      : operation.description,
    'x-sim-operation': operation.applicationOperation.id,
    ...(operation.applicationOperation.oauthScope
      ? { 'x-oauth-scope': operation.applicationOperation.oauthScope }
      : {}),
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
  nonEmpty(operation.applicationOperation.id, `${label} application operation id`)
  const security = operation.security ?? definition.security
  if (security.some((requirement) => 'oauthBearer' in requirement)) {
    invariant(
      operation.applicationOperation.oauthScope === 'api:read' ||
        operation.applicationOperation.oauthScope === 'api:write',
      `${label} must declare its canonical application's OAuth scope`
    )
  }
  nonEmpty(operation.operationId, `${label} operationId`)
  nonEmpty(operation.summary, `${label} summary`)
  nonEmpty(operation.description, `${label} description`)
  if ('byStatus' in operation.success) {
    invariant(
      Object.keys(operation.success.byStatus).length > 0,
      `${label} must declare status-specific success responses`
    )
    for (const [status, success] of Object.entries(operation.success.byStatus)) {
      nonEmpty(success.description, `${label} ${status} success description`)
    }
  } else {
    nonEmpty(operation.success.description, `${label} success description`)
  }
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

  const successResponses =
    'byStatus' in operation.success
      ? Object.values(operation.success.byStatus)
      : [operation.success]
  for (const success of successResponses) {
    for (const header of success.headers ?? []) {
      invariant(definition.headers[header], `${label} references unknown success header ${header}`)
    }
  }
  validateSecurity(operation.security ?? definition.security, definition, label, true)
}

function validateSecurity(
  requirements: readonly Readonly<Record<string, readonly string[]>>[],
  definition: OpenApiDocumentDefinition,
  label: string,
  allowAnonymous = false
): void {
  invariant(requirements.length > 0, `${label} must declare a security requirement`)
  for (const requirement of requirements) {
    invariant(
      allowAnonymous || Object.keys(requirement).length > 0,
      `${label} has an empty security requirement`
    )
    for (const [scheme, scopes] of Object.entries(requirement)) {
      invariant(
        definition.securitySchemes[scheme],
        `${label} references unknown security scheme ${scheme}`
      )
      invariant(
        Array.isArray(scopes) && scopes.length === 0,
        `${label} ${scheme} security requirement must use an empty scope array`
      )
    }
  }
}

/**
 * The error responses this document's operations actually reference, as `components.responses`.
 *
 * Only the referenced ones are built. An error response carries a worked example, and the
 * message in one is often the domain's rather than the surface's — a `423` reads `Workflow is
 * locked` in one document and `This table is insert-locked` in another. Emitting the whole set
 * everywhere would ship each document a body for a status it never answers, phrased by a
 * domain it does not contain.
 */
function errorComponents(
  definition: OpenApiDocumentDefinition,
  schemas: JsonObject,
  referencedErrors: ReadonlySet<string>
): JsonObject {
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
    if (!referencedErrors.has(id)) continue
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
    /**
     * Held to the same standard as every other documented example: it must parse against
     * the error schema, so a documented body cannot describe a shape the API never sends.
     */
    validateExamples(definition.errorSchema, [response.example], 'output', `${id} example`)
    responses[id] = {
      description: response.description,
      ...(referencedHeaders(response.headers)
        ? { headers: referencedHeaders(response.headers) }
        : {}),
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${generated.name}` },
          /**
           * Sits beside the `$ref` rather than on the shared schema: one schema serves every
           * status, so a schema-level example is necessarily one status's body shown under
           * all of them. A Media Type Object example overrides the schema's, which is what
           * makes each status tab show its own.
           */
          example: response.example,
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
  const referencedErrors = new Set(
    definition.routes.flatMap((route) => [...route.operation.errors])
  )
  const responses = errorComponents(definition, schemas, referencedErrors)
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
