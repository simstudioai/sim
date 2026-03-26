import { OpenCodeIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { coerceOpenCodeBoolean } from '@/lib/opencode/utils'
import type { BlockConfig } from '@/blocks/types'
import type { OpenCodePromptResponse } from '@/tools/opencode/types'

const isOpenCodeEnabled = isTruthy(getEnv('NEXT_PUBLIC_OPENCODE_ENABLED'))

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : undefined
}

async function getOpenCodeBlockValues(blockId: string): Promise<Record<string, unknown>> {
  const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
  const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) {
    return {}
  }

  return useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId] || {}
}

async function getOpenCodeWorkspaceId(): Promise<string | null> {
  const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
  return useWorkflowRegistry.getState().hydration.workspaceId
}

async function fetchOpenCodeOptions(
  route: string,
  query: Record<string, string | undefined>
): Promise<Array<{ label: string; id: string }>> {
  const workspaceId = await getOpenCodeWorkspaceId()
  if (!workspaceId) {
    return []
  }

  const searchParams = new URLSearchParams({ workspaceId })
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      searchParams.set(key, value)
    }
  }

  const response = await fetch(`${route}?${searchParams.toString()}`)
  const result = (await response.json().catch(() => null)) as {
    data?: Array<{ id: string; label: string }>
    error?: string
  } | null

  if (!response.ok) {
    throw new Error(result?.error || `Request failed with status ${response.status}`)
  }

  return Array.isArray(result?.data) ? result.data.map(({ id, label }) => ({ id, label })) : []
}

async function fetchOpenCodeOptionById(
  route: string,
  optionId: string,
  query: Record<string, string | undefined>
): Promise<{ label: string; id: string } | null> {
  if (!optionId) {
    return null
  }

  const options = await fetchOpenCodeOptions(route, query)
  return options.find((option) => option.id === optionId) || null
}

export const OpenCodeBlock: BlockConfig<OpenCodePromptResponse> = {
  type: 'opencode',
  name: 'OpenCode',
  description: 'Run a fixed-repository OpenCode expert inside a workflow.',
  longDescription:
    'Use the internal OpenCode server from a workflow with a fixed repository, system prompt, provider, model, and optional agent preset. The workflow can then be deployed as MCP or A2A using the normal Workflow Deployment flow.',
  docsLink: 'https://docs.sim.ai/tools/opencode',
  category: 'tools',
  bgColor: '#111827',
  icon: OpenCodeIcon,
  hideFromToolbar: !isOpenCodeEnabled,
  subBlocks: [
    {
      id: 'repository',
      title: 'Repository',
      type: 'dropdown',
      options: [],
      placeholder: 'Select a repository',
      required: true,
      fetchOptions: async () => fetchOpenCodeOptions('/api/opencode/repos', {}),
      fetchOptionById: async (blockId, _subBlockId, optionId) =>
        fetchOpenCodeOptionById('/api/opencode/repos', optionId, {}),
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'Define the role, rules, and behaviour for this OpenCode agent',
      rows: 8,
    },
    {
      id: 'providerId',
      title: 'Model Provider',
      type: 'dropdown',
      options: [],
      placeholder: 'Select a provider',
      required: true,
      dependsOn: ['repository'],
      fetchOptions: async (blockId: string) => {
        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        return fetchOpenCodeOptions('/api/opencode/providers', { repository })
      },
      fetchOptionById: async (blockId, _subBlockId, optionId) => {
        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        return fetchOpenCodeOptionById('/api/opencode/providers', optionId, {
          repository,
        })
      },
    },
    {
      id: 'modelId',
      title: 'Model ID',
      type: 'combobox',
      options: [],
      placeholder: 'Select a model',
      required: true,
      searchable: true,
      dependsOn: ['repository', 'providerId'],
      fetchOptions: async (blockId: string) => {
        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        const providerId = typeof values.providerId === 'string' ? values.providerId : undefined

        if (!providerId) {
          return []
        }

        return fetchOpenCodeOptions('/api/opencode/models', { repository, providerId })
      },
      fetchOptionById: async (blockId, _subBlockId, optionId) => {
        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        const providerId = typeof values.providerId === 'string' ? values.providerId : undefined

        if (!providerId) {
          return null
        }

        return fetchOpenCodeOptionById('/api/opencode/models', optionId, {
          repository,
          providerId,
        })
      },
    },
    {
      id: 'agent',
      title: 'Agent',
      type: 'dropdown',
      options: [],
      placeholder: 'Optional OpenCode agent preset',
      dependsOn: ['repository'],
      fetchOptions: async (blockId: string) => {
        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        const agents = await fetchOpenCodeOptions('/api/opencode/agents', { repository })
        return [{ label: 'None', id: '' }, ...agents]
      },
      fetchOptionById: async (blockId, _subBlockId, optionId) => {
        if (!optionId) {
          return { label: 'None', id: '' }
        }

        const values = await getOpenCodeBlockValues(blockId)
        const repository = typeof values.repository === 'string' ? values.repository : undefined
        return fetchOpenCodeOptionById('/api/opencode/agents', optionId, {
          repository,
        })
      },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Map this to the runtime input, e.g. <start.prompt>',
      required: true,
      rows: 5,
    },
    {
      id: 'newThreadToggle',
      title: 'New Thread',
      type: 'switch',
      canonicalParamId: 'newThread',
      mode: 'basic',
      defaultValue: false,
      description: 'Start a fresh OpenCode thread instead of reusing the caller thread.',
    },
    {
      id: 'newThreadExpression',
      title: 'New Thread',
      type: 'short-input',
      canonicalParamId: 'newThread',
      mode: 'advanced',
      placeholder: 'false or <start.new_thread>',
      description: 'Boolean expression used at runtime to force a new thread.',
    },
  ],
  tools: {
    access: ['opencode_get_messages', 'opencode_list_repos', 'opencode_prompt'],
    config: {
      tool: () => 'opencode_prompt',
      params: (params) => ({
        repository: params.repository,
        systemPrompt: getOptionalString(params.systemPrompt),
        providerId: params.providerId,
        modelId: params.modelId,
        ...(getOptionalString(params.agent) ? { agent: getOptionalString(params.agent) } : {}),
        prompt: params.prompt,
        newThread: coerceOpenCodeBoolean(params.newThread),
      }),
    },
  },
  inputs: {
    repository: { type: 'string', description: 'Repository selected for the workflow' },
    systemPrompt: { type: 'string', description: 'System prompt applied to the OpenCode agent' },
    providerId: { type: 'string', description: 'OpenCode provider identifier' },
    modelId: { type: 'string', description: 'OpenCode model identifier' },
    agent: { type: 'string', description: 'Optional OpenCode agent preset name' },
    prompt: { type: 'string', description: 'Runtime prompt sent by the caller' },
    newThread: {
      type: 'boolean',
      description: 'Whether to force creation of a new OpenCode thread for the caller',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Assistant text returned by OpenCode' },
    threadId: { type: 'string', description: 'OpenCode thread identifier used for the call' },
    cost: {
      type: 'number',
      description: 'Estimated OpenCode cost for the assistant response',
    },
    error: { type: 'string', description: 'Error message if the OpenCode call fails' },
  },
}
