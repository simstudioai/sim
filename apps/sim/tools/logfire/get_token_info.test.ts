/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { logfireGetTokenInfoTool } from '@/tools/logfire/get_token_info'

const baseParams = { apiKey: 'test-read-token' }

describe('logfireGetTokenInfoTool request', () => {
  it('targets the read-token-info endpoint with a GET', () => {
    expect(logfireGetTokenInfoTool.request.url(baseParams)).toBe(
      'https://logfire-us.pydantic.dev/v1/read-token-info'
    )
    expect(logfireGetTokenInfoTool.request.method).toBe('GET')
  })

  it('honours a self-hosted host', () => {
    expect(
      logfireGetTokenInfoTool.request.url({ ...baseParams, host: 'https://logfire.example.com' })
    ).toBe('https://logfire.example.com/v1/read-token-info')
  })
})

describe('logfireGetTokenInfoTool transformResponse', () => {
  it('maps the snake_case token info into the block outputs', async () => {
    const response = new Response(
      JSON.stringify({ organization_name: 'acme', project_name: 'backend' }),
      { status: 200 }
    )

    const result = await logfireGetTokenInfoTool.transformResponse?.(response, baseParams)

    expect(result?.success).toBe(true)
    expect(result?.output).toEqual({ organizationName: 'acme', projectName: 'backend' })
  })

  it('nulls fields the API omitted', async () => {
    const response = new Response(JSON.stringify({}), { status: 200 })
    const result = await logfireGetTokenInfoTool.transformResponse?.(response, baseParams)

    expect(result?.output).toEqual({ organizationName: null, projectName: null })
  })
})
