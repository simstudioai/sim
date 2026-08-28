/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { CodexBlock } from '@/blocks/blocks/codex'
import { CODEX_MODELS } from '@/providers/codex'

describe('CodexBlock', () => {
  it('uses a compact canvas title beside the agent badge', () => {
    expect(CodexBlock.canvasPresentation?.defaultTitle).toBe('Codex')
  })

  it('exposes only the Plan and Create PR MVP modes', () => {
    const mode = CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'mode')
    const options = typeof mode?.options === 'function' ? mode.options() : mode?.options

    expect(mode?.hidden).toBe(true)
    expect(mode?.value).toBeUndefined()
    expect(options?.map((option) => option.id)).toEqual(['cloud_plan', 'cloud'])
  })

  it('keeps every subblock id unique and uses the pinned model catalog', () => {
    const ids = CodexBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)

    const model = CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'model')
    const options = typeof model?.options === 'function' ? model.options() : model?.options
    expect(model?.hidden).toBe(true)
    expect(model?.defaultValue).toBeUndefined()
    expect(options?.map((option) => option.id)).toEqual(CODEX_MODELS)

    expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'agentId')).toMatchObject({
      title: 'Agent',
      type: 'agent-session-selector',
      agentSessionFields: ['mode', 'model', 'owner', 'repo', 'baseBranch', 'agentConfig'],
      hideFromPreview: true,
    })
    expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'agentId')?.required).not.toBe(
      true
    )
  })

  it('moves stable Agent fields out of the step sidebar', () => {
    for (const id of [
      'mode',
      'model',
      'owner',
      'repo',
      'baseBranch',
      'networkAccess',
      'agentConfig',
    ]) {
      expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === id)?.hidden).toBe(true)
    }

    const reasoning = CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'reasoningEffort')
    expect(reasoning).toMatchObject({
      title: 'Reasoning Effort (Step Override)',
      emptyIsValid: true,
    })
    const options =
      typeof reasoning?.options === 'function' ? reasoning.options() : reasoning?.options
    expect(options?.[0]).toEqual({ label: 'Inherit layered default', id: '' })
  })

  it('keeps step-specific PR fields available regardless of the inherited Agent mode', () => {
    for (const id of ['branchName', 'draft', 'prTitle', 'prBody']) {
      expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === id)?.condition).toBeUndefined()
    }
    for (const id of ['changedFiles', 'diff', 'prUrl', 'branch']) {
      expect(CodexBlock.outputs[id]?.condition).toBeUndefined()
    }
  })

  it('marks both credentials as user-only password fields', () => {
    for (const id of ['apiKey', 'githubToken']) {
      expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === id)).toMatchObject({
        password: true,
        paramVisibility: 'user-only',
      })
    }
  })

  it('allows a stored OpenAI BYOK key while still requiring the GitHub token', () => {
    expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'apiKey')?.required).not.toBe(
      true
    )
    expect(CodexBlock.subBlocks.find((subBlock) => subBlock.id === 'githubToken')?.required).toBe(
      true
    )
  })

  it('exposes native session identity and reuse metadata', () => {
    expect(CodexBlock.outputs).toMatchObject({
      agentId: { type: 'string' },
      threadId: { type: 'string' },
      sessionReused: { type: 'boolean' },
      turnNumber: { type: 'number' },
    })
  })
})
