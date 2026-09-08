/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  read: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  authenticateCredentialGroupEnrollment: mocks.authenticate,
}))
vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  readPublicCredentialGroupEnrollment: { execute: mocks.read },
}))
vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mocks.rateLimit,
}))
vi.mock('@/lib/credential-groups/providers', () => ({
  CREDENTIAL_GROUP_PROVIDER_IDS: ['confluence', 'slack'],
  CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS: ['confluence'],
  getCredentialGroupProviderService: (provider: string) => ({
    providerId: provider,
    name: provider === 'confluence' ? 'Confluence' : 'Slack',
    icon: () => null,
  }),
}))
vi.mock('@/lib/credential-groups/managed-mcp-connector-icons', () => ({
  getManagedMcpConnectorIcon: () => () => null,
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
  SupportFooter: () => null,
}))
vi.mock('@/app/(landing)/components/logo-shell', () => ({
  LogoShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/app/credential-groups/enroll/[token]/oauth-toast', () => ({
  CredentialGroupOAuthToast: ({ message }: { message: string }) => (
    <div role='status'>{message}</div>
  ),
}))

import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import CredentialGroupEnrollmentPage from '@/app/credential-groups/enroll/[token]/page'

const principal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'canonical-workspace',
  credentialGroupId: 'accounts',
  enrollmentId: 'enrollment',
  email: 'member@example.test',
  invitationTokenHash: 'hash',
} as const
let enrollment: PublicCredentialGroupEnrollment

async function render(searchParams: Record<string, string | string[]> = {}) {
  const page = await CredentialGroupEnrollmentPage({
    params: Promise.resolve({ token: 'invitation' }),
    searchParams: Promise.resolve(searchParams),
  })
  document.body.innerHTML = renderToStaticMarkup(page)
}

