import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson, requestRaw } from '@/lib/api/client/request'
import {
  type ActivateDeploymentVersionResponse,
  activateDeploymentVersionContract,
  type ChatDeploymentStatus,
  type ChatDetail,
  type DeploymentInfoResponse,
  type DeploymentVersionsResponse,
  type DeployWorkflowResponse,
  deployWorkflowContract,
  getChatDeploymentStatusContract,
  getChatDetailContract,
  getDeployedWorkflowStateContract,
  getDeploymentInfoContract,
  listDeploymentVersionsContract,
  type UpdateDeploymentVersionMetadataResponse,
  undeployWorkflowContract,
  updateDeploymentVersionMetadataContract,
  updatePublicApiContract,
} from '@/lib/api/contracts/deployments'
import { wandGenerateStreamContract } from '@/lib/api/contracts/hotspots'
import { fetchDeploymentVersionState } from '@/hooks/queries/utils/fetch-deployment-version-state'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeploymentQueries')

export type { ChatDetail, DeploymentVersionsResponse }

/**
 * Query key factory for deployment-related queries
 */
export const deploymentKeys = {
  all: ['deployments'] as const,
  infos: () => [...deploymentKeys.all, 'info'] as const,
  info: (workflowId: string | null) => [...deploymentKeys.infos(), workflowId ?? ''] as const,
  deployedState: (workflowId: string | null) =>
    [...deploymentKeys.all, 'deployedState', workflowId ?? ''] as const,
  allVersions: () => [...deploymentKeys.all, 'versions'] as const,
  versions: (workflowId: string | null) =>
    [...deploymentKeys.allVersions(), workflowId ?? ''] as const,
  chatStatuses: () => [...deploymentKeys.all, 'chatStatus'] as const,
  chatStatus: (workflowId: string | null) =>
    [...deploymentKeys.chatStatuses(), workflowId ?? ''] as const,
  chatDetails: () => [...deploymentKeys.all, 'chatDetail'] as const,
  chatDetail: (chatId: string | null) => [...deploymentKeys.chatDetails(), chatId ?? ''] as const,
  formStatuses: () => [...deploymentKeys.all, 'formStatus'] as const,
  formStatus: (workflowId: string | null) =>
    [...deploymentKeys.formStatuses(), workflowId ?? ''] as const,
  formDetails: () => [...deploymentKeys.all, 'formDetail'] as const,
  formDetail: (formId: string | null) => [...deploymentKeys.formDetails(), formId ?? ''] as const,
}

/**
 * Invalidates the core deployment queries (info, deployedState, versions) for a workflow.
 * Used by mutation onSuccess callbacks and manual invalidation after chat deployments.
 */
export function invalidateDeploymentQueries(queryClient: QueryClient, workflowId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: deploymentKeys.info(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.deployedState(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.chatStatus(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.formStatus(workflowId) }),
  ])
}

export async function refetchDeploymentBoundary(queryClient: QueryClient, workflowId: string) {
  await invalidateDeploymentQueries(queryClient, workflowId)
  await Promise.all([
    queryClient.refetchQueries({ queryKey: deploymentKeys.info(workflowId) }),
    queryClient.refetchQueries({ queryKey: deploymentKeys.deployedState(workflowId) }),
    queryClient.refetchQueries({ queryKey: workflowKeys.state(workflowId) }),
  ])
}

export type WorkflowDeploymentInfo = DeploymentInfoResponse & {
  deployedAt: string | null
  apiKey: string | null
  needsRedeployment: boolean
  isPublicApi: boolean
}

/**
 * Fetches deployment info for a workflow
 */
