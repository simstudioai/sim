/**
 * @vitest-environment node
 */
import { createExecutionContext, inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { executeMicrosoftWordTool } from '@/lib/internal/microsoft-word/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { buildDocxFromContent } from '@/lib/microsoft-word/document.server'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'

const baseBody = {
  accessToken: 'token-123',
  documentId: 'doc-abc',
  content: 'Appended paragraph',
}

/** A Graph `driveItem` metadata response carrying a content tag. */
function itemResponse(cTag: string) {
  const body = {
    id: 'doc-abc',
    name: 'notes.docx',
    cTag,
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  }
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** A Graph content response carrying a real `.docx` package. */
async function docxResponse() {
  const buffer = await buildDocxFromContent('Existing paragraph')
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  }
}

/** The `createUploadSession` response carrying the preauthenticated upload URL. */
function uploadSessionResponse(uploadUrl = 'https://sn3302.up.1drv.com/up/session-abc') {
  const body = { uploadUrl, expirationDateTime: '2026-01-01T00:00:00Z' }
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function preconditionFailedResponse() {
  return {
    ok: false,
    status: 412,
    statusText: 'Precondition Failed',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'graph.microsoft.com',
  })
})

function executeTool(toolId: string, input: unknown): Promise<Response> {
  const request: InternalToolOperationCall = {
    toolId,
    input,
    headers: new Headers(),
    context: createExecutionContext({ workflowId: 'workflow-1' }),
    requestId: 'request-1',
  }
  return executeMicrosoftWordTool(request)
}

function executeAppend(input: typeof baseBody): Promise<Response> {
  return executeTool('microsoft_word_append', input)
}

describe('Microsoft Word direct input validation', () => {
  it('rejects a whitespace-only document name before provider work', async () => {
    const response = await executeTool('microsoft_word_create', {
      accessToken: 'token-123',
      name: '   ',
      content: 'Hello',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/Document name is required/),
    })
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it.each([{ folderId: 'not a valid id' }, { driveId: 'bad/../drive' }])(
    'rejects malformed create paths before provider work',
    async (extra) => {
      const response = await executeTool('microsoft_word_create', {
        accessToken: 'token-123',
        name: 'Document',
        content: 'Hello',
        ...extra,
      })

      expect(response.status).toBe(400)
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it.each([{ '': 'Acme Corp' }, '{"  ": "Acme Corp"}', '["a","b"]'])(
    'rejects an invalid template placeholder map before provider work',
    async (replacements) => {
      const response = await executeTool('microsoft_word_create_from_template', {
        accessToken: 'token-123',
        templateDocumentId: 'template-abc',
        name: 'Acme Agreement',
        replacements,
      })

      expect(response.status).toBe(400)
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )
})

describe('Microsoft Word append operation', () => {
  it('writes through a conditional upload session carrying the content tag', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(uploadSessionResponse())
      .mockResolvedValueOnce(itemResponse('tag-2'))

    const response = await executeAppend(baseBody)

    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: boolean
      output: { updatedContent: boolean }
    }
    expect(data.success).toBe(true)
    expect(data.output.updatedContent).toBe(true)

    /** Graph enforces the content precondition when it creates the upload session. */
    const sessionCall = mockSecureFetchWithPinnedIP.mock.calls.find((call) =>
      String(call[0]).endsWith('/createUploadSession')
    )
    expect(sessionCall?.[2]).toMatchObject({ method: 'POST' })
    expect(sessionCall?.[2].headers).toMatchObject({ 'if-match': 'tag-1' })

    /** The preauthenticated upload URL must not receive the bearer token. */
    const uploadCall = mockSecureFetchWithPinnedIP.mock.calls.at(-1)
    expect(uploadCall?.[0]).toBe('https://sn3302.up.1drv.com/up/session-abc')
    expect(uploadCall?.[2]).toMatchObject({ method: 'PUT' })
    expect(uploadCall?.[2].headers.Authorization).toBeUndefined()
  })

  it('refuses to overwrite when the service rejects the precondition', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(preconditionFailedResponse())

    const response = await executeAppend(baseBody)

    expect(response.status).toBe(409)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toMatch(/no other change was overwritten/)

    /** A refused upload session prevents any content write. */
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('maps a malformed document ID to a client error, not a server error', async () => {
    const response = await executeAppend({ ...baseBody, documentId: 'bad/../id' })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('refuses to write Word bytes over a drive item that is not a .docx', async () => {
    const pdf = {
      id: 'doc-abc',
      name: 'invoice.pdf',
      cTag: 'tag-1',
      file: { mimeType: 'application/pdf' },
    }
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(pdf),
      json: async () => pdf,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const response = await executeAppend(baseBody)

    expect(response.status).toBe(400)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/not a Word document/)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('reports a no-op without writing when the content adds no paragraph', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())

    const response = await executeAppend({ ...baseBody, content: '   \n  \n' })

    expect(response.status).toBe(200)
    const data = (await response.json()) as { output: { updatedContent: boolean } }
    expect(data.output.updatedContent).toBe(false)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('refuses to write when Graph reports no version to compare against', async () => {
    const untagged = {
      id: 'doc-abc',
      name: 'notes.docx',
      file: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    }
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(untagged),
      json: async () => untagged,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const response = await executeAppend(baseBody)

    expect(response.status).toBe(409)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/did not report a version/)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('surfaces a conflict raised when the bytes commit', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(uploadSessionResponse())
      .mockResolvedValueOnce(preconditionFailedResponse())

    const response = await executeAppend(baseBody)

    expect(response.status).toBe(409)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/no other change was overwritten/)
  })
})
