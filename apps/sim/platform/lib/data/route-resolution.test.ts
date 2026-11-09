/**
 * @vitest-environment node
 *
 * Failure modes: a member with nothing on the organization surface sent from a `/workspace` URL to
 * workspace Settings, itself a `/workspace` URL, forever; a gate of one organization applied to
 * another whose id shares its prefix; Home with a resource painting before it hands off to the
 * chat; a bare Search URL loading without the viewer's remembered mode; a legacy workspace URL
 * reaching a renamed Settings section through a second redirect, or disclosing the organization of
 * a workspace the viewer cannot open; and a malformed path throwing instead of rendering.
 */
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({}) }))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/platform/lib/data/shell-scope', () => ({
  readWorkspaceShellOrganizationId: vi.fn(),
}))

import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  followProductRoute,
  productLocation,
  type RouteContext,
  resolveProductRedirect,
} from '@/platform/lib/data/route-resolution'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

interface Access {
  mothershipAvailable?: boolean
  canBuild?: boolean
  memberScoped?: boolean
  people?: boolean
  simLinks?: boolean
}

function organization({
  mothershipAvailable = true,
  canBuild = true,
  memberScoped = true,
  people = false,
  simLinks = false,
}: Access = {}): PlatformOrganization {
  return {
    organization: { id: 'org-1', name: 'Org', slug: 'org', logo: null, memberCount: 1 },
    routePrefix: '/o/org-1',
    viewer: {
      role: 'member',
      isAdmin: false,
      canInviteMembers: false,
      canConnectSearchIntegrations: false,
      canUsePersonalApiKeys: false,
      canUseSearchMcp: false,
    },
    mothershipAvailable,
    canBuild,
    searchAccess: { sourceMirrored: memberScoped, memberScoped },
    connectedAccountsAvailable: false,
    settingsFeatures: {
      billingEnabled: true,
      hasEnterprisePlan: false,
      governanceActive: false,
      hosted: true,
      selfHosted: {},
      personal: false,
    },
    deployment: {
      hosted: true,
      billingEnabled: true,
      chatEnabled: true,
      azureConfigured: false,
      cohereConfigured: false,
      features: {
        accessControl: false,
        auditLogs: false,
        customBlocks: false,
        dataDrains: false,
        dataRetention: false,
        inbox: false,
        sandboxes: false,
        scim: false,
        sessionPolicies: false,
        sso: false,
        usageMonitoring: false,
        whitelabeling: false,
      },
    },
    navFlags: { people, simLinks, benchmark: false, platformAdmin: false, anonymous: false },
    featureFlags: {
      dashboards: false,
      'workflow-tests': false,
      changelog: false,
      'mothership-model-selector': false,
      'mothership-computer-use': false,
      'mothership-plan-mode': false,
      'mothership-memory-spaces': false,
      projects: false,
    },
    settingsSections: [],
  }
}

/** A member whose permission group denies `copilot.use`, with no Search, People or Links. */
const NO_SURFACE: Access = { mothershipAvailable: false, memberScoped: false }

function resolve(href: string, context: Partial<RouteContext> & { access?: Access } = {}) {
  const { access, ...rest } = context
  const url = new URL(href, 'https://app.sim.test')
  return resolveProductRedirect(
    { pathname: url.pathname, query: url.searchParams },
    {
      organization: organization(access),
      rememberedSearchMode: null,
      workspaceOrganizationId: null,
      ...rest,
    }
  )
}

