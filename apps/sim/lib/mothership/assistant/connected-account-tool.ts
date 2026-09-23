import type { ToolMetadata } from '@/tools/metadata'

/** Adapt legacy GitHub API-token operations only at the Assistant boundary; Build schemas stay unchanged. */
export function projectAssistantConnectedAccountTool<T extends ToolMetadata>(
  tool: T,
  liveSearch: boolean
): T {
  if (!liveSearch || !/^github_[a-z0-9_]+$/.test(tool.id) || !tool.params.apiKey || tool.oauth)
    return tool
  return {
    ...tool,
    oauth: {
      required: true,
      provider: 'github-repositories',
      credentialKind: 'oauth',
      requiredScopes: ['repo'],
    },
    params: {
      ...tool.params,
      apiKey: { ...tool.params.apiKey, required: false, visibility: 'hidden' },
      credentialId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of your connected GitHub account. Authentication is supplied securely.',
      },
    },
  }
}

/** The destination is fixed by trusted registry metadata, never supplied by the model. */
export function assistantConnectedAccountTokenParam(tool: ToolMetadata): 'apiKey' | undefined {
  return /^github_[a-z0-9_]+$/.test(tool.id) &&
    tool.oauth?.provider === 'github-repositories' &&
    tool.params.apiKey?.visibility === 'hidden'
    ? 'apiKey'
    : undefined
}
