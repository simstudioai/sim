import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateTemplateInput,
  createTemplateContract,
  deleteTemplateContract,
  getTemplateContract,
  listTemplatesContract,
  starTemplateContract,
  type TemplateContractData,
  type TemplateDetailContractResponse,
  type TemplateListFilters,
  type TemplatesContractResponse,
  type UpdateTemplateInput as UpdateTemplateContractInput,
  unstarTemplateContract,
  updateTemplateContract,
} from '@/lib/api/contracts/templates'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateQueries')

export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (filters?: TemplateListFilters) => [...templateKeys.lists(), filters ?? {}] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (templateId?: string) => [...templateKeys.details(), templateId ?? ''] as const,
  byWorkflows: () => [...templateKeys.all, 'byWorkflow'] as const,
  byWorkflow: (workflowId?: string) => [...templateKeys.byWorkflows(), workflowId ?? ''] as const,
}

type TemplateApi = TemplateContractData

export interface Template extends Omit<TemplateApi, 'state'> {
  state: WorkflowState
}

export interface TemplateListData extends Omit<TemplatesContractResponse, 'data'> {
  data: Template[]
}

export interface TemplateDetailData extends Omit<TemplateDetailContractResponse, 'data'> {
  data: Template
}

export type { CreateTemplateInput }
export type UpdateTemplateInput = Omit<UpdateTemplateContractInput, 'status'>

async function fetchTemplates(
  filters?: TemplateListFilters,
  signal?: AbortSignal
): Promise<TemplateListData> {
  const response = await requestJson(listTemplatesContract, {
    query: {
      search: filters?.search,
      status: filters?.status,
      workflowId: filters?.workflowId,
      includeAllStatuses: filters?.includeAllStatuses,
      limit: filters?.limit,
      offset: filters?.offset,
    },
    signal,
  })

  return response as TemplateListData
}

async function fetchTemplate(
  templateId: string,
  signal?: AbortSignal
): Promise<TemplateDetailData> {
  const response = await requestJson(getTemplateContract, {
    params: { id: templateId },
    signal,
  })

  return response as TemplateDetailData
}

async function fetchTemplateByWorkflow(
  workflowId: string,
  signal?: AbortSignal
): Promise<Template | null> {
  const result = await fetchTemplates({ workflowId, limit: 1 }, signal)
  return result.data?.[0] || null
}

export function useTemplates(
  filters?: TemplateListFilters,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: templateKeys.list(filters),
    queryFn: ({ signal }) => fetchTemplates(filters, signal),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000, // 5 minutes - templates don't change frequently
    placeholderData: keepPreviousData,
  })
}

export function useTemplate(
  templateId?: string,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: templateKeys.detail(templateId),
    queryFn: ({ signal }) => fetchTemplate(templateId as string, signal),
    enabled: (options?.enabled ?? true) && Boolean(templateId),
    staleTime: 10 * 60 * 1000, // 10 minutes - individual templates are fairly static
    select: (data) => data.data,
  })
}

export function useTemplateByWorkflow(
  workflowId?: string,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: templateKeys.byWorkflow(workflowId),
    queryFn: ({ signal }) => fetchTemplateByWorkflow(workflowId as string, signal),
    enabled: (options?.enabled ?? true) && Boolean(workflowId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateTemplateInput) => {
      return requestJson(createTemplateContract, { body: data })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
      queryClient.invalidateQueries({ queryKey: templateKeys.byWorkflow(variables.workflowId) })
      logger.info('Template created successfully')
    },
    onError: (error) => {
      logger.error('Failed to create template', error)
    },
  })
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTemplateInput }) => {
      const response = await requestJson(updateTemplateContract, {
        params: { id },
        body: data,
      })

      return response as TemplateDetailData
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.detail(id) })

      const previousTemplate = queryClient.getQueryData<TemplateDetailData>(templateKeys.detail(id))

      if (previousTemplate) {
        queryClient.setQueryData<TemplateDetailData>(templateKeys.detail(id), {
          ...previousTemplate,
          data: {
            ...previousTemplate.data,
            ...data,
            updatedAt: new Date().toISOString(),
          },
        })
      }

      return { previousTemplate }
    },
    onError: (error, { id }, context) => {
      if (context?.previousTemplate) {
        queryClient.setQueryData(templateKeys.detail(id), context.previousTemplate)
      }
      logger.error('Failed to update template', error)
    },
    onSuccess: (result, { id }) => {
      queryClient.setQueryData<TemplateDetailData>(templateKeys.detail(id), result)
      logger.info('Template updated successfully')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
      queryClient.invalidateQueries({ queryKey: templateKeys.byWorkflows() })
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (templateId: string) => {
      return requestJson(deleteTemplateContract, { params: { id: templateId } })
    },
    onSuccess: (_, templateId) => {
      queryClient.removeQueries({ queryKey: templateKeys.detail(templateId) })

      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })

      queryClient.invalidateQueries({
        queryKey: templateKeys.byWorkflows(),
      })

      logger.info('Template deleted successfully')
    },
    onError: (error) => {
      logger.error('Failed to delete template', error)
    },
  })
}

export function useStarTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      templateId,
      action,
    }: {
      templateId: string
      action: 'add' | 'remove'
    }) => {
      const contract = action === 'add' ? starTemplateContract : unstarTemplateContract
      return requestJson(contract, { params: { id: templateId } })
    },
    onMutate: async ({ templateId, action }) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.detail(templateId) })

      const previousTemplate = queryClient.getQueryData<TemplateDetailData>(
        templateKeys.detail(templateId)
      )

      if (previousTemplate) {
        const newStarCount =
          action === 'add'
            ? previousTemplate.data.stars + 1
            : Math.max(0, previousTemplate.data.stars - 1)

        queryClient.setQueryData<TemplateDetailData>(templateKeys.detail(templateId), {
          ...previousTemplate,
          data: {
            ...previousTemplate.data,
            stars: newStarCount,
            isStarred: action === 'add',
          },
        })
      }

      const listQueries = queryClient.getQueriesData<TemplateListData>({
        queryKey: templateKeys.lists(),
      })

      listQueries.forEach(([key, data]) => {
        if (!data) return
        queryClient.setQueryData<TemplateListData>(key, {
          ...data,
          data: data.data.map((template) => {
            if (template.id === templateId) {
              const newStarCount =
                action === 'add' ? template.stars + 1 : Math.max(0, template.stars - 1)
              return {
                ...template,
                stars: newStarCount,
                isStarred: action === 'add',
              }
            }
            return template
          }),
        })
      })

      return { previousTemplate }
    },
    onError: (error, { templateId }, context) => {
      if (context?.previousTemplate) {
        queryClient.setQueryData(templateKeys.detail(templateId), context.previousTemplate)
      }

      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })

      logger.error('Failed to toggle star', error)
    },
    onSettled: (_, __, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.detail(templateId) })
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}
