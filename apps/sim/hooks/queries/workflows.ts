import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import {
  generateCreativeWorkflowName,
  getNextWorkflowColor,
} from '@/stores/workflows/registry/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('WorkflowQueries')

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...workflowKeys.lists(), workspaceId ?? ''] as const,
}

function mapWorkflow(workflow: any): WorkflowMetadata {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    color: workflow.color,
    workspaceId: workflow.workspaceId,
    folderId: workflow.folderId,
    createdAt: new Date(workflow.createdAt),
    lastModified: new Date(workflow.updatedAt || workflow.createdAt),
  }
}

async function fetchWorkflows(workspaceId: string): Promise<WorkflowMetadata[]> {
  const response = await fetch(`/api/workflows?workspaceId=${workspaceId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }

  const { data }: { data: any[] } = await response.json()
  return data.map(mapWorkflow)
}

export function useWorkflows(workspaceId?: string, options?: { syncRegistry?: boolean }) {
  const { syncRegistry = true } = options || {}
  const beginMetadataLoad = useWorkflowRegistry((state) => state.beginMetadataLoad)
  const completeMetadataLoad = useWorkflowRegistry((state) => state.completeMetadataLoad)
  const failMetadataLoad = useWorkflowRegistry((state) => state.failMetadataLoad)

  const query = useQuery({
    queryKey: workflowKeys.list(workspaceId),
    queryFn: () => fetchWorkflows(workspaceId as string),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'pending') {
      beginMetadataLoad(workspaceId)
    }
  }, [syncRegistry, workspaceId, query.status, beginMetadataLoad])

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'success' && query.data) {
      completeMetadataLoad(workspaceId, query.data)
    }
  }, [syncRegistry, workspaceId, query.status, query.data, completeMetadataLoad])

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'error') {
      const message =
        query.error instanceof Error ? query.error.message : 'Failed to fetch workflows'
      failMetadataLoad(workspaceId, message)
    }
  }, [syncRegistry, workspaceId, query.status, query.error, failMetadataLoad])

  return query
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  color?: string
  folderId?: string | null
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables) => {
      const { workspaceId, name, description, color, folderId } = variables

      logger.info(`Creating new workflow in workspace: ${workspaceId}`)

      const createResponse = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || generateCreativeWorkflowName(),
          description: description || 'New workflow',
          color: color || getNextWorkflowColor(),
          workspaceId,
          folderId: folderId || null,
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(
          `Failed to create workflow: ${errorData.error || createResponse.statusText}`
        )
      }

      const createdWorkflow = await createResponse.json()
      const workflowId = createdWorkflow.id

      logger.info(`Successfully created workflow ${workflowId}`)

      const { workflowState } = buildDefaultWorkflowArtifacts()

      const stateResponse = await fetch(`/api/workflows/${workflowId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowState),
      })

      if (!stateResponse.ok) {
        const text = await stateResponse.text()
        logger.error('Failed to persist default Start block:', text)
      } else {
        logger.info('Successfully persisted default Start block')
      }

      return {
        id: workflowId,
        name: createdWorkflow.name,
        description: createdWorkflow.description,
        color: createdWorkflow.color,
        workspaceId,
        folderId: createdWorkflow.folderId,
      }
    },
    onSuccess: (data, variables) => {
      logger.info(`Workflow ${data.id} created successfully`)

      const { subBlockValues } = buildDefaultWorkflowArtifacts()
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [data.id]: subBlockValues,
        },
      }))

      useWorkflowRegistry.setState((state) => ({
        workflows: {
          ...state.workflows,
          [data.id]: {
            id: data.id,
            name: data.name,
            lastModified: new Date(),
            createdAt: new Date(),
            description: data.description,
            color: data.color,
            workspaceId: data.workspaceId,
            folderId: data.folderId,
          },
        },
        error: null,
      }))

      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.workspaceId) })
    },
    onError: (error: Error) => {
      logger.error('Failed to create workflow:', error)
    },
  })
}
