/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import {
  admitContent,
  admitWrittenContent,
  type ContentDeliveryGate,
  type ContentSource,
  noteContentDeliveryOperation,
  runDeclaredContentOperation,
} from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import {
  deliveredFileProvenance,
  dispatchUnderContentGate,
  isCommittedWriteResponse,
} from '@/lib/mothership/content-delivery/dispatch'

const now = Date.now()
const CHAT: Principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:test',
  issuedAt: new Date(now),
  expiresAt: new Date(now + 60_000),
}

const SOURCED = defineWorkspaceOperation({
  id: 'test.sourced',
  contentDelivery: 'sourced',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
  capability: 'none',
})

const ENTRY = { encryptedValue: 'ciphertext-1', sourceUserId: 'user-1', name: 'TOKEN' }

const ADMIT_ALL: ContentDeliveryGate = {
  async admit(sources) {
    return sources.map(() => true)
  },
}

const SOURCE: ContentSource = {
  kind: 'workspace-file',
  id: 'file-1',
  provenance: { status: 'exact', entries: [ENTRY] },
  view: 'complete',
}

describe('dispatchUnderContentGate', () => {
  it('rethrows a gate failure the route had mapped to its own error response', async () => {
    const failure = new Error('history unavailable')
    const failing: ContentDeliveryGate = {
      async admit() {
        throw failure
      },
    }
    await expect(
      dispatchUnderContentGate(failing, async () => {
        try {
          await admitContent(CHAT, [SOURCE])
        } catch {
          return Response.json({ error: 'internal' }, { status: 500 })
        }
        return Response.json({ data: 'unreachable' })
      })
    ).rejects.toMatchObject({
      name: 'ContentGateFailure',
      gateFailure: failure,
      committedWrite: false,
    })
  })

  it('marks a withheld response to a committed write, so what it changed is still refreshed', async () => {
    const refusing: ContentDeliveryGate = {
      async admit(sources) {
        return sources.map(() => false)
      },
    }
    const { response } = await dispatchUnderContentGate(refusing, async () => {
      const outcome = await runDeclaredContentOperation(SOURCED, CHAT, async () => {
        await admitWrittenContent(CHAT, [SOURCE])
        return 'saved'
      }).catch(() => 'withheld')
      return Response.json({ error: outcome }, { status: 403 })
    })
    expect(response.status).toBe(403)
    expect(isCommittedWriteResponse(response)).toBe(true)
  })

  it('replaces any successful response that never classified its content with a 403', async () => {
    for (const status of [200, 201]) {
      const { response, admitted } = await dispatchUnderContentGate(ADMIT_ALL, async () => {
        noteContentDeliveryOperation(SOURCED, CHAT)
        return Response.json({ data: 'unclassified content' }, { status })
      })
      expect(response.status).toBe(403)
      const body = await response.text()
      expect(body).not.toContain('unclassified content')
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'FORBIDDEN' } })
      expect(admitted).toEqual([])
    }
  })

  it('passes an error response through, since it carries no content to classify', async () => {
    const { response } = await dispatchUnderContentGate(ADMIT_ALL, async () => {
      noteContentDeliveryOperation(SOURCED, CHAT)
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    })
    expect(response.status).toBe(404)
  })

  it('passes a classified response with the provenance of what it admitted', async () => {
    const { response, admitted } = await dispatchUnderContentGate(ADMIT_ALL, async () => {
      noteContentDeliveryOperation(SOURCED, CHAT)
      await admitContent(CHAT, [SOURCE])
      return Response.json({ data: 'classified' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: 'classified' })
    expect(admitted).toEqual([SOURCE.provenance])
  })
})

describe('deliveredFileProvenance', () => {
  it('is clean for nothing delivered, and merges every admitted item’s entries', () => {
    expect(deliveredFileProvenance([])).toEqual({ status: 'exact', entries: [] })
    const other = { encryptedValue: 'ciphertext-2', sourceUserId: 'user-2' }
    const merged = deliveredFileProvenance([
      { status: 'exact', entries: [ENTRY] },
      { status: 'exact', entries: [other] },
      { status: 'exact', entries: [] },
    ])
    expect(merged.status).toBe('exact')
    expect(merged.status === 'exact' && merged.entries).toEqual(
      expect.arrayContaining([ENTRY, other])
    )
  })

  it('stays unknown when any delivered item was unknown, and unrecorded when one was', () => {
    expect(
      deliveredFileProvenance([{ status: 'exact', entries: [ENTRY] }, { status: 'unknown' }])
    ).toEqual({ status: 'unknown' })
    expect(deliveredFileProvenance([{ status: 'unrecorded' }]).status).toBe('unrecorded')
  })

  it('reads an entry with no owner as unknown, since it cannot be re-bound to a file', () => {
    expect(
      deliveredFileProvenance([{ status: 'exact', entries: [{ encryptedValue: 'ciphertext-3' }] }])
    ).toEqual({ status: 'unknown' })
  })
})
