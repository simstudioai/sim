/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSource } = vi.hoisted(() => ({ fetchSource: vi.fn() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: fetchSource,
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({ VALIDATE_RETRY_OPTIONS: { maxRetries: 0 } }))

import { discoverGitLabPermissionPolicy } from '@/connectors/gitlab/permission-policy'

const config = { host: 'gitlab.example.com:8443', project: 'team/project' }
const project = {
  id: 42,
  namespace: { id: 20, kind: 'group' },
  shared_with_groups: [{ group_id: 30 }],
}
let version: string
let settings: Record<string, unknown>
let groups: Map<number, Record<string, unknown>>
let requests: URL[]
let failure: string | undefined

function group(id: number, parent_id: number | null = null): Record<string, unknown> {
  return { id, parent_id, shared_with_groups: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  version = '18.7.0-ee'
  settings = { external_authorization_service_enabled: false, admin_mode: false }
  groups = new Map([
    [20, group(20, 10)],
    [10, group(10)],
    [30, group(30, 40)],
    [40, group(40)],
  ])
  requests = []
  failure = undefined
  fetchSource.mockImplementation(
    async (
      raw: string,
      options: { headers: Record<string, string> },
      retry: { maxResponseBytes: number }
    ) => {
      const url = new URL(raw)
      requests.push(url)
      expect(url.origin).toBe('https://gitlab.example.com:8443')
      expect(options.headers['PRIVATE-TOKEN']).toBe('admin-token')
      expect(retry.maxResponseBytes).toBe(1024 * 1024)
      if (url.pathname === failure) return new Response(null, { status: 403 })
      if (url.pathname === '/api/v4/version') return Response.json({ version })
      if (url.pathname === '/api/v4/application/settings') return Response.json(settings)
      const match = url.pathname.match(/^\/api\/v4\/groups\/(\d+)$/)
      if (match) {
        expect(url.searchParams.get('with_projects')).toBe('false')
        return Response.json(groups.get(Number(match[1])))
      }
      throw new Error(`Unrecognized fixture request ${url.pathname}`)
    }
  )
})

const discover = () => discoverGitLabPermissionPolicy('admin-token', config, project)

describe('GitLab conditional source permission discovery', () => {
  it('inspects project, invited and ancestor group policy using bounded administrator reads', async () => {
    await expect(discover()).resolves.toEqual({
      version: '18.7.0-ee',
      implicitAdmin: true,
      plannerCanReadCode: true,
    })
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/v4/version',
      '/api/v4/application/settings',
      '/api/v4/groups/30',
      '/api/v4/groups/20',
      '/api/v4/groups/40',
      '/api/v4/groups/10',
    ])
  })

  it('accepts omitted unavailable paid-feature fields but never assumes absent Admin Mode is disabled', async () => {
    settings.admin_mode = undefined
    expect((await discover()).implicitAdmin).toBe(false)
    settings.admin_mode = true
    expect((await discover()).implicitAdmin).toBe(false)
    settings.admin_mode = 'false'
    await expect(discover()).rejects.toThrow('Admin Mode setting could not be verified')
  })

  it('uses the documented 18.7 Planner code boundary and rejects incomplete legacy member semantics', async () => {
    version = '18.6.9-ee'
    expect((await discover()).plannerCanReadCode).toBe(false)
    version = '17.4.0'
    expect((await discover()).plannerCanReadCode).toBe(false)
    version = '17.3.9-ee'
    await expect(discover()).rejects.toThrow('17.4 or later')
    version = '18.7.0-pre'
    await expect(discover()).rejects.toThrow('prerelease')
  })

  it('rejects enabled or unknown external authorization instead of assuming roles suffice', async () => {
    settings.external_authorization_service_enabled = true
    await expect(discover()).rejects.toThrow('external authorization service')
    settings.external_authorization_service_enabled = undefined
    await expect(discover()).rejects.toThrow('external authorization setting could not be verified')
  })

  it('rejects IP restrictions inherited through the project or an invited group', async () => {
    groups.get(10)!.ip_restriction_ranges = '10.0.0.0/8'
    await expect(discover()).rejects.toThrow('restricts access by IP')
    groups.get(10)!.ip_restriction_ranges = null
    groups.get(40)!.ip_restriction_ranges = '192.0.2.0/24'
    await expect(discover()).rejects.toThrow('restricts access by IP')
  })

  it('rejects download-ban enforcement even if automatic bans were subsequently disabled', async () => {
    groups.get(10)!.unique_project_download_limit = 10
    groups.get(10)!.auto_ban_user_on_excessive_projects_download = false
    await expect(discover()).rejects.toThrow('namespace download bans')
    groups.get(10)!.unique_project_download_limit = 0
    settings.auto_ban_user_on_excessive_projects_download = true
    await expect(discover()).rejects.toThrow('automatic repository-download bans')
  })

  it('rejects session-specific group step-up authentication', async () => {
    groups.get(10)!.step_up_auth_required_oauth_provider = 'openid_connect'
    await expect(discover()).rejects.toThrow('step-up authentication')
  })

  it('fails clearly when administrator policy discovery cannot read a related group or settings', async () => {
    failure = '/api/v4/groups/40'
    await expect(discover()).rejects.toThrow('policy discovery failed (403)')
    failure = '/api/v4/application/settings'
    await expect(discover()).rejects.toThrow('admin_mode scopes')
  })

  it('requires canonical project and group topology and detects corrupt ancestry', async () => {
    await expect(discoverGitLabPermissionPolicy('admin-token', config, { id: 42 })).rejects.toThrow(
      'namespace could not be verified'
    )
    groups.get(20)!.shared_with_groups = undefined
    await expect(discover()).rejects.toThrow('shared group policy')
    groups.set(20, group(20, 10))
    groups.get(10)!.parent_id = 20
    await expect(discover()).rejects.toThrow('ancestry contains a cycle')
  })

  it('handles personal namespaces and rechecks policy on every discovery', async () => {
    const personal = { id: 42, namespace: { id: 7, kind: 'user' }, shared_with_groups: [] }
    expect(
      (await discoverGitLabPermissionPolicy('admin-token', config, personal)).implicitAdmin
    ).toBe(true)
    expect(requests).toHaveLength(2)
    settings.external_authorization_service_enabled = true
    await expect(discoverGitLabPermissionPolicy('admin-token', config, personal)).rejects.toThrow(
      'external authorization service'
    )
  })
})
