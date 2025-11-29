import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('TemplateQueries')

export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (filters?: TemplateListFilters) => [...templateKeys.lists(), filters ?? {}] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (templateId?: string) => [...templateKeys.details(), templateId ?? ''] as const,
  byWorkflow: (workflowId?: string) =>
    [...templateKeys.all, 'byWorkflow', workflowId ?? ''] as const,
}

export interface TemplateListFilters {
  search?: string
  status?: 'pending' | 'approved' | 'rejected'
  workflowId?: string
  limit?: number
  offset?: number
  includeAllStatuses?: boolean
}

export interface TemplateCreator {
  id: string
  name: string
  referenceType: 'user' | 'organization'
  referenceId: string
  email?: string
  website?: string
  profileImageUrl?: string | null
  details?: {
    about?: string
    xUrl?: string
    linkedinUrl?: string
    websiteUrl?: string
    contactEmail?: string
  } | null
  createdAt: string
  updatedAt: string
}

export interface Template {
  id: string
  workflowId: string
  name: string
  details?: {
    tagline?: string
    about?: string
  }
  creatorId?: string
  creator?: TemplateCreator
  views: number
  stars: number
  status: 'pending' | 'approved' | 'rejected'
  tags: string[]
  requiredCredentials: Record<string, any>
  state: any
  createdAt: string
  updatedAt: string
  isStarred?: boolean
  isSuperUser?: boolean
}

export interface TemplatesResponse {
  data: Template[]
  pagination: {
    total: number
    limit: number
    offset: number
    page: number
    totalPages: number
  }
}

export interface TemplateDetailResponse {
  data: Template
}

export interface CreateTemplateInput {
  workflowId: string
  name: string
  details?: {
    tagline?: string
    about?: string
  }
  creatorId?: string
  tags?: string[]
}

export interface UpdateTemplateInput {
  name?: string
  details?: {
    tagline?: string
    about?: string
  }
  creatorId?: string
  tags?: string[]
  updateState?: boolean
}

async function fetchTemplates(filters?: TemplateListFilters): Promise<TemplatesResponse> {
  const params = new URLSearchParams()

  if (filters?.search) params.set('search', filters.search)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.workflowId) params.set('workflowId', filters.workflowId)
  if (filters?.includeAllStatuses) params.set('includeAllStatuses', 'true')
  params.set('limit', (filters?.limit ?? 50).toString())
  params.set('offset', (filters?.offset ?? 0).toString())

  const response = await fetch(`/api/templates?${params.toString()}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch templates')
  }

  return response.json()
}

async function fetchTemplate(templateId: string): Promise<TemplateDetailResponse> {
  const response = await fetch(`/api/templates/${templateId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch template')
  }

  return response.json()
}

async function fetchTemplateByWorkflow(workflowId: string): Promise<Template | null> {
  const response = await fetch(`/api/templates?workflowId=${workflowId}&limit=1`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch template')
  }

  const result: TemplatesResponse = await response.json()
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
    queryFn: () => fetchTemplates(filters),
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
    queryFn: () => fetchTemplate(templateId as string),
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
    queryFn: () => fetchTemplateByWorkflow(workflowId as string),
    enabled: (options?.enabled ?? true) && Boolean(workflowId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateTemplateInput) => {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create template')
      }

      return response.json()
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
      const response = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to update template')
      }

      return response.json()
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.detail(id) })

      const previousTemplate = queryClient.getQueryData<TemplateDetailResponse>(
        templateKeys.detail(id)
      )

      if (previousTemplate) {
        queryClient.setQueryData<TemplateDetailResponse>(templateKeys.detail(id), {
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
      queryClient.setQueryData<TemplateDetailResponse>(templateKeys.detail(id), result)

      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })

      if (result.data?.workflowId) {
        queryClient.invalidateQueries({
          queryKey: templateKeys.byWorkflow(result.data.workflowId),
        })
      }

      logger.info('Template updated successfully')
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (templateId: string) => {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete template')
      }

      return response.json()
    },
    onSuccess: (_, templateId) => {
      queryClient.removeQueries({ queryKey: templateKeys.detail(templateId) })

      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })

      queryClient.invalidateQueries({
        queryKey: [...templateKeys.all, 'byWorkflow'],
        exact: false,
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
      const method = action === 'add' ? 'POST' : 'DELETE'
      const response = await fetch(`/api/templates/${templateId}/star`, { method })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to toggle star')
      }

      return response.json()
    },
    onMutate: async ({ templateId, action }) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.detail(templateId) })

      const previousTemplate = queryClient.getQueryData<TemplateDetailResponse>(
        templateKeys.detail(templateId)
      )

      if (previousTemplate) {
        const newStarCount =
          action === 'add'
            ? previousTemplate.data.stars + 1
            : Math.max(0, previousTemplate.data.stars - 1)

        queryClient.setQueryData<TemplateDetailResponse>(templateKeys.detail(templateId), {
          ...previousTemplate,
          data: {
            ...previousTemplate.data,
            stars: newStarCount,
            isStarred: action === 'add',
          },
        })
      }

      const listQueries = queryClient.getQueriesData<TemplatesResponse>({
        queryKey: templateKeys.lists(),
      })

      listQueries.forEach(([key, data]) => {
        if (!data) return
        queryClient.setQueryData<TemplatesResponse>(key, {
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
