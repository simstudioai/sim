/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOrganizationAccounts } from '@/lib/api/contracts/organization-accounts'

const mocks = vi.hoisted(() => ({ accounts: vi.fn(), manager: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useWorkspaceOrganizationAccounts: mocks.accounts,
}))
vi.mock('@/ee/credential-groups/components/organization-connected-accounts', () => ({
  OrganizationConnectedAccounts: mocks.manager,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { CredentialGroupsSettings } from '@/ee/credential-groups/components/credential-groups-settings'

let root: Root
let container: HTMLDivElement
const status: WorkspaceOrganizationAccounts = {
  organizationId: 'host-org',
  organizationName: 'Host organization',
  available: true,
  allowed: false,
  canManage: true,
  providers: [],
  mcpProviders: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.accounts.mockReturnValue({ data: status, error: null })
  mocks.manager.mockReturnValue(<div>Providers, People, Workspace access</div>)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () => root.render(<CredentialGroupsSettings workspaceId='workspace-1' />))
}

describe('Connected accounts in normal settings', () => {
  it('embeds the full manager for the workspace’s canonical organization, including before workspace access is granted', async () => {
    await render()
    expect(mocks.accounts).toHaveBeenCalledWith('workspace-1')
    expect(mocks.manager).toHaveBeenCalledWith({ organizationId: 'host-org' }, undefined)
    expect(container.textContent).toContain('Providers, People, Workspace access')
  })

  it('keeps sharing status for workspace viewers without organization admin rights', async () => {
    mocks.accounts.mockReturnValue({ data: { ...status, canManage: false }, error: null })
    await render()
    expect(mocks.manager).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Access not granted')
    expect(container.textContent).toContain('Host organization')
  })

  it('does not mount the manager when the organization feature is disabled', async () => {
    mocks.accounts.mockReturnValue({ data: { ...status, available: false }, error: null })
    await render()
    expect(mocks.manager).not.toHaveBeenCalled()
  })

  it('does not mount the manager in a workspace without an organization', async () => {
    mocks.accounts.mockReturnValue({
      data: {
        ...status,
        organizationId: null,
        organizationName: null,
        available: false,
        canManage: false,
      },
      error: null,
    })
    await render()
    expect(mocks.manager).not.toHaveBeenCalled()
    expect(container.textContent).toContain('must belong to an organization')
  })
})
