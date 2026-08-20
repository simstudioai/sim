/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeUserTable = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/tools/server/table/user-table', () => ({
  userTableServerTool: { execute: executeUserTable },
}))

import { tableAutomationsServerTool } from '@/lib/copilot/tools/server/table/table-automations'
import { tableColumnsServerTool } from '@/lib/copilot/tools/server/table/table-columns'
import { tableEnrichmentsServerTool } from '@/lib/copilot/tools/server/table/table-enrichments'
import { tableManageServerTool } from '@/lib/copilot/tools/server/table/table-manage'
import { tableRowsServerTool } from '@/lib/copilot/tools/server/table/table-rows'

/**
 * Every split tool delegates its own operations to the shared user_table
 * executor untouched, and rejects operations that belong to a sibling slice
 * without ever invoking it — the per-slice allowlist is the access contract.
 */
describe('split table tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeUserTable.mockResolvedValue({ success: true, message: 'ok' })
  })

  const cases = [
    { tool: tableManageServerTool, own: 'create', foreign: 'insert_row' },
    { tool: tableRowsServerTool, own: 'batch_update_rows', foreign: 'add_column' },
    { tool: tableColumnsServerTool, own: 'update_column', foreign: 'create' },
    { tool: tableAutomationsServerTool, own: 'run_column', foreign: 'add_enrichment' },
    { tool: tableEnrichmentsServerTool, own: 'add_enrichment', foreign: 'run_column' },
  ] as const

  it.each(cases)(
    '$tool.name delegates $own and rejects $foreign',
    async ({ tool, own, foreign }) => {
      const context = { userId: 'user-1', workspaceId: 'workspace-1', copilotToolExecution: true }
      const params = { operation: own, args: { tableId: 'table-1' } }

      await expect(tool.execute(params as never, context as never)).resolves.toEqual({
        success: true,
        message: 'ok',
      })
      expect(executeUserTable).toHaveBeenCalledWith(params, context)

      executeUserTable.mockClear()
      await expect(
        tool.execute({ operation: foreign, args: { tableId: 'table-1' } } as never)
      ).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining(foreign),
      })
      expect(executeUserTable).not.toHaveBeenCalled()
    }
  )
})
