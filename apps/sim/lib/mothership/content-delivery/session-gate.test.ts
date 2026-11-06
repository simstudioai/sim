/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The workbench history lives in Redis beside a remote machine; only its write is observed. */
const history = vi.hoisted(() => ({ recordExistingSessionFileInput: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox/session-file-provenance', () => history)
const telemetry = vi.hoisted(() => ({
  reportDurableSecretProvenanceRefusal: vi.fn(),
  reportDurableSecretProvenanceRefusals: vi.fn(),
  reportDurableSecretProvenanceUnrecordedBatch: vi.fn(),
}))
vi.mock('@/lib/execution/durable-secret-provenance-telemetry', () => telemetry)

import type { ContentProvenance, ContentSource } from '@/lib/core/application'
import {
  createSessionContentGate,
  WorkbenchProvenanceUnavailableError,
} from '@/lib/mothership/content-delivery/session-gate'

const ENTRY = {
  encryptedValue: 'ciphertext-1',
  sourceUserId: 'user-1',
  sourceWorkspaceId: 'workspace-1',
  name: 'FIXTURE_TOKEN',
}

function item(id: string, provenance: ContentProvenance): ContentSource {
  return { kind: 'workspace-file', id, provenance, view: 'opaque' }
}

const gate = () =>
  createSessionContentGate({
    sessionKey: 'session-1',
    workspaceId: 'workspace-1',
    actorUserId: 'user-1',
  })

beforeEach(() => {
  history.recordExistingSessionFileInput.mockResolvedValue(undefined)
})

describe('createSessionContentGate', () => {
  it('keeps an unknown item out of the machine and its history', async () => {
    expect(await gate().admit([item('tainted', { status: 'unknown' })])).toEqual(['unknown'])
    expect(history.recordExistingSessionFileInput).not.toHaveBeenCalled()
    expect(telemetry.reportDurableSecretProvenanceRefusals).toHaveBeenCalledWith([
      expect.objectContaining({ resourceId: 'tainted' }),
    ])
  })

  it('reports every item one admission refuses as one batch, not one line per item', async () => {
    telemetry.reportDurableSecretProvenanceRefusals.mockClear()
    const refused = Array.from({ length: 50 }, (_, index) =>
      item(`tainted-${index}`, { status: 'unknown' })
    )
    expect(await gate().admit(refused)).toEqual(refused.map(() => 'unknown'))
    expect(telemetry.reportDurableSecretProvenanceRefusals).toHaveBeenCalledTimes(1)
    const [reports] = telemetry.reportDurableSecretProvenanceRefusals.mock.calls[0]
    expect(reports).toHaveLength(50)
    expect(telemetry.reportDurableSecretProvenanceRefusal).not.toHaveBeenCalled()
  })

  it('admits secret-bearing bytes, even opaque, after merging their entries into the history', async () => {
    const verdicts = await gate().admit([
      item('config', { status: 'exact', entries: [ENTRY] }),
      item('tainted', { status: 'unknown' }),
      item('clean', { status: 'exact', entries: [] }),
    ])
    expect(verdicts).toEqual([true, 'unknown', true])
    expect(history.recordExistingSessionFileInput).toHaveBeenCalledTimes(1)
    expect(history.recordExistingSessionFileInput).toHaveBeenCalledWith('session-1', {
      status: 'exact',
      entries: [ENTRY],
    })
  })

  it('records an unrecorded item as clean history and reports the absence', async () => {
    expect(await gate().admit([item('untracked', { status: 'unrecorded' })])).toEqual([true])
    expect(history.recordExistingSessionFileInput).toHaveBeenCalledWith('session-1', {
      status: 'exact',
      entries: [],
    })
    expect(telemetry.reportDurableSecretProvenanceUnrecordedBatch).toHaveBeenCalledWith([
      expect.objectContaining({ recordCount: 1, workspaceId: 'workspace-1' }),
    ])
  })

  it('lets nothing in when the history cannot be widened', async () => {
    history.recordExistingSessionFileInput.mockRejectedValue(new Error('redis unavailable'))
    await expect(
      gate().admit([item('clean', { status: 'exact', entries: [] })])
    ).rejects.toBeInstanceOf(WorkbenchProvenanceUnavailableError)
  })
})
