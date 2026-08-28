/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { checkCommandExistsTool } from '@/tools/ssh/check_command_exists'
import { checkFileExistsTool } from '@/tools/ssh/check_file_exists'
import { createDirectoryTool } from '@/tools/ssh/create_directory'
import { deleteFileTool } from '@/tools/ssh/delete_file'
import { downloadFileTool } from '@/tools/ssh/download_file'
import { executeCommandTool } from '@/tools/ssh/execute_command'
import { executeScriptTool } from '@/tools/ssh/execute_script'
import { getSystemInfoTool } from '@/tools/ssh/get_system_info'
import { listDirectoryTool } from '@/tools/ssh/list_directory'
import { moveRenameTool } from '@/tools/ssh/move_rename'
import { readFileContentTool } from '@/tools/ssh/read_file_content'
import { uploadFileTool } from '@/tools/ssh/upload_file'
import { writeFileContentTool } from '@/tools/ssh/write_file_content'

const SSH_TOOLS = [
  checkCommandExistsTool,
  checkFileExistsTool,
  createDirectoryTool,
  deleteFileTool,
  downloadFileTool,
  executeCommandTool,
  executeScriptTool,
  getSystemInfoTool,
  listDirectoryTool,
  moveRenameTool,
  readFileContentTool,
  uploadFileTool,
  writeFileContentTool,
]

const CONNECTION = {
  host: 'ssh.example.com',
  port: 0,
  username: 'deploy',
  password: 'not-a-real-password',
}

describe('SSH operation declarations', () => {
  it('declares every SSH tool as operation-only', () => {
    expect(SSH_TOOLS).toHaveLength(13)
    for (const tool of SSH_TOOLS) {
      expect('request' in tool).toBe(false)
      expect(tool.operation).toEqual({ input: expect.any(Function) })
    }
  })

  it('preserves execution-time defaults and coercion in typed operation input', () => {
    expect(
      executeScriptTool.operation.input({
        ...CONNECTION,
        script: 'echo ok',
      })
    ).toEqual({
      ...CONNECTION,
      port: 22,
      privateKey: undefined,
      passphrase: undefined,
      script: 'echo ok',
      interpreter: '/bin/bash',
      workingDirectory: undefined,
    })

    expect(
      readFileContentTool.operation.input({
        ...CONNECTION,
        path: '/var/log/app.log',
      })
    ).toMatchObject({ port: 22, encoding: 'utf-8', maxSize: 10 })

    expect(
      uploadFileTool.operation.input({
        ...CONNECTION,
        fileContent: 'aGVsbG8=',
        fileName: 'hello.txt',
        remotePath: '/tmp/hello.txt',
      })
    ).toMatchObject({ port: 22, overwrite: true })
  })
})
