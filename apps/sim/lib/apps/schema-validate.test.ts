import { describe, expect, it } from 'vitest'
import { validateAppActionInput } from '@/lib/apps/schema-validate'

describe('validateAppActionInput', () => {
  it('does not fail closed on schemaHash mismatch (jsonb / legacy hashes)', () => {
    const inputSchema = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    }
    const result = validateAppActionInput({
      schemaHash: 'not-the-real-hash',
      inputSchema,
      input: {},
      action: {
        actionId: 'main',
        workflowId: 'wf',
        deploymentVersionId: 'dv',
        inputSchema,
        outputAllowlist: [],
        executionPolicy: 'sync',
      },
    })
    expect(result).toEqual({ ok: true })
  })

  it('still rejects invalid input against the schema', () => {
    const inputSchema = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
      additionalProperties: false,
    }
    const result = validateAppActionInput({
      schemaHash: 'any',
      inputSchema,
      input: {},
    })
    expect(result.ok).toBe(false)
  })
})
