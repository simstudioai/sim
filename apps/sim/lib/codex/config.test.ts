import { describe, expect, it } from 'vitest'
import {
  compactCodexWorkflowConfig,
  parseCodexConfigPatch,
  parseCodexWorkflowConfig,
  remapCodexWorkflowAgentIds,
  resolveCodexConfig,
} from '@/lib/codex/config'

describe('Codex layered configuration', () => {
  it('strategically merges sparse layers in workspace-to-step order', () => {
    const result = resolveCodexConfig({
      workspace: {
        owner: 'simstudioai',
        repo: 'sim',
        model: 'gpt-5.5',
        reasoningEffort: 'low',
        networkAccess: true,
      },
      workflow: { model: 'gpt-5.2', baseBranch: 'develop' },
      legacyStep: { mode: 'cloud_plan' },
      agent: { mode: 'cloud', networkAccess: false },
      step: { reasoningEffort: 'xhigh' },
    })

    expect(result.config).toEqual({
      mode: 'cloud',
      model: 'gpt-5.2',
      owner: 'simstudioai',
      repo: 'sim',
      baseBranch: 'develop',
      reasoningEffort: 'xhigh',
      networkAccess: false,
    })
    expect(result.provenance).toMatchObject({
      owner: 'workspace',
      repo: 'workspace',
      model: 'workflow',
      baseBranch: 'workflow',
      mode: 'agent',
      reasoningEffort: 'step',
      networkAccess: 'agent',
    })
  })

  it('distinguishes an omitted key, false, and an explicit base-branch clear', () => {
    const result = resolveCodexConfig({
      workspace: { baseBranch: 'main', networkAccess: true },
      workflow: { baseBranch: null, networkAccess: false },
    })

    expect(result.config.baseBranch).toBeUndefined()
    expect(result.config.networkAccess).toBe(false)
    expect(result.provenance.baseBranch).toBe('workflow')
    expect(result.provenance.networkAccess).toBe('workflow')
  })

  it('parses and normalizes trusted patch fields while ignoring unknown keys', () => {
    expect(
      parseCodexConfigPatch({
        mode: 'cloud_plan',
        owner: '  simstudioai ',
        repo: ' sim ',
        baseBranch: null,
        networkAccess: false,
        futureField: 'ignored',
      })
    ).toEqual({
      mode: 'cloud_plan',
      owner: 'simstudioai',
      repo: 'sim',
      baseBranch: null,
      networkAccess: false,
    })
  })

  it('rejects malformed known values instead of silently inheriting', () => {
    expect(() => parseCodexConfigPatch({ model: 'gpt-future' })).toThrow('Unsupported Codex model')
    expect(() => parseCodexConfigPatch({ networkAccess: 'false' })).toThrow(
      'networkAccess must be a boolean'
    )
    expect(() => parseCodexWorkflowConfig({ version: 2, defaults: {}, agents: {} })).toThrow(
      'Unsupported Codex configuration version'
    )
    expect(() =>
      parseCodexWorkflowConfig({ version: 1, defaults: {}, agents: { 'bad agent': {} } })
    ).toThrow('Invalid Codex Agent ID')
  })

  it('upgrades an absent workflow document and compacts empty agent layers', () => {
    expect(parseCodexWorkflowConfig(undefined)).toEqual({ version: 1, defaults: {}, agents: {} })
    expect(
      compactCodexWorkflowConfig({
        version: 1,
        defaults: { reasoningEffort: 'high' },
        agents: { empty: {}, reviewer: { model: 'gpt-5.5' } },
      })
    ).toEqual({
      version: 1,
      defaults: { reasoningEffort: 'high' },
      agents: { reviewer: { model: 'gpt-5.5' } },
    })
  })

  it('remaps block-owned Agent layers while preserving explicit logical IDs', () => {
    expect(
      remapCodexWorkflowAgentIds(
        {
          version: 1,
          defaults: {},
          agents: {
            'old-block': { mode: 'cloud' },
            reviewer: { reasoningEffort: 'high' },
          },
        },
        new Map([['old-block', 'new-block']])
      )
    ).toEqual({
      version: 1,
      defaults: {},
      agents: {
        'new-block': { mode: 'cloud' },
        reviewer: { reasoningEffort: 'high' },
      },
    })
  })
})
