import type { DaytonaCreateSandboxParams, DaytonaSandboxResponse } from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  extractDaytonaError,
  mapDaytonaSandbox,
  toOptionalBoolean,
  toOptionalNumber,
} from '@/tools/daytona/utils'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

export const daytonaCreateSandboxTool: ToolConfig<
  DaytonaCreateSandboxParams,
  DaytonaSandboxResponse
> = {
  id: 'daytona_create_sandbox',
  name: 'Daytona Create Sandbox',
  description: 'Create a new Daytona sandbox for running AI-generated code in isolation',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Daytona API key',
    },
    snapshot: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID or name of the snapshot to create the sandbox from (uses default if empty)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the sandbox (defaults to the sandbox ID)',
    },
    target: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Region where the sandbox will be created (e.g., us, eu)',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User associated with the sandbox',
    },
    env: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment variables to set in the sandbox as key-value pairs',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Labels to attach to the sandbox as key-value pairs',
    },
    cpu: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'CPU cores to allocate to the sandbox',
    },
    memory: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memory to allocate to the sandbox in GB',
    },
    disk: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disk space to allocate to the sandbox in GB',
    },
    autoStopInterval: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-stop interval in minutes (0 disables auto-stop)',
    },
    autoArchiveInterval: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-archive interval in minutes (0 uses the maximum interval)',
    },
    autoDeleteInterval: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Auto-delete interval in minutes (negative disables, 0 deletes immediately on stop)',
    },
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the sandbox HTTP preview is publicly accessible',
    },
  },

  request: {
    url: `${DAYTONA_API_BASE_URL}/sandbox`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.snapshot) body.snapshot = params.snapshot
      if (params.name) body.name = params.name
      if (params.target) body.target = params.target
      if (params.user) body.user = params.user
      const env = transformTable(params.env ?? null)
      if (Object.keys(env).length > 0) body.env = env
      const labels = transformTable(params.labels ?? null)
      if (Object.keys(labels).length > 0) body.labels = labels
      const cpu = toOptionalNumber(params.cpu)
      if (cpu !== undefined) body.cpu = cpu
      const memory = toOptionalNumber(params.memory)
      if (memory !== undefined) body.memory = memory
      const disk = toOptionalNumber(params.disk)
      if (disk !== undefined) body.disk = disk
      const autoStopInterval = toOptionalNumber(params.autoStopInterval)
      if (autoStopInterval !== undefined) body.autoStopInterval = autoStopInterval
      const autoArchiveInterval = toOptionalNumber(params.autoArchiveInterval)
      if (autoArchiveInterval !== undefined) body.autoArchiveInterval = autoArchiveInterval
      const autoDeleteInterval = toOptionalNumber(params.autoDeleteInterval)
      if (autoDeleteInterval !== undefined) body.autoDeleteInterval = autoDeleteInterval
      const isPublic = toOptionalBoolean(params.public)
      if (isPublic !== undefined) body.public = isPublic
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to create sandbox'))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        sandbox: mapDaytonaSandbox(data),
      },
    }
  },

  outputs: {
    sandbox: {
      type: 'json',
      description: 'The created sandbox',
      properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
    },
  },
}
