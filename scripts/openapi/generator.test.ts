import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '../../apps/sim/lib/api/contracts/types'
import { filesAuditOpenApiDocument } from '../../apps/sim/lib/api/contracts/v2/openapi/files-audit'
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

const ERROR_SCHEMA = z
  .object({
    error: z.object({
      code: z.string().describe('Machine-readable error code.'),
      message: z.string().describe('Human-readable error message.'),
    }),
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
    summary: `Summary for ${operationId}`,
    description: `Description for ${operationId}.`,
    tags: ['Tests'],
    errors: ['Unauthorized', 'RateLimited'],
    success,
  }
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
      Unauthorized: { status: 401, description: 'Unauthorized.' },
      RateLimited: { status: 429, description: 'Rate limited.' },
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

  it('fails fast for an undocumented opaque schema', () => {
    const body = z
      .object({ value: z.unknown() })
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
      'POST /opaque body opaque schema at <root>.value description is required'
    )
  })

  it('serializes deterministically', () => {
    expect(serializeOpenApiDocument(filesAuditOpenApiDocument)).toBe(
      serializeOpenApiDocument(filesAuditOpenApiDocument)
    )
  })

  it('documents nullable file share metadata from the response schema', () => {
    const spec = generateOpenApiDocument(filesAuditOpenApiDocument)
    const schemas = (spec.components as JsonObject).schemas as JsonObject
    const metadata = schemas.V2FileMetadata as JsonObject
    const properties = metadata.properties as JsonObject
    const share = properties.share as JsonObject

    expect(share.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]))
  })

  it('uses string wire values for transformed boolean defaults', () => {
    const spec = generateOpenApiDocument(filesAuditOpenApiDocument)
    const deleteFolder = getOperation(spec, '/api/v2/files/folders', 'delete')
    const deleteFolderParameters = deleteFolder.parameters as JsonObject[]
    const recursive = deleteFolderParameters.find((parameter) => parameter.name === 'recursive')
    const listAuditLogs = getOperation(spec, '/api/v2/audit-logs', 'get')
    const listAuditLogParameters = listAuditLogs.parameters as JsonObject[]
    const includeDeparted = listAuditLogParameters.find(
      (parameter) => parameter.name === 'includeDeparted'
    )

    expect(recursive?.schema).toMatchObject({ type: 'string', default: 'false' })
    expect(includeDeparted?.schema).toMatchObject({ type: 'string', default: 'false' })
  })

  it('documents binary download response headers', () => {
    const spec = generateOpenApiDocument(filesAuditOpenApiDocument)
    const operation = getOperation(spec, '/api/v2/files/{fileId}', 'get')
    const response = (operation.responses as JsonObject)['200'] as JsonObject

    expect(response.headers).toMatchObject({
      'Content-Type': { $ref: '#/components/headers/Content-Type' },
      'Content-Disposition': { $ref: '#/components/headers/Content-Disposition' },
      'Content-Length': { $ref: '#/components/headers/Content-Length' },
    })
  })
})
