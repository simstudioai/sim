import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('DeploymentQueries')

/**
 * Query key factory for deployment-related queries
 */
export const deploymentKeys = {
  all: ['deployments'] as const,
  info: (workflowId: string | null) => [...deploymentKeys.all, 'info', workflowId ?? ''] as const,
  versions: (workflowId: string | null) =>
    [...deploymentKeys.all, 'versions', workflowId ?? ''] as const,
  chatStatus: (workflowId: string | null) =>
    [...deploymentKeys.all, 'chatStatus', workflowId ?? ''] as const,
  chatDetail: (chatId: string | null) =>
    [...deploymentKeys.all, 'chatDetail', chatId ?? ''] as const,
  formStatus: (workflowId: string | null) =>
    [...deploymentKeys.all, 'formStatus', workflowId ?? ''] as const,
  formDetail: (formId: string | null) =>
    [...deploymentKeys.all, 'formDetail', formId ?? ''] as const,
}

/**
 * Response type from /api/workflows/[id]/deploy GET endpoint
 */
export interface WorkflowDeploymentInfo {
  isDeployed: boolean
  deployedAt: string | null
  apiKey: string | null
  needsRedeployment: boolean
}

/**
 * Fetches deployment info for a workflow
 */
async function fetchDeploymentInfo(workflowId: string): Promise<WorkflowDeploymentInfo> {
  const response = await fetch(`/api/workflows/${workflowId}/deploy`)

  if (!response.ok) {
    throw new Error('Failed to fetch deployment information')
  }

  const data = await response.json()
  return {
    isDeployed: data.isDeployed ?? false,
    deployedAt: data.deployedAt ?? null,
    apiKey: data.apiKey ?? null,
    needsRedeployment: data.needsRedeployment ?? false,
  }
}

/**
 * Hook to fetch deployment info for a workflow.
 * Provides isDeployed status, deployedAt timestamp, apiKey info, and needsRedeployment flag.
 */
