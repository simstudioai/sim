import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPersistArtifactBundle, mockRequireAppsArtifactRoot } = vi.hoisted(() => ({
  mockPersistArtifactBundle: vi.fn(async () => ({ ok: true as const })),
  mockRequireAppsArtifactRoot: vi.fn(),
}))

vi.mock('@/lib/apps/artifacts/store', () => ({
  persistArtifactBundle: mockPersistArtifactBundle,
  requireAppsArtifactRoot: mockRequireAppsArtifactRoot,
}))

import {
  decodeE2BArtifactExport,
  type E2BAppSandbox,
  runE2BViteBuild,
} from '@/lib/apps/build/e2b-vite-build'

const originalDigest = process.env.E2B_APP_BUILD_IMAGE_DIGEST
const originalTemplateId = process.env.E2B_APP_BUILD_TEMPLATE_ID

describe('decodeE2BArtifactExport', () => {
  it('decodes a bounded artifact export', () => {
    const index = Buffer.from('<!doctype html><div id="root"></div>')
    const result = decodeE2BArtifactExport(
      JSON.stringify({
        version: 1,
        fileCount: 1,
        totalBytes: index.byteLength,
        files: [{ path: 'index.html', contentBase64: index.toString('base64') }],
      })
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.files[0]).toEqual({ path: 'index.html', content: index })
    }
  })

  it('rejects mismatched transport metadata', () => {
    const result = decodeE2BArtifactExport(
      JSON.stringify({
        version: 1,
        fileCount: 2,
        totalBytes: 1,
        files: [{ path: 'index.html', contentBase64: 'eA==' }],
      })
    )
    expect(result).toEqual({ ok: false, error: 'E2B artifact export metadata is invalid' })
  })

  it('rejects unsafe artifact paths before decoding bytes', () => {
    const result = decodeE2BArtifactExport(
      JSON.stringify({
        version: 1,
        fileCount: 1,
        totalBytes: 1,
        files: [{ path: '../secret.js', contentBase64: 'eA==' }],
      })
    )
    expect(result).toEqual({
      ok: false,
      error: 'E2B artifact export path rejected: ../secret.js',
    })
  })
})

describe('runE2BViteBuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.E2B_APP_BUILD_TEMPLATE_ID = 'sim-app-build:toolchain-test'
    process.env.E2B_APP_BUILD_IMAGE_DIGEST = 'e2b-build:build-123'
  })

  afterEach(() => {
    if (originalDigest === undefined) process.env.E2B_APP_BUILD_IMAGE_DIGEST = undefined
    else process.env.E2B_APP_BUILD_IMAGE_DIGEST = originalDigest
    if (originalTemplateId === undefined) process.env.E2B_APP_BUILD_TEMPLATE_ID = undefined
    else process.env.E2B_APP_BUILD_TEMPLATE_ID = originalTemplateId
  })

  it('writes trusted source, collects output, and persists a canonical bundle', async () => {
    const index = Buffer.from('<!doctype html><div id="root"></div>')
    const javascript = Buffer.from('console.log("ok")')
    const preview = Buffer.from('webp-preview')
    const exportPayload = JSON.stringify({
      version: 1,
      fileCount: 3,
      totalBytes: index.byteLength + javascript.byteLength + preview.byteLength,
      files: [
        { path: 'index.html', contentBase64: index.toString('base64') },
        { path: 'assets/app.js', contentBase64: javascript.toString('base64') },
        { path: 'preview.webp', contentBase64: preview.toString('base64') },
      ],
    })

    const files = {
      makeDir: vi.fn(async () => true),
      write: vi.fn(async () => ({ name: 'written' })),
      read: vi.fn(async () => exportPayload),
    }
    const commands = {
      run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    }
    const sandbox = {
      sandboxId: 'sandbox-1',
      files,
      commands,
      kill: vi.fn(async () => undefined),
    } as unknown as E2BAppSandbox

    const result = await runE2BViteBuild(
      {
        projectId: 'project-1',
        revisionId: 'revision-1',
        files: {},
        actions: [
          {
            actionId: 'main',
            workflowId: 'workflow-1',
            deploymentVersionId: 'version-1',
            inputSchema: {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              type: 'object',
              properties: {},
            },
            outputAllowlist: [],
            executionPolicy: 'sync',
            schemaHash: 'schema-hash',
          },
        ],
      },
      { createSandbox: async () => sandbox }
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.artifactManifestHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.buildImageDigest).toBe('e2b-build:build-123')
      expect(result.diagnostics).toMatchObject({
        mode: 'e2b',
        sandboxId: 'sandbox-1',
        fileCount: 3,
        thumbnail: { status: 'captured', path: 'preview.webp' },
      })
    }
    expect(commands.run).toHaveBeenCalledTimes(3)
    expect(commands.run.mock.calls[1]?.[0]).toContain('capture-thumbnail.mjs')
    const sourceBatch = files.write.mock.calls[0]?.[0] as Array<{ path: string; data: string }>
    expect(sourceBatch).toEqual(
      expect.arrayContaining([
        {
          path: '/home/user/app/src/sim.generated.ts',
          data: expect.stringContaining('sim.run("main"'),
        },
      ])
    )
    expect(mockPersistArtifactBundle).toHaveBeenCalledOnce()
    expect(sandbox.kill).toHaveBeenCalledOnce()
  })

  it('keeps a successful build when thumbnail capture fails', async () => {
    const index = Buffer.from('<!doctype html><div id="root"></div>')
    const files = {
      makeDir: vi.fn(async () => true),
      write: vi.fn(async () => ({ name: 'written' })),
      read: vi.fn(async () =>
        JSON.stringify({
          version: 1,
          fileCount: 1,
          totalBytes: index.byteLength,
          files: [{ path: 'index.html', contentBase64: index.toString('base64') }],
        })
      ),
    }
    const commands = {
      run: vi.fn(async (command: string) =>
        command.includes('capture-thumbnail.mjs')
          ? { stdout: '', stderr: 'chromium unavailable', exitCode: 1 }
          : { stdout: '', stderr: '', exitCode: 0 }
      ),
    }
    const sandbox = {
      sandboxId: 'sandbox-2',
      files,
      commands,
      kill: vi.fn(async () => undefined),
    } as unknown as E2BAppSandbox

    const result = await runE2BViteBuild(
      {
        projectId: 'project-1',
        revisionId: 'revision-1',
        files: {},
        actions: [
          {
            actionId: 'main',
            workflowId: 'workflow-1',
            deploymentVersionId: 'version-1',
            inputSchema: { type: 'object', properties: {} },
            outputAllowlist: [],
            executionPolicy: 'sync',
            schemaHash: 'schema-hash',
          },
        ],
      },
      { createSandbox: async () => sandbox }
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.diagnostics).toMatchObject({
        thumbnail: {
          status: 'failed',
          path: 'preview.webp',
          error: 'chromium unavailable',
          exitCode: 1,
        },
      })
    }
    expect(mockPersistArtifactBundle).toHaveBeenCalledOnce()
    expect(sandbox.kill).toHaveBeenCalledOnce()
  })
})
