import { describe, expect, it } from 'vitest'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { QuiverBlock, QuiverV2Block, QuiverV3Block } from '@/blocks/blocks/quiver'

describe('Quiver model dropdown', () => {
  it.each([QuiverBlock, QuiverV2Block, QuiverV3Block])(
    'accepts retired Arrow 1.x ids that saved $type blocks still store',
    (block) => {
      const modelConfig = block.subBlocks.find((subBlock) => subBlock.id === 'model')
      if (!modelConfig) throw new Error('Quiver model subBlock missing')
      for (const model of ['arrow-preview', 'arrow-1', 'arrow-1.0', 'arrow-1.1', 'arrow-1.1-max']) {
        expect(
          validateValueForSubBlockType(modelConfig, model, 'model', block.type, 'quiver-1').valid
        ).toBe(true)
      }
    }
  )
})
