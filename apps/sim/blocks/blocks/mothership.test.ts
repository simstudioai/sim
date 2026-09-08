import { describe, expect, it } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import { MothershipBlock } from '@/blocks/blocks/mothership'

describe('MothershipBlock', () => {
  it('exposes the closed model and effort catalog with an Astra-only Fast switch', () => {
    expect(MothershipBlock.subBlocks.find((input) => input.id === 'model')?.options).toEqual([
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'claude-opus-5', label: 'Opus 5' },
    ])
    expect(MothershipBlock.subBlocks.find((input) => input.id === 'effort')?.options).toHaveLength(
      5
    )
    expect(MothershipBlock.subBlocks.find((input) => input.id === 'fastMode')).toMatchObject({
      type: 'switch',
      defaultValue: false,
      condition: { field: 'model', value: 'gpt-6-astra' },
    })
    expect(MothershipBlock.subBlocks.some((input) => /thinking|stream.*tool/i.test(input.id))).toBe(
      false
    )
  })

  it.each(['tools', 'skills'] as const)(
    'uses the same primary %s input configuration as the Agent block',
    (id) => {
      const agentInput = AgentBlock.subBlocks.find((subBlock) => subBlock.id === id)
      const mothershipInput = MothershipBlock.subBlocks.find((subBlock) => subBlock.id === id)

      expect(mothershipInput).toEqual({
        id,
        title: agentInput?.title,
        type: agentInput?.type,
        defaultValue: agentInput?.defaultValue,
      })
    }
  )
})
