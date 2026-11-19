import { toError } from '@sim/utils/errors'
import { VERCEL_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { VercelCreateProjectParams, VercelCreateProjectResponse } from '@/tools/vercel/types'

/** The `nodeVersion` values Vercel's update-project endpoint accepts (openapi.vercel.sh). */
const VERCEL_NODE_VERSIONS = [
  '26.x',
  '24.x',
  '22.x',
  '20.x',
  '18.x',
  '16.x',
  '14.x',
  '12.x',
  '10.x',
]

export const vercelCreateProjectTool: ToolConfig<
  VercelCreateProjectParams,
  VercelCreateProjectResponse
> = {
  id: 'vercel_create_project',
  name: 'Vercel Create Project',
  description: 'Create a new Vercel project',
  version: '1.0.0',
  oauth: VERCEL_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    framework: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project framework (e.g. nextjs, remix, vite)',
    },
    gitRepository: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git repository connection object with type and repo',
    },
    buildCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom build command',
    },
    outputDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom output directory',
    },
    installCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom install command',
    },
    rootDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subdirectory of the repository the project lives in (for monorepos)',
    },
    nodeVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Node.js version to use (e.g. 22.x, 20.x, 18.x)',
    },
    devCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom dev server command',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelCreateProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v11/projects${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateProjectParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateProjectParams) => {
      // Checked before the create call: the version is applied by a follow-up update, and an
      // invalid one would fail only after the project already exists.
      const nodeVersion = params.nodeVersion == null ? '' : String(params.nodeVersion).trim()
      if (nodeVersion && !VERCEL_NODE_VERSIONS.includes(nodeVersion)) {
        throw new Error(
          `Invalid Node.js version "${nodeVersion}". Use one of: ${VERCEL_NODE_VERSIONS.join(', ')}`
        )
      }
      const body: Record<string, unknown> = { name: params.name.trim() }
      if (params.framework) body.framework = params.framework.trim()
      if (params.gitRepository) body.gitRepository = params.gitRepository
      if (params.buildCommand) body.buildCommand = params.buildCommand.trim()
      if (params.outputDirectory) body.outputDirectory = params.outputDirectory.trim()
      if (params.installCommand) body.installCommand = params.installCommand.trim()
      if (params.rootDirectory) body.rootDirectory = params.rootDirectory.trim()
      if (params.devCommand) body.devCommand = params.devCommand.trim()
      return body
    },
  },

  /**
   * Vercel's create-project body rejects `nodeVersion` (it allows no additional properties), so the
   * version is applied with a follow-up update once the project exists.
   */
  postProcess: async (result, params, executeTool) => {
    const nodeVersion = params.nodeVersion?.trim()
    if (!result.success || !nodeVersion) return result

    let update: ToolResponse
    try {
      update = await executeTool('vercel_update_project', {
        apiKey: params.apiKey,
        projectId: result.output.id,
        nodeVersion,
        teamId: params.teamId,
        slug: params.slug,
      })
    } catch (error) {
      update = { success: false, output: {}, error: toError(error).message }
    }
    if (update.success) {
      const updatedAt = update.output?.updatedAt
      return typeof updatedAt === 'number'
        ? { ...result, output: { ...result.output, updatedAt } }
        : result
    }

    return {
      ...result,
      success: false,
      error: `Project ${result.output.name} (${result.output.id}) was created, but setting Node.js version ${nodeVersion} failed: ${update.error ?? 'unknown error'}`,
    }
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        framework: data.framework ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    framework: { type: 'string', description: 'Project framework', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last updated timestamp' },
  },
}
