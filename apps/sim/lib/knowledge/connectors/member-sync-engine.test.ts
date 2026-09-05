/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: vi.fn(),
  processDocumentsWithQueue: vi.fn(),
  ConnectorSyncDeletionGuardError: class ConnectorSyncDeletionGuardError extends Error {},
}))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  KnowledgeConnectorMemberAccessDeniedError: class extends Error {},
  listKnowledgeConnectorMemberCredentials: vi.fn(),
  mintKnowledgeConnectorMemberToken: vi.fn(),
}))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn(),
}))
vi.mock('@/lib/credential-groups/availability', () => ({ isCredentialGroupsAvailable: vi.fn() }))

import {
  buildMemberSyncFailureUpdate,
  deriveMemberActive,
  memberFailureBackoffMs,
  memberNextAttemptAt,
  nextMemberSyncTime,
  shouldListFully,
} from '@/lib/knowledge/connectors/member-sync-engine'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  MAX_CONSECUTIVE_FAILURES,
  MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES,
  MEMBER_FULL_RECRAWL_MINUTES,
} from '@/lib/knowledge/connectors/sync-limits'
import { runChangeFeedPass } from '@/lib/knowledge/connectors/sync-primitives'
import type { ExternalChangeList, ExternalDocument } from '@/connectors/types'

function doc(externalId: string, content = 'x'): ExternalDocument {
  return { externalId, title: externalId, content, mimeType: 'text/plain', metadata: {} }
}

