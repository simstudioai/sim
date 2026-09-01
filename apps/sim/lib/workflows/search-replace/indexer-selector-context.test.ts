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
  getToolParametersConfig: () => ({
    userInputParameters: [
      {
        id: 'credential',
        type: 'string',
        required: true,
        visibility: 'user-only',
        uiComponent: {
          type: 'short-input',
          canonicalParamId: 'oauthCredential',
        },
      },
      {
        id: 'resourceId',
        type: 'string',
        required: true,
        visibility: 'user-only',
        uiComponent: {
          type: 'dropdown',
          selectorKey: 'gmail.labels',
          dependsOn: ['credential'],
        },
      },
    ],
  }),
}))

import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'

describe('tool-input selector fallback context', () => {
  beforeEach(() => getSubBlocksForToolInput.mockReset())

  it.each([
    ['without generated sub-blocks', null],
    [
      'with generated sub-blocks',
      { subBlocks: [{ id: 'message', title: 'Message', type: 'short-input' }] },
    ],
  ])('includes sibling display parameters $0', (_state, subBlocksResult) => {
    getSubBlocksForToolInput.mockReturnValue(subBlocksResult)
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
})