function oauthLinks() {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).filter((link) =>
    link.getAttribute('href')?.includes('/oauth/')
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'member', email: 'member@example.test', emailVerified: true },
    session: { id: 'session-1' },
  })
  mocks.authenticate.mockResolvedValue(principal)
  mocks.rateLimit.mockResolvedValue(null)
  enrollment = {
    inviterName: 'Admin',
    workspaceName: 'Company',
    credentialGroupName: 'Accounts',
    status: 'in_progress',
    options: [
      {
        id: 'site-one',
        label: 'First Confluence site',
        provider: 'confluence',
        status: 'active',
        required: false,
        connections: [],
      },
      {
        id: 'site-two',
        label: 'Second Confluence site',
        provider: 'confluence',
        status: 'active',
        required: false,
        connections: [],
      },
      {
        id: 'slack',
        label: 'Slack',
        provider: 'slack',
        status: 'active',
        required: true,
        connections: [],
      },
    ],
    mcpServers: [
      {
        id: 'mcp-one',
        name: 'Unrelated MCP',
        description: null,
        managedConnectorId: 'linear',
        connection: null,
      },
    ],
  }
  mocks.read.mockImplementation(async () => ({ enrollment }))
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('focused Search enrollment', () => {
  it('retains the generic invitation choices and Submit without Search context', async () => {
    await render()
    expect(oauthLinks()).toHaveLength(3)
    expect(document.body.textContent).toContain('Unrelated MCP')
    expect(document.querySelector('form')?.getAttribute('action')).toBe(
      '/api/credential-groups/enroll/invitation/complete'
    )
    expect(document.querySelector('button')?.textContent).toBe('Submit')
    expect(document.body.textContent).not.toContain('Return to Search')
    expect(document.body.textContent).not.toContain('Setup guide')
    expect(mocks.read).toHaveBeenCalledWith({ principal, input: {} })
  })

  it('shows only the exact requested option and derives the return workspace from the principal', async () => {
    await render({ returnTo: 'search', optionId: 'site-two', workspaceId: 'other-workspace' })
    expect(document.querySelector('h1')?.textContent).toBe('Connect your Confluence account')
    expect(document.body.textContent).toContain('Second Confluence site')
    expect(document.body.textContent).not.toContain('First Confluence site')
    expect(document.body.textContent).not.toContain('Slack')
    expect(document.body.textContent).not.toContain('Unrelated MCP')
    expect(oauthLinks().map((link) => link.getAttribute('href'))).toEqual([
      '/api/credential-groups/enroll/invitation/oauth/site-two?returnTo=search',
    ])
    expect(document.querySelector('form')).toBeNull()
    expect(
      Array.from(document.querySelectorAll('a'))
        .find((link) => link.textContent === 'Return to Search')
        ?.getAttribute('href')
    ).toBe('/workspace/canonical-workspace/search')
    const guide = Array.from(document.querySelectorAll('a')).find(
      (link) => link.textContent === 'Setup guide'
    )
    expect(guide?.getAttribute('href')).toBe('https://docs.sim.ai/search/confluence')
    expect(guide?.getAttribute('target')).toBe('_blank')
    expect(guide?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(mocks.read).toHaveBeenCalledWith({ principal, input: { optionId: 'site-two' } })
  })

  it.each(['missing', '', 'site-two', ['site-one', 'site-two']])(
    'does not substitute a different account when focus is unusable: %s',
    async (optionId) => {
      enrollment.options[1]!.status = 'disabled'
      await render({
        returnTo: 'search',
        optionId: Array.isArray(optionId) ? [...optionId] : optionId,
      })
      expect(document.body.textContent).toContain('Ask a workspace admin')
      expect(oauthLinks()).toHaveLength(0)
      expect(document.querySelector('form')).toBeNull()
      expect(document.body.textContent).toContain('Return to Search')
    }
  )

  it('reports provider configuration failures with a clear path back to Search', async () => {
    mocks.read.mockRejectedValue(
      new CredentialGroupProviderConfigurationError('Slack configuration missing')
    )
    await render({ returnTo: 'search', optionId: 'slack' })
    expect(document.body.textContent).toContain('Connection unavailable')
    expect(document.body.textContent).toContain('Ask a workspace admin')
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/canonical-workspace/search'
    )
  })

  it('shows Connected from current credential state without requiring generic completion', async () => {
    enrollment.options[1]!.connections = [
      {
        email: principal.email,
        displayName: null,
        avatarUrl: null,
        status: 'connected',
        grantedAt: '2026-09-05T12:00:00Z',
      },
    ]
    await render({ returnTo: 'search', optionId: 'site-two' })
    expect(document.body.textContent).toContain(`${principal.email} · Connected`)
    expect(document.querySelector('h1')?.textContent).toBe('Confluence connected')
    expect(oauthLinks()).toHaveLength(0)
    expect(document.querySelector('form')).toBeNull()
    expect(document.body.textContent).toContain('Return to Search')
  })

  it('does not treat a success query marker as a connected account', async () => {
    await render({
      returnTo: 'search',
      optionId: 'site-two',
      connected: 'site-two',
      mcp: 'connected',
      mcpServerId: 'mcp-one',
    })
    expect(oauthLinks()[0]?.textContent).toBe('Connect')
    expect(document.body.textContent).toContain('Not connected')
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('keeps the same focused Reconnect action after canceled authorization', async () => {
    enrollment.options[1]!.connections = [
      {
        email: principal.email,
        displayName: null,
        avatarUrl: null,
        status: 'needs_reauth',
        grantedAt: '2026-09-05T12:00:00Z',
      },
    ]
    await render({ returnTo: 'search', optionId: 'site-two', oauth: 'denied' })
    expect(oauthLinks()).toHaveLength(1)
    expect(oauthLinks()[0]?.textContent).toBe('Reconnect')
    expect(oauthLinks()[0]?.getAttribute('href')).toContain('/site-two?returnTo=search')
  })

  it('does not resolve enrollment metadata or trust a return workspace after authentication fails', async () => {
    mocks.authenticate.mockResolvedValue(null)
    await render({ returnTo: 'search', optionId: 'site-two', workspaceId: 'other-workspace' })
    expect(document.body.textContent).toContain('Invitation unavailable')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(document.querySelector('a')).toBeNull()
  })
})
