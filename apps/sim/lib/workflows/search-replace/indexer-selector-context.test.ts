/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSubBlocksForToolInput } = vi.hoisted(() => ({
  getSubBlocksForToolInput: vi.fn(),
}))

vi.mock('@/tools/params', () => ({
  formatParameterLabel: (id: string) => id,
  getToolIdForOperation: () => 'test_list',
  getSubBlocksForToolInput,
}))

import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'

/**
 * The credential and the selector that depends on it, in the shape
 * `getSubBlocksForToolInput` now returns for every user-facing param — whether the
 * block declares the sub-block or it was synthesized from the param's declared type.
 */
const SELECTOR_SUB_BLOCKS = [
  {
    id: 'credential',
    title: 'Credential',
    type: 'short-input',
    canonicalParamId: 'oauthCredential',
  },
  {
    id: 'resourceId',
    title: 'Resource',
    type: 'dropdown',
    selectorKey: 'gmail.labels',
    dependsOn: ['credential'],
  },
]

describe('tool-input selector context', () => {
  beforeEach(() => getSubBlocksForToolInput.mockReset())

  it.each([
    ['from the tool params alone', SELECTOR_SUB_BLOCKS],
    [
      'alongside an unrelated block sub-block',
      [...SELECTOR_SUB_BLOCKS, { id: 'message', title: 'Message', type: 'short-input' }],
    ],
  ])('resolves a selector dependency %s', (_state, subBlocks) => {
    getSubBlocksForToolInput.mockReturnValue({ subBlocks })

    const configs = getToolInputParamConfigs({
      tool: {
        type: 'test',
        operation: 'list',
        params: {
          credential: 'credential-1',
          resourceId: 'resource-1',
          message: 'hello',
        },
      },
    })

    expect(configs.find((config) => config.paramId === 'resourceId')?.selectorContext).toEqual({
      oauthCredential: 'credential-1',
    })
  })

  it('returns the generic fallback when the tool has no registry definition', () => {
    getSubBlocksForToolInput.mockReturnValue(null)

    const configs = getToolInputParamConfigs({
      tool: { type: 'test', operation: 'list', params: { message: 'hello' } },
    })

    expect(configs.map((config) => config.paramId)).toEqual(['message'])
    expect(configs[0].authoritative).toBe(false)
  })
})
