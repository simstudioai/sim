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
  isRenderableDocExt: (ext: string) => ['docx', 'pdf', 'pptx'].includes(ext.toLowerCase()),
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

describe('WorkspaceVFS dynamic render reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks render exceptions as file read errors', async () => {
    const record = {
      id: 'file-1',
      workspaceId: 'ws-1',
      name: 'brief.pdf',
      key: 'brief.pdf',
      path: '/api/files/serve/brief.pdf',
      size: 8,
      type: 'application/pdf',
      uploadedBy: 'user-1',
      deletedAt: null,
      uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      storageContext: 'mothership' as const,
    }
    listAllWorkspaceFilesExecute.mockResolvedValue({ files: [record] })
    findWorkspaceFileRecord.mockReturnValue(record)
    readWorkspaceFileContentExecute.mockResolvedValue({ content: Buffer.from('%PDF-1.7') })
    renderDocToGrid.mockRejectedValue(
      new Error('Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)')
    )

    const vfs = new WorkspaceVFS({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    Object.assign(vfs, { _workspaceId: 'ws-1' })

    const result = await vfs.readFileContent('files/brief.pdf/render')

    expect(result).toEqual({
      content:
        '{"ok":false,"error":"Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)"}',
      totalLines: 1,
      error: 'Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)',
    })
  })
})
