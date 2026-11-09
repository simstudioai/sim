import { describe, expect, it, vi } from 'vitest'
import { resolveLiveLanding } from '@/platform/lib/data/landing'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

vi.mock('server-only', () => ({}))
vi.mock('@/platform/lib/data/surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/lib/data/surface')>()),
  readOrganizationSurface: vi.fn(),
}))

describe('resolveLiveLanding', () => {
  it('leaves a viewer it could not resolve to the shell, which owns those states', async () => {
    vi.mocked(readOrganizationSurface).mockResolvedValue({ status: 'unauthenticated' })
    expect(await resolveLiveLanding()).toBe('/home')
  })
})
