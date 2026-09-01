/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLimit, mockSelect } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect },
}))

vi.mock('@sim/db/schema', () => ({
  workspaceSandbox: {
    cliTools: 'cliTools',
    dependencies: 'dependencies',
    id: 'id',
    language: 'language',
    name: 'name',
    systemPackages: 'systemPackages',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}))

import { enrichSandboxCapabilities } from '@/lib/execution/remote-sandbox/wand-enricher'

describe('enrichSandboxCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({ limit: mockLimit }),
      }),
    })
  })

  it('describes curated CLIs for a CLI-only sandbox without registry requests', async () => {
    mockLimit.mockResolvedValue([
      {
        name: 'Data tools',
        language: 'python',
        dependencies: [],
        cliTools: ['google-cloud-cli@577.0.0-r1'],
      },
    ])
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const prompt = await enrichSandboxCapabilities('workspace-1', { sandboxId: 'sandbox-1' })

    expect(prompt).toContain('Installed command-line tools:')
    expect(prompt).toContain('Google Cloud CLI')
    expect(prompt).toContain('gcloud, bq, and gsutil')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('describes apt-installed packages separately from managed CLI recipes', async () => {
    mockLimit.mockResolvedValue([
      {
        name: 'Unix tools',
        language: 'python',
        dependencies: [],
        cliTools: ['google-cloud-cli@577.0.0-r1'],
        systemPackages: ['ripgrep', 'jq'],
      },
    ])

    const prompt = await enrichSandboxCapabilities('workspace-1', { sandboxId: 'sandbox-1' })

    expect(prompt).toContain('Installed command-line tools:\n- Google Cloud CLI')
    expect(prompt).toContain('Installed Debian system packages:\n- jq\n- ripgrep')
    expect(prompt).toContain('Executables provided by these packages are available on PATH')
  })
})
