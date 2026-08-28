import { describe, expect, it } from 'vitest'
import { codexConfigPatchSchema, codexWorkflowConfigSchema } from '@/lib/api/contracts/codex-config'

describe('Codex configuration contracts', () => {
  it('preserves sparse false and null overrides', () => {
    expect(codexConfigPatchSchema.parse({ networkAccess: false, baseBranch: null })).toEqual({
      networkAccess: false,
      baseBranch: null,
    })
  })

  it('rejects unknown, blank, and unsupported values', () => {
    expect(codexConfigPatchSchema.safeParse({ future: true }).success).toBe(false)
    expect(codexConfigPatchSchema.safeParse({ owner: '' }).success).toBe(false)
    expect(codexConfigPatchSchema.safeParse({ model: 'gpt-future' }).success).toBe(false)
  })

  it('bounds logical Agent IDs and the number of Agent layers', () => {
    expect(
      codexWorkflowConfigSchema.safeParse({
        version: 1,
        defaults: {},
        agents: { 'bad agent': {} },
      }).success
    ).toBe(false)

    expect(
      codexWorkflowConfigSchema.safeParse({
        version: 1,
        defaults: {},
        agents: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [`agent-${index}`, {}])
        ),
      }).success
    ).toBe(false)
  })
})
