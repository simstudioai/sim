/**
 * @vitest-environment node
 */
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
const telemetry = vi.hoisted(() => ({
  reportDurableSecretProvenanceRefusal: vi.fn(),
  reportDurableSecretProvenanceUnrecordedBatch: vi.fn(),
}))
vi.mock('@/lib/execution/durable-secret-provenance-telemetry', () => telemetry)

import type { ContentProvenance, ContentSource } from '@/lib/core/application/content-delivery'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery/registry-gate'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Ciphertext is `enc:<plaintext>`; `enc:` alone stands for a value whose key was rotated away. */
const SECRET = 'SYNTHETIC_GATE_SECRET_4F7'
const OTHER_SECRET = 'SYNTHETIC_OTHER_SECRET_9C2'

function exact(...plaintexts: string[]): ContentProvenance {
  return {
    status: 'exact',
    entries: plaintexts.map((plaintext) => ({
      encryptedValue: `enc:${plaintext}`,
      sourceUserId: 'user-1',
      sourceWorkspaceId: 'workspace-1',
      name: 'FIXTURE_TOKEN',
    })),
  }
}

function item(
  id: string,
  provenance: ContentProvenance,
  view: ContentSource['view'] = 'complete'
): ContentSource {
  return { kind: 'workspace-file', id, provenance, view }
}

function newRegistry() {
  return new ResolvedSecretTraceRegistry([], { userId: 'user-1', workspaceId: 'workspace-1' })
}

/** What Chat's model receives for `text` under `registry`, as egress projects it. */
function modelView(text: string, registry: ResolvedSecretTraceRegistry) {
  const projection = projectResolvedSecretModelContent(text, registry.forkForPropagatedEntries())
  return projection.safe ? projection.value : undefined
}

beforeEach(() => {
  encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => {
    const plaintext = value.slice('enc:'.length)
    if (!plaintext) throw new Error('decryption failed')
    return { decrypted: plaintext }
  })
})

describe('createRegistryContentGate', () => {
  it('admits clean and unrecorded items, reporting the unrecorded ones once per batch', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({
      registry,
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
    })
    const verdicts = await gate.admit([
      item('clean', { status: 'exact', entries: [] }),
      item('untracked', { status: 'unrecorded' }, 'opaque'),
    ])
    expect(verdicts).toEqual([true, true])
    expect(registry.isPermanentlyIncomplete()).toBe(false)
    expect(telemetry.reportDurableSecretProvenanceUnrecordedBatch).toHaveBeenCalledTimes(1)
    expect(telemetry.reportDurableSecretProvenanceUnrecordedBatch).toHaveBeenCalledWith([
      expect.objectContaining({ resourceId: 'untracked', surface: 'workspace-file' }),
    ])
  })

  it('imports a complete item’s secrets so egress redacts them', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1' })
    expect(await gate.admit([item('config', exact(SECRET))])).toEqual([true])
    const view = modelView(`token=${SECRET}`, registry)
    expect(view).toBeDefined()
    expect(view).not.toContain(SECRET)
    expect(view).toContain('{{FIXTURE_TOKEN}}')
  })

  it('imports only the secrets a derived view contains', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1' })
    const derived = { excerpt: `token=${SECRET}` }
    expect(await gate.admit([item('config', exact(SECRET, OTHER_SECRET), { derived })])).toEqual([
      true,
    ])
    expect(modelView(`token=${SECRET}`, registry)).not.toContain(SECRET)
    /** The other secret is not in what this result shows, so it is not activated by it. */
    expect(modelView(`other=${OTHER_SECRET}`, registry)).toContain(OTHER_SECRET)
  })

  it('refuses an opaque view of an item holding secrets, which no redaction reaches', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1' })
    expect(await gate.admit([item('archive', exact(SECRET), 'opaque')])).toEqual([false])
    expect(registry.isPermanentlyIncomplete()).toBe(false)
    expect(telemetry.reportDurableSecretProvenanceRefusal).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'archive',
        cause: 'workspace-file-opaque-secret-content',
      })
    )
  })

  it('refuses an item holding secrets when there is no registry to redact with', async () => {
    const gate = createRegistryContentGate({ actorUserId: 'user-1' })
    expect(await gate.admit([item('config', exact(SECRET))])).toEqual([false])
  })

  it('refuses an unknown item without latching the registry', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1' })
    expect(await gate.admit([item('tainted', { status: 'unknown' })])).toEqual([false])
    expect(registry.isPermanentlyIncomplete()).toBe(false)
  })

  it('admits an unknown item under taint and withholds the whole output instead (D7)', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1', unknown: 'taint' })
    expect(await gate.admit([item('tainted', { status: 'unknown' })])).toEqual([true])
    expect(registry.isPermanentlyIncomplete()).toBe(true)
    expect(modelView('anything at all', registry)).toBeUndefined()
  })

  it('refuses an unknown item under taint when no registry could withhold the output', async () => {
    const gate = createRegistryContentGate({ actorUserId: 'user-1', unknown: 'taint' })
    expect(await gate.admit([item('tainted', { status: 'unknown' })])).toEqual([false])
  })

  it('refuses only the item whose secrets cannot be imported, keeping the rest of the call', async () => {
    const registry = newRegistry()
    const gate = createRegistryContentGate({ registry, actorUserId: 'user-1' })
    const rotated: ContentProvenance = {
      status: 'exact',
      entries: [{ encryptedValue: 'enc:', sourceUserId: 'user-1', name: 'ROTATED' }],
    }
    const verdicts = await gate.admit([
      item('rotated', rotated),
      item('config', exact(SECRET)),
      item('clean', { status: 'exact', entries: [] }),
    ])
    expect(verdicts).toEqual([false, true, true])
    expect(registry.isPermanentlyIncomplete()).toBe(false)
    expect(modelView(`token=${SECRET}`, registry)).not.toContain(SECRET)
  })
})
