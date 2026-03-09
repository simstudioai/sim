import type { SSHExecuteScriptParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const executeScriptTool: ToolConfig<SSHExecuteScriptParams, SSHResponse> = {
  id: 'ssh_execute_script',
  name: 'SSH Execute Script',
  description: 'Upload and execute a multi-line script on a remote SSH server',
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
    script: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Script content to execute (bash, python, etc.)',
    },
    interpreter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Script interpreter (default: /bin/bash)',
    },
    workingDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Working directory for script execution',
    },
  },

  request: {
    url: '/api/tools/ssh/execute-script',
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
      script: params.script,
      interpreter: params.interpreter || '/bin/bash',
      workingDirectory: params.workingDirectory,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH script execution failed')
    }

    return {
      success: true,
      output: {
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? 0,
        success: data.exitCode === 0,
        scriptPath: data.scriptPath,
        message: data.message,
      },
    }
  },

  outputs: {
    stdout: { type: 'string', description: 'Standard output from script' },
    stderr: { type: 'string', description: 'Standard error output' },
    exitCode: { type: 'number', description: 'Script exit code' },
    success: { type: 'boolean', description: 'Whether script succeeded (exit code 0)' },
    scriptPath: { type: 'string', description: 'Temporary path where script was uploaded' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
