/**
 * @vitest-environment node
 */

import { jsonResponse } from '@sim/testing/helpers/http'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockSecureFetchWithValidation } = inputValidationMockFns

import { executePlaneUploadAttachment } from '@/lib/internal/plane/operations'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/notes.txt',
  name: 'notes.txt',
  size: 5,
  type: 'text/plain',
  url: '/api/files/serve?key=notes.txt',
}

const INPUT = {
  apiKey: 'plane_api_key',
  baseUrl: 'https://plane.example.com',
  workspaceSlug: 'acme',
  projectId: 'project-1',
  workItemId: 'item-1',
  file: FILE,
}

const ATTACHMENT_URL =
  'https://plane.example.com/api/v1/workspaces/acme/projects/project-1/work-items/item-1/attachments/'

function ticket(size: number, url = 'https://plane-uploads.s3.amazonaws.com/') {
  return {
    upload_data: { url, fields: { key: 'ws/abc-notes.txt', 'Content-Type': 'text/plain' } },
    asset_id: 'asset-1',
    asset_url:
      '/api/assets/v2/workspaces/acme/projects/project-1/issues/item-1/attachments/asset-1/',
    attachment: {
      id: 'asset-1',
      attributes: { name: 'notes.txt', type: 'text/plain', size },
      size,
      issue: 'item-1',
      project: 'project-1',
      is_uploaded: false,
      created_at: '2026-10-05T00:00:00Z',
      updated_at: '2026-10-05T00:00:00Z',
    },
  }
}

describe('executePlaneUploadAttachment', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain; charset=utf-8',
    })
  })

  it('requests a signed upload, posts the bytes, and confirms the attachment', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(jsonResponse(ticket(5)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const response = await executePlaneUploadAttachment(INPUT, {
      userId: 'sim-user',
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: {
        attachment: { id: 'asset-1', name: 'notes.txt', type: 'text/plain', isUploaded: true },
      },
    })
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      FILE.key,
      'sim-user',
      'request-1',
      expect.anything()
    )

    const [createUrl, createInit, createParam] = mockSecureFetchWithValidation.mock.calls[0]
    expect(createUrl).toBe(ATTACHMENT_URL)
    expect(createParam).toBe('baseUrl')
    expect(createInit).toMatchObject({ profile: 'configuredEndpoint', method: 'POST' })
    expect(createInit.headers['X-API-Key']).toBe('plane_api_key')
    expect(JSON.parse(createInit.body)).toEqual({ name: 'notes.txt', type: 'text/plain', size: 5 })

    const [uploadUrl, uploadInit] = mockSecureFetchWithValidation.mock.calls[1]
    expect(uploadUrl).toBe('https://plane-uploads.s3.amazonaws.com/')
    expect(uploadInit.profile).toBe('contentFetch')
    expect(uploadInit.headers['X-API-Key']).toBeUndefined()
    expect(uploadInit.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    const multipart = Buffer.from(uploadInit.body).toString()
    expect(multipart.indexOf('name="key"')).toBeLessThan(multipart.indexOf('name="file"'))

    const [confirmUrl, confirmInit] = mockSecureFetchWithValidation.mock.calls[2]
    expect(confirmUrl).toBe(`${ATTACHMENT_URL}asset-1/`)
    expect(confirmInit).toMatchObject({ profile: 'configuredEndpoint', method: 'PATCH' })
    expect(JSON.parse(confirmInit.body)).toEqual({ is_uploaded: true })
  })

  it('treats a storage URL on the configured Plane origin as a configured endpoint', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(jsonResponse(ticket(5, 'https://plane.example.com/uploads')))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await executePlaneUploadAttachment(INPUT, { userId: 'sim-user', requestId: 'request-1' })

    expect(mockSecureFetchWithValidation.mock.calls[1][1].profile).toBe('configuredEndpoint')
  })

  it('discards the pending attachment when the file exceeds the instance limit', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(jsonResponse(ticket(3)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const response = await executePlaneUploadAttachment(INPUT, {
      userId: 'sim-user',
      requestId: 'request-1',
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('attachment limit'),
    })
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
    expect(mockSecureFetchWithValidation.mock.calls[1][0]).toBe(`${ATTACHMENT_URL}asset-1/`)
    expect(mockSecureFetchWithValidation.mock.calls[1][1].method).toBe('DELETE')
  })

  it('discards the pending attachment when Plane rejects the upload confirmation', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(jsonResponse(ticket(5)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'You are not allowed to upload this attachment' }, 403)
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const response = await executePlaneUploadAttachment(INPUT, {
      userId: 'sim-user',
      requestId: 'request-1',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'You are not allowed to upload this attachment',
    })
    const [discardUrl, discardInit] = mockSecureFetchWithValidation.mock.calls[3]
    expect(discardUrl).toBe(`${ATTACHMENT_URL}asset-1/`)
    expect(discardInit.method).toBe('DELETE')
  })

  it('surfaces a rejected file type with the MIME type it sent', async () => {
    mockSecureFetchWithValidation.mockResolvedValueOnce(
      jsonResponse({ error: 'Invalid file type.', status: false }, 400)
    )

    const response = await executePlaneUploadAttachment(INPUT, {
      userId: 'sim-user',
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Plane does not accept attachments of type text/plain',
    })
  })

  it('returns the storage authorization denial without contacting Plane', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    const response = await executePlaneUploadAttachment(INPUT, {
      userId: 'sim-user',
      requestId: 'request-1',
    })

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mockSecureFetchWithValidation).not.toHaveBeenCalled()
  })
})
