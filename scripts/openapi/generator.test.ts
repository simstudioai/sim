import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '../../apps/sim/lib/api/contracts/types'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiRouteDefinition,
} from '../../apps/sim/lib/api/openapi/types'
import { generateOpenApiDocument } from './generator'

type JsonObject = Record<string, unknown>
type OpenApiDocument = Parameters<typeof generateOpenApiDocument>[0]

const generatedDocuments = new Map<OpenApiDocument, JsonObject>()

function _generatedDocument(document: OpenApiDocument): JsonObject {
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
})