export function useDeploymentInfo(workflowId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: deploymentKeys.info(workflowId),
    queryFn: () => fetchDeploymentInfo(workflowId!),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Response type from /api/workflows/[id]/deployments GET endpoint
 */
export interface DeploymentVersionsResponse {
  versions: WorkflowDeploymentVersionResponse[]
}

/**
 * Fetches all deployment versions for a workflow
 */
async function fetchDeploymentVersions(workflowId: string): Promise<DeploymentVersionsResponse> {
  const response = await fetch(`/api/workflows/${workflowId}/deployments`)

  if (!response.ok) {
    throw new Error('Failed to fetch deployment versions')
  }

  const data = await response.json()
  return {
    versions: Array.isArray(data.versions) ? data.versions : [],
  }
}

/**
 * Hook to fetch deployment versions for a workflow.
 * Returns a list of all deployment versions with their metadata.
 */
export function useDeploymentVersions(workflowId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: deploymentKeys.versions(workflowId),
    queryFn: () => fetchDeploymentVersions(workflowId!),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Response type from /api/workflows/[id]/chat/status GET endpoint
 */
export interface ChatDeploymentStatus {
  isDeployed: boolean
  deployment: {
    id: string
    identifier: string
  } | null
}

/**
 * Fetches chat deployment status for a workflow
 */
async function fetchChatDeploymentStatus(workflowId: string): Promise<ChatDeploymentStatus> {
  const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

  if (!response.ok) {
    throw new Error('Failed to fetch chat deployment status')
  }

  const data = await response.json()
  return {
    isDeployed: data.isDeployed ?? false,
    deployment: data.deployment ?? null,
  }
}

/**
 * Hook to fetch chat deployment status for a workflow.
 * Returns whether a chat is deployed and basic deployment info.
 */
export function useChatDeploymentStatus(
  workflowId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: deploymentKeys.chatStatus(workflowId),
    queryFn: () => fetchChatDeploymentStatus(workflowId!),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Response type from /api/chat/manage/[id] GET endpoint
 */
export interface ChatDetail {
  id: string
  identifier: string
  title: string
  description: string
  authType: 'public' | 'password' | 'email' | 'sso'
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
    imageUrl?: string
    primaryColor?: string
  }
  isActive: boolean
  chatUrl: string
  hasPassword: boolean
}

/**
 * Fetches chat detail by chat ID
 */
async function fetchChatDetail(chatId: string): Promise<ChatDetail> {
  const response = await fetch(`/api/chat/manage/${chatId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch chat detail')
  }

  return response.json()
}

/**
 * Hook to fetch chat detail by chat ID.
 * Returns full chat configuration including customizations and auth settings.
 */
export function useChatDetail(chatId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: deploymentKeys.chatDetail(chatId),
    queryFn: () => fetchChatDetail(chatId!),
    enabled: Boolean(chatId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Combined hook to fetch chat deployment info for a workflow.
 * First fetches the chat status, then if deployed, fetches the chat detail.
 * Returns the combined result.
 */
export function useChatDeploymentInfo(workflowId: string | null, options?: { enabled?: boolean }) {
  const statusQuery = useChatDeploymentStatus(workflowId, options)

  const chatId = statusQuery.data?.deployment?.id ?? null

  const detailQuery = useChatDetail(chatId, {
    enabled: Boolean(chatId) && statusQuery.isSuccess && (options?.enabled ?? true),
  })

  return {
    isLoading:
      statusQuery.isLoading || Boolean(statusQuery.data?.isDeployed && detailQuery.isLoading),
    isError: statusQuery.isError || detailQuery.isError,
    error: statusQuery.error ?? detailQuery.error,
    chatExists: statusQuery.data?.isDeployed ?? false,
    existingChat: detailQuery.data ?? null,
    refetch: async () => {
      await statusQuery.refetch()
      if (statusQuery.data?.deployment?.id) {
        await detailQuery.refetch()
      }
    },
  }
}

/**
 * Variables for deploy workflow mutation
 */
interface DeployWorkflowVariables {
  workflowId: string
  deployChatEnabled?: boolean
}

/**
 * Response from deploy workflow mutation
 */
interface DeployWorkflowResult {
  isDeployed: boolean
  deployedAt?: string
  apiKey?: string
  warnings?: string[]
}

/**
 * Mutation hook for deploying a workflow.
 * Invalidates deployment info and versions queries on success.
 */
export function useDeployWorkflow() {
  const queryClient = useQueryClient()
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)

  return useMutation({
    mutationFn: async ({
      workflowId,
      deployChatEnabled = false,
    }: DeployWorkflowVariables): Promise<DeployWorkflowResult> => {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployChatEnabled,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to deploy workflow')
      }

      const data = await response.json()
      return {
        isDeployed: data.isDeployed ?? false,
        deployedAt: data.deployedAt,
        apiKey: data.apiKey,
        warnings: data.warnings,
      }
    },
    onSuccess: (data, variables) => {
      logger.info('Workflow deployed successfully', { workflowId: variables.workflowId })

      setDeploymentStatus(
        variables.workflowId,
        data.isDeployed,
        data.deployedAt ? new Date(data.deployedAt) : undefined,
        data.apiKey
      )

      useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(variables.workflowId, false)

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to deploy workflow', { error })
    },
  })
}

/**
 * Variables for undeploy workflow mutation
 */
interface UndeployWorkflowVariables {
  workflowId: string
}

/**
 * Mutation hook for undeploying a workflow.
 * Invalidates deployment info and versions queries on success.
 */
export function useUndeployWorkflow() {
  const queryClient = useQueryClient()
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)

  return useMutation({
    mutationFn: async ({ workflowId }: UndeployWorkflowVariables): Promise<void> => {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to undeploy workflow')
      }
    },
    onSuccess: (_, variables) => {
      logger.info('Workflow undeployed successfully', { workflowId: variables.workflowId })

      setDeploymentStatus(variables.workflowId, false)

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.chatStatus(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to undeploy workflow', { error })
    },
  })
}

/**
 * Variables for update deployment version mutation
 */
interface UpdateDeploymentVersionVariables {
  workflowId: string
  version: number
  name?: string
  description?: string | null
}

/**
 * Response from update deployment version mutation
 */
interface UpdateDeploymentVersionResult {
  name: string | null
  description: string | null
}

/**
 * Mutation hook for updating a deployment version's name or description.
 * Invalidates versions query on success.
 */
export function useUpdateDeploymentVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      version,
      name,
      description,
    }: UpdateDeploymentVersionVariables): Promise<UpdateDeploymentVersionResult> => {
      const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update deployment version')
      }

      return response.json()
    },
    onSuccess: (_, variables) => {
      logger.info('Deployment version updated', {
        workflowId: variables.workflowId,
        version: variables.version,
      })

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to update deployment version', { error })
    },
  })
}

/**
 * Variables for generating a version description
 */
interface GenerateVersionDescriptionVariables {
  workflowId: string
  version: number
  onStreamChunk?: (accumulated: string) => void
}

const VERSION_DESCRIPTION_SYSTEM_PROMPT = `You are a technical writer generating concise deployment version descriptions.

Given a diff of changes between two workflow versions, write a brief, factual description (1-2 sentences, under 300 characters) that states ONLY what changed.

RULES:
- State specific values when provided (e.g. "model changed from X to Y")
- Do NOT wrap your response in quotes
- Do NOT add filler phrases like "streamlining the workflow", "for improved efficiency"
- Do NOT use markdown formatting
- Do NOT include version numbers
- Do NOT start with "This version" or similar phrases

Good examples:
- Changes model in Agent 1 from gpt-4o to claude-sonnet-4-20250514.
- Adds Slack notification block. Updates webhook URL to production endpoint.
- Removes Function block and its connection to Router.

Bad examples:
- "Changes model..." (NO - don't wrap in quotes)
- Changes model, streamlining the workflow. (NO - don't add filler)

Respond with ONLY the plain text description.`

/**
 * Hook for generating a version description using AI based on workflow diff
 */
export function useGenerateVersionDescription() {
  return useMutation({
    mutationFn: async ({
      workflowId,
      version,
      onStreamChunk,
    }: GenerateVersionDescriptionVariables): Promise<string> => {
      const { generateWorkflowDiffSummary, formatDiffSummaryForDescription } = await import(
        '@/lib/workflows/comparison/compare'
      )

      const currentResponse = await fetch(`/api/workflows/${workflowId}/deployments/${version}`)
      if (!currentResponse.ok) {
        throw new Error('Failed to fetch current version state')
      }
      const currentData = await currentResponse.json()
      const currentState = currentData.deployedState

      let previousState = null
      if (version > 1) {
        const previousResponse = await fetch(
          `/api/workflows/${workflowId}/deployments/${version - 1}`
        )
        if (previousResponse.ok) {
          const previousData = await previousResponse.json()
          previousState = previousData.deployedState
        }
      }

      const diffSummary = generateWorkflowDiffSummary(currentState, previousState)
      const diffText = formatDiffSummaryForDescription(diffSummary)

      const wandResponse = await fetch('/api/wand', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-transform',
        },
        body: JSON.stringify({
          prompt: `Generate a deployment version description based on these changes:\n\n${diffText}`,
          systemPrompt: VERSION_DESCRIPTION_SYSTEM_PROMPT,
          stream: true,
          workflowId,
        }),
        cache: 'no-store',
      })

      if (!wandResponse.ok) {
        const errorText = await wandResponse.text()
        throw new Error(errorText || 'Failed to generate description')
      }

      if (!wandResponse.body) {
        throw new Error('Response body is null')
      }

      const reader = wandResponse.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedContent = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const lineData = line.substring(6)
              if (lineData === '[DONE]') continue

              try {
                const data = JSON.parse(lineData)
                if (data.error) throw new Error(data.error)
                if (data.chunk) {
                  accumulatedContent += data.chunk
                  onStreamChunk?.(accumulatedContent)
                }
                if (data.done) break
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (!accumulatedContent) {
        throw new Error('Failed to generate description')
      }

      return accumulatedContent.trim()
    },
    onSuccess: (content) => {
      logger.info('Generated version description', { length: content.length })
    },
    onError: (error) => {
      logger.error('Failed to generate version description', { error })
    },
  })
}

/**
 * Variables for activate version mutation
 */
interface ActivateVersionVariables {
  workflowId: string
  version: number
}

/**
 * Response from activate version mutation
 */
interface ActivateVersionResult {
  deployedAt?: string
  apiKey?: string
  warnings?: string[]
}

/**
 * Mutation hook for activating (promoting) a specific deployment version.
 * Invalidates deployment info and versions queries on success.
 */
export function useActivateDeploymentVersion() {
  const queryClient = useQueryClient()
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)

  return useMutation({
    mutationFn: async ({
      workflowId,
      version,
    }: ActivateVersionVariables): Promise<ActivateVersionResult> => {
      const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to activate version')
      }

      return response.json()
    },
    onMutate: async ({ workflowId, version }) => {
      await queryClient.cancelQueries({ queryKey: deploymentKeys.versions(workflowId) })

      const previousVersions = queryClient.getQueryData<DeploymentVersionsResponse>(
        deploymentKeys.versions(workflowId)
      )

      if (previousVersions) {
        queryClient.setQueryData<DeploymentVersionsResponse>(deploymentKeys.versions(workflowId), {
          versions: previousVersions.versions.map((v) => ({
            ...v,
            isActive: v.version === version,
          })),
        })
      }

      return { previousVersions }
    },
    onError: (_, variables, context) => {
      logger.error('Failed to activate deployment version')

      if (context?.previousVersions) {
        queryClient.setQueryData(
          deploymentKeys.versions(variables.workflowId),
          context.previousVersions
        )
      }
    },
    onSuccess: (data, variables) => {
      logger.info('Deployment version activated', {
        workflowId: variables.workflowId,
        version: variables.version,
      })

      setDeploymentStatus(
        variables.workflowId,
        true,
        data.deployedAt ? new Date(data.deployedAt) : undefined,
        data.apiKey
      )

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
  })
}
