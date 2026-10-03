import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingWorkspaceAccessMock } from '@sim/testing/mocks/billing-workspace-access.mock'
import { knowledgeDocumentsServiceMock } from '@sim/testing/mocks/knowledge-documents-service.mock'
import { knowledgeMemberAccessMock } from '@sim/testing/mocks/knowledge-member-access.mock'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))
vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)
vi.mock('@/lib/knowledge/connectors/member-access', () => knowledgeMemberAccessMock)
vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
vi.mock('@/lib/credential-groups/availability', () => ({ isCredentialGroupsAvailable: vi.fn() }))

import {
  buildMemberSyncDatabaseRetryUpdate,
  buildMemberSyncFailureUpdate,
  deriveMemberActive,
  type MemberSyncResult,
  memberFailureBackoffMs,
  memberNextAttemptAt,
  memberRunMadeProgress,
  nextMemberSyncTime,
  resolveMemberSyncFailureUpdate,
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

function _doc(externalId: string, content = 'x'): ExternalDocument {
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
  })

  describe('memberFailureBackoffMs', () => {
    it('doubles on the connector interval and caps at a day', () => {
      expect(memberFailureBackoffMs(1, 60)).toBe(60 * 60 * 1000)
      expect(memberFailureBackoffMs(2, 60)).toBe(2 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(3, 60)).toBe(4 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(10, 60)).toBe(24 * 60 * 60 * 1000)
      expect(memberFailureBackoffMs(40, 60)).toBe(24 * 60 * 60 * 1000)
    })
  })

  describe('buildMemberSyncFailureUpdate', () => {
    const now = new Date('2026-09-01T12:00:00Z')

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

  describe('buildMemberSyncDatabaseRetryUpdate', () => {
    const now = new Date('2026-09-01T12:00:00Z')
    const _minutesAfter = (mins: number) => now.getTime() + mins * 60 * 1000

    it('keeps the error visible without advancing the breaker', () => {
      const update = buildMemberSyncDatabaseRetryUpdate(
        now,
        MAX_CONSECUTIVE_FAILURES - 1,
        'db timeout',
        40
      )
      expect(update).toMatchObject({
        memberSyncStatus: 'error',
        lastMemberSyncError: 'db timeout',
        memberSyncConsecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
      })
    })
  })

  describe('memberRunMadeProgress', () => {
    const idle = {
      membersCompleted: 0,
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
    } as MemberSyncResult

    it('reports no progress for a run that wrote nothing', () => {
      expect(memberRunMadeProgress(idle)).toBe(false)
    })
  })

  describe('resolveMemberSyncFailureUpdate', () => {
    beforeEach(() => {
      resetDbChainMock()
    })

    const failure = {
      connectorId: 'c-1',
      runId: 'run-1',
      previousFailures: MAX_CONSECUTIVE_FAILURES - 1,
      errorMessage: 'failed',
      madeProgress: false,
    }
    const run = (status: string, membersCompleted = 0) => ({
      status,
      databaseFailureClass: status === 'failed' ? 'conflict' : null,
      membersCompleted,
      docsAdded: 0,
      docsUpdated: 0,
    })
    const _deadlock = () =>
      new DrizzleQueryError(
        'update private SQL',
        ['private'],
        Object.assign(new Error('deadlock detected'), { code: '40P01' })
      )

    it('does not disable a connector one failure from the breaker over a database timeout', async () => {
      queueTableRows(schemaMock.knowledgeConnectorMemberSyncLog, [run('failed'), run('completed')])
      const timeout = new DrizzleQueryError(
        'select private SQL',
        ['private'],
        Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        })
      )
      const update = await resolveMemberSyncFailureUpdate(timeout, failure)
      expect(update).toMatchObject({
        memberSyncStatus: 'error',
        memberSyncConsecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
      })
      expect(update.nextMemberSyncAt).not.toBeNull()
    })
  })

  describe('nextMemberSyncTime', () => {
    const now = new Date('2026-09-01T12:00:00Z')

    it('re-dispatches immediately while members remain due', () => {
      expect(nextMemberSyncTime(now, 1440, true)).toEqual(now)
      expect(nextMemberSyncTime(now, 0, true)).toEqual(now)
    })
  })
})
