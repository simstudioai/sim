/**
 * @vitest-environment node
 *
 * Which workspace an organization's Integrations page lists. Failure modes: an external
 * collaborator on another team's workspace, sent here from `/workspace/<id>/integrations` (the
 * workspace opens in their own organization's shell), silently switched to their first workspace
 * because the page kept only workspaces the organization owns; and a workspace that does not open in
 * this organization swapped for another instead of answered as not found. Which organization a
 * workspace opens in is proven against PostgreSQL in `personal-organization-shell.integration.ts`.
 */
import { beforeEach, expect, it, vi } from 'vitest'

const { shellOrganizations, viewerWorkspaces } = vi.hoisted(() => ({
  /** The organization each workspace organization's workspaces open in for the viewer. */
  shellOrganizations: new Map<string | null, string | null>(),
  viewerWorkspaces: { current: [] as { id: string; organizationId: string | null }[] },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/platform/lib/data/server-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/lib/data/server-read')>()),
  requireSessionViewer: async () => ({
    principal: { kind: 'session', userId: 'viewer', sessionId: 'session-1' },
    activeOrganizationId: 'org-a',
  }),
}))
vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: async () =>
    viewerWorkspaces.current.map((workspace) => ({
      workspace: { ...workspace, name: workspace.id },
      permissionType: 'write',
      viaOrgAdmin: false,
    })),
}))
vi.mock('@/lib/workspaces/visits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaces/visits')>()),
  listRecentWorkspaceIds: async () => [],
}))
vi.mock('@/lib/workspaces/application/workspace-shell', () => ({
  readWorkspaceShellResolver: async () => (workspaceOrganizationId: string | null) =>
    shellOrganizations.get(workspaceOrganizationId) ?? null,
}))
vi.mock('@/lib/catalog/application/list-workspace-apps', () => ({
  listWorkspaceApps: { execute: async () => ({ policy: {}, oauthAvailability: [] }) },
}))
vi.mock('@/lib/integrations/access', () => ({ resolveIntegrationAccess: () => 'available' }))

import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { resolveIntegrationsSection } from '@/platform/lib/data/workspace-integrations'

/** Organization A, without member-scoped accounts, so the page lists only workspace apps. */
const ORGANIZATION_A = {
  organization: { id: 'org-a', name: 'A', slug: 'a', logo: null, memberCount: 2 },
  routePrefix: '/o/org-a',
  viewer: {
    role: 'member',
    isAdmin: false,
    canInviteMembers: false,
    canConnectSearchIntegrations: false,
    canUsePersonalApiKeys: false,
    canUseSearchMcp: false,
  },
  mothershipAvailable: true,
  searchAccess: { sourceMirrored: false, memberScoped: false },
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
  navFlags: {
    people: false,
    simLinks: false,
    benchmark: false,
    platformAdmin: false,
    anonymous: false,
  },
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
} satisfies PlatformOrganization

beforeEach(() => {
  // The viewer belongs to A and C. B is a team they only collaborate with, so B's workspaces open
  // in A, their landing organization, as organization-less ones do; C's open in C.
  shellOrganizations.clear()
  shellOrganizations.set('org-a', 'org-a')
  shellOrganizations.set('org-b', 'org-a')
  shellOrganizations.set('org-c', 'org-c')
  shellOrganizations.set(null, 'org-a')
  viewerWorkspaces.current = [
    { id: 'ws-own', organizationId: 'org-a' },
    { id: 'ws-collaborator', organizationId: 'org-b' },
    { id: 'ws-elsewhere', organizationId: 'org-c' },
    { id: 'ws-personal', organizationId: null },
  ]
})

it('lists every workspace that opens in this organization, including a collaborator’s', async () => {
  const section = await resolveIntegrationsSection(ORGANIZATION_A, undefined, {})
  if (section.kind !== 'render') throw new Error(`Expected a page, got ${section.kind}`)
  expect(section.workspaces.map((workspace) => workspace.id)).toEqual([
    'ws-own',
    'ws-collaborator',
    'ws-personal',
  ])
})

it('opens the collaborator’s workspace a `/workspace` link hands over', async () => {
  const section = await resolveIntegrationsSection(ORGANIZATION_A, undefined, {
    workspace: 'ws-collaborator',
    oauth: 'connected',
  })
  expect(section).toMatchObject({ kind: 'render', workspaceId: 'ws-collaborator' })
})

it('answers a workspace that opens in another organization as not found, never another one', async () => {
  const section = await resolveIntegrationsSection(ORGANIZATION_A, undefined, {
    workspace: 'ws-elsewhere',
  })
  expect(section).toEqual({ kind: 'notFound' })
})
