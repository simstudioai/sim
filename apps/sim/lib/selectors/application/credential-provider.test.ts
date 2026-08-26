/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import {
  dbChainMock,
  dbChainMockFns,
  drizzleOrmMock,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)

import { selectorCredentialMatchesService } from '@/lib/selectors/application/credential-provider'

describe('selectorCredentialMatchesService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    ['OAuth', 'jira', 'jira', true],
    ['Atlassian service account', 'atlassian-service-account', 'confluence', true],
    ['Slack custom bot', 'slack-custom-bot', 'slack', true],
    ['unrelated provider', 'pipedrive', 'slack', false],
  ])(
    'binds a stored %s provider to the requested service',
    async (_, providerId, serviceId, ok) => {
      queueTableRows(credential, [{ accountId: null, providerId }])

      await expect(
        selectorCredentialMatchesService({
          credentialId: 'credential-1',
          credentialOwnerUserId: 'owner-1',
          serviceId,
        })
      ).resolves.toBe(ok)

      expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    }
  )

  it('falls back to an owner-scoped legacy account provider', async () => {
    queueTableRows(credential, [])
    queueTableRows(account, [{ providerId: 'slack' }])

    await expect(
      selectorCredentialMatchesService({
        credentialId: 'legacy-account-1',
        credentialOwnerUserId: 'owner-1',
        serviceId: 'slack',
      })
    ).resolves.toBe(true)

    const accountWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        accountWhere,
        (condition) =>
          condition.type === 'eq' &&
          condition.left === account.id &&
          condition.right === 'legacy-account-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        accountWhere,
        (condition) =>
          condition.type === 'eq' &&
          condition.left === account.userId &&
          condition.right === 'owner-1'
      )
    ).toBe(true)
  })

  it('rejects a legacy account with no owner-matched provider row', async () => {
    queueTableRows(credential, [])
    queueTableRows(account, [])

    await expect(
      selectorCredentialMatchesService({
        credentialId: 'legacy-account-1',
        credentialOwnerUserId: 'owner-1',
        serviceId: 'slack',
      })
    ).resolves.toBe(false)
  })
})
