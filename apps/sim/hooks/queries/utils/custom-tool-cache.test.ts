/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getQueryDataMock } = vi.hoisted(() => ({
  getQueryDataMock: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: vi.fn(() => ({
    getQueryData: getQueryDataMock,
  })),
}))

import { getCustomTool, getCustomTools } from '@/hooks/queries/utils/custom-tool-cache'

describe('custom tool cache helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads workspace-scoped custom tools from the cache', () => {
    const tools = [{ id: 'tool-1', title: 'Weather', schema: {}, code: '', workspaceId: 'ws-1' }]
    getQueryDataMock.mockReturnValue(tools)

    expect(getCustomTools('ws-1')).toBe(tools)
    expect(getQueryDataMock).toHaveBeenCalledWith(['customTools', 'list', 'ws-1'])
  })

  it('resolves custom tools by id or title', () => {
    getQueryDataMock.mockReturnValue([
      { id: 'tool-1', title: 'Weather', schema: {}, code: '', workspaceId: 'ws-1' },
    ])

    expect(getCustomTool('tool-1', 'ws-1')?.title).toBe('Weather')
    expect(getCustomTool('Weather', 'ws-1')?.id).toBe('tool-1')
  })
})
