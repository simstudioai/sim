/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  clickup: vi.fn(),
  discord: vi.fn(),
  linq: vi.fn(),
  dataverse: vi.fn(),
  servicenow: vi.fn(),
  pipedrive: vi.fn(),
}))

vi.mock('@/lib/internal/clickup/operations', () => ({
  executeClickUpUploadAttachment: operations.clickup,
}))
vi.mock('@/lib/internal/discord/operations', () => ({
  executeDiscordSendMessage: operations.discord,
}))
vi.mock('@/lib/internal/linq/operations', () => ({
  executeLinqCreateAttachment: operations.linq,
}))
vi.mock('@/lib/internal/microsoft-dataverse/operations', () => ({
  executeDataverseUploadFile: operations.dataverse,
}))
vi.mock('@/lib/internal/servicenow/operations', () => ({
  executeServiceNowUploadAttachment: operations.servicenow,
}))
vi.mock('@/lib/internal/pipedrive/operations', () => ({
  executePipedriveGetFiles: operations.pipedrive,
}))

import { ClickUpOperationError } from '@/lib/internal/clickup/errors'
import { executeClickUpTool } from '@/lib/internal/clickup/execute-tool'
import { DiscordOperationError } from '@/lib/internal/discord/errors'
import { executeDiscordTool } from '@/lib/internal/discord/execute-tool'
import { LinqOperationError } from '@/lib/internal/linq/errors'
import { executeLinqTool } from '@/lib/internal/linq/execute-tool'
import { DataverseOperationError } from '@/lib/internal/microsoft-dataverse/errors'
import { executeMicrosoftDataverseTool } from '@/lib/internal/microsoft-dataverse/execute-tool'
import { PipedriveOperationError } from '@/lib/internal/pipedrive/errors'
import { executePipedriveTool } from '@/lib/internal/pipedrive/execute-tool'
import { ServiceNowOperationError } from '@/lib/internal/servicenow/errors'
import { executeServiceNowTool } from '@/lib/internal/servicenow/execute-tool'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { clickupUploadAttachmentTool } from '@/tools/clickup/upload_attachment'
import { discordSendMessageTool } from '@/tools/discord/send_message'
import { linqCreateAttachmentTool } from '@/tools/linq/create_attachment'
import { dataverseUploadFileTool } from '@/tools/microsoft_dataverse/upload_file'
import { pipedriveGetFilesTool } from '@/tools/pipedrive/get_files'
import { uploadAttachmentTool as serviceNowUploadAttachmentTool } from '@/tools/servicenow/upload_attachment'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/file-1',
  name: 'document.txt',
  size: 3,
  type: 'text/plain',
  url: 'https://files.example/document.txt',
}

const CASES: Array<{
  execute: InternalToolOperationHandler
  input: Record<string, unknown>
  operation: ReturnType<typeof vi.fn>
  toolId: string
}> = [
  {
    toolId: 'clickup_upload_attachment',
    execute: executeClickUpTool,
    operation: operations.clickup,
    input: { accessToken: 'token', taskId: 'task-1', file: FILE },
  },
  {
    toolId: 'discord_send_message',
    execute: executeDiscordTool,
    operation: operations.discord,
    input: { botToken: 'token', channelId: '123456789012345678', content: 'hello' },
  },
  {
    toolId: 'linq_create_attachment',
    execute: executeLinqTool,
    operation: operations.linq,
    input: { apiKey: 'key', fileContent: 'YQ==', filename: 'a.txt' },
  },
  {
    toolId: 'microsoft_dataverse_upload_file',
    execute: executeMicrosoftDataverseTool,
    operation: operations.dataverse,
    input: {
      accessToken: 'token',
      environmentUrl: 'https://org.crm.dynamics.com',
      entitySetName: 'accounts',
      recordId: 'record-1',
      fileColumn: 'document',
      fileName: 'a.txt',
      fileContent: 'YQ==',
    },
  },
  {
    toolId: 'servicenow_upload_attachment',
    execute: executeServiceNowTool,
    operation: operations.servicenow,
    input: {
      instanceUrl: 'https://example.service-now.com',
      username: 'user',
      password: 'password',
      tableName: 'incident',
      recordSysId: 'record-1',
      fileName: 'a.txt',
      file: FILE,
    },
  },
  {
    toolId: 'pipedrive_get_files',
    execute: executePipedriveTool,
    operation: operations.pipedrive,
    input: { accessToken: 'token', downloadFiles: false },
  },
]

function request(
  toolId: string,
  input: unknown,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('file and message operation declarations', () => {
  it.each([
    clickupUploadAttachmentTool,
    discordSendMessageTool,
    linqCreateAttachmentTool,
    dataverseUploadFileTool,
    serviceNowUploadAttachmentTool,
    pipedriveGetFilesTool,
  ])('$id uses typed operation input without HTTP metadata', (tool) => {
    expect(tool.operation.input).toBeTypeOf('function')
    expect('request' in tool).toBe(false)
  })

  it('marks Linq model-bound files as private operation input', () => {
    const modelInput = linqCreateAttachmentTool.operation.modelInput
    if (modelInput?.mode !== 'private-provenance') {
      throw new Error('Linq file provenance is missing')
    }
    expect(
      modelInput.inputPaths({
        apiKey: 'key',
        file: 'data:text/plain;base64,{{PRIVATE_FILE}}',
      })
    ).toEqual([['file']])
    expect(modelInput.inputPaths({ apiKey: 'key', file: FILE })).toEqual([])
  })
})

describe('file and message direct handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operations)) {
      operation.mockResolvedValue({ success: true, output: {} })
    }
  })

  it.each(CASES)('dispatches $toolId with trusted context and cancellation', async (testCase) => {
    const controller = new AbortController()
    const response = await testCase.execute(
      request(testCase.toolId, testCase.input, { signal: controller.signal })
    )

    expect(response.status).toBe(200)
    expect(testCase.operation).toHaveBeenCalledWith(
      expect.objectContaining(testCase.input),
      expect.objectContaining({ requestId: 'request-1', signal: controller.signal })
    )
  })

  it.each(CASES)('authenticates $toolId before operation input parsing', async (testCase) => {
    const response = await testCase.execute(
      request(testCase.toolId, null, { context: createExecutionContext() })
    )

    expect(response.status).toBe(401)
    expect(testCase.operation).not.toHaveBeenCalled()
  })

  it.each(CASES)('does no $toolId provider work after cancellation', async (testCase) => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      testCase.execute(request(testCase.toolId, testCase.input, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(testCase.operation).not.toHaveBeenCalled()
  })

  it.each([
    [CASES[0], new ClickUpOperationError('clickup failure', 422)],
    [CASES[1], new DiscordOperationError('discord failure', 429)],
    [CASES[2], new LinqOperationError('linq failure', 502)],
    [CASES[3], new DataverseOperationError('dataverse failure', 400)],
    [CASES[4], new ServiceNowOperationError('servicenow failure', 503)],
    [CASES[5], new PipedriveOperationError('pipedrive failure', 400)],
  ])('preserves exact $0.toolId operation error status and body', async (testCase, error) => {
    testCase.operation.mockRejectedValueOnce(error)
    const response = await testCase.execute(request(testCase.toolId, testCase.input))

    expect(response.status).toBe(error.status)
    await expect(response.json()).resolves.toEqual({ success: false, error: error.message })
  })
})
