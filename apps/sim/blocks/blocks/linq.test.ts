import { describe, expect, it } from 'vitest'
import { LinqBlock } from '@/blocks/blocks/linq'

type Params = Record<string, unknown>

const toolCall = (args: Params, operation: string): Params =>
  LinqBlock.tools.config?.params?.(args as never, { operation }) as Params

describe('Linq agent tool calls', () => {
  it('unwraps a single picked file on create_attachment', () => {
    const file = {
      id: 'f1',
      name: 'card.png',
      key: 'workspace/ws/card.png',
      size: 10,
      type: 'image/png',
    }
    expect(toolCall({ file: [file] }, 'create_attachment').file).toEqual(file)
  })
})
