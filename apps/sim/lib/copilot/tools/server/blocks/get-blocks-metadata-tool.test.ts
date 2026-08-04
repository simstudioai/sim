/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { computeBlockLevelInputs } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { MothershipBlock } from '@/blocks/blocks/mothership'

describe('get blocks metadata', () => {
  it('omits server-only Mothership policy inputs from block metadata definitions', () => {
    const definitions = computeBlockLevelInputs(MothershipBlock)

    expect(definitions).not.toHaveProperty('secretScope')
    expect(definitions).not.toHaveProperty('mountedSecrets')
  })
})
