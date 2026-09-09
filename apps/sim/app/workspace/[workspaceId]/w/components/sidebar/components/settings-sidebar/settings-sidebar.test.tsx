/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentShape, WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/settings/general',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/components/settings/settings-intent-link', () => ({
  SettingsIntentLink: ({
    href,
    children,
    className,
    'aria-current': current,
  }: ComponentProps<'a'>) => (
    <a href={href} className={className} aria-current={current}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-1', role: 'user' } } }),
}))
vi.mock('@/lib/billing/client', () => ({
  getSubscriptionAccessState: (...args: Parameters<typeof getSubscriptionAccessState>) =>
    getSubscriptionAccessState(...args),
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => deployment,
  getDeploymentShape: () => deployment,
}))
vi.mock('@/lib/desktop', () => ({
  hasDesktopSettings: () => false,
  hasBrowserAgent: () => false,
  hasTerminal: () => false,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => hostContext,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: true }),
}))
vi.mock('@/ee/sso/hooks/sso', () => ({
  useSSOProviders: () => ({ data: { providers: [] }, isLoading: false }),
}))
vi.mock('@/ee/workspace-forking/hooks/use-forking-available', () => ({
  useForkingAvailable: () => false,
}))
vi.mock('@/hooks/queries/general-settings', () => ({
  useGeneralSettings: () => ({ data: { superUserModeEnabled: false } }),
}))
vi.mock('@/hooks/queries/inbox', () => ({
  useInboxConfig: () => ({ data: { entitled: true } }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ config: {} }),
}))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({
    popSettingsReturnUrl: (fallback: string) => fallback,
    getSettingsHref: ({ section }: { section: string }) =>
      `/workspace/workspace-1/settings/${section}`,
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-sidebar/settings-query-warmers',
  () => ({ warmSettingsSectionQuery: vi.fn() })
)

import { SettingsSidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-sidebar/settings-sidebar'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const deployment: DeploymentShape = {
  hosted: true,
  billingEnabled: true,
  chatEnabled: true,
  azureConfigured: false,
  cohereConfigured: false,
  features: {
    accessControl: true,
    auditLogs: true,
    customBlocks: true,
    dataDrains: true,
    dataRetention: true,
    inbox: true,
    sandboxes: true,
    scim: true,
    sessionPolicies: true,
    sso: true,
    usageMonitoring: true,
    whitelabeling: true,
  },
}

function makeHostContext(
  role: 'admin' | 'member' | 'external',
  organizationSearch?: boolean
): WorkspaceHostContext {
  return {
    workspace: {
      id: 'workspace-1',
      name: 'Team workspace',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
    },
    hostOrganizationId: 'host-org',
    ownerBilling: {
      plan: 'enterprise',
      status: 'active',
      isPaid: true,
      isPro: false,
      isTeam: false,
      isEnterprise: true,
      isOrgScoped: true,
      organizationId: 'host-org',
      billingInterval: 'month',
      billingBlocked: false,
      billingBlockedReason: null,
    },
    viewer: {
      permission: 'admin',
      isHostOrganizationAdmin: role === 'admin',
      isHostOrganizationMember: role !== 'external',
      organizationRole: role === 'external' ? null : role,
    },
    features: {
      credentialGroups: true,
      organizationSearch,
      knowledgeMemberAccess: true,
      knowledgeSourceMirroredAccess: true,
    },
    deployment,
  }
}

let hostContext: WorkspaceHostContext
let queryClient: QueryClient
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  hostContext = makeHostContext('admin', false)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useSettingsDirtyStore.getState().reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
  useSettingsDirtyStore.getState().reset()
})

function renderSidebar() {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SettingsSidebar />
      </QueryClientProvider>
    )
  })
}

function workspaceLink(section: string) {
  return container.querySelector<HTMLAnchorElement>(
    `a[href="/workspace/workspace-1/settings/${section}"]`
  )
}

function expectWorkspaceLinks() {
  expect(workspaceLink('general')).toHaveTextContent('General')
  expect(workspaceLink('teammates')).toHaveTextContent('Teammates')
  expect(workspaceLink('secrets')).toHaveTextContent('Secrets')
}

describe('workspace SettingsSidebar organization rollout', () => {
  it.each([false, undefined])(
    'keeps organization settings in the workspace for an admin when rollout is %s',
    (enabled) => {
      hostContext = makeHostContext('admin', enabled)
      renderSidebar()

      expect(workspaceLink('organization')).toHaveTextContent('Members')
      expect(workspaceLink('billing')).toHaveTextContent('Subscription')
      expect(workspaceLink('usage')).toHaveTextContent('Usage tracking')
      expect(workspaceLink('sso')).toHaveTextContent('Single sign-on')
      expect(container.querySelector('a[href^="/o/"]')).toBeNull()
      expectWorkspaceLinks()
    }
  )

  it('keeps existing settings when an older host context has no features object', () => {
    hostContext.features = undefined
    renderSidebar()

    expect(workspaceLink('organization')).toHaveTextContent('Members')
    expect(workspaceLink('billing')).toHaveTextContent('Subscription')
    expect(container.querySelector('a[href^="/o/"]')).toBeNull()
    expectWorkspaceLinks()
  })

  it.each(['admin', 'member'] as const)(
    'replaces organization entries with one host organization link for a %s when enabled',
    (role) => {
      hostContext = makeHostContext(role, true)
      renderSidebar()

      const links = container.querySelectorAll<HTMLAnchorElement>('a[href^="/o/"]')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAttribute('href', '/o/host-org/settings/members')
      expect(links[0]).toHaveTextContent('Organization')
      for (const section of ['organization', 'billing', 'usage', 'sso']) {
        expect(workspaceLink(section)).toBeNull()
      }
      expectWorkspaceLinks()
    }
  )

  it('keeps the member roster while preserving admin-only settings restrictions when disabled', () => {
    hostContext = makeHostContext('member', false)
    renderSidebar()

    expect(workspaceLink('organization')).toHaveTextContent('Members')
    for (const section of ['billing', 'usage', 'sso']) {
      expect(workspaceLink(section)).toBeNull()
    }
    expect(container.querySelector('a[href^="/o/"]')).toBeNull()
    expectWorkspaceLinks()
  })

  it('preserves plan restrictions without hiding the billing recovery link when disabled', () => {
    hostContext.ownerBilling.billingBlocked = true
    hostContext.ownerBilling.billingBlockedReason = 'payment_failed'
    renderSidebar()

    expect(workspaceLink('billing')).toHaveTextContent('Subscription')
    for (const section of ['organization', 'usage', 'sso']) {
      expect(workspaceLink(section)).toBeNull()
    }
    expectWorkspaceLinks()
  })

  it.each([false, true])(
    'keeps external workspace admins out of organization settings when rollout is %s',
    (enabled) => {
      hostContext = makeHostContext('external', enabled)
      renderSidebar()

      expect(container.querySelector('a[href^="/o/"]')).toBeNull()
      for (const section of ['organization', 'billing', 'usage', 'sso']) {
        expect(workspaceLink(section)).toBeNull()
      }
      expectWorkspaceLinks()
    }
  )
})
