/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { oauthAccessToken, oauthConsent } from '@sim/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  transaction: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mocks.recordAudit,
  AuditAction: { OAUTH_APP_REVOKED: 'oauth_app.revoked' },
  AuditResourceType: { OAUTH_CLIENT: 'oauth_client' },
}))

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

vi.mock('@sim/db', () => ({
  db: {
    transaction: mocks.transaction,
    select: mocks.select,
  },
}))

import { ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  listAuthorizedAppsUseCase,
  revokeAuthorizedAppUseCase,
} from '@/lib/users/application/authorized-apps'

const session: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const personalKey: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}

/** A drizzle select chain that answers `rows` whenever it is finally awaited. */
function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn<(predicate: SQL | undefined) => unknown>(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  }
  for (const method of [chain.from, chain.innerJoin, chain.where, chain.orderBy, chain.limit]) {
    method.mockReturnValue(chain)
  }
  return chain
}

describe('authorized apps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a principal that is not the account holder in session', async () => {
    await expect(
      listAuthorizedAppsUseCase.execute({ principal: personalKey, input: {} })
    ).rejects.toBeInstanceOf(ForbiddenOperationError)
    await expect(
      revokeAuthorizedAppUseCase.execute({
        principal: personalKey,
        input: { clientId: 'sim-cli' },
      })
    ).rejects.toBeInstanceOf(ForbiddenOperationError)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('returns one page of domain records without applying HTTP presentation', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          clientId: 'sim-cli',
          name: 'Sim CLI',
          scopes: ['openid', 'api:write'],
          authorizedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          clientId: 'partner-app',
          name: null,
          scopes: ['openid'],
          authorizedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ])
    )

    await expect(
      listAuthorizedAppsUseCase.execute({ principal: session, input: {} })
    ).resolves.toEqual({
      apps: [
        {
          clientId: 'sim-cli',
          name: 'Sim CLI',
          scopes: ['openid', 'api:write'],
          authorizedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          clientId: 'partner-app',
          name: null,
          scopes: ['openid'],
          authorizedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
    })
  })

  it('limits the read and resumes after the last visible row with a stable timestamp tie-breaker', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      clientId: `app-${String(26 - index).padStart(2, '0')}`,
      name: `App ${index}`,
      scopes: ['api:read'],
      authorizedAt: new Date('2026-09-01T00:00:00.000Z'),
    }))
    const first = selectChain(rows)
    const second = selectChain([rows[25]])
    mocks.select.mockReturnValueOnce(first).mockReturnValueOnce(second)

    const page = await listAuthorizedAppsUseCase.execute({ principal: session, input: {} })
    expect(first.limit).toHaveBeenCalledWith(26)
    expect(page.apps).toEqual(rows.slice(0, 25))
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'))).toEqual([
      rows[24].authorizedAt.toISOString(),
      rows[24].clientId,
    ])

    const final = await listAuthorizedAppsUseCase.execute({
      principal: session,
      input: { cursor: page.nextCursor! },
    })
    expect(final).toEqual({ apps: [rows[25]], nextCursor: null })
    const condition = second.where.mock.calls[0][0]
    expect(condition).toBeDefined()
    const query = new PgDialect().sqlToQuery(condition!)
    expect(query.sql).toContain("date_trunc('milliseconds'")
    expect(query.sql).toContain('"oauth_consent"."client_id" <')
    expect(query.params).toContain(session.userId)
    expect(query.params).toContain(rows[24].clientId)
  })

  it('searches all grants for this user and treats SQL wildcards literally', async () => {
    const queryChain = selectChain([])
    mocks.select.mockReturnValue(queryChain)
    await listAuthorizedAppsUseCase.execute({
      principal: session,
      input: { search: '  100%_App  ' },
    })
    const query = new PgDialect().sqlToQuery(queryChain.where.mock.calls[0][0]!)
    expect(query.params).toEqual([session.userId, '%100\\%\\_App%', '%100\\%\\_App%'])
    expect(query.sql).toContain('"oauth_client"."name" ilike')
    expect(query.sql).toContain('"oauth_client"."client_id" ilike')
  })

  it.each(['not-json', Buffer.from('["not-a-date","client"]', 'utf8').toString('base64url')])(
    'rejects malformed cursors before reading protected data',
    async (cursor) => {
      await expect(
        listAuthorizedAppsUseCase.execute({ principal: session, input: { cursor } })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.select).not.toHaveBeenCalled()
    }
  )

  it('removes the consent and both token kinds in one transaction, and records the audit', async () => {
    const deleted: unknown[] = []
    const tx = {
      select: () => selectChain([{ id: 'consent-1', name: 'Sim CLI' }]),
      delete: (table: unknown) => ({ where: (clause: unknown) => deleted.push([table, clause]) }),
    }
    mocks.transaction.mockImplementation(async (run: (t: unknown) => unknown) => run(tx))

    await expect(
      revokeAuthorizedAppUseCase.execute({ principal: session, input: { clientId: 'sim-cli' } })
    ).resolves.toEqual({ clientId: 'sim-cli', name: 'Sim CLI' })

    /**
     * The tables are asserted, not just the call counts: swapping the access
     * and refresh token tables leaves the counts identical while deleting the
     * rows whose revocation is what makes a replayed token detectable.
     */
    expect(deleted.map(([table]) => table)).toEqual([oauthConsent, oauthAccessToken])
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'oauth_app.revoked',
        resourceId: 'sim-cli',
        resourceName: 'Sim CLI',
      })
    )
  })

  it('reports a grant this account does not hold as not found, changing nothing', async () => {
    const tx = {
      select: () => selectChain([]),
      delete: () => {
        throw new Error('must not delete')
      },
      update: () => {
        throw new Error('must not update')
      },
    }
    mocks.transaction.mockImplementation(async (run: (t: unknown) => unknown) => run(tx))

    const failure = await revokeAuthorizedAppUseCase
      .execute({ principal: session, input: { clientId: 'someone-elses' } })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(OrchestrationError)
    expect(failure.code).toBe('not_found')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