describe('member sync engine decisions', () => {
  describe('deriveMemberActive', () => {
    const live = { groupActive: true, optionActive: true }

    it.each([
      ['active credential in a live enrollment', 'active', 'completed', live, true],
      ['active credential mid-enrollment', 'active', 'in_progress', live, true],
      ['credential needing re-auth', 'needs_reauth', 'completed', live, false],
      ['revoked credential', 'revoked', 'completed', live, false],
      ['revoked enrollment', 'active', 'revoked', live, false],
      ['invited-only enrollment', 'active', 'invited', live, false],
      ['disabled option', 'active', 'completed', { groupActive: true, optionActive: false }, false],
      ['disabled group', 'active', 'completed', { groupActive: false, optionActive: true }, false],
    ] as const)('%s', (_name, managedOauthStatus, enrollmentStatus, option, expected) => {
      expect(deriveMemberActive({ managedOauthStatus, enrollmentStatus }, option)).toBe(expected)
    })
  })

  describe('shouldListFully', () => {
    const now = new Date('2026-09-01T12:00:00Z')

    it('lists fully before any complete listing exists', () => {
      expect(shouldListFully(null, null, now)).toBe(true)
      expect(shouldListFully(now, null, now)).toBe(true)
      expect(shouldListFully(null, now, now)).toBe(true)
    })

    it('lists incrementally inside the recrawl window and fully once it elapses', () => {
      const windowMs = MEMBER_FULL_RECRAWL_MINUTES * 60 * 1000
      const recent = new Date(now.getTime() - windowMs + 60_000)
      const stale = new Date(now.getTime() - windowMs)
      expect(shouldListFully(recent, recent, now)).toBe(false)
      expect(shouldListFully(stale, stale, now)).toBe(true)
    })

    it('stretches the window for a member whose change feed is open', () => {
      const feedWindowMs = MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES * 60 * 1000
      const beyondPlainWindow = new Date(now.getTime() - MEMBER_FULL_RECRAWL_MINUTES * 60 * 1000)
      expect(MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES).toBeGreaterThan(MEMBER_FULL_RECRAWL_MINUTES)
      expect(
        shouldListFully(
          beyondPlainWindow,
          beyondPlainWindow,
          now,
          MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES
        )
      ).toBe(false)
      const stale = new Date(now.getTime() - feedWindowMs)
      expect(shouldListFully(stale, stale, now, MEMBER_CHANGE_FEED_FULL_RECRAWL_MINUTES)).toBe(true)
    })
  })

  describe('runChangeFeedPass', () => {
    function pass(
      pages: ExternalChangeList[],
      options: { deadlineAt?: number; maxPages?: number } = {}
    ) {
      const listChanges = vi.fn(async (_token: string, _config: unknown, cursor: string) => {
        const page = pages[Number(cursor.replace('c', ''))]
        if (!page) throw new Error(`no page for ${cursor}`)
        return page
      })
      return {
        listChanges,
        run: () =>
          runChangeFeedPass({
            connectorId: 'c-1',
            connectorConfig: { listChanges },
            sourceConfig: {},
            syncContext: {},
            cursor: 'c0',
            beforePage: async () => undefined,
            getAccessToken: async () => 'token',
            ...options,
          }),
      }
    }

    it('keeps the last word on each item and resumes past the drained feed', async () => {
      const feed = pass([
        {
          changes: [
            { kind: 'upsert', externalId: 'a', document: doc('a', 'v1') },
            { kind: 'removed', externalId: 'b' },
          ],
          nextCursor: 'c1',
          hasMore: true,
        },
        {
          changes: [
            { kind: 'removed', externalId: 'a' },
            { kind: 'upsert', externalId: 'b', document: doc('b') },
            { kind: 'upsert', externalId: 'c', document: doc('c') },
          ],
          nextCursor: 'resume',
          hasMore: false,
        },
      ])
      const result = await feed.run()

      expect(result.upserts.map((d) => d.externalId)).toEqual(['b', 'c'])
      expect(result.removedExternalIds).toEqual(['a'])
      expect(result.cursor).toBe('resume')
      expect(result.exhausted).toBe(true)
      expect(feed.listChanges).toHaveBeenCalledTimes(2)
    })

    it('stops at the page cap with the cursor past the pages it read', async () => {
      const feed = pass(
        [
          { changes: [{ kind: 'removed', externalId: 'x' }], nextCursor: 'c1', hasMore: true },
          { changes: [], nextCursor: 'c2', hasMore: true },
        ],
        { maxPages: 1 }
      )
      const result = await feed.run()

      expect(result.removedExternalIds).toEqual(['x'])
      expect(result.cursor).toBe('c1')
      expect(result.exhausted).toBe(false)
    })

    it('applies a bounded prefix and resumes before a page that would overflow, including removals', async () => {
      const changes = Array.from({ length: 30_000 }, (_, index) => ({
        kind: 'removed' as const,
        externalId: `a-${index}`,
      }))
      const feed = pass([
        { changes, nextCursor: 'c1', hasMore: true },
        {
          changes: changes.map((change) => ({ ...change, externalId: `b-${change.externalId}` })),
          nextCursor: 'c2',
          hasMore: false,
        },
      ])
      const result = await feed.run()
      expect(result.removedExternalIds).toHaveLength(30_000)
      expect(result.cursor).toBe('c1')
      expect(result.exhausted).toBe(false)
    })

    it('rejects a provider cursor that does not advance', async () => {
      await expect(pass([{ changes: [], nextCursor: 'c0', hasMore: true }]).run()).rejects.toThrow(
        'did not advance'
      )
    })

    it('reads nothing past the deadline and leaves the cursor where it was', async () => {
      const feed = pass([{ changes: [], nextCursor: 'c1', hasMore: false }], {
        deadlineAt: Date.now() - 1,
      })
      const result = await feed.run()

      expect(result.cursor).toBe('c0')
      expect(result.exhausted).toBe(false)
      expect(feed.listChanges).not.toHaveBeenCalled()
    })
  })

  describe('memberNextAttemptAt', () => {
    const now = new Date('2026-09-01T12:00:00Z')

    it('is exactly one interval on, with no jitter, so the connector run finds the member due', () => {
      expect(memberNextAttemptAt(now, 60)).toEqual(new Date('2026-09-01T13:00:00Z'))
    })

    it('waits for the next manual run on a manual-only connector', () => {
      expect(memberNextAttemptAt(now, 0)).toBeNull()
    })
  })

  describe('memberFailureBackoffMs', () => {
    it('doubles on the connector interval and caps at a day', () => {
      expect(memberFailureBackoffMs(1, 60)).toBe(60 * 60 * 1000)
      expect(memberFailureBackoffMs(2, 60)).toBe(2 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(3, 60)).toBe(4 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(10, 60)).toBe(24 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(40, 60)).toBe(24 * 60 * 60 * 1000)
    })

    it('paces a manual-only connector on an hourly base', () => {
      expect(memberFailureBackoffMs(1, 0)).toBe(60 * 60 * 1000)
    })
  })

  describe('buildMemberSyncFailureUpdate', () => {
    const now = new Date('2026-09-01T12:00:00Z')

    it('re-enters the shared ladder over the member columns and releases the lease', () => {
      const update = buildMemberSyncFailureUpdate(now, 0, 'boom')
      expect(update.memberSyncStatus).toBe('error')
      expect(update.lastMemberSyncError).toBe('boom')
      expect(update.memberSyncConsecutiveFailures).toBe(1)
      expect(update.nextMemberSyncAt?.getTime()).toBeGreaterThan(now.getTime())
      expect(update.memberSyncLockToken).toBeNull()
      expect(update.memberSyncLockLeaseAt).toBeNull()
    })

    it('disables after the shared threshold with the shared message', () => {
      const update = buildMemberSyncFailureUpdate(now, MAX_CONSECUTIVE_FAILURES - 1, 'boom')
      expect(update.memberSyncStatus).toBe('disabled')
      expect(update.lastMemberSyncError).toBe(CONNECTOR_AUTO_DISABLED_ERROR)
      expect(update.nextMemberSyncAt).toBeNull()
    })

    it('honours a longer provider retry hint but never a shorter one', () => {
      const ladder = buildMemberSyncFailureUpdate(now, 0, 'boom').nextMemberSyncAt!.getTime()
      const longer = buildMemberSyncFailureUpdate(now, 0, 'boom', 6 * 60 * 60 * 1000)
      const shorter = buildMemberSyncFailureUpdate(now, 0, 'boom', 1000)
      expect(longer.nextMemberSyncAt!.getTime()).toBe(now.getTime() + 6 * 60 * 60 * 1000)
      expect(shorter.nextMemberSyncAt!.getTime()).toBe(ladder)
    })
  })

  describe('nextMemberSyncTime', () => {
    const now = new Date('2026-09-01T12:00:00Z')

    it('re-dispatches immediately while members remain due', () => {
      expect(nextMemberSyncTime(now, 1440, true)).toEqual(now)
      expect(nextMemberSyncTime(now, 0, true)).toEqual(now)
    })

    it('schedules the interval plus bounded jitter, or nothing for a manual connector', () => {
      const next = nextMemberSyncTime(now, 60, false)!
      expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() + 60 * 60 * 1000)
      expect(next.getTime()).toBeLessThanOrEqual(now.getTime() + 60 * 60 * 1000 + 300_000)
      expect(nextMemberSyncTime(now, 0, false)).toBeNull()
    })
  })
})
