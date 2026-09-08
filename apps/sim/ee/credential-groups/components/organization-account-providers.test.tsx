/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import type {
  OrganizationAccountsSettings,
  OrganizationDatabricksSetup,
} from '@/lib/api/contracts/organization-accounts'
import {
  managedSourceParam,
  searchSetupParam,
} from '@/app/workspace/[workspaceId]/search/search-params'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  addAsync: vi.fn(),
  configure: vi.fn(),
  setup: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reset: vi.fn(),
  indexing: vi.fn(),
  sources: [] as SearchSourceSummary[],
  addError: null as Error | null,
  sourcesError: null as Error | null,
  sourceSetup: vi.fn(),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useUpdateOrganizationAccounts: () => ({
    isPending: false,
    mutate: mocks.update,
    reset: mocks.reset,
  }),
  useAddOrganizationAccountMcpProvider: () => ({
    isPending: false,
    mutate: mocks.add,
    mutateAsync: mocks.addAsync,
    reset: mocks.reset,
    error: mocks.addError,
  }),
  useRemoveOrganizationAccountMcpProvider: () => ({
    isPending: false,
    mutate: mocks.remove,
    reset: mocks.reset,
  }),
  useConfigureOrganizationMcp: () => ({ isPending: false, mutateAsync: mocks.configure }),
  useOrganizationDatabricksSetup: mocks.setup,
}))
vi.mock('@/ee/credential-groups/components/slack-managed-users-modal', () => ({
  SlackManagedUsersModal: () => null,
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchSources: () => ({
    data: mocks.sources,
    isPending: false,
    error: mocks.sourcesError,
    isError: Boolean(mocks.sourcesError),
  }),
}))
vi.mock('@/hooks/queries/organization-account-indexing', () => ({
  useUpdateOrganizationAccountIndexing: () => ({ mutate: mocks.indexing, isPending: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-setup', () => ({
  SearchSourceSetup: function SourceSetup(props: unknown) {
    mocks.sourceSetup(props)
    const [type, setType] = useQueryState(searchSetupParam.key, searchSetupParam.parser)
    const [source, setSource] = useQueryState(managedSourceParam.key, managedSourceParam.parser)
    if (type === null && source === null) return null
    return (
      <div role='dialog' aria-label='Source setup'>
        {type ?? source}
        <button
          type='button'
          onClick={() => {
            void setType(null)
            void setSource(null)
          }}
        >
          Close source setup
        </button>
      </div>
    )
  },
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
const source: SearchSourceSummary = {
  knowledgeBaseId: 'kb-1',
  connectorId: 'source-1',
  connectorType: 'gmail',
  sourceDescription: 'Inbox',
  accessMode: 'members',
  availability: 'available',
  enabled: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: true,
  viewerMembership: 'connected',
}

describe('organization provider configuration UI', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    vi.spyOn(toast, 'error').mockImplementation(() => '')
    mocks.setup.mockReturnValue({ data: { server: setupServer }, isPending: false, error: null })
    mocks.configure.mockResolvedValue({ mcpServer: { ...provider, enabled: true } })
    mocks.addAsync.mockResolvedValue({ mcpServer: { ...provider, enabled: true } })
    mocks.add.mockImplementation((_input, { onSuccess }) => onSuccess())
    mocks.update.mockImplementation((_input, { onSuccess }) => onSuccess())
    mocks.sources = []
    mocks.addError = null
    mocks.sourcesError = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function render(
    mcpServers: NonNullable<OrganizationAccountsSettings['credentialGroup']>['mcpServers'] = [
      { ...provider, enabled: true },
    ],
    options: NonNullable<OrganizationAccountsSettings['credentialGroup']>['options'] = []
  ) {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory>
          <OrganizationAccountProviders
            organizationId='org-1'
            group={{ ...group, mcpServers, options }}
            availableProviders={['gmail', 'google-drive']}
            indexingAvailable
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
  async function fill(labelText: string, value: string) {
    const label = Array.from(document.querySelectorAll('label')).find((node) =>
      node.textContent?.startsWith(labelText)
    )
    const input = label?.control
    expect(input).toBeInstanceOf(HTMLInputElement)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows only added providers and searches the remaining catalog', async () => {
    await render([], [gmail])
    expect(container.textContent).toContain('Gmail')
    expect(container.textContent).toContain('Indexing off')
    expect(container.textContent).not.toMatch(/Ready|Setup required/)
    expect(container.textContent).not.toContain('Fireflies')
    expect(container.querySelector('[role="radio"]')).toBeNull()
    await clickButton('Add provider')
    expect(document.querySelector('[aria-label="Add Gmail"]')).toBeNull()
    const search = document.querySelector('[aria-label="Search providers"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'fire'
      )
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('[aria-label="Add Fireflies"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Add Databricks"]')).toBeNull()
  })

  it('adds Fireflies directly without an empty configuration modal', async () => {
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Fireflies')
    expect(mocks.add).toHaveBeenCalledWith(
      { organizationId: 'org-1', connectorId: 'fireflies' },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await render([
      { ...provider, managedConnectorId: 'fireflies', name: 'Fireflies', enabled: true },
    ])
    expect(container.textContent).toContain('Fireflies')
    expect(container.textContent).not.toContain('Configure')
    expect(container.textContent).not.toMatch(/Ready|Setup required/)
  })

  it('opens the same indexing configuration after adding Gmail and when editing later', async () => {
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Gmail')
    expect(mocks.update).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        groupId: 'group-1',
        update: { options: [{ provider: 'gmail', label: 'Gmail', required: false }] },
      },
      expect.any(Object)
    )
    await render([], [gmail])
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Configure Gmail')
    expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe('Off')
    expect(mocks.indexing).not.toHaveBeenCalled()
    await clickButton('Done')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await clickButton('Configure')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Configure Gmail')
  })

  it('opens member source setup from indexing and returns to provider configuration on cancel', async () => {
    await render([], [gmail])
    await clickButton('Configure')
    await clickButton('On')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('gmail')
    expect(mocks.sourceSetup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: { kind: 'organization', organizationId: 'org-1' },
        membersOnly: true,
      })
    )
    expect(mocks.indexing).not.toHaveBeenCalled()
    await clickButton('Close source setup')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Configure Gmail')
    expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe('Off')
  })

  it('edits only the selected member source and keeps unrelated sources out of provider settings', async () => {
    mocks.sources = [
      source,
      {
        ...source,
        connectorId: 'admin-source',
        accessMode: 'admin',
        sourceDescription: 'Central mail',
      },
    ]
    await render([], [gmail])
    expect(container.textContent).toContain('Indexing on')
    await clickButton('Configure')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Central mail')
    await clickButton('Source settings')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('source-1')
    await clickButton('Close source setup')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Configure Gmail')
  })

  it('surfaces an add failure in the catalog and does not open configuration', async () => {
    mocks.add.mockImplementation(() => {})
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Fireflies')
    mocks.addError = new Error('Could not add Fireflies')
    await render([])
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Could not add Fireflies'
    )
    expect(mocks.setup).not.toHaveBeenCalled()
  })

  it('shows indexing load failures without allowing a toggle against unknown source state', async () => {
    mocks.sourcesError = new Error('Could not load indexing settings')
    await render([], [gmail])
    expect(container.textContent).toContain('Indexing status unavailable')
    await clickButton('Configure')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Could not load indexing settings'
    )
    await clickButton('On')
    expect(mocks.indexing).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Configure Gmail')
  })

  it('removes a provider through the row menu using organization scope', async () => {
    mocks.remove.mockImplementation((_input, { onSuccess }) => onSuccess())
    await render()
    const trigger = document.querySelector('[aria-label="Databricks actions"]')
    await act(async () =>
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
    const remove = document.querySelector<HTMLElement>('[role="menuitem"]')
    expect(remove?.textContent).toBe('Remove')
    await act(async () => remove?.click())
    expect(mocks.remove).not.toHaveBeenCalled()
    await clickButton('Remove')
    expect(mocks.remove).toHaveBeenCalledWith(
      { organizationId: 'org-1', connectorId: 'databricks' },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('returns an unfinished Databricks entry to the catalog until its configuration is saved', async () => {
    await render([provider])
    expect(container.textContent).not.toContain('Databricks')
    await clickButton('Add provider')
    await clickButton('Add Databricks')
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.addAsync).not.toHaveBeenCalled()
    expect(mocks.setup).toHaveBeenCalledWith('org-1', true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add Databricks')
    await fill('MCP URL', 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql')
    await fill('OAuth Client ID', 'client-1')
    await clickButton('Add')
    expect(mocks.configure).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'Databricks',
      url: 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql',
      oauthClientId: 'client-1',
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('cancels Databricks setup without adding a provider', async () => {
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Databricks')
    expect(mocks.setup).toHaveBeenCalledWith('org-1', false)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add Databricks')
    const add = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === 'Add'
    )
    expect(add?.disabled).toBe(true)
    await fill('MCP URL', 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql')
    await fill('OAuth Client ID', 'client-1')
    await clickButton('Cancel')
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.addAsync).not.toHaveBeenCalled()
    expect(mocks.configure).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).not.toContain('Databricks')
  })

  it('adds Databricks with its complete configuration in one organization-scoped request', async () => {
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Databricks')
    expect(mocks.addAsync).not.toHaveBeenCalled()
    await fill('Name', ' Analytics ')
    await fill('MCP URL', 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql')
    await fill('OAuth Client ID', ' client-1 ')
    await fill('OAuth Client Secret', 'secret-1')
    await clickButton('Add')
    expect(mocks.addAsync).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      connectorId: 'databricks',
      name: 'Analytics',
      url: 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql',
      oauthClientId: 'client-1',
      oauthClientSecret: 'secret-1',
    })
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.configure).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps Databricks configuration open after validation fails and allows correction', async () => {
    mocks.addAsync.mockRejectedValueOnce(new Error('Enter a valid Databricks MCP URL'))
    await render([])
    await clickButton('Add provider')
    await clickButton('Add Databricks')
    await fill('MCP URL', 'https://invalid.example.com/mcp')
    await fill('OAuth Client ID', 'client-1')
    await clickButton('Add')
    expect(toast.error).toHaveBeenCalledWith('Enter a valid Databricks MCP URL')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add Databricks')
    expect(container.textContent).not.toContain('Databricks')
    await fill('MCP URL', 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql')
    await clickButton('Add')
    expect(mocks.addAsync).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('loads existing settings for Configure and preserves a saved secret left blank', async () => {
    mocks.setup.mockReturnValue({
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

  it('shows setup read failures and disables saving', async () => {
    mocks.setup.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('Organization administrator access is required'),
    })
    await render()
    await clickButton('Configure')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Organization administrator access is required'
    )
    const save = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === 'Save'
    )
    expect(save?.disabled).toBe(true)
    expect(mocks.configure).not.toHaveBeenCalled()
  })
})
