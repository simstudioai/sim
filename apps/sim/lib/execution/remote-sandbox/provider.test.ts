/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboundRoutingError } from '@/lib/core/network/routing'

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  create: vi.fn(),
  startBuild: vi.fn(),
}))

vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  getSelectedSandboxProviderId: () => 'e2b',
}))
vi.mock('@/lib/core/network/config.server', () => ({
  resolveOutboundRoute: mocks.route,
}))
vi.mock('@/lib/execution/remote-sandbox/e2b', () => ({
  e2bProvider: { id: 'e2b', create: mocks.create, images: { startBuild: mocks.startBuild } },
}))
vi.mock('@/lib/execution/remote-sandbox/daytona', () => ({
  daytonaProvider: { id: 'daytona' },
}))

import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'

describe('sandbox provider routing boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.route.mockRejectedValue(new OutboundRoutingError('MISSING_SCOPE'))
  })

  it('builds deployment-shared images without requiring an organization scope', async () => {
    const image = { imageRef: 'image', buildId: 'build' }
    mocks.startBuild.mockResolvedValue(image)

    await expect(
      resolveProvider().images!.startBuild(
        { language: 'python', dependencies: [], cliTools: [], systemPackages: [] },
        'spec-hash',
        {
          rendererRevision: 1,
          generation: 1,
          imageRefPrefix: 'image:',
          baseImageRef: 'base',
        }
      )
    ).resolves.toBe(image)
    expect(mocks.startBuild).toHaveBeenCalledOnce()
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it('still requires a resolved route before creating an execution sandbox', async () => {
    await expect(resolveProvider().create('code')).rejects.toMatchObject({ code: 'MISSING_SCOPE' })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
