/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { UserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import { routeExecution } from '@/lib/copilot/tools/server/router'

describe('server tool write gating', () => {
  it('denies create_view before executing for a read-only workspace member', async () => {
    await expect(
      routeExecution(
        UserTable.id,
        {
          operation: 'create_view',
          args: { tableId: 'tbl_1', name: 'Private View' },
        },
        {
          userId: 'user_1',
          workspaceId: 'workspace_1',
          userPermission: 'read',
        }
      )
    ).rejects.toThrow("Permission denied: 'create_view' on user_table requires write access")
  })
})
