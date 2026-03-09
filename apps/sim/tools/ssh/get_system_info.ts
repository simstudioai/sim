import type { SSHGetSystemInfoParams, SSHResponse } from '@/tools/ssh/types'
import type { ToolConfig } from '@/tools/types'

export const getSystemInfoTool: ToolConfig<SSHGetSystemInfoParams, SSHResponse> = {
  id: 'ssh_get_system_info',
  name: 'SSH Get System Info',
  description: 'Retrieve system information from the remote SSH server',
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
  },

  request: {
    url: '/api/tools/ssh/get-system-info',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SSH get system info failed')
    }

    return {
      success: true,
      output: {
        hostname: data.hostname,
        os: data.os,
        architecture: data.architecture,
        uptime: data.uptime,
        memory: data.memory,
        diskSpace: data.diskSpace,
        message: data.message,
      },
    }
  },

  outputs: {
    hostname: { type: 'string', description: 'Server hostname' },
    os: { type: 'string', description: 'Operating system (e.g., Linux, Darwin)' },
    architecture: { type: 'string', description: 'CPU architecture (e.g., x64, arm64)' },
    uptime: { type: 'number', description: 'System uptime in seconds' },
    memory: {
      type: 'json',
      description: 'Memory information (total, free, used)',
    },
    diskSpace: {
      type: 'json',
      description: 'Disk space information (total, free, used)',
    },
    message: { type: 'string', description: 'Operation status message' },
  },
}
