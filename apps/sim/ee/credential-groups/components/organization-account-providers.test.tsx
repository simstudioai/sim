/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import {
  organizationAccountsQueriesMock,
  organizationAccountsQueriesMockFns,
} from '@sim/testing/mocks/organization-accounts-queries.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OrganizationAccountsSettings,
  OrganizationDatabricksSetup,
} from '@/lib/api/contracts/organization-accounts'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  addAsync: vi.fn(),
  configure: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reset: vi.fn(),
  slack: vi.fn<(props: unknown) => null>(() => null),
  addError: null as Error | null,
  updatePending: false,
}))
vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
vi.mock('@/ee/credential-groups/components/slack-managed-users-modal', () => ({
  SlackManagedUsersModal: mocks.slack,
}))
vi.mock('@/ee/credential-groups/components/organization-account-people', () => ({
  OrganizationAccountPeople: () => null,
}))
vi.mock('@/ee/credential-groups/components/organization-account-workspace-access', () => ({
  OrganizationAccountWorkspaceAccess: () => <div data-testid='workspace-access'>Workspaces</div>,
}))

import { OrganizationAccountProviders } from '@/ee/credential-groups/components/organization-account-providers'

const group: NonNullable<OrganizationAccountsSettings['credentialGroup']> = {
  id: 'group-1',
  organizationId: 'org-1',
  workspaceId: null,
  name: 'Connected accounts',
  description: null,
  options: [],
  mcpServers: [],
  status: 'active',
  createdAt: '2026-09-07T00:00:00Z',
  updatedAt: '2026-09-07T00:00:00Z',
}
const setupServer: OrganizationDatabricksSetup['server'] = {
  id: 'server-1',
  name: 'Databricks',
  url: null,
  oauthClientId: null,
  hasOauthClientSecret: false,
  enabled: false,
}
const provider = {
  id: 'server-1',
  name: 'Databricks',
  description: null,
  authType: 'oauth',
  enabled: false,
  managedConnectorId: 'databricks' as const,
}
const gmail: NonNullable<OrganizationAccountsSettings['credentialGroup']>['options'][number] = {
  id: 'gmail-option',
  provider: 'gmail',
  label: 'Gmail',
  required: false,
  status: 'active',
  configurationStatus: 'ready',
}
const github: NonNullable<OrganizationAccountsSettings['credentialGroup']>['options'][number] = {
  ...gmail,
  id: 'github-option',
  provider: 'github-repositories',
  label: 'Engineering GitHub',
  required: true,
}

describe('organization provider configuration UI', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    vi.spyOn(toast, 'error').mockImplementation(() => '')
    organizationAccountsQueriesMockFns.mockUseEnsureOrganizationAccounts.mockReturnValue({
      isPending: false,
      error: null,
    })
    organizationAccountsQueriesMockFns.mockUseUpdateOrganizationAccounts.mockImplementation(() => ({
      isPending: mocks.updatePending,
      mutate: mocks.update,
      reset: mocks.reset,
    }))
    organizationAccountsQueriesMockFns.mockUseAddOrganizationAccountMcpProvider.mockImplementation(
      () => ({
        isPending: false,
        mutate: mocks.add,
        mutateAsync: mocks.addAsync,
        reset: mocks.reset,
        error: mocks.addError,
      })
    )
    organizationAccountsQueriesMockFns.mockUseRemoveOrganizationAccountMcpProvider.mockReturnValue({
      isPending: false,
      mutate: mocks.remove,
      reset: mocks.reset,
    })
    organizationAccountsQueriesMockFns.mockUseConfigureOrganizationMcp.mockReturnValue({
      isPending: false,
      mutateAsync: mocks.configure,
    })
    organizationAccountsQueriesMockFns.mockUseOrganizationDatabricksSetup.mockReturnValue({
      data: { server: setupServer },
      isPending: false,
      error: null,
    })
    mocks.configure.mockResolvedValue({ mcpServer: { ...provider, enabled: true } })
    mocks.addAsync.mockResolvedValue({ mcpServer: { ...provider, enabled: true } })
    mocks.add.mockImplementation((_input, { onSuccess }) => onSuccess())
    mocks.update.mockImplementation((_input, { onSuccess }) => onSuccess())
    mocks.addError = null
    mocks.updatePending = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function render(
    mcpServers: NonNullable<OrganizationAccountsSettings['credentialGroup']>['mcpServers'] = [
      { ...provider, enabled: true },
    ],
    options: NonNullable<OrganizationAccountsSettings['credentialGroup']>['options'] = [],
    searchParams = ''
  ) {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <OrganizationAccountProviders
            organizationId='org-1'
            group={{ ...group, mcpServers, options }}
            availableProviders={['gmail', 'google-drive']}
          />
        </NuqsTestingAdapter>
      )
    )
  }
  async function clickButton(text: string) {
    const button = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === text || node.getAttribute('aria-label') === text
    )
    expect(button).toBeDefined()
    expect(button?.disabled).toBe(false)
    await act(async () => button?.click())
  }

  it('updates current provider configurations while preserving their IDs and saved settings', async () => {
    const slack = {
      ...gmail,
      id: 'slack-option',
      provider: 'slack' as const,
      label: 'Company Slack',
      slackBotCredentialId: 'bot-1',
      requiredScopes: ['search:read'],
    }
    await render([], [github, gmail, slack])
    await clickButton('Update configurations')
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      {
        organizationId: 'org-1',
        groupId: 'group-1',
        update: {
          options: [
            {
              id: github.id,
              provider: github.provider,
              label: github.label,
              required: github.required,
            },
            {
              id: gmail.id,
              provider: gmail.provider,
              label: gmail.label,
              required: gmail.required,
            },
            {
              id: slack.id,
              provider: slack.provider,
              label: slack.label,
              required: slack.required,
              slackBotCredentialId: slack.slackBotCredentialId,
            },
          ],
        },
      },
      expect.any(Object)
    )
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Provider configurations updated')
  })

  it('loads existing settings for Configure and preserves a saved secret left blank', async () => {
    organizationAccountsQueriesMockFns.mockUseOrganizationDatabricksSetup.mockReturnValue({
      data: {
        server: {
          ...setupServer,
          enabled: true,
          url: 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql',
          oauthClientId: 'existing-client',
          hasOauthClientSecret: true,
        },
      },
      isPending: false,
      error: null,
    })
    await render([{ ...provider, enabled: true }])
    await clickButton('Configure')
    const secret = document.querySelector<HTMLInputElement>(
      'input[placeholder="Leave blank to keep the current secret"]'
    )
    expect(secret).not.toBeNull()
    expect(secret?.value).toBe('')
    await clickButton('Save')
    expect(mocks.configure.mock.calls[0][0]).not.toHaveProperty('oauthClientSecret')
    expect(mocks.configure.mock.calls[0][0]).not.toHaveProperty('workspaceId')
  })
})
