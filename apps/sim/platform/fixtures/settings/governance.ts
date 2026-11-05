import { auditFixture } from '@/platform/fixtures/settings/audit'
import { retentionFixture } from '@/platform/fixtures/settings/retention'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import {
  type OrganizationNetwork,
  type OrganizationSessionPolicy,
  updateOrganizationSessionPolicyBodySchema,
} from '@/platform/lib/data/security'

interface PreviewSecurity {
  policy: OrganizationSessionPolicy['configured']
  otherSessions: number
}

const security = new WeakMap<SettingsFixtureState, PreviewSecurity>()
const networks = {
  empty: { mode: 'direct' },
  full: { mode: 'gateway', publicIps: ['192.0.2.16', '198.51.100.24'] },
  stress: { mode: 'blocked' },
} satisfies Record<SettingsFixtureState['scenario'], OrganizationNetwork>

function sessionState(state: SettingsFixtureState): PreviewSecurity {
  const existing = security.get(state)
  if (existing) return existing
  const session = {
    policy:
      state.scenario === 'empty'
        ? { maxSessionHours: null, idleTimeoutHours: null }
        : { maxSessionHours: 720, idleTimeoutHours: 48 },
    otherSessions: state.scenario === 'empty' ? 0 : state.scenario === 'full' ? 4 : 172,
  }
  security.set(state, session)
  return session
}

export async function governanceFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const scope = `/api/organizations/${state.organizationId}/`
  if (!path.startsWith(scope)) return auditFixture(request, path, state)
  const key = path.slice(scope.length)
  if (key === 'session-policy' && (request.method === 'GET' || request.method === 'PUT')) {
    const session = sessionState(state)
    if (request.method === 'PUT') {
      const result = updateOrganizationSessionPolicyBodySchema.safeParse(await request.json())
      if (!result.success) {
        return Response.json({ error: result.error.issues[0].message }, { status: 400 })
      }
      session.policy = result.data
    }
    return { success: true, data: { isEnterprise: true, configured: session.policy } }
  }
  if (key === 'sessions/revoke' && request.method === 'POST') {
    const session = sessionState(state)
    const revokedSessions = session.otherSessions
    session.otherSessions = 0
    return { success: true, data: { revokedSessions } }
  }
  if (key === 'network' && request.method === 'GET') return networks[state.scenario]
  if (key === 'data-retention') return retentionFixture(request, state)
}
