import { describe, expect, it } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import { MothershipBlock } from '@/blocks/blocks/mothership'

describe('MothershipBlock', () => {
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
