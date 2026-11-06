import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ProjectConflictError, ProjectFileRevisionConflictError } from '@/lib/projects/errors'

const { mockReadContent } = vi.hoisted(() => ({ mockReadContent: vi.fn() }))

vi.mock('@/lib/projects/files/application/authorization', () => ({
  createProjectFileAuthorizer: async () => async () => ({
    file: { originalName: 'notes.md', contentType: 'text/markdown' },
  }),
}))
vi.mock('@/lib/projects/files/application/content', () => ({
  readProjectFileContent: { execute: mockReadContent },
  updateProjectFileContent: { execute: vi.fn() },
}))

import { persistProjectFileDoc } from '@/lib/projects/files/application/documents'

const args = {
  principal: createSessionPrincipal({ userId: 'user-1' }),
  input: {
    projectId: 'project-1',
    fileId: 'file-1',
    docState: Y.encodeStateAsUpdate(new Y.Doc()),
    expectedVersion: 1,
  },
}

describe('persistProjectFileDoc conflict retries', () => {
  it('retries a moving revision before reporting a document conflict', async () => {
    mockReadContent.mockRejectedValue(new ProjectFileRevisionConflictError('File changed'))
    await expect(persistProjectFileDoc.execute(args)).resolves.toEqual({ status: 'conflict' })
    expect(mockReadContent).toHaveBeenCalledTimes(3)
  })

  it('surfaces a Project lock conflict instead of reporting a document conflict', async () => {
    const lockConflict = new ProjectConflictError('Project is changing; retry the operation')
    mockReadContent.mockRejectedValue(lockConflict)
    await expect(persistProjectFileDoc.execute(args)).rejects.toBe(lockConflict)
    expect(mockReadContent).toHaveBeenCalledTimes(1)
  })
})
