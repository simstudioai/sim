/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  LEGACY_CONNECTOR_CREDENTIAL_BATCH_SIZE,
  remapLegacyKnowledgeConnectorCredentials,
} from './0011_remap_legacy_knowledge_connector_credentials'

/** A store whose pages are served in order and whose ids encode their outcome by prefix. */
function createStore(pages: string[][]) {
  const queue = [...pages]
  const store = {
    remapped: [] as string[][],
    disconnected: [] as string[][],
    listUnmappedConnectorIds: vi.fn(async () => queue.shift() ?? []),
    remapToWorkspaceCredential: vi.fn(async (ids: readonly string[]) => {
      store.remapped.push([...ids])
      return ids.filter((id) => id.startsWith('map')).length
    }),
    disconnectUnmapped: vi.fn(async (ids: readonly string[]) => {
      store.disconnected.push([...ids])
      return ids.filter((id) => id.startsWith('drop')).length
    }),
  }
  return store
}

describe('remapLegacyKnowledgeConnectorCredentials', () => {
  it('walks pages by keyset cursor, remapping before disconnecting each page', async () => {
    const store = createStore([['drop-a', 'map-b'], ['map-c']])

    const result = await remapLegacyKnowledgeConnectorCredentials(store, { batchSize: 2 })

    expect(result).toEqual({ remapped: 2, disconnected: 1 })
    expect(store.listUnmappedConnectorIds.mock.calls).toEqual([
      ['', 2],
      ['map-b', 2],
      ['map-c', 2],
    ])
    expect(store.remapped).toEqual([['drop-a', 'map-b'], ['map-c']])
    expect(store.disconnected).toEqual([['drop-a', 'map-b'], ['map-c']])
    expect(store.remapToWorkspaceCredential.mock.invocationCallOrder[0]).toBeLessThan(
      store.disconnectUnmapped.mock.invocationCallOrder[0]
    )
  })

  it('is a no-op when nothing is unmapped', async () => {
    const store = createStore([])
    await expect(remapLegacyKnowledgeConnectorCredentials(store)).resolves.toEqual({
      remapped: 0,
      disconnected: 0,
    })
    expect(store.listUnmappedConnectorIds).toHaveBeenCalledWith(
      '',
      LEGACY_CONNECTOR_CREDENTIAL_BATCH_SIZE
    )
    expect(store.remapToWorkspaceCredential).not.toHaveBeenCalled()
  })

  it('fails fast on a non-advancing or oversized page instead of looping', async () => {
    await expect(
      remapLegacyKnowledgeConnectorCredentials(createStore([['b'], ['a']]), { batchSize: 1 })
    ).rejects.toThrow('non-advancing page')
    await expect(
      remapLegacyKnowledgeConnectorCredentials(createStore([['a', 'b']]), { batchSize: 1 })
    ).rejects.toThrow('oversized page')
    await expect(
      remapLegacyKnowledgeConnectorCredentials(createStore([]), { batchSize: 0 })
    ).rejects.toThrow('positive integer')
  })
})
