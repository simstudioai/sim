/**
 * @vitest-environment jsdom
 *
 * The live Integrations index over one workspace. Failure modes: the app list painting before the
 * workspace's credentials load, so every connected app shows as Available and then jumps; a Skills
 * tab offered with no workspace to hold a skill; tabs and secrets links the viewer's permission
 * group withholds in Settings (MCP tools, skills, the Secrets section) offered here anyway; and the
 * MCPs tab listing servers Search manages for a connected account or managed connector; and
 * Create skill or Connect MCP offered to a read-only member, whom the server refuses; and an open
 * skill mounting its own discard dialog beside the shell's, so leaving a draft stacks two.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import { IntegrationsRoute } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-route'
import type { IntegrationsWorkspaceScope } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-directory'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/platform/lib/data/permission-policy'
import { requestSettingsLeave, useSettingsDirtyStore } from '@/platform/lib/data/settings-guard'
import type { WorkspaceApp } from '@/platform/lib/integrations/workspace-catalog'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'

const WORKSPACE = { id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f', name: 'Acme' }

const GMAIL: WorkspaceApp = {
  id: 'gmail',
  type: 'gmail_v2',
  slug: 'gmail',
  name: 'Gmail',
  description: 'Send and read Gmail messages',
  category: 'Email',
  docsUrl: 'https://docs.sim.test/gmail',
  access: 'available',
  credentialProviders: ['google-email'],
  connections: [],
  instanceLabels: {},
}

const IN_WORKSPACE: IntegrationsWorkspaceScope = {
  workspaces: [WORKSPACE],
  workspaceId: WORKSPACE.id,
  apps: [GMAIL],
}

const GMAIL_CREDENTIAL = {
  id: 'cred-1',
  workspaceId: WORKSPACE.id,
  type: 'oauth',
  displayName: 'Support inbox',
  description: null,
  unredacted: false,
  providerId: 'google-email',
  accountId: null,
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'viewer',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

function mcpServer(id: string, extra: Record<string, string> = {}) {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name: id,
    transport: 'streamable-http',
    url: `https://${id}.example/mcp`,
    enabled: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  }
}

let restrictions: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG> = {}
let credentialsHeld: Promise<void> = Promise.resolve()
let mcpServers: ReturnType<typeof mcpServer>[] = []
let viewerPermission: 'read' | 'write' | 'admin' = 'write'
let container: HTMLDivElement
let root: Root

async function respond(url: URL) {
  if (url.pathname === '/api/permission-groups/user')
    return Response.json({
      permissionGroupId: null,
      groupName: null,
      config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restrictions },
      entitled: true,
      organizationId: 'org',
      isOrgAdmin: false,
    })
  if (url.pathname === '/api/credentials') {
    await credentialsHeld
    return Response.json({ credentials: [GMAIL_CREDENTIAL] })
  }
  if (url.pathname === `/api/workspaces/${WORKSPACE.id}/permissions`)
    return Response.json({
      users: [],
      total: 0,
      viewer: { userId: 'viewer', isAdmin: false, permissionType: viewerPermission },
    })
  if (url.pathname === '/api/skills') return Response.json({ data: [] })
  if (url.pathname === '/api/mcp/servers')
    return Response.json({ success: true, data: { servers: mcpServers } })
  return Response.json({ error: 'Not found' }, { status: 404 })
}

beforeEach(() => {
  stubResizeObserver()
  stubDialog()
  restrictions = {}
  credentialsHeld = Promise.resolve()
  mcpServers = []
  viewerPermission = 'write'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      respond(new URL(String(input instanceof Request ? input.url : input), 'https://sim.test'))
    )
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null } },
    isPending: false,
    error: null,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useSettingsDirtyStore.getState().reset()
})

async function settle() {
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

async function render(search: string, workspace: IntegrationsWorkspaceScope = IN_WORKSPACE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter searchParams={search}>
          <SurfaceScopeProvider routePrefix='/o/org'>
            <SettingsLeaveGuard />
            <IntegrationsRoute organizationId='org' member={false} workspace={workspace} />
          </SurfaceScopeProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  await settle()
}

/** The paths of the links in a labelled section or navigation. */
function linksIn(label: string) {
  const region = container.querySelector(`[aria-label="${label}"]`)
  return [...(region?.querySelectorAll('a[href]') ?? [])].map(
    (link) => new URL(link.getAttribute('href') ?? '', 'https://sim.test')
  )
}

