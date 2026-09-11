/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxDownloadFileTool, boxDownloadFileV2Tool } from '@/tools/box/download_file'
import { daytonaDownloadFileTool } from '@/tools/daytona/download_file'
import { dropboxDownloadTool, dropboxDownloadV2Tool } from '@/tools/dropbox/download'
import { getQrCodeTool, getQrCodeV2Tool } from '@/tools/dub/get_qr_code'
import {
  dataverseDownloadFileTool,
  dataverseDownloadFileV2Tool,
} from '@/tools/microsoft_dataverse/download_file'
import { personaPrintInquiryPdfTool } from '@/tools/persona/print_inquiry_pdf'
import { s3GetObjectTool } from '@/tools/s3/get_object'
import {
  downloadAttachmentTool,
  downloadAttachmentV2Tool,
} from '@/tools/servicenow/download_attachment'
import { storageDownloadTool } from '@/tools/supabase/storage_download'

interface BinaryResult {
  success: boolean
  output: Record<string, unknown>
}

interface DownloadCase {
  tool: { id: string; request: { responseType?: 'binary' }; outputs?: Record<string, unknown> }
  transform: (response: Response) => Promise<BinaryResult>
  name: string
  mimeType?: string
  checkMetadata?: (output: Record<string, unknown>, size: number) => void
}

const DOWNLOAD_CASES: DownloadCase[] = [
  {
    tool: boxDownloadFileV2Tool,
    transform: (response) => boxDownloadFileV2Tool.transformResponse!(response),
    name: 'download.pdf',
  },
  {
    tool: dropboxDownloadV2Tool,
    transform: (response) =>
      dropboxDownloadV2Tool.transformResponse!(response, { path: '/download.pdf' }),
    name: 'download.pdf',
    checkMetadata: (output, size) => {
      expect(output.metadata).toEqual({ id: 'file-1', name: 'download.pdf', size })
      expect(output.temporaryLink).toBeUndefined()
    },
  },
  {
    tool: s3GetObjectTool,
    transform: (response) =>
      s3GetObjectTool.transformResponse!(response, {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        bucketName: 'test-bucket',
        region: 'us-east-1',
        objectKey: 'folder/download.pdf',
      }),
    name: 'download.pdf',
    checkMetadata: (output, size) => {
      expect(output.metadata).toEqual({
        fileType: 'application/pdf',
        size,
        name: 'download.pdf',
        lastModified: 'Fri, 11 Sep 2026 12:00:00 GMT',
      })
      expect(output.url).toMatch(
        /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/folder\/download\.pdf\?/
      )
    },
  },
  {
    tool: storageDownloadTool,
    transform: (response) =>
      storageDownloadTool.transformResponse!(response, {
        projectId: 'project-1',
        apiKey: 'test-key',
        bucket: 'documents',
        path: 'folder/original.pdf',
        fileName: 'renamed.pdf',
      }),
    name: 'renamed.pdf',
  },
  {
    tool: daytonaDownloadFileTool,
    transform: (response) =>
      daytonaDownloadFileTool.transformResponse!(response, {
        apiKey: 'test-key',
        sandboxId: 'sandbox-1',
        filePath: '/workspace/download.pdf',
      }),
    name: 'download.pdf',
    checkMetadata: (output, size) => {
      expect(output.name).toBe('download.pdf')
      expect(output.mimeType).toBe('application/pdf')
      expect(output.size).toBe(size)
    },
  },
  {
    tool: dataverseDownloadFileV2Tool,
    transform: (response) =>
      dataverseDownloadFileV2Tool.transformResponse!(response, {
        accessToken: 'test-token',
        environmentUrl: 'https://test.crm.dynamics.com',
        entitySetName: 'accounts',
        recordId: 'record-1',
        fileColumn: 'cr_document',
      }),
    name: 'download.pdf',
    checkMetadata: (output, size) => {
      expect(output.fileName).toBe('download.pdf')
      expect(output.fileSize).toBe(size)
      expect(output.mimeType).toBe('application/pdf')
      expect(output.fileColumn).toBe('cr_document')
      expect(output.success).toBe(true)
    },
  },
  {
    tool: personaPrintInquiryPdfTool,
    transform: (response) =>
      personaPrintInquiryPdfTool.transformResponse!(response, {
        apiKey: 'test-key',
        inquiryId: 'inq_test',
      }),
    name: 'inq_test.pdf',
  },
  {
    tool: downloadAttachmentV2Tool,
    transform: (response) => downloadAttachmentV2Tool.transformResponse!(response),
    name: 'download.pdf',
  },
  {
    tool: getQrCodeV2Tool,
    transform: (response) => getQrCodeV2Tool.transformResponse!(response),
    name: 'qrcode.png',
    mimeType: 'image/png',
  },
]

