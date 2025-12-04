import type { SSHCheckCommandExistsParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const checkCommandExistsTool: ToolConfig<SSHCheckCommandExistsParams, SSHResponse> = {
  id: 'ssh_check_command_exists',
  name: 'SSH Check Command Exists',
  description: 'Check if a command/program exists on the remote SSH server',
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
    commandName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Command name to check (e.g., docker, git, python3)',
    },
  },

  request: {
    url: '/api/tools/ssh/check-command-exists',
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
      commandName: params.commandName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH check command exists failed')
    }

    return {
      success: true,
      output: {
        commandExists: data.exists ?? false,
        commandPath: data.path,
        version: data.version,
        message: data.message,
      },
    }
  },

  outputs: {
    commandExists: { type: 'boolean', description: 'Whether the command exists' },
    commandPath: { type: 'string', description: 'Full path to the command (if found)' },
    version: { type: 'string', description: 'Command version output (if applicable)' },
    message: { type: 'string', description: 'Operation status message' },
  },
}
