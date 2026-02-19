import type { ToolConfig } from '@/tools/types'
import type {
  VercelListDeploymentFilesParams,
  VercelListDeploymentFilesResponse,
} from '@/tools/vercel/types'

export const vercelListDeploymentFilesTool: ToolConfig<
  VercelListDeploymentFilesParams,
  VercelListDeploymentFilesResponse
> = {
  id: 'vercel_list_deployment_files',
  name: 'Vercel List Deployment Files',
  description: 'List files in a Vercel deployment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The deployment ID to list files for',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListDeploymentFilesParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v6/deployments/${params.deploymentId.trim()}/files${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListDeploymentFilesParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const files = (Array.isArray(data) ? data : (data.files ?? [])).map((f: any) => ({
      name: f.name ?? null,
      type: f.type ?? null,
      uid: f.uid ?? null,
      mode: f.mode ?? null,
      contentType: f.contentType ?? null,
      children: f.children ?? [],
    }))

    return {
      success: true,
      output: {
        files,
        count: files.length,
      },
    }
  },

  outputs: {
    files: {
      type: 'array',
      description: 'List of deployment files',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name of the file tree entry' },
          type: {
            type: 'string',
            description: 'File type: directory, file, symlink, lambda, middleware, or invalid',
          },
          uid: {
            type: 'string',
            description: 'Unique file identifier (only valid for file type)',
            optional: true,
          },
          mode: { type: 'number', description: 'File mode indicating file type and permissions' },
          contentType: {
            type: 'string',
            description: 'Content-type of the file (only valid for file type)',
            optional: true,
          },
          children: {
            type: 'array',
            description: 'Child files of the directory (only valid for directory type)',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'File name' },
                type: { type: 'string', description: 'Entry type' },
                uid: { type: 'string', description: 'File identifier', optional: true },
              },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of files returned',
    },
  },
}
