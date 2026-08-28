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
  beforeEach(() => {
    getSubBlocksForToolInput.mockReturnValue(null)
  })

  it('includes sibling display parameters in selector context', () => {
    const configs = getToolInputParamConfigs({
      tool: {
        type: 'test',
        operation: 'list',
        params: {
          credential: 'credential-1',
          resourceId: 'resource-1',
        },
      },
    })

    expect(configs.find((config) => config.paramId === 'resourceId')?.selectorContext).toEqual({
      oauthCredential: 'credential-1',
    })
  })

  it('includes sibling display parameters when tool sub-blocks also exist', () => {
    getSubBlocksForToolInput.mockReturnValue({
      subBlocks: [{ id: 'message', title: 'Message', type: 'short-input' }],
    })

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
