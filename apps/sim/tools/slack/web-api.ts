import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { OAuthConfig, ToolConfig, ToolOutputProperty, ToolResponse } from '@/tools/types'

export interface SlackWebApiResponse<Output extends Record<string, unknown>> extends ToolResponse {
  output: Output
}

interface SlackWebApiDefinition<
  Input extends z.ZodType<Record<string, unknown>>,
  Output extends z.ZodType<Record<string, unknown>>,
> {
  id: string
  name: string
  description: string
  method: 'GET' | 'POST'
  endpoint: string
  oauth: OAuthConfig
  params: ToolConfig['params']
  input: Input
  output: Output
  outputs: Record<string, ToolOutputProperty>
}

/** Validates provider inputs once per request and projects documented response fields. */
export function createSlackWebApiTool<
  Input extends z.ZodType<Record<string, unknown>>,
  Output extends z.ZodType<Record<string, unknown>>,
>(
  definition: SlackWebApiDefinition<Input, Output>
): ToolConfig<z.input<Input> & { accessToken: string }, SlackWebApiResponse<z.output<Output>>> {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: '1.0.0',
    oauth: definition.oauth,
    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Resolved Slack credential token',
      },
      ...definition.params,
    },
    request: {
      url:
        definition.method === 'GET'
          ? (params) => {
              const url = new URL(`https://slack.com/api/${definition.endpoint}`)
              for (const [key, value] of Object.entries(definition.input.parse(params))) {
                if (value !== undefined) {
                  url.searchParams.set(
                    key,
                    typeof value === 'object' ? JSON.stringify(value) : String(value)
                  )
                }
              }
              return url.toString()
            }
          : `https://slack.com/api/${definition.endpoint}`,
      method: definition.method,
      headers: (params) => ({
        Authorization: `Bearer ${z.string().trim().min(1, 'Select a Slack credential').parse(params.accessToken)}`,
        'Content-Type': 'application/json; charset=utf-8',
      }),
      ...(definition.method === 'POST'
        ? {
            body: (params: z.input<Input> & { accessToken: string }) =>
              definition.input.parse(params),
          }
        : {}),
    },
    transformResponse: async (response) => ({
      success: true,
      output: definition.output.parse(await readSlackResponse(response)),
    }),
    outputs: definition.outputs,
  }
}

export const slackId = z.string().trim().min(1, 'A Slack resource ID is required')

/** JSON fields accept either parsed workflow data or the JSON editor's serialized value. */
export function slackJson<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      throw new Error('Invalid JSON in Slack request')
    }
  }, schema)
}
