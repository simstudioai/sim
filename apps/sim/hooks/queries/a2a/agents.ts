/**
 * A2A Agents React Query Hooks
 *
 * Hooks for managing A2A agents in the UI.
 */

import type { AgentSkill } from '@a2a-js/sdk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type A2AAgent,
  type A2AAgentCard,
  type CreateA2AAgentBody,
  createA2AAgentContract,
  deleteA2AAgentContract,
  getA2AAgentCardContract,
  listA2AAgentsContract,
  publishA2AAgentContract,
  type UpdateA2AAgentBody,
  updateA2AAgentContract,
} from '@/lib/api/contracts/a2a-agents'

export type { A2AAgent }

/**
 * Query keys for A2A agents
 */
export const a2aAgentKeys = {
  all: ['a2a-agents'] as const,
  lists: () => [...a2aAgentKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...a2aAgentKeys.lists(), workspaceId] as const,
  details: () => [...a2aAgentKeys.all, 'detail'] as const,
  detail: (agentId: string) => [...a2aAgentKeys.details(), agentId] as const,
  byWorkflows: () => [...a2aAgentKeys.all, 'byWorkflow'] as const,
  byWorkflow: (workspaceId: string, workflowId: string) =>
    [...a2aAgentKeys.byWorkflows(), workspaceId, workflowId] as const,
}

/**
 * Fetch A2A agents for a workspace
 */
async function fetchA2AAgents(workspaceId: string, signal?: AbortSignal): Promise<A2AAgent[]> {
  const data = await requestJson(listA2AAgentsContract, {
    query: { workspaceId },
    signal,
  })
  return data.agents
}

/**
 * Hook to list A2A agents for a workspace
 */
export function useA2AAgents(workspaceId: string) {
  return useQuery({
    queryKey: a2aAgentKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchA2AAgents(workspaceId, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Fetch a single A2A agent card (discovery document)
 */
async function fetchA2AAgentCard(agentId: string, signal?: AbortSignal): Promise<A2AAgentCard> {
  return requestJson(getA2AAgentCardContract, {
    params: { agentId },
    signal,
  })
}

/**
 * Hook to get a single A2A agent card (discovery document)
 */
export function useA2AAgentCard(agentId: string) {
  return useQuery({
    queryKey: a2aAgentKeys.detail(agentId),
    queryFn: ({ signal }) => fetchA2AAgentCard(agentId, signal),
    enabled: Boolean(agentId),
    staleTime: 5 * 60 * 1000, // 5 minutes - agent cards are relatively static
  })
}

export type CreateA2AAgentParams = CreateA2AAgentBody

/**
 * Create a new A2A agent
 */
async function createA2AAgent(params: CreateA2AAgentParams): Promise<A2AAgent> {
  const data = await requestJson(createA2AAgentContract, {
    body: params,
  })
  return data.agent
}

/**
 * Hook to create an A2A agent
 */
export function useCreateA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createA2AAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.byWorkflows(),
      })
    },
  })
}

export type UpdateA2AAgentParams = UpdateA2AAgentBody & {
  agentId: string
}

/**
 * Update an A2A agent
 */
async function updateA2AAgent(params: UpdateA2AAgentParams): Promise<A2AAgent> {
  const { agentId, ...body } = params
  const data = await requestJson(updateA2AAgentContract, {
    params: { agentId },
    body,
  })
  return data.agent
}

/**
 * Hook to update an A2A agent
 */
export function useUpdateA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateA2AAgent,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.detail(variables.agentId),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.byWorkflows(),
      })
    },
  })
}

/**
 * Delete an A2A agent
 */
async function deleteA2AAgent(params: { agentId: string; workspaceId: string }): Promise<void> {
  await requestJson(deleteA2AAgentContract, {
    params: { agentId: params.agentId },
  })
}

/**
 * Hook to delete an A2A agent
 */
export function useDeleteA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteA2AAgent,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.detail(variables.agentId),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.byWorkflows(),
      })
    },
  })
}

/**
 * Publish/unpublish agent params
 */
interface PublishA2AAgentParams {
  agentId: string
  workspaceId: string
  action: 'publish' | 'unpublish' | 'refresh'
}

/**
 * Publish or unpublish an A2A agent
 */
async function publishA2AAgent(params: PublishA2AAgentParams): Promise<{
  isPublished?: boolean
  skills?: AgentSkill[]
}> {
  return requestJson(publishA2AAgentContract, {
    params: { agentId: params.agentId },
    body: { action: params.action },
  })
}

/**
 * Hook to publish/unpublish an A2A agent
 */
export function usePublishA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: publishA2AAgent,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.detail(variables.agentId),
      })
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.byWorkflows(),
      })
    },
  })
}

/**
 * Fetch A2A agent by workflow ID
 */
async function fetchA2AAgentByWorkflow(
  workspaceId: string,
  workflowId: string,
  signal?: AbortSignal
): Promise<A2AAgent | null> {
  const data = await requestJson(listA2AAgentsContract, {
    query: { workspaceId },
    signal,
  })
  const agents = data.agents
  return agents.find((agent) => agent.workflowId === workflowId) || null
}

/**
 * Hook to get A2A agent by workflow ID
 */
export function useA2AAgentByWorkflow(workspaceId: string, workflowId: string) {
  return useQuery({
    queryKey: a2aAgentKeys.byWorkflow(workspaceId, workflowId),
    queryFn: ({ signal }) => fetchA2AAgentByWorkflow(workspaceId, workflowId, signal),
    enabled: Boolean(workspaceId) && Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds
  })
}
