import type {
  DynatraceCreateSettingsObjectParams,
  DynatraceCreateSettingsObjectResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapSettingsWriteResult,
  parseJsonParam,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const createSettingsObjectTool: ToolConfig<
  DynatraceCreateSettingsObjectParams,
  DynatraceCreateSettingsObjectResponse
> = {
  id: 'dynatrace_create_settings_object',
  name: 'Dynatrace Create Settings Object',
  description:
    'Create a settings object — a maintenance window, alerting profile, management zone, or any other schema-backed configuration.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the settings.write scope',
    },
    schemaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Schema of the object to create, e.g. builtin:alerting.maintenance-window. List Settings Schemas returns the available IDs',
    },
    scope: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Scope the object applies to, e.g. environment or an entity ID such as HOST-06F288EE2A930951',
    },
    value: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The configuration itself. Its shape is defined by the schema — read an existing object of the same schema to see the expected fields',
    },
    schemaVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema version to validate against. Defaults to the latest',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External ID to correlate the object with a system outside Dynatrace',
    },
    validateOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate the payload without creating anything',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, '/settings/objects', {
        validateOnly: params.validateOnly,
      }),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    // The endpoint takes an array; this tool creates exactly one object.
    body: (params) => {
      const value = parseJsonParam(params.value)
      if (value === undefined) throw new Error('value is required')
      const entry: Record<string, unknown> = {
        schemaId: params.schemaId,
        scope: params.scope,
        value,
      }
      if (params.schemaVersion) entry.schemaVersion = params.schemaVersion
      if (params.externalId) entry.externalId = params.externalId
      return JSON.stringify([entry])
    },
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()
    const parsed = text.trim() ? JSON.parse(text) : []
    const entries = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
    const results = entries.map(mapSettingsWriteResult)

    // A rejected object comes back as 207 with a per-object 4xx, so the HTTP
    // status alone would report a failed create as a success.
    const failure = results.find((result) => result.code !== null && result.code >= 400)
    if (failure) {
      const message = (failure.writeError?.message as string) ?? `HTTP ${failure.code}`
      throw new Error(`Dynatrace rejected the settings object: ${message}`)
    }

    return {
      success: true,
      output: {
        results,
        objectId: results[0]?.objectId ?? null,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'One result per submitted object',
      items: {
        type: 'object',
        properties: {
          code: { type: 'number', description: 'Per-object HTTP status', nullable: true },
          objectId: { type: 'string', description: 'ID of the created object', nullable: true },
          writeError: {
            type: 'json',
            description: 'Validation error for this object, when it failed',
            nullable: true,
            properties: {
              code: { type: 'number', description: 'Error code' },
              message: { type: 'string', description: 'Error message' },
              constraintViolations: {
                type: 'array',
                description: 'Which part of the value failed validation',
                items: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'Where the violation was found' },
                    message: { type: 'string', description: 'What is wrong' },
                    parameterLocation: {
                      type: 'string',
                      description: 'HEADER, PATH, PAYLOAD_BODY, or QUERY',
                    },
                    path: { type: 'string', description: 'Path to the offending field' },
                  },
                },
              },
            },
          },
          invalidValue: {
            type: 'json',
            description:
              'The value that was rejected. Mirrors the submitted schema-defined value, so the shape is dynamic',
            optional: true,
          },
        },
      },
    },
    objectId: {
      type: 'string',
      description: 'ID of the created object, lifted from the first result',
      nullable: true,
    },
  },
}
