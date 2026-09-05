/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { schemaMock } from '@sim/testing'
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

vi.mock('@sim/db/schema', () => schemaMock)

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
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
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
  })

  it('presents each grant by the client name, falling back to its id', async () => {
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
    ).resolves.toEqual([
      {
        clientId: 'sim-cli',
        name: 'Sim CLI',
        scopes: ['openid', 'api:write'],
        authorizedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        clientId: 'partner-app',
        name: 'partner-app',
        scopes: ['openid'],
        authorizedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
  })

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
    expect(deleted.map(([table]) => table)).toEqual([
      schemaMock.oauthConsent,
      schemaMock.oauthAccessToken,
    ])
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
