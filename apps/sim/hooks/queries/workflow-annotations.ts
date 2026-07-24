import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createWorkflowAnnotationContract,
  deleteWorkflowAnnotationContract,
  listWorkflowAnnotationsContract,
  updateWorkflowAnnotationContract,
  type WorkflowAnnotationApi,
} from '@/lib/api/contracts'
import { workflowAnnotationKeys } from '@/hooks/queries/utils/workflow-annotation-keys'

export const WORKFLOW_ANNOTATIONS_STALE_TIME = 30 * 1000

const OPTIMISTIC_ID_PREFIX = 'optimistic-annotation-'

async function fetchWorkflowAnnotations(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowAnnotationApi[]> {
  const { annotations } = await requestJson(listWorkflowAnnotationsContract, {
    params: { id: workflowId },
    signal,
  })
  return annotations
}

export function useWorkflowAnnotationsQuery<TData = WorkflowAnnotationApi[]>(
  workflowId?: string,
  options?: { select?: (annotations: WorkflowAnnotationApi[]) => TData }
) {
  return useQuery({
    queryKey: workflowAnnotationKeys.list(workflowId),
    queryFn: ({ signal }) => fetchWorkflowAnnotations(workflowId as string, signal),
    enabled: Boolean(workflowId),
    staleTime: WORKFLOW_ANNOTATIONS_STALE_TIME,
    select: options?.select,
  })
}

interface CreateAnnotationVariables {
  blockId: string
  content: string
  /** Session user id, used only for the optimistic cache entry. */
  createdBy: string
}

export function useCreateWorkflowAnnotation(workflowId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: CreateAnnotationVariables) => {
      const { annotation } = await requestJson(createWorkflowAnnotationContract, {
        params: { id: workflowId as string },
        body: { blockId: variables.blockId, content: variables.content },
      })
      return annotation
    },
    onMutate: async (variables) => {
      const queryKey = workflowAnnotationKeys.list(workflowId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<WorkflowAnnotationApi[]>(queryKey)
      const now = new Date().toISOString()
      const optimistic: WorkflowAnnotationApi = {
        id: `${OPTIMISTIC_ID_PREFIX}${now}`,
        workflowId: workflowId ?? '',
        blockId: variables.blockId,
        content: variables.content,
        createdBy: variables.createdBy,
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      queryClient.setQueryData<WorkflowAnnotationApi[]>(queryKey, (current) => [
        ...(current ?? []),
        optimistic,
      ])
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(workflowAnnotationKeys.list(workflowId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workflowAnnotationKeys.list(workflowId) })
    },
  })
}

interface UpdateAnnotationVariables {
  annotationId: string
  content?: string
  resolved?: boolean
}

export function useUpdateWorkflowAnnotation(workflowId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: UpdateAnnotationVariables) => {
      const { annotation } = await requestJson(updateWorkflowAnnotationContract, {
        params: { id: workflowId as string, annotationId: variables.annotationId },
        body: { content: variables.content, resolved: variables.resolved },
      })
      return annotation
    },
    onMutate: async (variables) => {
      const queryKey = workflowAnnotationKeys.list(workflowId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<WorkflowAnnotationApi[]>(queryKey)
      queryClient.setQueryData<WorkflowAnnotationApi[]>(queryKey, (current) =>
        (current ?? []).map((annotation) =>
          annotation.id === variables.annotationId
            ? {
                ...annotation,
                content: variables.content ?? annotation.content,
                resolved: variables.resolved ?? annotation.resolved,
                updatedAt: new Date().toISOString(),
              }
            : annotation
        )
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(workflowAnnotationKeys.list(workflowId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workflowAnnotationKeys.list(workflowId) })
    },
  })
}

interface DeleteAnnotationVariables {
  annotationId: string
}

export function useDeleteWorkflowAnnotation(workflowId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: DeleteAnnotationVariables) => {
      await requestJson(deleteWorkflowAnnotationContract, {
        params: { id: workflowId as string, annotationId: variables.annotationId },
      })
    },
    onMutate: async (variables) => {
      const queryKey = workflowAnnotationKeys.list(workflowId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<WorkflowAnnotationApi[]>(queryKey)
      queryClient.setQueryData<WorkflowAnnotationApi[]>(queryKey, (current) =>
        (current ?? []).filter((annotation) => annotation.id !== variables.annotationId)
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(workflowAnnotationKeys.list(workflowId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workflowAnnotationKeys.list(workflowId) })
    },
  })
}