function offeredTabs() {
  return [...container.querySelectorAll('a[href]')].flatMap((link) => {
    const tab = new URL(link.getAttribute('href') ?? '', 'https://sim.test').searchParams.get('tab')
    return tab ? [tab] : []
  })
}

it('paints no app list until the workspace’s credentials load, then lists the app connected', async () => {
  let release = () => {}
  credentialsHeld = new Promise((resolve) => {
    release = resolve
  })
  await render('')
  expect(container.querySelector('section[aria-label="Available"]')).toBeNull()

  release()
  await settle()
  expect(linksIn('Connected').map((url) => url.pathname)).toEqual(['/o/org/integrations/gmail'])
  expect(linksIn('Available')).toEqual([])
})

it('offers no Skills or MCPs tab without a workspace', async () => {
  await render('', { workspaces: [], workspaceId: null, apps: [] })
  expect(offeredTabs()).not.toContain('skills')
  expect(offeredTabs()).not.toContain('mcps')
})

it('withholds the tabs and secrets links the viewer’s permission group withholds in Settings', async () => {
  restrictions = { disableMcpTools: true, disableSkills: true, hideSecretsTab: true }
  await render('?tab=credentials')
  expect(offeredTabs()).not.toContain('skills')
  expect(offeredTabs()).not.toContain('mcps')
  const links = [...container.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'))
  expect(links.filter((href) => href?.includes('settings/secrets'))).toEqual([])
})

it('offers the tabs and secrets links a permission group leaves open', async () => {
  await render('?tab=credentials')
  expect(offeredTabs()).toEqual(expect.arrayContaining(['skills', 'mcps']))
  const links = [...container.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'))
  expect(links.some((href) => href?.includes('settings/secrets'))).toBe(true)
})

it('lists only the workspace’s own MCP servers, not those Search manages', async () => {
  mcpServers = [
    mcpServer('own'),
    mcpServer('account', { credentialGroupId: 'group-1' }),
    mcpServer('connector', { managedConnectorId: 'granola' }),
  ]
  await render('?tab=mcps')
  expect(linksIn('Shared').map((url) => url.searchParams.get('mcpServerId'))).toEqual(['own'])
})

function buttonNamed(name: string) {
  return [...container.querySelectorAll('button, a')].find(
    (element) => element.textContent?.trim() === name
  )
}

it('offers Create skill to a member who can write', async () => {
  await render('?tab=skills')
  expect(buttonNamed('Create skill')).toBeDefined()
})

it('offers Connect MCP to a member who can write', async () => {
  await render('?tab=mcps')
  expect(buttonNamed('Connect MCP')).toBeDefined()
})

it('offers no Create skill to a read-only member', async () => {
  viewerPermission = 'read'
  await render('?tab=skills')
  expect(offeredTabs()).toContain('skills')
  expect(buttonNamed('Create skill')).toBeUndefined()
})

it('offers no Connect MCP to a read-only member', async () => {
  viewerPermission = 'read'
  await render('?tab=mcps')
  expect(offeredTabs()).toContain('mcps')
  expect(buttonNamed('Connect MCP')).toBeUndefined()
})

it('opens a new skill read-only for a read-only member', async () => {
  viewerPermission = 'read'
  await render('?tab=skills&resource=new')
  expect(container.querySelector('form[aria-label="Skill details"]')).not.toBeNull()
  expect(buttonNamed('Create skill')).toBeUndefined()
  expect(buttonNamed('Import')).toBeUndefined()
})

it('opens a new skill editable for a member who can write', async () => {
  await render('?tab=skills&resource=new')
  expect(buttonNamed('Create skill')).toBeDefined()
})

it('asks once before leaving an unsaved skill, with the shell’s one discard dialog', async () => {
  await render('?tab=skills&resource=new')
  const name = container.querySelector<HTMLInputElement>('form[aria-label="Skill details"] input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(name, 'triage')
    name?.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => requestSettingsLeave(() => undefined))
  const prompts = [...document.querySelectorAll('dialog[open]')].filter((dialog) =>
    dialog.textContent?.includes('Unsaved changes')
  )
  expect(prompts).toHaveLength(1)
})
