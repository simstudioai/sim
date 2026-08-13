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

import { WorkspaceVFS } from '@/lib/copilot/vfs/workspace-vfs'

const MAX_DOC_READ_INPUT_BYTES = 50 * 1024 * 1024
const MAX_DOCUMENT_PREVIEW_CODE_BYTES = 1024 * 1024

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
