import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  mcpServers,
  resourcePolicy,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  credentialGroupsOrganizationSetupMock,
  credentialGroupsOrganizationSetupMockFns,
} from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import {
  credentialGroupsProvidersMock,
  credentialGroupsProvidersMockFns,
} from '@sim/testing/mocks/credential-groups-providers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/provider-registry', () => credentialGroupsProvidersMock)
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
vi.mock('@/lib/credential-groups/provider-configuration', () => ({
  decryptCredentialGroupProviderConfiguration: async () => ({}),
}))

import {
  addOrganizationAccountProvider,
  ensureWorkspaceAccountsGroup,
} from '@/lib/credential-groups/service'

const mocks = {
  policy: vi.fn(),
  organizationSetup: credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup,
}
credentialGroupsProvidersMockFns.mockGetCredentialGroupProviderAdapter.mockReturnValue({
  getPolicy: mocks.policy,
})

const option: CredentialGroupOptionConfig = {
  id: 'drive-option',
  provider: 'google-drive',
  label: 'Google Drive',
  authorizationAppId: 'existing-app',
  requiredScopes: ['existing-scope'],
  scopeVersion: 42,
  required: true,
  status: 'active',
}
const group = {
  id: 'group',
  organizationId: 'org',
  workspaceId: null,
  publicId: 'public',
  name: 'Connected accounts',
  description: null,
  options: [option],
  status: 'active',
  createdBy: 'admin',
  encryptedProviderConfiguration: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const coda = {
  id: 'coda',
  credentialGroupId: 'group',
  name: 'Coda',
  description: null,
  authType: 'oauth',
  enabled: true,
  managedConnectorId: 'coda',
}
const jira = { provider: 'jira', label: 'Jira' } as const

beforeEach(() => {
  resetDbChainMock()
  mocks.organizationSetup.mockResolvedValue(undefined)
  mocks.policy.mockResolvedValue({
    authorizationAppId: 'jira-app',
    requiredScopes: ['read:jira-work'],
    scopeVersion: 1,
  })
})

function queueExisting(options = group.options) {
  queueTableRows(credentialGroup, [{ ...group, options }])
  queueTableRows(mcpServers, [coda])
  queueTableRows(credentialGroup, [{ ...group, options }])
}

describe('explicit organization Search sign-in setup', () => {
  it('appends Jira to the existing container without changing Coda, prior options, credentials or grants', async () => {
    queueExisting()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: group.id }])
    await expect(addOrganizationAccountProvider('org', 'admin', jira, db)).resolves.toEqual({
      groupId: 'group',
      changed: true,
    })
    expect(mocks.organizationSetup).toHaveBeenCalledWith('org', 'group', db)
    expect(dbChainMockFns.update).toHaveBeenCalledExactlyOnceWith(credentialGroup)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      options: [
        option,
        expect.objectContaining({
          ...jira,
          required: false,
          status: 'active',
          authorizationAppId: 'jira-app',
        }),
      ],
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(mcpServers)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(resourcePolicy)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(credential)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('leaves the same linked-container auto-provision guard intact', async () => {
    queueTableRows(credentialGroup, [group])
    queueTableRows(mcpServers, [coda])
    await expect(
      ensureWorkspaceAccountsGroup(
        { kind: 'organization', organizationId: 'org' },
        'admin',
        { ...jira, required: false },
        db
      )
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('has MCP access'),
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('is idempotent and does not refresh or replace an existing provider', async () => {
    queueExisting([{ ...option, provider: 'jira' }])
    await expect(addOrganizationAccountProvider('org', 'admin', jira, db)).resolves.toEqual({
      groupId: 'group',
      changed: false,
    })
    expect(mocks.policy).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses a disabled option without reactivating it', async () => {
    queueExisting([{ ...option, provider: 'jira', status: 'disabled' }])
    await expect(addOrganizationAccountProvider('org', 'admin', jira, db)).rejects.toMatchObject({
      code: 'validation',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses a disabled group without creating a replacement', async () => {
    queueTableRows(credentialGroup, [{ ...group, status: 'disabled' }])
    await expect(addOrganizationAccountProvider('org', 'admin', jira, db)).rejects.toMatchObject({
      code: 'validation',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not bypass the organization policy migration gate', async () => {
    queueExisting()
    mocks.organizationSetup.mockRejectedValueOnce(new Error('Migration review required'))
    await expect(addOrganizationAccountProvider('org', 'admin', jira, db)).rejects.toThrow(
      'Migration review required'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
