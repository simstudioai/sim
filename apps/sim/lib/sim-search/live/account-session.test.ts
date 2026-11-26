/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedLiveAccount } from '@/lib/sim-search/live/accounts'
import type { DocumentLink } from '@/lib/sim-search/live/links'

const { adminVerify, projectLookup } = vi.hoisted(() => ({
  adminVerify: vi.fn(),
  projectLookup: vi.fn(),
}))

vi.mock('@/lib/sim-search/live/provider-rollout', () => ({
  isSearchProviderEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/sim-search/live/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-search/live/http')>()),
  createNativeClient: () => ({ json: projectLookup }),
}))
vi.mock('@/lib/sim-search/live/gitlab-admin', () => ({
  createAdminGitLabSession: vi.fn(async () => ({ verify: adminVerify })),
}))

import { openLiveAccountSession } from '@/lib/sim-search/live/account-session'

const fileLink: DocumentLink = {
  provider: 'gitlab',
  host: 'gitlab.example.com',
  repository: 'private-group/private-project',
  blob: ['feature', 'src', 'a.ts'],
}

async function adminSession() {
  return openLiveAccountSession({
    owner: { organizationId: 'org-1' },
    userId: 'member-1',
    resolved: {
      account: {
        id: 'gitlab-source:s1',
        provider: 'gitlab',
        providerId: 'gitlab',
        displayName: 'GitLab',
        type: 'admin_source',
        scopes: [],
      },
      accessToken: 'admin-token',
      origin: 'https://gitlab.example.com',
      adminSource: { id: 's1', config: {} },
    } satisfies ResolvedLiveAccount,
    policies: {},
    signal: new AbortController().signal,
  })
}

describe('administrator GitLab link location', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectLookup.mockResolvedValue({ id: 7, default_branch: 'release-2026' })
  })

  it('does not name the branch of a project the administrator token sees', async () => {
    adminVerify.mockResolvedValue(false)
    const session = await adminSession()
    await expect(session.locate(fileLink)).resolves.toBeUndefined()
  })

  it('locates a default-branch file only once the reader may open it', async () => {
    adminVerify.mockResolvedValue(false)
    const session = await adminSession()
    await expect(
      session.locate({ ...fileLink, blob: ['release-2026', 'src', 'a.ts'] })
    ).resolves.toBeUndefined()

    adminVerify.mockResolvedValue(true)
    await expect(
      session.locate({ ...fileLink, blob: ['release-2026', 'src', 'a.ts'] })
    ).resolves.toMatchObject({ id: 'src/a.ts', container: '7', kind: 'code' })
  })
})
