import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface ArtifactGenerateParams {
  title: string
  content: string
  designInstructions?: string
  model: string
  fileName?: string
  createShareLink?: boolean
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  vertexCredential?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  _context?: WorkflowToolExecutionContext
}

export const artifactGenerateTool: ToolConfig<ArtifactGenerateParams, ToolResponse> = {
  id: 'artifact_generate',
  name: 'Generate Artifact',
  description:
    'Generate a polished, self-contained HTML artifact from workflow outputs using an LLM. The artifact is stored in the workspace Files module under an Artifacts folder and can optionally get a public share link.',
  version: '1.0.0',

  params: {
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the artifact (used as the page title and default file name).',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The data/content to present in the artifact. Reference block outputs like <blockName.output>.',
    },
    designInstructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional instructions describing the desired look and layout.',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LLM model used to generate the HTML.',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'File name for the artifact (defaults to a slug of the title).',
    },
    createShareLink: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Create a public share link for the artifact.',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for the selected model provider (omit to use hosted keys).',
    },
    azureEndpoint: { type: 'string', required: false, visibility: 'user-only' },
    azureApiVersion: { type: 'string', required: false, visibility: 'user-only' },
    vertexProject: { type: 'string', required: false, visibility: 'user-only' },
    vertexLocation: { type: 'string', required: false, visibility: 'user-only' },
    vertexCredential: { type: 'string', required: false, visibility: 'user-only' },
    bedrockAccessKeyId: { type: 'string', required: false, visibility: 'user-only' },
    bedrockSecretKey: { type: 'string', required: false, visibility: 'user-only' },
    bedrockRegion: { type: 'string', required: false, visibility: 'user-only' },
  },

  request: {
    url: '/api/tools/artifact/generate',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      title: params.title,
      content: params.content,
      designInstructions: params.designInstructions,
      model: params.model,
      fileName: params.fileName,
      createShareLink: params.createShareLink,
      apiKey: params.apiKey,
      azureEndpoint: params.azureEndpoint,
      azureApiVersion: params.azureApiVersion,
      vertexProject: params.vertexProject,
      vertexLocation: params.vertexLocation,
      vertexCredential: params.vertexCredential,
      bedrockAccessKeyId: params.bedrockAccessKeyId,
      bedrockSecretKey: params.bedrockSecretKey,
      bedrockRegion: params.bedrockRegion,
      workflowId: params._context?.workflowId,
      workspaceId: params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to generate artifact' }
    }
    return { success: true, output: data.output }
  },

  outputs: {
    file: { type: 'file', description: 'The generated HTML artifact file' },
    url: { type: 'string', description: 'URL to view the artifact' },
    shareUrl: {
      type: 'string',
      description: 'Public share link (null unless createShareLink is enabled)',
      optional: true,
    },
    title: { type: 'string', description: 'Artifact title' },
    model: { type: 'string', description: 'Model used for generation' },
  },
}
