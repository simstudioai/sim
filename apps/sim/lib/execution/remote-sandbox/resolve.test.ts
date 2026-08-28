/**
 * @vitest-environment node
 *
 * Resolution is the fail-closed boundary: a selection that cannot be honored has
 * to surface as an explicit error, never as a baffling ModuleNotFoundError
 * inside the user's code. These cases pin that contract down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'

const {
  mockSelect,
  mockUpdate,
  mockProviderStrategy,
  mockEnsureSandboxImage,
  mockIsMissingImage,
  mockLocalGeneration,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockProviderStrategy: { current: 'prebuilt' as 'prebuilt' | 'runtime' },
  mockEnsureSandboxImage: vi.fn(),
  mockIsMissingImage: vi.fn(),
  mockLocalGeneration: { current: 1785792000000001 },
}))

vi.mock('@/lib/execution/remote-sandbox/image-registry', () => ({
  ensureSandboxImage: mockEnsureSandboxImage,
  FAILED_BUILD_RETRY_COOLDOWN_MS: 600_000,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workspaceSandbox: {
    id: 'id',
    workspaceId: 'workspace_id',
    name: 'name',
    language: 'language',
    dependencies: 'dependencies',
    cliTools: 'cli_tools',
    systemPackages: 'system_packages',
    specHash: 'spec_hash',
  },
  sandboxImage: {
    provider: 'provider',
    specHash: 'spec_hash',
    status: 'status',
    imageRef: 'image_ref',
    materializationGeneration: 'materialization_generation',
    errorCode: 'error_code',
    errorMessage: 'error_message',
    lastUsedAt: 'last_used_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}))

vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    get dependencyStrategy() {
      return mockProviderStrategy.current
    },
    get images() {
      return mockProviderStrategy.current === 'prebuilt'
        ? {
            rendererRevision: 1,
            isMissingImage: mockIsMissingImage,
            materialization: () => ({
              rendererRevision: 1,
              generation: mockLocalGeneration.current,
              imageRefPrefix: 'sim-sbx-current:',
              baseImageRef: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
            }),
            imageRefGeneration: (imageRef: string) => {
              if (imageRef.startsWith('sim-sbx-current:')) return mockLocalGeneration.current
              if (imageRef.startsWith('sim-sbx-newer:')) return mockLocalGeneration.current + 1000
              if (imageRef.startsWith('sim-sbx-collision:')) return mockLocalGeneration.current
              return undefined
            },
          }
        : undefined
    },
  }),
}))

import {
  invalidateSandboxResolution,
  provisionRuntimeDependencies,
  repairMissingSandboxImage,
  resolveWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/resolve'

/** Queues the rows each successive `db.select()` chain resolves to. */
function queueSelects(...results: unknown[][]) {
  mockSelect.mockReset()
  for (const rows of results) {
    mockSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    })
  }
}

const SANDBOX_ROW = {
  id: 'sbx-1',
  name: 'bigquery-etl',
  language: 'python',
  dependencies: ['pandas'],
  cliTools: [],
  systemPackages: [],
  specHash: 'hash-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSandboxResolution()
  mockProviderStrategy.current = 'prebuilt'
  mockLocalGeneration.current = 1785792000000001
  mockUpdate.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) })
  mockEnsureSandboxImage.mockResolvedValue(undefined)
})

