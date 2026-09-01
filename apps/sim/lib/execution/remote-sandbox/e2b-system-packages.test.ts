/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'

const { mockBuildInBackground, mockBuilder, mockEnv } = vi.hoisted(() => {
  const builder = {
    fromTemplate: vi.fn(),
    makeDir: vi.fn(),
    runCmd: vi.fn(),
    setEnvs: vi.fn(),
  }
  return {
    mockBuildInBackground: vi.fn(),
    mockBuilder: builder,
    mockEnv: {
      E2B_API_KEY: 'test-key',
      E2B_DOMAIN: undefined,
      E2B_FUNCTION_TEMPLATE_ID: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
      E2B_FUNCTION_TEMPLATE_GENERATION: '1785792000000',
    },
  }
})

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

vi.mock('@e2b/code-interpreter', () => {
  const Template = Object.assign(() => mockBuilder, {
    buildInBackground: mockBuildInBackground,
  })
  return { Template }
})

import {
  E2B_SANDBOX_MATERIALIZER_REVISION,
  e2bMaterializationGeneration,
  e2bProvider,
  sandboxImageName,
} from '@/lib/execution/remote-sandbox/e2b'

const CHILD_BUILD_ID = '7d9d12d6-5f2a-44df-9cc2-a20203f3813b'

describe('E2B system package image layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuilder.fromTemplate.mockReturnValue(mockBuilder)
    mockBuilder.makeDir.mockReturnValue(mockBuilder)
    mockBuilder.runCmd.mockReturnValue(mockBuilder)
    mockBuilder.setEnvs.mockReturnValue(mockBuilder)
    mockBuildInBackground.mockResolvedValue({
      buildId: CHILD_BUILD_ID,
      templateId: 'template-1',
    })
  })

  it('runs apt update/install as root before building a system-package-only template', async () => {
    const materialization = e2bProvider.images?.materialization('abcdef0123456789abcdef0123456789')
    if (!materialization) throw new Error('E2B image materialization is unavailable')
    const build = await e2bProvider.images?.startBuild(
      {
        language: CodeLanguage.Python,
        dependencies: [],
        cliTools: [],
        systemPackages: ['jq', 'curl=7.88.1-10+deb12u8'],
      },
      'abcdef0123456789abcdef0123456789',
      materialization
    )

    expect(mockBuilder.fromTemplate).toHaveBeenCalledWith(
      'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479'
    )
    expect(mockBuilder.runCmd).toHaveBeenCalledWith(
      expect.stringContaining(
        "apt-get install -y --no-install-recommends --no-remove -- 'curl=7.88.1-10+deb12u8' 'jq'"
      ),
      { user: 'root' }
    )
    const [installCommand] = mockBuilder.runCmd.mock.calls[0] as [string]
    expect(installCommand).toContain("for package in 'curl' 'jq'; do")
    expect(installCommand.indexOf('apt-cache pkgnames')).toBeLessThan(
      installCommand.indexOf('apt-get install')
    )
    const imageName = sandboxImageName(
      'abcdef0123456789abcdef0123456789',
      'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
      e2bMaterializationGeneration(1785792000000)
    )
    expect(mockBuildInBackground).toHaveBeenCalledWith(
      mockBuilder,
      imageName,
      expect.objectContaining({ apiKey: 'test-key', cpuCount: 2, memoryMB: 4096 })
    )
    expect(build).toEqual(expect.objectContaining({ imageRef: `${imageName}:${CHILD_BUILD_ID}` }))
  })

  it('verifies managed CLIs with PATH exported in the root RUN instruction', async () => {
    const materialization = e2bProvider.images?.materialization('1234567890abcdef1234567890abcdef')
    if (!materialization) throw new Error('E2B image materialization is unavailable')

    await e2bProvider.images?.startBuild(
      {
        language: CodeLanguage.Python,
        dependencies: [],
        cliTools: ['kubectl@1.36.3-r1'],
        systemPackages: [],
      },
      '1234567890abcdef1234567890abcdef',
      materialization
    )

    expect(mockBuilder.setEnvs).toHaveBeenCalledWith({
      PATH: expect.stringContaining('/opt/sim-cli/kubectl/bin'),
    })
    expect(mockBuilder.runCmd).toHaveBeenCalledWith(
      expect.stringMatching(
        /^export PATH='\/opt\/sim-cli\/kubectl\/bin:[^']+' && kubectl version --client$/
      ),
      { user: 'root' }
    )
  })

  it('changes the child family when the immutable base or materializer revision changes', () => {
    const specHash = 'abcdef0123456789abcdef0123456789'
    const baseTemplate = 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479'

    const generation = e2bMaterializationGeneration(1785792000000)
    expect(sandboxImageName(specHash, baseTemplate, generation)).not.toBe(
      sandboxImageName(specHash, 'sim-function:9f12a6cf-a38e-4a34-a2ab-6f8e03ac451a', generation)
    )
    expect(sandboxImageName(specHash, baseTemplate, generation)).not.toBe(
      sandboxImageName(
        specHash,
        baseTemplate,
        e2bMaterializationGeneration(1785792000000, E2B_SANDBOX_MATERIALIZER_REVISION + 1)
      )
    )
    expect(sandboxImageName(specHash, baseTemplate, generation).length).toBeLessThanOrEqual(63)
  })

  it('rejects a queued materialization with a mutable base reference', async () => {
    const images = e2bProvider.images
    if (!images) throw new Error('E2B image materialization is unavailable')
    const materialization = images.materialization('abcdef0123456789abcdef0123456789')

    await expect(
      images.startBuild(
        {
          language: CodeLanguage.Python,
          dependencies: ['requests'],
          cliTools: [],
          systemPackages: [],
        },
        'abcdef0123456789abcdef0123456789',
        { ...materialization, baseImageRef: 'sim-function:latest' }
      )
    ).rejects.toThrow('immutable E2B build reference')
    expect(mockBuildInBackground).not.toHaveBeenCalled()
  })

  it('rejects a queued materialization with an invalid generation', async () => {
    const images = e2bProvider.images
    if (!images) throw new Error('E2B image materialization is unavailable')
    const materialization = images.materialization('abcdef0123456789abcdef0123456789')

    await expect(
      images.startBuild(
        {
          language: CodeLanguage.Python,
          dependencies: ['requests'],
          cliTools: [],
          systemPackages: [],
        },
        'abcdef0123456789abcdef0123456789',
        { ...materialization, generation: 0 }
      )
    ).rejects.toThrow('invalid generation')
    expect(mockBuildInBackground).not.toHaveBeenCalled()
  })
})
