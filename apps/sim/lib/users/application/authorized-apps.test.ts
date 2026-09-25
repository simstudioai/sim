import { oauthAccessToken, oauthConsent } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

import { ForbiddenOperationError } from '@/lib/core/application'
import {
  listAuthorizedAppsUseCase,
  revokeAuthorizedAppUseCase,
} from '@/lib/users/application/authorized-apps'

const mocks = {
  recordAudit: auditMockFns.mockRecordAudit,
  transaction: dbChainMockFns.transaction,
  select: dbChainMockFns.select,
}

const session = createSessionPrincipal()
const personalKey = createPersonalApiKeyPrincipal()

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
  beforeEach(resetDbChainMock)
  afterAll(resetDbChainMock)

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
})
