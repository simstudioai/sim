/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { renderDocToGrid } = vi.hoisted(() => ({
  renderDocToGrid: vi.fn(),
}))

const { findWorkspaceFileRecord, listAllWorkspaceFilesExecute, readWorkspaceFileContentExecute } =
  vi.hoisted(() => ({
    findWorkspaceFileRecord: vi.fn(),
    listAllWorkspaceFilesExecute: vi.fn(),
    readWorkspaceFileContentExecute: vi.fn(),
  }))

const { isCustomBlocksEligible, listCustomBlocksWithInputsForWorkspace } = vi.hoisted(() => ({
  isCustomBlocksEligible: vi.fn().mockResolvedValue(false),
  listCustomBlocksWithInputsForWorkspace: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/server/files/doc-render', () => ({
  // `odt` exposes the defensive missing-task branch independently from the extension guard.
  isRenderableDocExt: (ext: string) => ['docx', 'odt', 'pdf', 'pptx'].includes(ext.toLowerCase()),
  renderDocToGrid,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  findWorkspaceFileRecord,
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: { execute: listAllWorkspaceFilesExecute },
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: readWorkspaceFileContentExecute },
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  isCustomBlocksEligible,
  listCustomBlocksWithInputsForWorkspace,
}))

/** None of these suites list catalog entries, and each real registry loads every definition it holds. */
vi.mock('@/blocks/registry-maps', () => ({ BLOCK_REGISTRY: {}, BLOCK_META_REGISTRY: {} }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))
vi.mock('@/triggers/registry', () => ({ TRIGGER_REGISTRY: {} }))

import { WorkspaceVFS } from '@/lib/copilot/vfs/workspace-vfs'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const MAX_DOC_READ_INPUT_BYTES = 50 * 1024 * 1024
const MAX_DOCUMENT_PREVIEW_CODE_BYTES = 1024 * 1024

interface TestableWorkspaceVFS {
  loadCustomBlocks(workspaceId: string): Promise<unknown[]>
}

function customBlockLoader(vfs: WorkspaceVFS): TestableWorkspaceVFS {
  return vfs as unknown as TestableWorkspaceVFS
}

describe('WorkspaceVFS custom block loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shares a successful custom block load within one VFS instance', async () => {
    const blocks = [{ id: 'custom-block-1' }]
    listCustomBlocksWithInputsForWorkspace.mockResolvedValueOnce(blocks)
    const loader = customBlockLoader(new WorkspaceVFS())

    const [first, second] = await Promise.all([
      loader.loadCustomBlocks('workspace-1'),
      loader.loadCustomBlocks('workspace-1'),
    ])

    expect(first).toBe(blocks)
    expect(second).toBe(blocks)
    expect(listCustomBlocksWithInputsForWorkspace).toHaveBeenCalledTimes(1)
  })

  it('retries a custom block load after failure', async () => {
    const blocks = [{ id: 'custom-block-1' }]
    listCustomBlocksWithInputsForWorkspace
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(blocks)
    const loader = customBlockLoader(new WorkspaceVFS())

    await expect(loader.loadCustomBlocks('workspace-1')).rejects.toThrow('temporary failure')
    await expect(loader.loadCustomBlocks('workspace-1')).resolves.toBe(blocks)
    expect(listCustomBlocksWithInputsForWorkspace).toHaveBeenCalledTimes(2)
  })
})

function arrangeRenderRead({
  name = 'brief.pdf',
  size = 8,
  content = Buffer.from('%PDF-1.7'),
}: {
  name?: string
  size?: number
  content?: Buffer | { length: number }
} = {}) {
  const record = {
    id: 'file-1',
    workspaceId: 'ws-1',
    name,
    key: name,
    path: `/api/files/serve/${name}`,
    size,
    type: 'application/octet-stream',
    uploadedBy: 'user-1',
    deletedAt: null,
    uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    storageContext: 'mothership' as const,
  }
  listAllWorkspaceFilesExecute.mockResolvedValue({ files: [record] })
  findWorkspaceFileRecord.mockReturnValue(record)
  readWorkspaceFileContentExecute.mockResolvedValue({ content })

  const vfs = new WorkspaceVFS({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  Object.assign(vfs, { _workspaceId: 'ws-1' })
  return vfs
}

describe('WorkspaceVFS dynamic render reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks render exceptions as file read errors', async () => {
    const vfs = arrangeRenderRead()
    renderDocToGrid.mockRejectedValue(
      new Error('Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)')
    )

    const result = await vfs.readFileContent('files/brief.pdf/render')

    expect(result).toEqual({
      content:
        '{"ok":false,"error":"Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)"}',
      totalLines: 1,
      error: 'Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)',
    })
  })

  it.each([
    {
      label: 'unsupported extensions',
      name: 'brief.txt',
      error: 'Render supports .pptx, .docx, and .pdf only',
    },
    {
      label: 'oversized file metadata',
      size: MAX_DOC_READ_INPUT_BYTES + 1,
      error: 'File is too large to render',
    },
    {
      label: 'oversized fetched buffers',
      content: { length: MAX_DOC_READ_INPUT_BYTES + 1 },
      error: 'File is too large to render',
    },
    {
      label: 'oversized source',
      content: Buffer.alloc(MAX_DOCUMENT_PREVIEW_CODE_BYTES + 1, 'a'),
      error: 'File source exceeds maximum size',
    },
    {
      label: 'missing render tasks',
      name: 'brief.odt',
      content: Buffer.from('document source'),
      error: 'Cannot render this file',
    },
  ])('marks $label as file read errors', async ({ name, size, content, error }) => {
    const vfs = arrangeRenderRead({ name, size, content })

    const result = await vfs.readFileContent(`files/${name ?? 'brief.pdf'}/render`)

    expect(result).toEqual({
      content: JSON.stringify({ ok: false, error }),
      totalLines: 1,
      error,
    })
  })
})

