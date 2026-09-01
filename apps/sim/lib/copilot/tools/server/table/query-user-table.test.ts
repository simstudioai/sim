/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeUserTable = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/tools/server/table/user-table', () => ({
  userTableServerTool: { execute: executeUserTable },
}))

import { queryUserTableServerTool } from '@/lib/copilot/tools/server/table/query-user-table'

describe('query_user_table alias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeUserTable.mockResolvedValue({ success: true, message: 'ok' })
  })

  it('delegates read operations with the original trusted context', async () => {
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      toolCallId: 'tool-call-1',
      copilotToolExecution: true,
    }
    const params = { operation: 'query_rows', args: { tableId: 'table-1', limit: 10 } }

    await expect(queryUserTableServerTool.execute(params, context)).resolves.toEqual({
      success: true,
      message: 'ok',
    })
    expect(executeUserTable).toHaveBeenCalledWith(params, context)
  })

  it('rejects mutations and outputPath without invoking user_table', async () => {
    await expect(
      queryUserTableServerTool.execute({ operation: 'delete', args: { tableId: 'table-1' } })
    ).resolves.toMatchObject({ success: false, message: expect.stringContaining('read-only') })
    await expect(
      queryUserTableServerTool.execute({
        operation: 'query_rows',
        args: { tableId: 'table-1', outputPath: 'files/result.csv' },
      })
    ).resolves.toMatchObject({ success: false, message: expect.stringContaining('outputPath') })
    expect(executeUserTable).not.toHaveBeenCalled()
  })
})
