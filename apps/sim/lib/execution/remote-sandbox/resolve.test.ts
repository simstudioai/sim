/**
 * @vitest-environment node
 *
 * Resolution is the fail-closed boundary: a selection that cannot be honored has
 * to surface as an explicit error, never as a baffling ModuleNotFoundError
 * inside the user's code. These cases pin that contract down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'

const { mockSelect, mockUpdate, mockProviderStrategy, mockEnsureSandboxImage, mockIsMissingImage } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockProviderStrategy: { current: 'prebuilt' as 'prebuilt' | 'runtime' },
    mockEnsureSandboxImage: vi.fn(),
    mockIsMissingImage: vi.fn(),
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
    specHash: 'spec_hash',
  },
  sandboxImage: {
    provider: 'provider',
    specHash: 'spec_hash',
    status: 'status',
    imageRef: 'image_ref',
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
        ? { isMissingImage: mockIsMissingImage }
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
  specHash: 'hash-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSandboxResolution()
  mockProviderStrategy.current = 'prebuilt'
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

  it.each(['doc', 'pi'] as const)('ignores a selection for the %s kind', async (kind) => {
    const resolved = await resolveWorkspaceSandbox({
      kind,
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })
    expect(resolved).toBeNull()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('passes the ready image ref under the prebuilt strategy', async () => {
    queueSelects([SANDBOX_ROW], [{ status: 'ready', imageRef: 'sim-sbx-abc', errorMessage: null }])

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved).toMatchObject({ strategy: 'prebuilt', imageRef: 'sim-sbx-abc' })
    // Python needs no NODE_PATH; only JavaScript does.
    expect(resolved?.envs).toBeUndefined()
  })

  it('carries NODE_PATH for javascript so installed packages resolve', async () => {
    queueSelects(
      [{ ...SANDBOX_ROW, language: 'javascript', dependencies: ['axios'] }],
      [{ status: 'ready', imageRef: 'sim-sbx-abc', errorMessage: null }]
    )

    const resolved = await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.JavaScript,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(resolved?.envs?.NODE_PATH).toContain('node_modules')
  })

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
      { language: 'python', dependencies: ['pandas'] },
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
    queueSelects([SANDBOX_ROW], [{ status: 'ready', imageRef: 'sim-sbx-abc', errorMessage: null }])

    await resolveWorkspaceSandbox({
      kind: 'code',
      language: CodeLanguage.Python,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    expect(mockEnsureSandboxImage).not.toHaveBeenCalled()
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
    queueSelects([SANDBOX_ROW], [{ status: 'ready', imageRef: 'sim-sbx-abc', errorMessage: null }])

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
})

describe('provisionRuntimeDependencies', () => {
  function fakeSandbox(commandResult: { stdout: string; stderr: string; exitCode: number }) {
    return {
      sandboxId: 'sb_1',
      writeFile: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue(commandResult),
      runCode: vi.fn(),
      readFile: vi.fn(),
      kill: vi.fn(),
    }
  }

  const RUNTIME_PY = {
    id: 'sbx-1',
    name: 'etl',
    language: CodeLanguage.Python,
    dependencies: ['pandas'],
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
    specHash: 'hash-1',
    strategy: 'prebuilt' as const,
    imageRef: 'sim-sbx-abc',
  }

  it('rebuilds without a cooldown, because create observed the image is gone', async () => {
    mockIsMissingImage.mockResolvedValue(true)

    const message = await repairMissingSandboxImage(SELECTED, new Error('404'))

    expect(message).toMatch(/being rebuilt/)
    expect(mockEnsureSandboxImage).toHaveBeenCalledWith(
      { language: 'python', dependencies: ['pandas'] },
      'hash-1',
      { imageKnownGone: true }
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
