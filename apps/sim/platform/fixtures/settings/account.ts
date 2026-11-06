import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

const APPS_PATH = '/api/users/me/authorized-apps'
const ACCOUNTS_PATH = '/api/users/me/organization-accounts'
const APP_NAMES = ['Operations desktop', 'Research assistant', 'Reporting console'] as const
const PROVIDERS = ['google-email', 'github', 'google-calendar'] as const

function page<T>(items: T[], params: URLSearchParams, size: number) {
  const offset = Number(params.get('cursor') ?? 0)
  const end = offset + size
  return { rows: items.slice(offset, end), nextCursor: end < items.length ? String(end) : null }
}

/** Serves the personally authorized grants, connections and deletion consent for one settings session. */
export async function accountFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  if (
    request.method === 'DELETE' &&
    (path.startsWith(`${APPS_PATH}/`) || path.startsWith(`${ACCOUNTS_PATH}/`))
  ) {
    state.records.set(path, true)
    return { success: true }
  }
  if (request.method !== 'GET') return undefined
  const params = new URL(request.url).searchParams
  if (path === APPS_PATH) {
    const filter = (params.get('search') ?? '').trim().toLowerCase()
    const count =
      state.scenario === 'stress' ? 58 : state.scenario === 'full' ? APP_NAMES.length : 0
    const apps = Array.from({ length: count }, (_, index) => ({
      clientId: `client-${index + 1}`,
      name: `${APP_NAMES[index % APP_NAMES.length]}${index < APP_NAMES.length ? '' : ` ${index + 1}`}`,
      scopes: [index % 2 ? 'search:read' : 'api:read'],
      authorizedAt: new Date(Date.UTC(2026, 9, 13 - index)).toISOString(),
    })).filter(
      (app) =>
        !state.records.has(`${APPS_PATH}/${app.clientId}`) &&
        app.name.toLowerCase().includes(filter)
    )
    const result = page(apps, params, 25)
    return { apps: result.rows, nextCursor: result.nextCursor }
  }
  if (path === ACCOUNTS_PATH) {
    const count =
      state.scenario === 'stress' ? 66 : state.scenario === 'full' ? PROVIDERS.length : 0
    const accounts = Array.from({ length: count }, (_, index) => {
      const credentialId = `personal-grant-${index + 1}`
      const revoked = state.records.has(`${ACCOUNTS_PATH}/${credentialId}`) || index % 3 === 2
      return {
        credentialId,
        providerId: PROVIDERS[index % PROVIDERS.length],
        displayName: state.general.profile?.email ?? 'emir@example.com',
        organizationId: index % 2 === 0 ? state.organizationId : 'field-team',
        organizationName: index % 2 === 0 ? 'Sim Enterprise' : 'Field team',
        kind: 'oauth',
        status: revoked ? 'revoked' : index % 3 === 1 ? 'needs_reauth' : 'active',
        enrollmentStatus: revoked ? 'revoked' : 'completed',
        canReconnect: !revoked,
      }
    })
    const result = page(accounts, params, 50)
    return { accounts: result.rows, nextCursor: result.nextCursor }
  }
  if (path === '/api/users/me/deletion') {
    return {
      plan: {
        blockers:
          state.scenario === 'stress'
            ? [
                {
                  code: 'shared_workspace',
                  message:
                    'Transfer ownership of Workspace to another administrator before deleting your account.',
                },
              ]
            : [],
        workspacesToDelete:
          state.scenario === 'empty' ? [] : [{ id: 'personal', name: 'Personal projects' }],
        workspacesToTransfer: state.scenario === 'empty' ? [] : [settingsWorkspaces[0]],
      },
    }
  }
  return undefined
}
