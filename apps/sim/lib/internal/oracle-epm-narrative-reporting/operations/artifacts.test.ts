/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
}
const request = vi.fn()
const context = {
  client: { request, validateReturnedLink: vi.fn(), requestValidatedLink: vi.fn() },
  execution: { workflowId: 'workflow' },
  signal: new AbortController().signal,
} satisfies NarrativeOperationContext
beforeEach(() => vi.clearAllMocks())

import {
  createLibraryFile,
  createLibraryFolder,
  deleteLibraryArtifact,
  getLibraryArtifact,
  listLibraryArtifacts,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/artifacts'

describe('Narrative library operations', () => {
  it('uses folder UUIDs only for the children endpoint and keeps one bounded page', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        items: [{ artifactId: 'a::202', name: 'Budget', links: [{ href: 'secret' }] }],
        hasMore: true,
        offset: 50,
        limit: 50,
      },
    })
    const result = await listLibraryArtifacts(
      { ...auth, folderId: 'folder', limit: 50, offset: 50 },
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(
      narrativeEndpoints.listArtifactChildren,
      expect.objectContaining({
        pathParams: { id: 'folder' },
        query: expect.objectContaining({ limit: 50, offset: 50 }),
        signal: context.signal,
      })
    )
    expect(result.output).toMatchObject({
      artifacts: [{ artifactId: 'a::202', name: 'Budget' }],
      hasMore: true,
      offset: 50,
    })
    expect(result.output.artifacts[0]).not.toHaveProperty('links')
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.artifacts[0]).sort()
    )
  })
  it('keeps repository identities and explicitly projects artifact metadata', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { artifactId: 'a', name: 'Artifact', reportId: 'not interchangeable' },
    })
    const result = await getLibraryArtifact({ ...auth, resourceId: 'a' }, context)
    expect(result.output.artifact).not.toHaveProperty('reportId')
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.artifact).sort()
    )
    expect(request).toHaveBeenCalledWith(
      narrativeEndpoints.getArtifact,
      expect.objectContaining({ pathParams: { id: 'a' } })
    )
  })
  it('creates folders with only documented fields, never execution authority or credentials', async () => {
    request.mockResolvedValue({ status: 201, data: { artifactId: 'a', name: 'Folder' } })
    await createLibraryFolder({ ...auth, name: 'Folder', systemPath: '/Library' }, context)
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.createArtifact, {
      json: { name: 'Folder', systemPath: '/Library', type: 'FolderResourceType' },
      signal: context.signal,
    })
  })
  it('references an existing provider file without uploading or losing false', async () => {
    request.mockResolvedValue({ status: 201, data: { artifactId: 'a', name: 'File' } })
    await createLibraryFile(
      {
        ...auth,
        name: 'File',
        systemPath: '/Library',
        providerFile: 'uploaded-id',
        mimeType: 'application/pdf',
        overwrite: false,
      },
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.createArtifact, {
      query: { overwrite: false },
      json: {
        name: 'File',
        systemPath: '/Library',
        type: 'FileResourceType',
        file: 'uploaded-id',
        mimeType: 'application/pdf',
      },
      signal: context.signal,
    })
  })
  it('requires a successful empty delete response', async () => {
    request.mockResolvedValueOnce({ status: 204 })
    await expect(deleteLibraryArtifact({ ...auth, resourceId: 'a' }, context)).resolves.toEqual({
      success: true,
      output: { deleted: true, artifactId: 'a' },
    })
    request.mockResolvedValueOnce({ status: 200, data: {} })
    await expect(
      deleteLibraryArtifact({ ...auth, resourceId: 'a' }, context)
    ).rejects.toMatchObject({ category: 'invalid_response' })
  })
})