describe('resolveWorkspaceSandbox', () => {
  it('returns null when nothing is selected, leaving current behavior unchanged', async () => {
    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
    })
    expect(resolved).toBeNull()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it.each(['mothership', 'doc', 'pi', 'codex'] as const)(
    'ignores a selection for the %s kind',
    async (kind) => {
      const resolved = await resolveWorkspaceSandbox({
        kind,
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
      expect(resolved).toBeNull()
      expect(mockSelect).not.toHaveBeenCalled()
    }
  )

  it('passes the ready image ref under the prebuilt strategy', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [{ status: 'ready', imageRef: 'sim-sbx-current:abc', errorCode: null, errorMessage: null }]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({ strategy: 'prebuilt', imageRef: 'sim-sbx-current:abc' })
    // Python needs no NODE_PATH; only JavaScript does.
    expect(resolved?.envs).toBeUndefined()
  })

  it('carries NODE_PATH for javascript so installed packages resolve', async () => {
    queueSelects(
      [{ ...SANDBOX_ROW, language: 'javascript', dependencies: ['axios'] }],
      [
        {
          status: 'ready',
          imageRef: 'sim-sbx-current:abc',
          errorCode: null,
          errorMessage: null,
        },
      ]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.JavaScript,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved?.envs?.NODE_PATH).toContain('node_modules')
  })

  it.each([CodeLanguage.Python, CodeLanguage.JavaScript])(
    'carries the complete system PATH for %s system-package executions',
    async (language) => {
      queueSelects(
        [{ ...SANDBOX_ROW, language, dependencies: [], systemPackages: ['cowsay'] }],
        [
          {
            status: 'ready',
            imageRef: 'sim-sbx-current:system',
            errorCode: null,
            errorMessage: null,
          },
        ]
      )

      const resolved = await resolveWorkspaceSandbox({
        kind: 'code',
        language,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })

      expect(resolved?.envs?.PATH).toContain('/usr/local/games')
      expect(resolved?.envs?.PATH).toContain('/usr/games')
      if (language === CodeLanguage.JavaScript) {
        expect(resolved?.envs?.NODE_PATH).toContain('node_modules')
      } else {
        expect(resolved?.envs?.NODE_PATH).toBeUndefined()
      }
    }
  )

  it.each([
    ['building', /still building/],
    ['pending', /still building/],
    ['failed', /failed to build/],
  ])('fails closed when the build is %s', async (status, expected) => {
    queueSelects([SANDBOX_ROW], [{ status, imageRef: null, errorMessage: 'pandas not found' }])

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(expected)
  })

  it('fails closed when the build row does not exist yet', async () => {
    queueSelects([SANDBOX_ROW], [])

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/no completed build/)
  })

  /**
   * A sandbox whose definition is fine but whose image is gone must not require
   * the user to re-save it in Settings to become runnable again. Resolution
   * re-queues the build so the next execution succeeds on its own.
   */
  it.each([
    ['a failed build', [{ status: 'failed', imageRef: null, errorMessage: 'pandas not found' }]],
    ['a missing build row', []],
  ])('re-queues the build for %s', async (_label, imageRows) => {
    queueSelects([SANDBOX_ROW], imageRows)

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/queued/)

    // The cooldown is what stops a scheduled workflow re-enqueueing a build that
    // fails in seconds on every single run.
    expect(mockEnsureSandboxImage).toHaveBeenCalledWith(
      { language: 'python', dependencies: ['pandas'], cliTools: [], systemPackages: [] },
      'hash-1',
      { minFailureAgeMs: 600_000 }
    )
  })

  it('does not re-queue while a healthy build is still in flight', async () => {
    queueSelects([SANDBOX_ROW], [{ status: 'building', imageRef: null, errorMessage: null }])

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/still building/)

    // The registry's own conflict guard decides whether a stale in-flight row is
    // re-claimable, so calling it here is safe — but the message must not
    // promise a rebuild that the guard will refuse.
    expect(mockEnsureSandboxImage).toHaveBeenCalled()
  })

  it('keeps the build error when the repair itself fails', async () => {
    queueSelects([SANDBOX_ROW], [{ status: 'failed', imageRef: null, errorMessage: 'pandas gone' }])
    mockEnsureSandboxImage.mockRejectedValue(new Error('trigger.dev unreachable'))

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/pandas gone/)
  })

  it('never re-queues when the image is usable', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [{ status: 'ready', imageRef: 'sim-sbx-current:abc', errorCode: null, errorMessage: null }]
    )

    await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })

  it('keeps using a previously ready image while the current base release is queued', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [{ status: 'ready', imageRef: 'sim-sbx-previous:abc', errorCode: null, errorMessage: null }]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({ strategy: 'prebuilt', imageRef: 'sim-sbx-previous:abc' })
    expect(mockEnsureSandboxImage).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'building', 'failed'])(
    'keeps using the retained ready image while its base-release refresh is %s',
    async (status) => {
      queueSelects(
        [SANDBOX_ROW],
        [
          {
            status,
            imageRef: 'sim-sbx-previous:abc',
            errorCode: 'base_release_refresh',
            errorMessage: null,
          },
        ]
      )

      const resolved = await resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })

      expect(resolved).toMatchObject({ strategy: 'prebuilt', imageRef: 'sim-sbx-previous:abc' })
      expect(mockEnsureSandboxImage).toHaveBeenCalledTimes(1)
    }
  )

  it('accepts a newer committed generation without rebuilding backward on an old replica', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [
        {
          status: 'ready',
          imageRef: 'sim-sbx-newer:build',
          materializationGeneration: mockLocalGeneration.current + 1000,
          errorCode: null,
          errorMessage: null,
        },
      ]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({ strategy: 'prebuilt', imageRef: 'sim-sbx-newer:build' })
    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })

  it('fails closed when one generation is reused for a different immutable base', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [
        {
          status: 'ready',
          imageRef: 'sim-sbx-collision:build',
          materializationGeneration: mockLocalGeneration.current,
          errorCode: null,
          errorMessage: null,
        },
      ]
    )

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/generation that does not match its immutable Function base/)
    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })

  it.each([
    ['failed', null],
    ['building', null],
    ['pending', 'provider_build_failed'],
  ])('does not fall back to an unproven prior ref from a %s row', async (status, errorCode) => {
    queueSelects(
      [SANDBOX_ROW],
      [
        {
          status,
          imageRef: 'sim-sbx-previous:partial',
          errorCode,
          errorMessage: 'unproven build',
        },
      ]
    )

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(status === 'failed' ? /failed to build/ : /still building/)
  })

  it('rejects a deleted or cross-workspace sandbox', async () => {
    queueSelects([])

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.Python,
        workspaceId: 'ws-other',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/no longer exists in this workspace/)
  })

  it('rejects a language mismatch instead of installing the wrong dependency set', async () => {
    queueSelects(
      [SANDBOX_ROW],
      [{ status: 'ready', imageRef: 'sim-sbx-current:abc', errorCode: null, errorMessage: null }]
    )

    await expect(
      resolveWorkspaceSandbox({
        kind: 'code',
        language: CodeLanguage.JavaScript,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })
    ).rejects.toThrow(/installs python dependencies, but this block runs javascript/)
  })

  it('never touches the build registry under the runtime strategy', async () => {
    mockProviderStrategy.current = 'runtime'
    queueSelects([SANDBOX_ROW])

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({ strategy: 'runtime' })
    expect(resolved?.imageRef).toBeUndefined()
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })

  it('treats a system-package-only sandbox as image-backed under the prebuilt strategy', async () => {
    queueSelects(
      [{ ...SANDBOX_ROW, dependencies: [], systemPackages: ['jq'] }],
      [
        {
          status: 'ready',
          imageRef: 'sim-sbx-current:system',
          errorCode: null,
          errorMessage: null,
        },
      ]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'shell',
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({
      strategy: 'prebuilt',
      imageRef: 'sim-sbx-current:system',
      systemPackages: ['jq'],
    })
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })
})