function binaryResponse(buffer: Buffer, mimeType = 'application/pdf'): Response {
  return new Response(buffer, {
    headers: {
      'content-type': mimeType,
      'content-length': String(buffer.length),
      'content-disposition': 'attachment; filename="download.pdf"',
      'last-modified': 'Fri, 11 Sep 2026 12:00:00 GMT',
      'dropbox-api-result': JSON.stringify({
        id: 'file-1',
        name: 'download.pdf',
        size: buffer.length,
      }),
      'x-ms-file-name': 'download.pdf',
      'x-ms-file-size': String(buffer.length),
    },
  })
}

function expectBinaryFile(result: BinaryResult, buffer: Buffer, provider: DownloadCase): void {
  expect(result.success).toBe(true)
  const file = result.output.file as {
    name: unknown
    mimeType: unknown
    size: unknown
    data: unknown
  }
  expect(file.name).toBe(provider.name)
  expect(file.mimeType).toBe(provider.mimeType ?? 'application/pdf')
  expect(file.size).toBe(buffer.length)
  expect(Buffer.isBuffer(file.data)).toBe(true)
  if (!Buffer.isBuffer(file.data)) throw new Error('Expected raw file bytes')
  expect(file.data.length).toBe(buffer.length)
  expect(file.data.equals(buffer)).toBe(true)
  expect(result.output).not.toHaveProperty('content')
  expect(result.output).not.toHaveProperty('fileContent')
  provider.checkMetadata?.(result.output, buffer.length)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe.each(DOWNLOAD_CASES)('$tool.id binary download', (provider) => {
  it('opts into the bounded binary transfer budget', () => {
    expect(provider.tool.request.responseType).toBe('binary')
    expect(provider.tool.outputs).not.toHaveProperty('content')
    expect(provider.tool.outputs).not.toHaveProperty('fileContent')
  })

  it('returns raw bytes and file metadata above the former 10 MiB cap', async () => {
    const buffer = Buffer.alloc(11 * 1024 * 1024, 65)
    const result = await provider.transform(binaryResponse(buffer, provider.mimeType))
    expectBinaryFile(result, buffer, provider)
  })

  it('returns small downloads without inline content', async () => {
    const buffer = Buffer.from('small file contents')
    const result = await provider.transform(binaryResponse(buffer, provider.mimeType))
    expectBinaryFile(result, buffer, provider)
  })
})

const LEGACY_DOWNLOAD_CASES = [
  { tool: boxDownloadFileTool, content: 'content' },
  { tool: dropboxDownloadTool, content: 'content' },
  { tool: getQrCodeTool, content: 'content' },
  { tool: dataverseDownloadFileTool, content: 'fileContent' },
  { tool: downloadAttachmentTool, content: 'content' },
] as const

describe.each(LEGACY_DOWNLOAD_CASES)(
  '$tool.id legacy download compatibility',
  ({ tool, content }) => {
    it('retains the original response budget and inline base64 contract', async () => {
      expect(tool.request).not.toHaveProperty('responseType')
      const buffer = Buffer.from('saved workflow content')
      const result = await tool.transformResponse(binaryResponse(buffer))
      expect(result.success).toBe(true)
      expect(result.output).toHaveProperty(content, buffer.toString('base64'))
      expect(result.output.file?.data).toBe(buffer.toString('base64'))
      expect(tool.outputs).toHaveProperty(content)
    })
  }
)
