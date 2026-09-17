import { describe, expect, it } from 'vitest'
import { extractInlineBlockSubBlockIds } from '@/scripts/block-registry-source'

describe('extractInlineBlockSubBlockIds', () => {
  it('does not attribute a satisfies-style legacy block’s fields to a typed successor', () => {
    expect(
      extractInlineBlockSubBlockIds(`
      export const LegacyBlock = {
        type: 'legacy',
        subBlocks: [{ id: 'operation' }, { id: 'encoding' }],
      } satisfies BlockConfig<Result>
      export const CurrentBlock: BlockConfig = {
        ...LegacyBlock,
        type: 'current',
        subBlocks: LegacyBlock.subBlocks.filter((field) => field.id !== 'encoding'),
      }
    `)
    ).toEqual({ legacy: ['operation', 'encoding'] })
  })

  it('reads each inline definition and ignores nested option IDs and punctuation in strings', () => {
    expect(
      extractInlineBlockSubBlockIds(`
      export const FirstBlock: BlockConfig = {
        type: 'first', subBlocks: [{ id: 'operation', options: [{ id: 'nested' }] }],
      }
      export const SecondBlock: BlockConfig<Result> = {
        type: 'second', subBlocks: [
          { id: 'template', placeholder: 'objects: [{ }]' },
          { id: 'text' },
        ],
      }
    `)
    ).toEqual({ first: ['operation'], second: ['template', 'text'] })
  })
})
