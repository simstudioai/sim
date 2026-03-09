import type { SSHExecuteCommandParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const executeCommandTool: ToolConfig<SSHExecuteCommandParams, SSHResponse> = {
  id: 'ssh_execute_command',
  name: 'SSH Execute Command',
  description: 'Execute a shell command on a remote SSH server',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SSH server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'SSH server port (default: 22)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SSH username',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for authentication (if not using private key)',
    },
    privateKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Private key for authentication (OpenSSH format)',
    },
    passphrase: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Passphrase for encrypted private key',
    },
    command: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Shell command to execute on the remote server',
    },
    workingDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Working directory for command execution',
    },
  },

  request: {
    url: '/api/tools/ssh/execute-command',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      host: params.host,
      port: Number(params.port) || 22,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
      command: params.command,
      workingDirectory: params.workingDirectory,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH command execution failed')
    }

    return {
      success: true,
      output: {
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? 0,
        success: data.exitCode === 0,
        message: data.message,
      },
    }
  },

  outputs: {
    stdout: { type: 'string', description: 'Standard output from command' },
    stderr: { type: 'string', description: 'Standard error output' },
    exitCode: { type: 'number', description: 'Command exit code' },
    success: { type: 'boolean', description: 'Whether command succeeded (exit code 0)' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
