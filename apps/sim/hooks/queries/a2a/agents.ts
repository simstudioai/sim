/**
 * A2A Agents React Query Hooks
 *
 * Hooks for managing A2A agents in the UI.
 */

import type { AgentCapabilities, AgentSkill } from '@a2a-js/sdk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentAuthentication } from '@/lib/a2a/types'

/**
 * A2A Agent as returned from the API
 */
export interface A2AAgent {
  id: string
  workspaceId: string
  workflowId: string
  name: string
  description?: string
  version: string
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  authentication: AgentAuthentication
  isPublished: boolean
  publishedAt?: string
  createdAt: string
  updatedAt: string
  workflowName?: string
  workflowDescription?: string
  isDeployed?: boolean
  taskCount?: number
}

/**
 * Query keys for A2A agents
 */
export const a2aAgentKeys = {
  all: ['a2a-agents'] as const,
  list: (workspaceId: string) => [...a2aAgentKeys.all, 'list', workspaceId] as const,
  detail: (agentId: string) => [...a2aAgentKeys.all, 'detail', agentId] as const,
}

/**
 * Fetch A2A agents for a workspace
 */
async function fetchA2AAgents(workspaceId: string): Promise<A2AAgent[]> {
  const response = await fetch(`/api/a2a/agents?workspaceId=${workspaceId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch A2A agents')
  }
  const data = await response.json()
  return data.agents
}

/**
 * Hook to list A2A agents for a workspace
 */
export function useA2AAgents(workspaceId: string) {
  return useQuery({
    queryKey: a2aAgentKeys.list(workspaceId),
    queryFn: () => fetchA2AAgents(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Agent Card as returned from the agent detail endpoint
 */
export interface A2AAgentCard {
  name: string
  description?: string
  url: string
  version: string
  documentationUrl?: string
  provider?: {
    organization: string
    url?: string
  }
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  authentication?: AgentAuthentication
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
}

/**
 * Fetch a single A2A agent card (discovery document)
 */
async function fetchA2AAgentCard(agentId: string): Promise<A2AAgentCard> {
  const response = await fetch(`/api/a2a/agents/${agentId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch A2A agent')
  }
  return response.json()
}

/**
 * Hook to get a single A2A agent card (discovery document)
 */
export function useA2AAgentCard(agentId: string) {
  return useQuery({
    queryKey: a2aAgentKeys.detail(agentId),
    queryFn: () => fetchA2AAgentCard(agentId),
    enabled: Boolean(agentId),
  })
}

/**
 * Create A2A agent params
 */
export interface CreateA2AAgentParams {
  workspaceId: string
  workflowId: string
  name?: string
  description?: string
  capabilities?: AgentCapabilities
  authentication?: AgentAuthentication
  skillTags?: string[]
}

/**
 * Create a new A2A agent
 */
async function createA2AAgent(params: CreateA2AAgentParams): Promise<A2AAgent> {
  const response = await fetch('/api/a2a/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create A2A agent')
  }
  const data = await response.json()
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
      // Invalidate all a2a-agent queries (list, detail, byWorkflow, etc.)
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.all,
      })
    },
  })
}

/**
 * Update A2A agent params
 */
export interface UpdateA2AAgentParams {
  agentId: string
  name?: string
  description?: string
  version?: string
  capabilities?: AgentCapabilities
  skills?: AgentSkill[]
  authentication?: AgentAuthentication
  isPublished?: boolean
  skillTags?: string[]
}

/**
 * Update an A2A agent
 */
async function updateA2AAgent(params: UpdateA2AAgentParams): Promise<A2AAgent> {
  const { agentId, ...body } = params
  const response = await fetch(`/api/a2a/agents/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update A2A agent')
  }
  const data = await response.json()
  return data.agent
}

/**
 * Hook to update an A2A agent
 */
export function useUpdateA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateA2AAgent,
    onSuccess: () => {
      // Invalidate all a2a-agent queries (list, detail, byWorkflow, etc.)
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.all,
      })
    },
  })
}

/**
 * Delete an A2A agent
 */
async function deleteA2AAgent(params: { agentId: string; workspaceId: string }): Promise<void> {
  const response = await fetch(`/api/a2a/agents/${params.agentId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete A2A agent')
  }
}

/**
 * Hook to delete an A2A agent
 */
export function useDeleteA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteA2AAgent,
    onSuccess: () => {
      // Invalidate all a2a-agent queries (list, detail, byWorkflow, etc.)
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.all,
      })
    },
  })
}

/**
 * Publish/unpublish agent params
 */
export interface PublishA2AAgentParams {
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
  const response = await fetch(`/api/a2a/agents/${params.agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: params.action }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update A2A agent')
  }
  return response.json()
}

/**
 * Hook to publish/unpublish an A2A agent
 */
export function usePublishA2AAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: publishA2AAgent,
    onSuccess: () => {
      // Invalidate all a2a-agent queries (list, detail, byWorkflow, etc.)
      queryClient.invalidateQueries({
        queryKey: a2aAgentKeys.all,
      })
    },
  })
}

/**
 * Fetch A2A agent by workflow ID
 */
async function fetchA2AAgentByWorkflow(
  workspaceId: string,
  workflowId: string
): Promise<A2AAgent | null> {
  const response = await fetch(`/api/a2a/agents?workspaceId=${workspaceId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch A2A agents')
  }
  const data = await response.json()
  const agents = data.agents as A2AAgent[]
  return agents.find((agent) => agent.workflowId === workflowId) || null
}

/**
 * Hook to get A2A agent by workflow ID
 */
export function useA2AAgentByWorkflow(workspaceId: string, workflowId: string) {
  return useQuery({
    queryKey: [...a2aAgentKeys.all, 'byWorkflow', workspaceId, workflowId] as const,
    queryFn: () => fetchA2AAgentByWorkflow(workspaceId, workflowId),
    enabled: Boolean(workspaceId) && Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds
  })
}
