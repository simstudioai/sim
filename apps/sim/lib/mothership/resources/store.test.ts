import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import type { MothershipResource } from '@/lib/mothership/resources/types'

const unscopedFile: MothershipResource = { type: 'file', id: 'file-1', title: 'notes.md' }
const scopedFile: MothershipResource = { ...unscopedFile, workspaceId: 'ws' }
const table: MothershipResource = { type: 'table', id: 'table-1', title: 'Accounts' }

function storeWorkspaceChat(resources: MothershipResource[]) {
  queueTableRows(schemaMock.copilotChats, [{ resources, workspaceId: 'ws' }])
}

describe('changeStoredChatResources reorder', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('keeps the reorder when a workspace chat holds a tab both unscoped and scoped', async () => {
    storeWorkspaceChat([unscopedFile, scopedFile, table])

    const reordered = await changeStoredChatResources('chat-1', {
      kind: 'reorder',
      resources: [table, unscopedFile, scopedFile],
    })

    expect(reordered.map((resource) => resource.type)).toEqual(['table', 'file'])
  })

  it('still rejects an order that drops or invents a resource', async () => {
    storeWorkspaceChat([scopedFile, table])
    await expect(
      changeStoredChatResources('chat-1', { kind: 'reorder', resources: [table, table] })
    ).rejects.toThrow('Reordered resources must match existing resources')

    storeWorkspaceChat([scopedFile, table])
    await expect(
      changeStoredChatResources('chat-1', {
        kind: 'reorder',
        resources: [table, { ...unscopedFile, id: 'file-2' }],
      })
    ).rejects.toThrow('Reordered resources must match existing resources')
  })
})
