/**
 * @vitest-environment node
 *
 * Failure modes: a member with nothing on the organization surface sent from a `/workspace` URL to
 * the workspace entry, itself a `/workspace` URL, forever; the organization gate, its landing and
 * the workspace entry's hand-off disagreeing, so a viewer bounces between them; the gate locking a
 * member out of Settings or dropping the query; a gate of one organization applied to
 * another whose id shares its prefix; Home with a resource painting before it hands off to the
 * chat; a chat page answering a member without chat differently from Home; a bare Search URL loading without the viewer's remembered mode; a legacy workspace URL
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

import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  blockedWorkspaceEntryHref,
  type RouteContext,
  resolveProductRedirect,
} from '@/platform/lib/data/route-resolution'

interface Access {
  mothershipAvailable?: boolean
  memberScoped?: boolean
  people?: boolean
  simLinks?: boolean
}

function organization({
  mothershipAvailable = true,
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
      invitationsDisabled: false,
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
      'platform-preview': false,
    },
    settingsSections: [],
  }
}

/** A member without chat (`copilot.use` denied, or chat off), with no Search, People or Links. */
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

  it.each(['/o/org-1', '/o/org-1/home', '/o/org-1/people'])(
    'sends %s to the workspace entry for a member with nothing on the organization surface',
    (href) => {
      expect(resolve(href, { access: NO_SURFACE })).toEqual({
        href: WORKSPACES_PATH,
        permanent: false,
      })
    }
  )

  it('keeps the query when the gate sends a member to the workspace entry', () => {
    expect(resolve('/o/org-1/home?redirect=settings', { access: NO_SURFACE })?.href).toBe(
      `${WORKSPACES_PATH}?redirect=settings`
    )
  })

  it.each(['/o/org-1/settings', '/o/org-1/settings/general', '/o/org-1/settings/billing'])(
    'leaves %s to Settings for a member with nothing on the organization surface',
    (href) => {
      expect(resolve(href, { access: NO_SURFACE })).toBeNull()
    }
  )

  it('leaves another organization whose id shares the prefix to its own gates', () => {
    expect(resolve('/o/org-10/home', { access: NO_SURFACE })).toBeNull()
  })

  it.each([
    [{}, '/o/org-1/home'],
    [{ memberScoped: false }, '/o/org-1/home'],
    [{ mothershipAvailable: false }, '/o/org-1/search'],
    [{ mothershipAvailable: false, memberScoped: false, people: true }, '/o/org-1/people'],
    [
      { mothershipAvailable: false, memberScoped: false, simLinks: true },
      '/o/org-1/settings/links',
    ],
  ])('opens the organization root for %o on %s', (access, expected) => {
    expect(resolve('/o/org-1', { access })?.href).toBe(expected)
  })

  it('hands Home with a resource to the new chat, keeping the query', () => {
    expect(resolve('/o/org-1/home?resource=file-1&q=x')?.href).toBe(
      '/o/org-1/chat?resource=file-1&q=x'
    )
    expect(resolve('/o/org-1/home')).toBeNull()
    expect(resolve('/o/org-1/home', { access: { memberScoped: false } })).toBeNull()
    expect(resolve('/o/org-1/home', { access: { mothershipAvailable: false } })?.href).toBe(
      '/o/org-1/search'
    )
    expect(
      resolve('/o/org-1/home', {
        access: { mothershipAvailable: false, memberScoped: false, people: true },
      })?.href
    ).toBe(WORKSPACES_PATH)
  })

  it('sends a member without chat from a chat page where Home sends them', () => {
    for (const href of ['/o/org-1/chat', '/o/org-1/chat/chat-1']) {
      expect(resolve(href)).toBeNull()
      expect(resolve(href, { access: { mothershipAvailable: false } })?.href).toBe(
        '/o/org-1/search'
      )
      expect(
        resolve(href, { access: { mothershipAvailable: false, memberScoped: false, people: true } })
          ?.href
      ).toBe(WORKSPACES_PATH)
    }
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

  it('opens a workspace on its home tab, keeping the query', () => {
    expect(resolve('/workspace/ws-1')?.href).toBe('/workspace/ws-1/workflows')
    expect(resolve('/workspace/ws-1?resource=file-1')?.href).toBe(
      '/workspace/ws-1/workflows?resource=file-1'
    )
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

describe('the organization gate, its landing and the workspace entry', () => {
  const both = [false, true]
  const viewers = both.flatMap((chat) =>
    both.flatMap((memberScoped) =>
      both.flatMap((people) =>
        both.flatMap((simLinks) =>
          both.flatMap((hasWorkspaces) =>
            both.map((canCreate) => ({
              chat,
              memberScoped,
              people,
              simLinks,
              hasWorkspaces,
              canCreate,
            }))
          )
        )
      )
    )
  )
  const starts = [
    '/o/org-1',
    '/o/org-1/home',
    '/o/org-1/search',
    '/o/org-1/people',
    '/o/org-1/chat',
    '/o/org-1/chat/chat-1',
    '/o/org-1/settings',
    WORKSPACES_PATH,
    `${WORKSPACES_PATH}?redirect=settings`,
  ]

  it.each(viewers)('never sends a viewer around in a circle: %o', (viewer) => {
    const surface = organization({
      mothershipAvailable: viewer.chat,
      memberScoped: viewer.memberScoped,
      people: viewer.people,
      simLinks: viewer.simLinks,
    })
    /** The bare `/workspace` entry: a workspace opens (or is created), else the hand-off decides. */
    const enterWorkspace = (url: URL) =>
      viewer.hasWorkspaces || viewer.canCreate
        ? null
        : blockedWorkspaceEntryHref(surface, url.searchParams.get('redirect'))
    for (const start of starts) {
      const visited: string[] = []
      let href: string | null = start
      while (href) {
        expect(visited, `${start} returns to ${href}`).not.toContain(href)
        visited.push(href)
        const url = new URL(href, 'https://app.sim.test')
        href =
          url.pathname === WORKSPACES_PATH
            ? enterWorkspace(url)
            : (resolveProductRedirect(
                { pathname: url.pathname, query: url.searchParams },
                { organization: surface, rememberedSearchMode: null, workspaceOrganizationId: null }
              )?.href ?? null)
      }
    }
  })
})
