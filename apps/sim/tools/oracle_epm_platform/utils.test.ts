/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import * as toolExports from '@/tools/oracle_epm_platform'
import {
  oracleEpmPlatformCreateUsersTool,
  oracleEpmPlatformImportSnapshotTool,
  oracleEpmPlatformUpdateUsersTool,
} from '@/tools/oracle_epm_platform'
import { createLLMToolSchema, createUserToolSchema } from '@/tools/params'
import type { InternalToolConfig } from '@/tools/types'

const tools = Object.values(toolExports) as InternalToolConfig[]
describe('Oracle EPM Platform public parameter and output contracts', () => {
  it.each(tools.map((tool) => [tool.id, tool] as const))(
    '%s keeps credentials and destinations out of model control',
    async (_id, tool) => {
      const { schema, modelBlockedParams } = await createLLMToolSchema(tool, {})
      for (const key of ['oauthCredential', 'accessToken', 'instanceUrl']) {
        expect(schema.properties).not.toHaveProperty(key)
        expect(modelBlockedParams).toContain(key)
      }
      expect(createUserToolSchema(tool).properties).toHaveProperty('oauthCredential')
      expect(createUserToolSchema(tool).properties).not.toHaveProperty('accessToken')
      expect(createUserToolSchema(tool).properties).not.toHaveProperty('instanceUrl')
    }
  )

  it('keeps the entire password-bearing Create Users array user-controlled', async () => {
    const { schema, modelBlockedParams } = await createLLMToolSchema(
      oracleEpmPlatformCreateUsersTool,
      {}
    )
    expect(schema.properties).not.toHaveProperty('users')
    expect(modelBlockedParams).toContain('users')
    expect(createUserToolSchema(oracleEpmPlatformCreateUsersTool).properties.users).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { password: { type: 'string' } },
      },
    })
  })

  it('keeps snapshot-import passwords user-only without hiding non-secret import options', async () => {
    const { schema, modelBlockedParams } = await createLLMToolSchema(
      oracleEpmPlatformImportSnapshotTool,
      {}
    )
    expect(schema.properties).not.toHaveProperty('userPassword')
    expect(modelBlockedParams).toContain('userPassword')
    expect(schema.properties).toHaveProperty('importUsers')
  })

  it('exposes typed update records to the model without a password mutation field', async () => {
    const { schema } = await createLLMToolSchema(oracleEpmPlatformUpdateUsersTool, {})
    expect(schema.properties.users).toMatchObject({
      type: 'array',
      items: { type: 'object', additionalProperties: false },
    })
    const items = schema.properties.users.items as { properties: Record<string, unknown> }
    expect(items.properties).not.toHaveProperty('password')
  })

  it('preserves documented nullable counts and explicit partial-failure outputs', () => {
    const output = oracleEpmPlatformCreateUsersTool.outputs
    expect(output?.processed).toMatchObject({ type: 'number', nullable: true })
    expect(output?.partialFailure).toMatchObject({ type: 'boolean' })
    expect(output?.failedItems).toMatchObject({ type: 'array', items: { type: 'object' } })
    expect(JSON.stringify(output)).not.toContain('"password":')
  })
})
