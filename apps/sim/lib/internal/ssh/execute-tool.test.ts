/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeSshCheckCommandExists: vi.fn(),
  executeSshCheckFileExists: vi.fn(),
  executeSshCreateDirectory: vi.fn(),
  executeSshDeleteFile: vi.fn(),
  executeSshDownloadFile: vi.fn(),
  executeSshExecuteCommand: vi.fn(),
  executeSshExecuteScript: vi.fn(),
  executeSshGetSystemInfo: vi.fn(),
  executeSshListDirectory: vi.fn(),
  executeSshMoveRename: vi.fn(),
  executeSshReadFileContent: vi.fn(),
  executeSshUploadFile: vi.fn(),
  executeSshWriteFileContent: vi.fn(),
}))

vi.mock('@/lib/internal/ssh/operations', () => operationMocks)

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { SshOperationError } from '@/lib/internal/ssh/errors'
import { executeSshTool } from '@/lib/internal/ssh/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  host: 'ssh.example.com',
  port: 22,
  username: 'deploy',
  password: 'not-a-real-password',
}

const TOOL_IDS = [
  'ssh_check_command_exists',
  'ssh_check_file_exists',
  'ssh_create_directory',
  'ssh_delete_file',
  'ssh_download_file',
  'ssh_execute_command',
  'ssh_execute_script',
  'ssh_get_system_info',
  'ssh_list_directory',
  'ssh_move_rename',
  'ssh_read_file_content',
  'ssh_upload_file',
  'ssh_write_file_content',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'ssh_execute_command',
    input: { ...CONNECTION, command: 'pwd' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeSshTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ handled: true })
    }
  })

  it('validates typed operation input and dispatches without reading a serialized body', async () => {
    const controller = new AbortController()
    const input = { ...CONNECTION, command: 'pwd' }

    const response = await executeSshTool(createRequest({ input, signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: true })
    expect(operationMocks.executeSshExecuteCommand).toHaveBeenCalledWith(input, {
      signal: controller.signal,
    })
  })

  it.each(TOOL_IDS)('recognizes canonical tool ID %s', async (toolId) => {
    const response = await executeSshTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
  })

  it('preserves expected statuses and generic error prefixes', async () => {
    operationMocks.executeSshExecuteCommand.mockRejectedValueOnce(
      new SshOperationError(409, { error: 'conflict' })
    )
    const conflict = await executeSshTool(createRequest())
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'conflict' })

    operationMocks.executeSshExecuteCommand.mockRejectedValueOnce(
      new PayloadSizeLimitError({ label: 'SSH file', maxBytes: 1, observedBytes: 2 })
    )
    const oversized = await executeSshTool(createRequest())
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toEqual({
      error: 'SSH file exceeds maximum size of 1 bytes (2 bytes received)',
    })

    operationMocks.executeSshExecuteCommand.mockRejectedValueOnce(new Error('connection reset'))
    const generic = await executeSshTool(createRequest())
    expect(generic.status).toBe(500)
    await expect(generic.json()).resolves.toEqual({
      error: 'SSH command execution failed: connection reset',
    })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeSshTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeSshExecuteCommand).not.toHaveBeenCalled()
  })

  it('rejects unsupported SSH IDs without provider work', async () => {
    const response = await executeSshTool(createRequest({ toolId: 'ssh_unknown' }))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported SSH tool: ssh_unknown' })
  })
})
