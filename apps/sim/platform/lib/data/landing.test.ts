import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLiveLanding } from '@/platform/lib/data/landing'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

vi.mock('server-only', () => ({}))
vi.mock('@/platform/lib/data/surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/lib/data/surface')>()),
  readOrganizationSurface: vi.fn(),
}))

const ORIGIN = 'https://sim.test'

function organizationWith(platformOrgUi: boolean) {
  return {
    organization: { id: 'org-1' },
    legacyOrigin: ORIGIN,
    platformOrgUi,
    mothershipAvailable: true,
    canBuild: true,
    searchAccess: { memberScoped: true },
    navFlags: { people: true, simLinks: true },
  } as unknown as PlatformOrganization
}

/**
 * The zone's 404 page offers "Return home", which lands here. An organization the rollout has left
 * would loop between this redirect and that 404 if the root sent it anywhere inside the zone.
 */
describe('resolveLiveLanding', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '/org')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN)
  })

  it('sends an organization outside the rollout back to the main app, out of the zone', async () => {
    vi.mocked(readOrganizationSurface).mockResolvedValue({
      status: 'ok',
      organization: organizationWith(false),
    })
    expect(await resolveLiveLanding()).toMatch(/\/o\/org-1$/)
  })

  it('keeps an organization inside the rollout on the zone', async () => {
    vi.mocked(readOrganizationSurface).mockResolvedValue({
      status: 'ok',
      organization: organizationWith(true),
    })
    expect(await resolveLiveLanding()).toBe('/home')
  })

  it('does not gate a standalone zone, which has no main app to return to', async () => {
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '')
    vi.mocked(readOrganizationSurface).mockResolvedValue({
      status: 'ok',
      organization: organizationWith(false),
    })
    expect(await resolveLiveLanding()).toBe('/home')
  })

  it('leaves a viewer it could not resolve to the shell, which owns those states', async () => {
    vi.mocked(readOrganizationSurface).mockResolvedValue({ status: 'unauthenticated' })
    expect(await resolveLiveLanding()).toBe('/home')
  })
})