async function fetchDeploymentInfo(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowDeploymentInfo> {
  const data = await requestJson(getDeploymentInfoContract, {
    params: { id: workflowId },
    signal,
  })
  return {
    isDeployed: data.isDeployed ?? false,
    deployedAt: data.deployedAt ?? null,
    apiKey: data.apiKey ?? null,
    needsRedeployment: data.needsRedeployment ?? false,
    isPublicApi: data.isPublicApi ?? false,
  }
}

/**
 * Hook to fetch deployment info for a workflow.
 * Provides isDeployed status, deployedAt timestamp, apiKey info, and needsRedeployment flag.
 */
export function useDeploymentInfo(
  workflowId: string | null,
  options?: { enabled?: boolean; refetchOnMount?: boolean | 'always' }
) {
  return useQuery({
    queryKey: deploymentKeys.info(workflowId),
    queryFn: ({ signal }) => fetchDeploymentInfo(workflowId!, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
    ...(options?.refetchOnMount !== undefined && { refetchOnMount: options.refetchOnMount }),
  })
}

/**
 * Fetches the deployed workflow state snapshot for a workflow
 */
async function fetchDeployedWorkflowState(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowState | null> {
  const data = await requestJson(getDeployedWorkflowStateContract, {
    params: { id: workflowId },
    signal,
  })
  return data.deployedState || null
}

/**
 * Hook to fetch the deployed workflow state snapshot.
 * Returns the full workflow state at the time of the last active deployment.
 */
export function useDeployedWorkflowState(
  workflowId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: deploymentKeys.deployedState(workflowId),
    queryFn: ({ signal }) => fetchDeployedWorkflowState(workflowId!, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetches all deployment versions for a workflow
 */
async function fetchDeploymentVersions(
  workflowId: string,
  signal?: AbortSignal
): Promise<DeploymentVersionsResponse> {
  const data = await requestJson(listDeploymentVersionsContract, {
    params: { id: workflowId },
    signal,
  })
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
    queryFn: ({ signal }) => fetchDeploymentVersions(workflowId!, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Fetches chat deployment status for a workflow
 */
async function fetchChatDeploymentStatus(
  workflowId: string,
  signal?: AbortSignal
): Promise<ChatDeploymentStatus> {
  const data = await requestJson(getChatDeploymentStatusContract, {
    params: { id: workflowId },
    signal,
  })
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
    queryFn: ({ signal }) => fetchChatDeploymentStatus(workflowId!, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
  })
}

/**
 * Fetches chat detail by chat ID
 */
async function fetchChatDetail(chatId: string, signal?: AbortSignal): Promise<ChatDetail> {
  return requestJson(getChatDetailContract, {
    params: { id: chatId },
    signal,
  })
}

/**
 * Hook to fetch chat detail by chat ID.
 * Returns full chat configuration including customizations and auth settings.
 */
export function useChatDetail(chatId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: deploymentKeys.chatDetail(chatId),
    queryFn: ({ signal }) => fetchChatDetail(chatId!, signal),
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
  const queryClient = useQueryClient()
  const statusQuery = useChatDeploymentStatus(workflowId, options)

  const chatId = statusQuery.data?.deployment?.id ?? null

  const detailQuery = useChatDetail(chatId, {
    enabled: Boolean(chatId) && statusQuery.isSuccess && (options?.enabled ?? true),
  })

  const refetch = useCallback(async () => {
    const statusResult = await statusQuery.refetch()
    const nextChatId = statusResult.data?.deployment?.id
    if (nextChatId) {
      await queryClient.fetchQuery({
        queryKey: deploymentKeys.chatDetail(nextChatId),
        queryFn: ({ signal }) => fetchChatDetail(nextChatId, signal),
        staleTime: 30 * 1000,
      })
    }
  }, [queryClient, statusQuery.refetch])

  return {
    isLoading:
      statusQuery.isLoading || Boolean(statusQuery.data?.isDeployed && detailQuery.isLoading),
    isError: statusQuery.isError || detailQuery.isError,
    error: statusQuery.error ?? detailQuery.error,
    chatExists: statusQuery.data?.isDeployed ?? false,
    existingChat: detailQuery.data ?? null,
    refetch,
  }
}

/**
 * Variables for deploy workflow mutation
 */
interface DeployWorkflowVariables {
  workflowId: string
}

type DeployWorkflowResult = Omit<DeployWorkflowResponse, 'deployedAt' | 'apiKey'> & {
  deployedAt?: string
  apiKey?: string
}

/**
 * Mutation hook for deploying a workflow.
 * Invalidates deployment info and versions queries on success.
 */
export function useDeployWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId }: DeployWorkflowVariables): Promise<DeployWorkflowResult> => {
      const data = await requestJson(deployWorkflowContract, {
        params: { id: workflowId },
      })
      return {
        isDeployed: data.isDeployed ?? false,
        deployedAt: data.deployedAt ?? undefined,
        apiKey: data.apiKey ?? undefined,
        warnings: data.warnings,
      }
    },
    onSettled: (_data, error, variables) => {
      if (error) {
        logger.error('Failed to deploy workflow', { error })
        return invalidateDeploymentQueries(queryClient, variables.workflowId)
      }
      logger.info('Workflow deployed successfully', { workflowId: variables.workflowId })
      return refetchDeploymentBoundary(queryClient, variables.workflowId)
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

  return useMutation({
    mutationFn: async ({ workflowId }: UndeployWorkflowVariables) => {
      return requestJson(undeployWorkflowContract, {
        params: { id: workflowId },
      })
    },
    onSettled: (_data, error, variables) => {
      if (error) {
        logger.error('Failed to undeploy workflow', { error })
      } else {
        logger.info('Workflow undeployed successfully', { workflowId: variables.workflowId })
      }
      return Promise.all([
        invalidateDeploymentQueries(queryClient, variables.workflowId),
        queryClient.invalidateQueries({
          queryKey: deploymentKeys.chatStatus(variables.workflowId),
        }),
      ])
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

type UpdateDeploymentVersionResult = UpdateDeploymentVersionMetadataResponse

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
      return requestJson(updateDeploymentVersionMetadataContract, {
        params: { id: workflowId, version },
        body: { name, description },
      })
    },
    onSettled: (_data, error, variables) => {
      if (!error) {
        logger.info('Deployment version updated', {
          workflowId: variables.workflowId,
          version: variables.version,
        })
      } else {
        logger.error('Failed to update deployment version', { error })
      }

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
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

const VERSION_DESCRIPTION_SYSTEM_PROMPT = `You are writing deployment version descriptions for a workflow automation platform.

Write a brief, factual description (1-3 sentences, under 2000 characters) that states what changed between versions.

Guidelines:
- Use the specific values provided (credential names, channel names, model names)
- Be precise: "Changes Slack channel from #general to #alerts" not "Updates channel configuration"
- Combine related changes: "Updates Agent model to claude-sonnet-4-5 and increases temperature to 0.8"
- For added/removed blocks, mention their purpose if clear from the type

Format rules:
- Plain text only, no quotes around the response
- No markdown formatting
- No filler phrases ("for improved efficiency", "streamlining the workflow")
- No version numbers or "This version" prefixes

Examples:
- Switches Agent model from gpt-4o to claude-sonnet-4-5. Changes Slack credential to Production OAuth.
- Adds Gmail notification block for sending alerts. Removes unused Function block. Updates Router conditions.
- Updates system prompt for more concise responses. Reduces temperature from 0.7 to 0.3.
- Connects Slack block to Router. Adds 2 new workflow connections. Configures error handling path.`

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
      const { generateWorkflowDiffSummary, formatDiffSummaryForDescriptionAsync } = await import(
        '@/lib/workflows/comparison/compare'
      )

      const currentState = await fetchDeploymentVersionState(workflowId, version)

      let previousState = null
      if (version > 1) {
        try {
          previousState = await fetchDeploymentVersionState(workflowId, version - 1)
        } catch {
          // Previous version may not exist, continue without it
        }
      }

      const diffSummary = generateWorkflowDiffSummary(currentState, previousState)
      const diffText = await formatDiffSummaryForDescriptionAsync(
        diffSummary,
        currentState,
        workflowId
      )

      const wandResponse = await requestRaw(
        wandGenerateStreamContract,
        {
          body: {
            prompt: `Generate a deployment version description based on these changes:\n\n${diffText}`,
            systemPrompt: VERSION_DESCRIPTION_SYSTEM_PROMPT,
            stream: true,
            workflowId,
          },
        },
        {
          headers: {
            'Cache-Control': 'no-cache, no-transform',
          },
          cache: 'no-store',
        }
      )

      if (!wandResponse.body) {
        throw new Error('Response body is null')
      }

      const { readSSEStream } = await import('@/lib/core/utils/sse')
      const accumulatedContent = await readSSEStream(wandResponse.body, {
        onAccumulated: onStreamChunk,
      })

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

type ActivateVersionResult = ActivateDeploymentVersionResponse

/**
 * Mutation hook for activating (promoting) a specific deployment version.
 * Invalidates deployment info and versions queries on success.
 */
export function useActivateDeploymentVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      version,
    }: ActivateVersionVariables): Promise<ActivateVersionResult> => {
      return requestJson(activateDeploymentVersionContract, {
        params: { id: workflowId, version },
        body: { isActive: true },
      })
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
    onSettled: (_data, error, variables) => {
      if (!error) {
        logger.info('Deployment version activated', {
          workflowId: variables.workflowId,
          version: variables.version,
        })
      }
      return invalidateDeploymentQueries(queryClient, variables.workflowId)
    },
  })
}

/**
 * Variables for updating public API access
 */
interface UpdatePublicApiVariables {
  workflowId: string
  isPublicApi: boolean
}

/**
 * Mutation hook for toggling a workflow's public API access.
 * Invalidates deployment info query on success.
 */
export function useUpdatePublicApi() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId, isPublicApi }: UpdatePublicApiVariables) => {
      return requestJson(updatePublicApiContract, {
        params: { id: workflowId },
        body: { isPublicApi },
      })
    },
    onSettled: (_data, error, variables) => {
      if (!error) {
        logger.info('Public API setting updated', {
          workflowId: variables.workflowId,
          isPublicApi: variables.isPublicApi,
        })
      } else {
        logger.error('Failed to update public API setting', { error })
      }

      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
    },
  })
}
