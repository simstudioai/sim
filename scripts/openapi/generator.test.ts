import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '../../apps/sim/lib/api/contracts/types'
import {
  V2_ERROR_STATUS_BY_CODE,
  type V2ErrorCode,
} from '../../apps/sim/lib/api/contracts/v2/error-codes'
import { billingOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/billing'
import { filesAuditOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/files-audit'
import { workflowsOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/workflows'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiRouteDefinition,
} from '../../apps/sim/lib/api/openapi/types'
import {
  contractPathToOpenApi,
  generateOpenApiDocument,
  serializeOpenApiDocument,
} from './generator'

type JsonObject = Record<string, unknown>
type OpenApiDocument = Parameters<typeof generateOpenApiDocument>[0]

const generatedDocuments = new Map<OpenApiDocument, JsonObject>()

function generatedDocument(document: OpenApiDocument): JsonObject {
  const cached = generatedDocuments.get(document)
  if (cached) return cached

  const generated = generateOpenApiDocument(document)
  generatedDocuments.set(document, generated)
  return generated
}

const ERROR_SCHEMA = z
  .object({
    error: z
      .object({
        code: z.string().describe('Machine-readable error code.'),
        message: z.string().describe('Human-readable error message.'),
      })
      .describe('Canonical error details.'),
  })
  .meta({
    id: 'TestError',
    title: 'Test error',
    description: 'Canonical test error envelope.',
  })

const LOCATION_HEADER_SCHEMA = z.string().meta({
  id: 'LocationHeader',
  title: 'Location',
  description: 'Redirect target URL.',
})

function operation(
  operationId: string,
  success: OpenApiOperationMetadata['success']
): OpenApiOperationMetadata {
  return {
    operationId,
    applicationOperation: { id: operationId },
    summary: `Summary for ${operationId}`,
    description: `Description for ${operationId}.`,
    tags: ['Tests'],
    errors: ['Unauthorized', 'RateLimited'],
    success,
  }
}

/** A minimal route, for assertions about document-level output rather than the route itself. */
function simpleRoute(): OpenApiRouteDefinition {
  const response = z.object({ ok: z.boolean().describe('Whether the call succeeded.') }).meta({
    id: 'SimpleResponse',
    title: 'Simple response',
    description: 'Response body.',
  })
  return defineOpenApiRoute(
    defineRouteContract({
      method: 'GET',
      path: '/simple',
      response: { mode: 'json', schema: response },
    }),
    operation('simple', { description: 'Simple.' }),
    { response }
  )
}

function document(routes: readonly OpenApiRouteDefinition[]) {
  return defineOpenApiDocument({
    output: 'unused.json',
    info: {
      title: 'Generator test',
      description: 'Generator test document.',
      version: '1.0.0',
    },
    servers: [{ url: 'https://example.com', description: 'Test' }],
    tags: [{ name: 'Tests', description: 'Generator test operations.' }],
    security: [{ apiKey: [] }],
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Test API key.',
      },
    },
    headers: { Location: { schema: LOCATION_HEADER_SCHEMA } },
    errorSchema: ERROR_SCHEMA,
    errorResponses: {
      Unauthorized: {
        status: 401,
        description: 'Unauthorized.',
        example: { error: { code: 'UNAUTHORIZED', message: 'API key required' } },
      },
      RateLimited: {
        status: 429,
        description: 'Rate limited.',
        example: { error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded' } },
      },
      /** Declared but referenced by no operation below, so it must not be published. */
      NotFound: {
        status: 404,
        description: 'Not found.',
        example: { error: { code: 'NOT_FOUND', message: 'Not found' } },
      },
    },
    routes,
  })
}

function getOperation(spec: JsonObject, path: string, method: string): JsonObject {
  const paths = spec.paths as JsonObject
  return (paths[path] as JsonObject)[method] as JsonObject
}

describe('OpenAPI generator', () => {
  it('converts contract path parameters', () => {
    expect(contractPathToOpenApi('/api/v2/files/[fileId]/parts/[partId]')).toBe(
      '/api/v2/files/{fileId}/parts/{partId}'
    )
  })

  it('uses input schemas for requests and output schemas for responses', () => {
    const params = z
      .object({ id: z.string().describe('Resource identifier.') })
      .meta({ id: 'TransformParams', title: 'Transform params', description: 'Path parameters.' })
    const body = z
      .object({
        value: z
          .string()
          .transform((value) => value.length)
          .describe('String input.'),
      })
      .meta({ id: 'TransformRequest', title: 'Transform request', description: 'Request body.' })
    const response = z
      .object({
        value: z
          .string()
          .transform((value) => value.length)
          .pipe(z.number())
          .describe('Numeric output.'),
      })
      .meta({
        id: 'TransformResponse',
        title: 'Transform response',
        description: 'Response body.',
        deprecated: true,
      })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/items/[id]',
      params,
      body,
      response: { mode: 'json', schema: response, status: 201 },
    })
    const route = defineOpenApiRoute(
      contract,
      { ...operation('transformItem', { description: 'Transformed item.' }), deprecated: true },
      { params, body, response }
    )
    const spec = generateOpenApiDocument(document([route]))
    const schemas = (spec.components as JsonObject).schemas as JsonObject
    const requestProperties = (schemas.TransformRequest as JsonObject).properties as JsonObject
    const responseProperties = (schemas.TransformResponse as JsonObject).properties as JsonObject

    expect((requestProperties.value as JsonObject).type).toBe('string')
    expect((responseProperties.value as JsonObject).type).toBe('number')
    expect(schemas.TransformResponse).toHaveProperty('deprecated', true)
    expect(getOperation(spec, '/items/{id}', 'post')).toMatchObject({
      deprecated: true,
      responses: { '201': expect.any(Object) },
    })
  })

  it('omits feature-flagged enum values from generated schemas', () => {
    const columnType = z.enum(['string', 'ttl']).meta({ omitEnumValuesFromOpenApi: ['ttl'] })
    const body = z
      .object({ type: columnType.describe('Column data type.') })
      .meta({ id: 'HiddenEnumRequest', title: 'Hidden enum request', description: 'Request body.' })
    const response = z
      .object({ ok: z.boolean().describe('Whether the request succeeded.') })
      .meta({ id: 'HiddenEnumResponse', title: 'Hidden enum response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/hidden-enum',
      body,
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('hiddenEnum', { description: 'Response.' }),
      { body, response }
    )
    const spec = generateOpenApiDocument(document([route]))
    const schemas = (spec.components as JsonObject).schemas as JsonObject
    const requestProperties = (schemas.HiddenEnumRequest as JsonObject).properties as JsonObject
    const documentedColumnType = requestProperties.type as JsonObject

    expect(columnType.safeParse('ttl').success).toBe(true)
    expect(documentedColumnType.enum).toEqual(['string'])
    expect(documentedColumnType).not.toHaveProperty('omitEnumValuesFromOpenApi')
  })

  it('handles every route response mode and media type', () => {
    const emptyContract = defineRouteContract({
      method: 'DELETE',
      path: '/empty',
      response: { mode: 'empty', status: 204 },
    })
    const textContract = defineRouteContract({
      method: 'GET',
      path: '/text',
      response: { mode: 'text' },
    })
    const binaryContract = defineRouteContract({
      method: 'GET',
      path: '/binary',
      response: { mode: 'binary' },
    })
    const streamContract = defineRouteContract({
      method: 'GET',
      path: '/stream',
      response: { mode: 'stream' },
    })
    const redirectContract = defineRouteContract({
      method: 'GET',
      path: '/redirect',
      response: { mode: 'redirect', status: 302 },
    })
    const spec = generateOpenApiDocument(
      document([
        defineOpenApiRoute(emptyContract, operation('empty', { description: 'No content.' }), {}),
        defineOpenApiRoute(
          textContract,
          operation('text', { description: 'Text.', contentTypes: ['text/plain'] }),
          {}
        ),
        defineOpenApiRoute(
          binaryContract,
          operation('binary', {
            description: 'Binary.',
            contentTypes: ['application/pdf'],
          }),
          {}
        ),
        defineOpenApiRoute(
          streamContract,
          operation('stream', {
            description: 'Stream.',
            contentTypes: ['text/event-stream'],
          }),
          {}
        ),
        defineOpenApiRoute(
          redirectContract,
          operation('redirect', { description: 'Redirect.', headers: ['Location'] }),
          {}
        ),
      ])
    )

    const emptyResponse = (getOperation(spec, '/empty', 'delete').responses as JsonObject)[
      '204'
    ] as JsonObject
    const textResponse = (getOperation(spec, '/text', 'get').responses as JsonObject)[
      '200'
    ] as JsonObject
    const binaryResponse = (getOperation(spec, '/binary', 'get').responses as JsonObject)[
      '200'
    ] as JsonObject
    const streamResponse = (getOperation(spec, '/stream', 'get').responses as JsonObject)[
      '200'
    ] as JsonObject
    const redirectResponse = (getOperation(spec, '/redirect', 'get').responses as JsonObject)[
      '302'
    ] as JsonObject

    expect(emptyResponse.content).toBeUndefined()
    expect(textResponse.content).toHaveProperty('text/plain')
    expect(binaryResponse.content).toHaveProperty('application/pdf')
    expect(streamResponse.content).toHaveProperty('text/event-stream')
    expect(redirectResponse.content).toBeUndefined()
    expect(redirectResponse.headers).toHaveProperty('Location')
  })

  it('documents status-specific JSON schemas and additional media types', () => {
    const completed = z
      .object({ status: z.literal('completed').describe('Completed status.') })
      .meta({
        id: 'CompletedResponse',
        title: 'Completed response',
        description: 'A completed result.',
      })
    const queued = z
      .object({ status: z.literal('queued').describe('Queued status.') })
      .meta({ id: 'QueuedResponse', title: 'Queued response', description: 'A queued result.' })
    const response = z
      .union([completed, queued])
      .meta({ id: 'ResultResponse', title: 'Result response', description: 'Any result.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/execute',
      response: {
        mode: 'json',
        schema: response,
        status: [200, 202],
        statusSchemas: { 200: completed, 202: queued },
      },
    })
    const route = defineOpenApiRoute(
      contract,
      {
        ...operation('execute', {
          byStatus: {
            200: {
              description: 'Completed synchronously.',
              additionalContentTypes: ['text/event-stream'],
            },
            202: { description: 'Accepted for processing.' },
          },
        }),
        security: [{ apiKey: [] }, {}],
      },
      { response, responses: { 200: completed, 202: queued } }
    )
    const spec = generateOpenApiDocument(document([route]))
    const responses = getOperation(spec, '/execute', 'post').responses as JsonObject
    const completedContent = (responses['200'] as JsonObject).content as JsonObject
    const queuedContent = (responses['202'] as JsonObject).content as JsonObject

    expect(completedContent).toHaveProperty('application/json')
    expect(completedContent).toHaveProperty('text/event-stream')
    expect(queuedContent).toHaveProperty('application/json')
    expect(getOperation(spec, '/execute', 'post').security).toEqual([{ apiKey: [] }, {}])
  })

  it('documents a typed multipart body outside JSON parsing', () => {
    const upload = z
      .object({ file: z.file().describe('File to upload.') })
      .meta({ id: 'UploadForm', title: 'Upload form', description: 'Multipart upload form.' })
    const response = z
      .object({ id: z.string().describe('Uploaded file identifier.') })
      .meta({ id: 'UploadResponse', title: 'Upload response', description: 'Uploaded file.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/upload',
      response: { mode: 'json', schema: response, status: 201 },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('upload', { description: 'Uploaded file.' }),
      {
        requestBody: { schema: upload, contentTypes: ['multipart/form-data'] },
        response,
      }
    )
    const spec = generateOpenApiDocument(document([route]))
    const requestBody = getOperation(spec, '/upload', 'post').requestBody as JsonObject

    expect(requestBody.description).toBe('Multipart upload form.')
    expect(requestBody.content).toHaveProperty('multipart/form-data')
  })

  it('fails when status-specific metadata drifts from the contract', () => {
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'DriftResponse', title: 'Drift response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/drift',
      response: {
        mode: 'json',
        schema: response,
        status: [200, 202],
        statusSchemas: { 200: response, 202: response },
      },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('drift', {
        byStatus: { 200: { description: 'Only one documented status.' } },
      }),
      { response, responses: { 200: response, 202: response } }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'status-specific responses do not match the contract statuses'
    )
  })

  it('fails when a documented status schema drifts from the contract', () => {
    const completed = z
      .object({ status: z.literal('completed').describe('Completed status.') })
      .meta({
        id: 'ContractCompletedResponse',
        title: 'Contract completed response',
        description: 'A completed result.',
      })
    const queued = z.object({ status: z.literal('queued').describe('Queued status.') }).meta({
      id: 'ContractQueuedResponse',
      title: 'Contract queued response',
      description: 'A queued result.',
    })
    const response = z
      .union([completed, queued])
      .meta({ id: 'ContractResultResponse', title: 'Contract result', description: 'Any result.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/schema-drift',
      response: {
        mode: 'json',
        schema: response,
        status: [200, 202],
        statusSchemas: { 200: completed, 202: queued },
      },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('schemaDrift', {
        byStatus: {
          200: { description: 'Completed synchronously.' },
          202: { description: 'Accepted for processing.' },
        },
      }),
      { response, responses: { 200: queued, 202: completed } }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'documented schema for status 200 does not match the contract schema'
    )
  })

  it('rejects scopes for API key security requirements', () => {
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'SecurityResponse', title: 'Security response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'GET',
      path: '/security',
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      {
        ...operation('security', { description: 'Response.' }),
        security: [{ apiKey: ['read'] }],
      },
      { response }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'apiKey security requirement must use an empty scope array'
    )
  })

  it('rejects OAuth documentation without canonical scope policy', () => {
    expect(() =>
      generateOpenApiDocument({
        ...document([simpleRoute()]),
        security: [{ oauthBearer: [] }],
        securitySchemes: { oauthBearer: { type: 'http', scheme: 'bearer' } },
      })
    ).toThrow("must declare its canonical application's OAuth scope")
  })

  it('fails fast for missing Zod documentation metadata', () => {
    const body = z.object({ value: z.string().describe('Value.') })
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'MetadataResponse', title: 'Metadata response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/metadata',
      body,
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('metadata', { description: 'Response.' }),
      {
        body,
        response,
      }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'POST /metadata body is missing Zod metadata'
    )
  })

  it('fails fast when a Zod metadata example is invalid', () => {
    const body = z.object({ value: z.string().describe('Value.') }).meta({
      id: 'ExampleRequest',
      title: 'Example request',
      description: 'Request.',
      examples: [{ value: 1 }],
    })
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'ExampleResponse', title: 'Example response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/examples',
      body,
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('examples', { description: 'Response.' }),
      {
        body,
        response,
      }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'POST /examples body at <root> example 1 is invalid'
    )
  })

  it('validates response examples against transformed output schemas', () => {
    const response = z
      .object({
        value: z
          .string()
          .transform((value) => value.length)
          .pipe(z.number())
          .describe('Transformed numeric value.'),
      })
      .meta({
        id: 'OutputExampleResponse',
        title: 'Output example response',
        description: 'Transformed response.',
        examples: [{ value: 'not-an-output-number' }],
      })
    const contract = defineRouteContract({
      method: 'GET',
      path: '/output-example',
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('outputExample', { description: 'Response.' }),
      { response }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'GET /output-example response at <root> example 1 is invalid for the output schema'
    )
  })

  it('fails fast for an undocumented opaque schema', () => {
    const body = z
      .object({
        value: z
          .record(z.string(), z.unknown())
          .describe('User-defined values keyed by property name.'),
      })
      .meta({ id: 'OpaqueRequest', title: 'Opaque request', description: 'Request.' })
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'OpaqueResponse', title: 'Opaque response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/opaque',
      body,
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(contract, operation('opaque', { description: 'Response.' }), {
      body,
      response,
    })

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'POST /opaque body opaque schema at <root>.value.additionalProperties description is required'
    )
  })

  it('fails fast for an undocumented inline property schema', () => {
    const body = z
      .object({ value: z.string() })
      .meta({ id: 'UndocumentedRequest', title: 'Undocumented request', description: 'Request.' })
    const response = z
      .object({ ok: z.boolean().describe('Success state.') })
      .meta({ id: 'DocumentedResponse', title: 'Documented response', description: 'Response.' })
    const contract = defineRouteContract({
      method: 'POST',
      path: '/undocumented-property',
      body,
      response: { mode: 'json', schema: response },
    })
    const route = defineOpenApiRoute(
      contract,
      operation('undocumentedProperty', { description: 'Response.' }),
      { body, response }
    )

    expect(() => generateOpenApiDocument(document([route]))).toThrow(
      'POST /undocumented-property body property at <root>.value description is required'
    )
  })

  it('serializes deterministically', () => {
    expect(serializeOpenApiDocument(filesAuditOpenApiDocument)).toBe(
      serializeOpenApiDocument(filesAuditOpenApiDocument)
    )
  })

  it('documents nullable file share metadata from the response schema', () => {
    const spec = generatedDocument(filesAuditOpenApiDocument)
    const schemas = (spec.components as JsonObject).schemas as JsonObject
    const metadata = schemas.V2FileMetadata as JsonObject
    const properties = metadata.properties as JsonObject
    const share = properties.share as JsonObject

    expect(share.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]))
  })

  it('documents v2 billing storage coverage from the response schema', () => {
    const spec = generatedDocument(billingOpenApiDocument)
    const paths = spec.paths as JsonObject
    const schemas = (spec.components as JsonObject).schemas as JsonObject
    const response = schemas.V2BillingStatusResponse as JsonObject
    const responseProperties = response.properties as JsonObject
    const data = responseProperties.data as JsonObject
    const billingStatus = schemas.V2BillingStatus as JsonObject
    const dataProperties = billingStatus.properties as JsonObject
    const storage = dataProperties.storage as JsonObject
    const credits = dataProperties.credits as JsonObject

    expect(Object.keys(paths).sort()).toEqual(['/api/v2/billing/logs', '/api/v2/billing/status'])
    expect(data.$ref).toBe('#/components/schemas/V2BillingStatus')
    expect(storage.anyOf).toEqual([
      expect.objectContaining({
        required: ['usedBytes', 'limitBytes', 'percentUsed'],
        properties: {
          usedBytes: expect.objectContaining({ type: 'number', minimum: 0 }),
          limitBytes: expect.objectContaining({ type: 'number', minimum: 0 }),
          percentUsed: expect.objectContaining({ type: 'number', minimum: 0 }),
        },
      }),
      { type: 'null' },
    ])
    expect(credits.anyOf).toEqual([
      expect.objectContaining({ required: ['used', 'limit', 'remaining'] }),
      { type: 'null' },
    ])
  })

  /**
   * `recursive` is declared with `z.stringbool()`, which accepts only strings
   * (including `yes`/`no`/`on`/`off`), so `type: 'string'` is what the wire
   * genuinely takes. It is the last v2 boolean query param not on
   * `booleanQueryFlagSchema`; moving it would *narrow* the accepted set, which
   * is why it stays and is pinned here instead.
   */
  it('uses string wire values for a stringbool query param', () => {
    const spec = generatedDocument(filesAuditOpenApiDocument)
    const deleteFolder = getOperation(spec, '/api/v2/files/folders', 'delete')
    const deleteFolderParameters = deleteFolder.parameters as JsonObject[]
    const recursive = deleteFolderParameters.find((parameter) => parameter.name === 'recursive')

    expect(recursive?.schema).toMatchObject({ type: 'string', default: 'false' })
  })

  /**
   * Every other v2 boolean query param documents a real boolean.
   * `includeDeparted` and `includeOutput` used to be `'true'`/`'false'` string
   * enums inherited from the internal shapes they reused, so the spec told
   * callers to send a string for what four sibling params took as a boolean.
   */
  it('documents boolean query flags as booleans', () => {
    const auditSpec = generatedDocument(filesAuditOpenApiDocument)
    const listAuditLogParameters = getOperation(auditSpec, '/api/v2/audit-logs', 'get')
      .parameters as JsonObject[]
    const includeDeparted = listAuditLogParameters.find(
      (parameter) => parameter.name === 'includeDeparted'
    )

    const workflowSpec = generatedDocument(workflowsOpenApiDocument)
    const getRunParameters = getOperation(
      workflowSpec,
      '/api/v2/workflows/{workflowId}/runs/{runId}',
      'get'
    ).parameters as JsonObject[]
    const includeOutput = getRunParameters.find((parameter) => parameter.name === 'includeOutput')

    expect(includeDeparted?.schema).toMatchObject({ type: 'boolean' })
    expect(includeOutput?.schema).toMatchObject({ type: 'boolean' })
  })

  it('documents binary download response headers', () => {
    const spec = generatedDocument(filesAuditOpenApiDocument)
    const operation = getOperation(spec, '/api/v2/files/{fileId}', 'get')
    const response = (operation.responses as JsonObject)['200'] as JsonObject

    expect(response.headers).toMatchObject({
      'Content-Type': { $ref: '#/components/headers/Content-Type' },
      'Content-Disposition': { $ref: '#/components/headers/Content-Disposition' },
      'Content-Length': { $ref: '#/components/headers/Content-Length' },
    })
  })

  it('gives each error response its own example beside the shared schema ref', () => {
    const spec = generateOpenApiDocument(document([simpleRoute()]))
    const responses = (spec.components as JsonObject).responses as JsonObject
    const contentFor = (id: string) =>
      ((responses[id] as JsonObject).content as JsonObject)['application/json'] as JsonObject

    expect(contentFor('Unauthorized').schema).toEqual({ $ref: '#/components/schemas/TestError' })
    expect(contentFor('RateLimited').schema).toEqual({ $ref: '#/components/schemas/TestError' })
    expect(contentFor('Unauthorized').example).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'API key required' },
    })
    expect(contentFor('RateLimited').example).toEqual({
      error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded' },
    })
  })

  it('rejects an error example that does not fit the error schema', () => {
    expect(() =>
      generateOpenApiDocument({
        ...document([simpleRoute()]),
        errorResponses: {
          Unauthorized: {
            status: 401,
            description: 'Unauthorized.',
            example: { error: { code: 'UNAUTHORIZED' } },
          },
          RateLimited: {
            status: 429,
            description: 'Rate limited.',
            example: { error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded' } },
          },
        },
      })
    ).toThrow(/Unauthorized example/)
  })

  it('publishes only the error responses its operations reference', () => {
    const spec = generateOpenApiDocument(document([simpleRoute()]))
    const responses = (spec.components as JsonObject).responses as JsonObject

    /** `NotFound` is defined on the document but no operation declares it. */
    expect(Object.keys(responses).sort()).toEqual(['RateLimited', 'Unauthorized'])
  })

  it('publishes a distinct example under every documented error status', () => {
    const spec = generatedDocument(workflowsOpenApiDocument)
    const responses = (spec.components as JsonObject).responses as JsonObject
    const byStatus = new Map<number, Set<string>>()

    for (const response of Object.values(responses) as JsonObject[]) {
      const content = (response.content as JsonObject)['application/json'] as JsonObject
      const example = content.example as { error: { code: string } }
      const status = V2_ERROR_STATUS_BY_CODE[example.error.code as V2ErrorCode]
      expect(status, `${example.error.code} is not a v2 error code`).toBeDefined()
      const codes = byStatus.get(status) ?? new Set<string>()
      codes.add(example.error.code)
      byStatus.set(status, codes)
    }

    /** Every status documents exactly one code — the property the derivation relies on. */
    for (const [status, codes] of byStatus) {
      expect([...codes], `status ${status}`).toHaveLength(1)
    }
  })
})