describe('WorkspaceVFS lazy grep resilience', () => {
  it('skips an unmaterializable lazy artifact instead of failing the whole sweep', async () => {
    const vfs = new WorkspaceVFS({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    const internals = vfs as unknown as {
      files: Map<string, string>
      registerLazy: (path: string, loader: () => Promise<string | null>) => void
      resolveLazyPath: (path: string) => Promise<string | null>
    }
    internals.files.set('workflows/A/state.json', '{"needle": true}')
    internals.registerLazy.call(vfs, 'knowledgebases/huge/documents.json', async () => {
      throw new Error(
        'Knowledge base kb-1 has more than 10000 documents; documents.json cannot be materialized'
      )
    })
    internals.registerLazy.call(
      vfs,
      'knowledgebases/small/documents.json',
      async () => '{"needle": "lazy"}'
    )

    const matches = (await vfs.grep('needle')) as Array<{ path: string }>
    const paths = matches.map((m) => m.path)
    expect(paths).toContain('workflows/A/state.json')
    expect(paths).toContain('knowledgebases/small/documents.json')

    // Reading the failing artifact directly still surfaces its own error, and
    // the loader stays re-armed for that read.
    await expect(
      internals.resolveLazyPath.call(vfs, 'knowledgebases/huge/documents.json')
    ).rejects.toThrow('cannot be materialized')
  })
})

describe('WorkspaceVFS oversized content reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function arrangeOversizedContentRead() {
    const record = {
      id: 'file-big',
      workspaceId: 'ws-1',
      name: 'big.tsv',
      key: 'big.tsv',
      path: '/api/files/serve/big.tsv',
      size: 7_500_000,
      type: 'text/tab-separated-values',
      uploadedBy: 'user-1',
      deletedAt: null,
      uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      storageContext: 'workspace' as const,
    }
    listAllWorkspaceFilesExecute.mockResolvedValue({ files: [record] })
    findWorkspaceFileRecord.mockReturnValue(record)
    readWorkspaceFileContentExecute.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'Workspace file', maxBytes: 20_971_520 })
    )

    const vfs = new WorkspaceVFS({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    Object.assign(vfs, { _workspaceId: 'ws-1' })
    const internals = vfs as unknown as { files: Map<string, string> }
    internals.files.set('files/big.tsv', '')
    return vfs
  }

  it('answers a cap breach with an oversized placeholder, not "not found"', async () => {
    const vfs = arrangeOversizedContentRead()

    const result = await vfs.readFileContent('files/big.tsv/content')

    expect(result).not.toBeNull()
    expect(result).toMatchObject({ placeholder: 'oversized' })
    expect(result?.content).toContain('File too large')
    expect(result?.content).toContain('big.tsv')
  })

  it('reports a cap breach honestly for grep instead of "content not found"', async () => {
    const vfs = arrangeOversizedContentRead()

    await expect(vfs.grepFile('files/big.tsv', 'needle')).rejects.toThrow(/too large to search/)
  })
})

describe('WorkspaceVFS decoded-equivalent resolution', () => {
  it('resolves a decoded path to its single encoded twin and rejects ambiguity', () => {
    const vfs = new WorkspaceVFS({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    const internals = vfs as unknown as { files: Map<string, string> }
    internals.files.set('workflows/Elder%20v2/The%20Elder/state.json', '{}')

    expect(vfs.resolveDecodedEquivalent('workflows/Elder v2/The Elder/state.json')).toBe(
      'workflows/Elder%20v2/The%20Elder/state.json'
    )
    expect(vfs.resolveDecodedEquivalent('workflows/Elder v2/The Elder/meta.json')).toBeNull()

    // Two keys decoding identically (pathological) must refuse to guess.
    internals.files.set('workflows/Elder v2/The Elder/state.json', '{}')
    expect(vfs.resolveDecodedEquivalent('workflows/Elder v2/The Elder/state.json')).toBeNull()
  })
})
