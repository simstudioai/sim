import { describe, expect, it } from 'vitest'
import { InfisicalBlock } from '@/blocks/blocks/infisical'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { createSecretTool } from '@/tools/infisical/create_secret'
import { deleteSecretTool } from '@/tools/infisical/delete_secret'
import { getSecretTool } from '@/tools/infisical/get_secret'
import { listSecretsTool } from '@/tools/infisical/list_secrets'
import { updateSecretTool } from '@/tools/infisical/update_secret'
import type { ToolConfig } from '@/tools/types'

const TOOLS: Array<{ operation: string; tool: ToolConfig }> = [
  { operation: 'list_secrets', tool: listSecretsTool },
  { operation: 'get_secret', tool: getSecretTool },
  { operation: 'create_secret', tool: createSecretTool },
  { operation: 'update_secret', tool: updateSecretTool },
  { operation: 'delete_secret', tool: deleteSecretTool },
]

const SECRET_PARAMS = {
  apiKey: 'inline-token',
  projectId: 'project-1',
  environment: 'dev',
  secretName: 'DB_URL',
  secretValue: 'value',
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

describe('Infisical request host', () => {
  it.each(TOOLS)(
    '$operation never sends the inline token to an instance URL the model picked',
    async ({ operation, tool }) => {
      const providerTool = await transformBlockTool(
        {
          type: 'infisical',
          params: {
            operation,
            apiKey: 'inline-token',
            projectId: 'project-1',
            environment: 'dev',
          },
        },
        { selectedOperation: operation, getAllBlocks: () => [InfisicalBlock], getTool: () => tool }
      )
      if (!providerTool) throw new Error('Infisical agent tool was not created')

      expect(providerTool.parameters.properties).not.toHaveProperty('baseUrl')
      const { executionParams } = prepareToolExecution(
        providerTool,
        { baseUrl: 'https://attacker.example', secretName: 'DB_URL', secretValue: 'value' },
        {},
        undefined
      )

      expect(new URL(requestUrl(tool, executionParams)).origin).toBe('https://us.infisical.com')
    }
  )

  it.each([
    ['', 'https://us.infisical.com'],
    ['   ', 'https://us.infisical.com'],
    ['https://eu.infisical.com/', 'https://eu.infisical.com'],
    ['eu.infisical.com', 'https://eu.infisical.com'],
    [' https://infisical.example.com/infisical/ ', 'https://infisical.example.com/infisical'],
    ['http://infisical.internal.example:8080', 'http://infisical.internal.example:8080'],
  ])('builds on the instance URL %j the way a saved credential stores it', (baseUrl, base) => {
    for (const { tool } of TOOLS) {
      expect(requestUrl(tool, { ...SECRET_PARAMS, baseUrl })).toMatch(
        new RegExp(`^${base.replace(/[.:/]/g, '\\$&')}/api/v[34]/secrets`)
      )
    }
  })

  it.each([
    'https://attacker.example@us.infisical.com',
    'https://us.infisical.com?redirect=https://attacker.example',
    'https://us.infisical.com#fragment',
    'https:/attacker.example',
    'ftp://us.infisical.com',
  ])('refuses the instance URL %j instead of retargeting the request', (baseUrl) => {
    for (const { tool } of TOOLS) {
      expect(() => requestUrl(tool, { ...SECRET_PARAMS, baseUrl })).toThrow(
        /Infisical instance URL/
      )
    }
  })
})

const WRITE_TOOLS = TOOLS.filter(({ operation }) =>
  ['create_secret', 'update_secret', 'delete_secret'].includes(operation)
)

describe('Infisical secret writes under an approval policy', () => {
  it.each(WRITE_TOOLS)(
    '$operation reports the pending change request instead of passing it off as the secret',
    async ({ tool }) => {
      const approval = {
        id: '6f0a1c43-5d0e-4a8a-9d6b-3f0d6c1f2b11',
        policyId: '0a7d1c22-6b9f-4d3e-8f0a-2c4b5e6d7f80',
        hasMerged: false,
        status: 'open',
        slug: 'quick-fox-jumps',
        folderId: '9b8c7d6e-5f4a-3b2c-1d0e-f9a8b7c6d5e4',
        createdAt: '2026-11-18T10:00:00.000Z',
        updatedAt: '2026-11-18T10:00:00.000Z',
      }
      const result = await tool.transformResponse?.(
        new Response(JSON.stringify({ approval }), { status: 200 })
      )

      expect(result?.success).toBe(true)
      expect(result?.output.secret.id).toBeNull()
      expect(result?.output.secret.createdAt).toBeNull()
      expect(result?.output.approval).toMatchObject({ id: approval.id, status: 'open' })
    }
  )
})

describe('Infisical secret name path segment', () => {
  it.each(TOOLS.filter(({ operation }) => operation !== 'list_secrets'))(
    '$operation refuses a dot-segment secret name that would retarget the request',
    ({ tool }) => {
      expect(() => requestUrl(tool, { ...SECRET_PARAMS, secretName: '..' })).toThrow(/secretName/)
    }
  )
})