describe('provisionRuntimeDependencies', () => {
  function fakeSandbox(commandResult: {
    stdout: string
    stderr: string
    exitCode: number
    timedOut?: boolean
  }) {
    return {
      sandboxId: 'sb_1',
      writeFile: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue(commandResult),
      runCode: vi.fn(),
      readFile: vi.fn(),
      readFileWithLimit: vi.fn(),
      getFileSize: vi.fn(),
      kill: vi.fn(),
    }
  }

  const RUNTIME_PY = {
    id: 'sbx-1',
    name: 'etl',
    language: CodeLanguage.Python,
    dependencies: ['pandas'],
    cliTools: [],
    systemPackages: [],
    specHash: 'hash-runtime',
    strategy: 'runtime' as const,
  }

  it('writes the manifest through the filesystem API, never a shell argument', async () => {
    const sandbox = fakeSandbox({ stdout: 'ok', stderr: '', exitCode: 0 })

    await provisionRuntimeDependencies(sandbox, RUNTIME_PY)

    expect(sandbox.writeFile).toHaveBeenCalledWith('/tmp/sim-requirements.txt', 'pandas\n')
    const [command] = sandbox.runCommand.mock.calls.at(-1) as [string]
    expect(command).toContain('-r /tmp/sim-requirements.txt')
    expect(command).not.toContain('pandas')
  })

  it('installs javascript packages from a package.json into the shared prefix', async () => {
    const sandbox = fakeSandbox({ stdout: 'ok', stderr: '', exitCode: 0 })

    await provisionRuntimeDependencies(sandbox, {
      ...RUNTIME_PY,
      language: CodeLanguage.JavaScript,
      dependencies: ['axios@^1.7.0'],
    })

    const manifestCall = sandbox.writeFile.mock.calls[0] as [string, string]
    expect(manifestCall[0]).toMatch(/package\.json$/)
    expect(JSON.parse(manifestCall[1]).dependencies).toEqual({ axios: '^1.7.0' })
  })

  it('installs validated Debian packages as root within the shared runtime budget', async () => {
    const sandbox = fakeSandbox({ stdout: 'ok', stderr: '', exitCode: 0 })
    const controller = new AbortController()

    await provisionRuntimeDependencies(
      sandbox,
      {
        ...RUNTIME_PY,
        dependencies: [],
        systemPackages: ['jq', 'curl=7.88.1-10+deb12u8'],
      },
      { timeoutMs: 90_000, signal: controller.signal }
    )

    const [command, options] = sandbox.runCommand.mock.calls[0] as [
      string,
      { rootUser?: boolean; signal?: AbortSignal; timeoutMs: number },
    ]
    expect(command).toContain('apt-get update')
    expect(command).toContain("'curl=7.88.1-10+deb12u8' 'jq'")
    expect(options).toMatchObject({
      rootUser: true,
      signal: controller.signal,
      atMostOnce: true,
    })
    expect(options.timeoutMs).toBeGreaterThan(0)
    expect(options.timeoutMs).toBeLessThanOrEqual(90_000)
    expect(sandbox.writeFile).not.toHaveBeenCalled()
  })

  it('aborts with the classified error so user code never runs half-installed', async () => {
    const sandbox = fakeSandbox({
      stdout: '',
      stderr: 'ERROR: No matching distribution found for pandsa',
      exitCode: 1,
    })

    await expect(provisionRuntimeDependencies(sandbox, RUNTIME_PY)).rejects.toThrow(
      /Package "pandsa" was not found on PyPI/
    )
  })

  it('preserves a provider timeout while installing runtime dependencies', async () => {
    const sandbox = fakeSandbox({
      stdout: '',
      stderr: 'installer timed out',
      exitCode: 124,
      timedOut: true,
    })

    await expect(provisionRuntimeDependencies(sandbox, RUNTIME_PY)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'timeout',
    })
  })

  it('does nothing under the prebuilt strategy', async () => {
    const sandbox = fakeSandbox({ stdout: '', stderr: '', exitCode: 0 })

    await provisionRuntimeDependencies(sandbox, { ...RUNTIME_PY, strategy: 'prebuilt' })

    expect(sandbox.writeFile).not.toHaveBeenCalled()
    expect(sandbox.runCommand).not.toHaveBeenCalled()
  })

  it('uses a timeout of its own, so a slow install cannot eat the code budget', async () => {
    const sandbox = fakeSandbox({ stdout: 'ok', stderr: '', exitCode: 0 })

    await provisionRuntimeDependencies(sandbox, RUNTIME_PY)

    const [, options] = sandbox.runCommand.mock.calls.at(-1) as [string, { timeoutMs: number }]
    expect(options.timeoutMs).toBeGreaterThan(0)
  })

  it('forwards workflow cancellation to runtime installation commands', async () => {
    const sandbox = fakeSandbox({ stdout: 'ok', stderr: '', exitCode: 0 })
    const controller = new AbortController()

    await provisionRuntimeDependencies(sandbox, RUNTIME_PY, { signal: controller.signal })

    for (const [, options] of sandbox.runCommand.mock.calls as Array<
      [string, { signal?: AbortSignal }]
    >) {
      expect(options.signal).toBe(controller.signal)
    }
  })
})

