/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ConnectorSetupDraft, useConnectorSetupStore } from '@/stores/connector-setup/store'

function draft(savedAt = Date.now()): ConnectorSetupDraft {
  return {
    sourceConfig: { excludeChannels: 'private' },
    canonicalModes: {},
    accessMode: 'members',
    credentialId: 'credential-1',
    contentCredentialId: null,
    disabledTagIds: [],
    savedAt,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  useConnectorSetupStore.getState().reset()
})

describe('connector setup drafts', () => {
  it('restores a tab-scoped draft across rehydration without mixing user or workspace keys', async () => {
    const saved = draft()
    useConnectorSetupStore.getState().saveDraft('user-1:workspace-1:kb-1:slack', saved)
    await useConnectorSetupStore.persist.rehydrate()
    expect(useConnectorSetupStore.getState().getDraft('user-1:workspace-1:kb-1:slack')).toEqual(
      saved
    )
    expect(
      useConnectorSetupStore.getState().getDraft('user-2:workspace-1:kb-1:slack')
    ).toBeUndefined()
    expect(
      useConnectorSetupStore.getState().getDraft('user-1:workspace-2:kb-1:slack')
    ).toBeUndefined()
  })

  it('expires unfinished setups and bounds retained drafts', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const store = useConnectorSetupStore.getState()
    store.saveDraft('expired', draft(now - 30 * 60 * 1000))
    expect(store.getDraft('expired')).toBeUndefined()
    for (let index = 0; index < 12; index++) store.saveDraft(`source-${index}`, draft(now + index))
    expect(Object.keys(useConnectorSetupStore.getState().drafts)).toHaveLength(10)
    expect(store.getDraft('expired')).toBeUndefined()
    expect(store.getDraft('source-0')).toBeUndefined()
    expect(store.getDraft('source-11')).toBeDefined()
  })

  it('preserves selected display names across an OAuth draft rehydration', async () => {
    const saved: ConnectorSetupDraft = {
      ...draft(),
      sourceConfig: { channelSelector: ['channel-1'] },
      selectionLabels: { channel: [{ id: 'channel-1', label: 'Engineering' }] },
    }
    useConnectorSetupStore.getState().saveDraft('user:org:index:slack', saved)
    await useConnectorSetupStore.persist.rehydrate()
    expect(useConnectorSetupStore.getState().getDraft('user:org:index:slack')).toEqual(saved)
  })

  it('clears just the canceled setup and clears persisted drafts on reset', async () => {
    const store = useConnectorSetupStore.getState()
    store.saveDraft('one', draft())
    store.saveDraft('two', draft())
    store.clearDraft('one')
    expect(store.getDraft('one')).toBeUndefined()
    expect(store.getDraft('two')).toBeDefined()
    store.reset()
    await useConnectorSetupStore.persist.rehydrate()
    expect(useConnectorSetupStore.getState().drafts).toEqual({})
  })
})
