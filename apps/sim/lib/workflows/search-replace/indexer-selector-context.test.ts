/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/tools/params', () => ({
  formatParameterLabel: (id: string) => id,
  getToolIdForOperation: () => 'test_list',
  getSubBlocksForToolInput: () => null,
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
})