/**
 * The registry and the provider template are two systems with no shared
 * transaction, so every attempt to keep them in step leaves some window. Create is
 * the one step that observes the truth, which is why the repair hangs off it.
 */
describe('repairMissingSandboxImage', () => {
  const SELECTED = {
    id: 'sbx-1',
    name: 'bigquery-etl',
    language: CodeLanguage.Python,
    dependencies: ['pandas'],
    cliTools: [],
    systemPackages: [],
    specHash: 'hash-1',
    strategy: 'prebuilt' as const,
    imageRef: 'sim-sbx-abc',
  }

  it('rebuilds without a cooldown, because create observed the image is gone', async () => {
    mockIsMissingImage.mockResolvedValue(true)

    const message = await repairMissingSandboxImage(SELECTED, new Error('404'))

    expect(message).toMatch(/being rebuilt/)
    expect(mockEnsureSandboxImage).toHaveBeenCalledWith(
      { language: 'python', dependencies: ['pandas'], cliTools: [], systemPackages: [] },
      'hash-1',
      { missingImageRef: 'sim-sbx-abc' }
    )
  })

  /**
   * The classifier has to stay narrow: treating an auth or rate-limit failure as a
   * missing image would rebuild every sandbox on a provider outage.
   */
  it('leaves any other provider failure alone', async () => {
    mockIsMissingImage.mockResolvedValue(false)

    const message = await repairMissingSandboxImage(SELECTED, new Error('rate limited'))

    expect(message).toBeNull()
    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })

  it('does nothing for a runtime-strategy sandbox, which has no image to miss', async () => {
    mockIsMissingImage.mockResolvedValue(true)

    const message = await repairMissingSandboxImage(
      { ...SELECTED, strategy: 'runtime', imageRef: undefined },
      new Error('404')
    )

    expect(message).toBeNull()
    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
  })
})
