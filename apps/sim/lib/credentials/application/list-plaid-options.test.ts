/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
  resolveContext: vi.fn(),
  getActor: vi.fn(),
  decryptCredential: vi.fn(),
  executeProvider: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_ACCESSED: 'credential.accessed' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
}))
vi.mock('@/lib/credentials/application/credential-context', () => ({
  resolveCredentialApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/credentials/plaid-service-account', () => ({
  decryptPlaidServiceAccountCredential: mocks.decryptCredential,
}))
vi.mock('@/tools/plaid/utils.server', () => ({
  executePlaidProviderRequest: mocks.executeProvider,
  PlaidGatewayError: class extends Error {},
}))

import {
  listPlaidOptions,
  plaidAccountMatchesEligibility,
} from '@/lib/credentials/application/list-plaid-options'
import type { PlaidAccount } from '@/tools/plaid/types'

const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'service_account',
  providerId: 'plaid-service-account',
  encryptedServiceAccountKey: 'encrypted',
}
const stored = {
  type: 'plaid_service_account',
  providerId: 'plaid-service-account',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'production',
  accessToken: 'item-token',
  itemId: 'item-1',
  metadata: {},
}
const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

function account(type: string, subtype: string | null): PlaidAccount {
  return {
    account_id: `${type}-${subtype}`,
    name: 'Account',
    official_name: null,
    mask: null,
    type,
    subtype,
    balances: {
      available: null,
      current: null,
      limit: null,
      iso_currency_code: null,
      unofficial_currency_code: null,
    },
  }
}

function providerAccount(
  accountId: string,
  name: string,
  type: string,
  subtype: string | null,
  mask: string | null = null
) {
  return {
    account_id: accountId,
    name,
    official_name: null,
    mask,
    type,
    subtype,
    balances: {
      available: null,
      current: 100,
      limit: null,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
    },
  }
}

function providerInstitution(institutionId: string, name: string) {
  return {
    institution_id: institutionId,
    name,
    products: ['auth', 'transactions'],
    country_codes: ['US'],
    routing_numbers: ['021000021'],
    oauth: true,
  }
}

describe('Plaid account selector eligibility', () => {
  it.each([
    ['depository', 'checking', true],
    ['depository', 'savings', true],
    ['depository', 'cash management', true],
    ['depository', 'money market', false],
    ['credit', 'credit card', false],
  ] as const)('filters Auth account %s/%s', (type, subtype, eligible) => {
    expect(plaidAccountMatchesEligibility(account(type, subtype), 'auth')).toBe(eligible)
  })

  it.each([
    ['depository', 'checking', true],
    ['credit', 'credit card', true],
    ['loan', 'student', true],
    ['loan', 'mortgage', true],
    ['loan', 'auto', false],
    ['investment', 'brokerage', false],
  ] as const)('filters Transactions account %s/%s', (type, subtype, eligible) => {
    expect(plaidAccountMatchesEligibility(account(type, subtype), 'transactions')).toBe(eligible)
  })

  it('retains all linked accounts for unfiltered operations', () => {
    expect(plaidAccountMatchesEligibility(account('investment', 'brokerage'), 'all')).toBe(true)
  })
})

describe('listPlaidOptions application composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      credential,
    })
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'member', status: 'active' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
    mocks.decryptCredential.mockResolvedValue(stored)
  })

  it('authorizes, decrypts, filters eligible accounts, forwards cancellation, and audits', async () => {
    mocks.executeProvider.mockResolvedValue({
      accounts: [
        providerAccount('checking-1', 'Everyday Checking', 'depository', 'checking', '1234'),
        providerAccount('market-1', 'Money Market', 'depository', 'money market'),
        providerAccount('credit-1', 'Credit Card', 'credit', 'credit card'),
      ],
      request_id: 'plaid-request-1',
    })
    const signal = new AbortController().signal
    const body = {
      kind: 'accounts' as const,
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      eligibility: 'auth' as const,
    }

    await expect(listPlaidOptions.execute({ principal, input: { body, signal } })).resolves.toEqual(
      {
        options: [{ id: 'checking-1', label: 'Everyday Checking ••••1234' }],
      }
    )

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.getActor).toHaveBeenCalledWith('credential-1', 'user-1')
    expect(mocks.decryptCredential).toHaveBeenCalledWith(credential)
    expect(mocks.executeProvider).toHaveBeenCalledWith({
      body: {
        operation: 'plaid_get_accounts',
        credentialId: 'credential-1',
        input: {},
      },
      credential: stored,
      signal,
    })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        action: 'credential.accessed',
        resourceType: 'credential',
        resourceId: 'credential-1',
        metadata: expect.objectContaining({
          provider: 'plaid-service-account',
          credentialType: 'service_account',
          selectorKind: 'accounts',
          operation: 'credentials.read',
        }),
      })
    )
  })

  it('maps institution search input and results without returning provider metadata', async () => {
    mocks.executeProvider.mockResolvedValue({
      institutions: [providerInstitution('ins_1', 'Example Bank')],
      request_id: 'plaid-request-2',
    })
    const signal = new AbortController().signal
    const body = {
      kind: 'institution_search' as const,
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      query: 'Example',
      country_codes: ['US'] as const,
    }

    await expect(listPlaidOptions.execute({ principal, input: { body, signal } })).resolves.toEqual(
      {
        options: [{ id: 'ins_1', label: 'Example Bank' }],
      }
    )
    expect(mocks.executeProvider).toHaveBeenCalledWith({
      body: {
        operation: 'plaid_search_institutions',
        credentialId: 'credential-1',
        input: { query: 'Example', country_codes: ['US'] },
      },
      credential: stored,
      signal,
    })
  })

  it('maps an institution detail selector through the same custody boundary', async () => {
    mocks.executeProvider.mockResolvedValue({
      institution: providerInstitution('ins_2', 'Detail Bank'),
      request_id: 'plaid-request-3',
    })
    const signal = new AbortController().signal
    const body = {
      kind: 'institution_detail' as const,
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      institution_id: 'ins_2',
      country_codes: ['US', 'CA'] as const,
    }

    await expect(listPlaidOptions.execute({ principal, input: { body, signal } })).resolves.toEqual(
      {
        options: [{ id: 'ins_2', label: 'Detail Bank' }],
      }
    )
    expect(mocks.executeProvider).toHaveBeenCalledWith({
      body: {
        operation: 'plaid_get_institution',
        credentialId: 'credential-1',
        input: { institution_id: 'ins_2', country_codes: ['US', 'CA'] },
      },
      credential: stored,
      signal,
    })
  })

  it('stops before decryption and provider execution when credential access is unavailable', async () => {
    mocks.getActor.mockResolvedValueOnce({
      credential,
      member: null,
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
    const signal = new AbortController().signal
    const body = {
      kind: 'accounts' as const,
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
    }

    await expect(
      listPlaidOptions.execute({ principal, input: { body, signal } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.decryptCredential).not.toHaveBeenCalled()
    expect(mocks.executeProvider).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates provider cancellation and does not audit a failed selector read', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    mocks.executeProvider.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal).toBe(controller.signal)
      controller.abort(abortError)
      throw abortError
    })
    const body = {
      kind: 'accounts' as const,
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
    }

    await expect(
      listPlaidOptions.execute({ principal, input: { body, signal: controller.signal } })
    ).rejects.toBe(abortError)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