describe('resolveProductRedirect', () => {
  it.each([
    '/workspace',
    '/workspace?redirect=settings',
    '/workspace/ws-1/workflows',
    '/workspace/ws-1/settings/teammates',
  ])('renders %s for a member with nothing on the organization surface', (href) => {
    expect(resolve(href, { access: NO_SURFACE, workspaceOrganizationId: 'org-1' })).toBeNull()
  })

  it.each(['/o/org-1', '/o/org-1/home', '/o/org-1/people', '/o/org-1/settings/members'])(
    'sends %s to workspace Settings for a member with nothing on the organization surface',
    (href) => {
      expect(resolve(href, { access: NO_SURFACE })).toEqual({
        href: WORKSPACE_SETTINGS_PATH,
        permanent: false,
      })
    }
  )

  it('leaves another organization whose id shares the prefix to its own gates', () => {
    expect(resolve('/o/org-10/home', { access: NO_SURFACE })).toBeNull()
  })

  it.each([
    [{}, '/o/org-1/home'],
    [{ canBuild: false }, '/o/org-1/search'],
    [{ canBuild: false, memberScoped: false, people: true }, '/o/org-1/people'],
    [{ canBuild: false, memberScoped: false, simLinks: true }, '/o/org-1/settings/links'],
  ])('opens the organization root for %o on %s', (access, expected) => {
    expect(resolve('/o/org-1', { access })?.href).toBe(expected)
  })

  it('hands Home with a resource to the new chat, keeping the query', () => {
    expect(resolve('/o/org-1/home?resource=file-1&q=x')?.href).toBe(
      '/o/org-1/chat?resource=file-1&q=x'
    )
    expect(resolve('/o/org-1/home')).toBeNull()
    expect(resolve('/o/org-1/home', { access: { canBuild: false } })?.href).toBe('/o/org-1/search')
  })

  it('pins a bare Search URL to the remembered mode and leaves a named one', () => {
    expect(resolve('/o/org-1/search', { rememberedSearchMode: 'assistant' })?.href).toBe(
      '/o/org-1/search?mode=assistant'
    )
    expect(resolve('/o/org-1/search?mode=search')).toBeNull()
    expect(resolve('/o/org-1/search', { access: { memberScoped: false } })?.href).toBe(
      '/o/org-1/settings'
    )
    expect(
      resolve('/o/org-1/search/chat/chat-1', { access: { mothershipAvailable: false } })
    ).toEqual({ href: '/o/org-1/search', permanent: false })
  })

  it.each([
    ['/o/org-1/settings/subscription', '/o/org-1/settings/billing'],
    ['/o/org-1/settings/privacy?tab=x', '/o/org-1/settings/general?tab=x&view=privacy'],
  ])('sends the renamed Settings section %s to %s permanently', (href, expected) => {
    expect(resolve(href)).toEqual({ href: expected, permanent: true })
    expect(resolve('/o/org-1/settings/subscription/extra')).toBeNull()
  })

  it('opens a workspace on its home tab', () => {
    expect(resolve('/workspace/ws-1')?.href).toBe('/workspace/ws-1/workflows')
  })

  it('sends a legacy workspace Settings alias to its section in one permanent hop', () => {
    expect(
      resolve('/workspace/ws-1/settings/subscription', { workspaceOrganizationId: 'org-2' })
    ).toEqual({ href: '/o/org-2/settings/billing', permanent: true })
  })

  it('leaves a legacy URL of a workspace the viewer cannot open to its page', () => {
    expect(resolve('/workspace/ws-1/settings/subscription')).toBeNull()
  })

  it('renders a path whose encoding is malformed', () => {
    expect(resolve('/workspace/%E0%A4%A/settings/team')).toBeNull()
  })
})

describe('followProductRoute', () => {
  it('answers not found for a workspace the viewer cannot open, before any redirect', async () => {
    vi.mocked(readWorkspaceShellOrganizationId).mockResolvedValue(null)
    await expect(
      followProductRoute(
        organization({ mothershipAvailable: false }),
        productLocation('/workspace/ws-outside/home', {})
      )
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })

  it('opens a workspace the viewer can open', async () => {
    vi.mocked(readWorkspaceShellOrganizationId).mockResolvedValue('org-1')
    await expect(
      followProductRoute(
        organization({ mothershipAvailable: false }),
        productLocation('/workspace/ws-1/workflows', {})
      )
    ).resolves.toBeUndefined()
  })
})
