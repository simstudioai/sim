import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const logger = createLogger('FormQueries')

export const formKeys = {
  all: ['forms'] as const,
  lists: () => [...formKeys.all, 'list'] as const,
  list: (workflowId?: string) => [...formKeys.lists(), workflowId ?? ''] as const,
  details: () => [...formKeys.all, 'detail'] as const,
  detail: (formId?: string) => [...formKeys.details(), formId ?? ''] as const,
  byWorkflow: (workflowId?: string) => [...formKeys.all, 'byWorkflow', workflowId ?? ''] as const,
}

export interface FormCustomizations {
  primaryColor?: string
  welcomeMessage?: string
  thankYouTitle?: string
  thankYouMessage?: string
  logoUrl?: string
}

export interface Form {
  id: string
  workflowId: string
  userId: string
  identifier: string
  title: string
  description?: string
  isActive: boolean
  customizations: FormCustomizations
  authType: 'public' | 'password' | 'email'
  hasPassword?: boolean
  allowedEmails?: string[]
  showBranding: boolean
  createdAt: string
  updatedAt: string
}

export interface FormResponse {
  data: Form
}

export interface CreateFormInput {
  workflowId: string
  identifier: string
  title: string
  description?: string
  customizations?: FormCustomizations
  authType?: 'public' | 'password' | 'email'
  password?: string
  allowedEmails?: string[]
  showBranding?: boolean
}

export interface UpdateFormInput {
  identifier?: string
  title?: string
  description?: string
  customizations?: FormCustomizations
  authType?: 'public' | 'password' | 'email'
  password?: string
  allowedEmails?: string[]
  showBranding?: boolean
  isActive?: boolean
}

async function fetchFormByWorkflow(workflowId: string): Promise<Form | null> {
  const response = await fetch(`/api/workflows/${workflowId}/form/status`)

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch form')
  }

  const result = await response.json()
  return result.data || null
}

async function fetchForm(formId: string): Promise<Form> {
  const response = await fetch(`/api/form/manage/${formId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch form')
  }

  const result = await response.json()
  return result.data
}

export function useFormByWorkflow(
  workflowId?: string,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: formKeys.byWorkflow(workflowId),
    queryFn: () => fetchFormByWorkflow(workflowId as string),
    enabled: (options?.enabled ?? true) && Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds - forms may change frequently during editing
  })
}

export function useForm(
  formId?: string,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: formKeys.detail(formId),
    queryFn: () => fetchForm(formId as string),
    enabled: (options?.enabled ?? true) && Boolean(formId),
    staleTime: 30 * 1000,
  })
}

export function useCreateForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateFormInput) => {
      const response = await fetch('/api/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create form')
      }

      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() })
      queryClient.invalidateQueries({ queryKey: formKeys.byWorkflow(variables.workflowId) })
      logger.info('Form created successfully')
    },
    onError: (error) => {
      logger.error('Failed to create form', error)
    },
  })
}

export function useUpdateForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFormInput }) => {
      const response = await fetch(`/api/form/manage/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to update form')
      }

      return response.json()
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: formKeys.detail(id) })

      const previousForm = queryClient.getQueryData<Form>(formKeys.detail(id))

      if (previousForm) {
        queryClient.setQueryData<Form>(formKeys.detail(id), {
          ...previousForm,
          ...data,
          updatedAt: new Date().toISOString(),
        })
      }

      return { previousForm }
    },
    onError: (error, { id }, context) => {
      if (context?.previousForm) {
        queryClient.setQueryData(formKeys.detail(id), context.previousForm)
      }
      logger.error('Failed to update form', error)
    },
    onSuccess: (result, { id }) => {
      queryClient.setQueryData<Form>(formKeys.detail(id), result.data)
      queryClient.invalidateQueries({ queryKey: formKeys.lists() })

      if (result.data?.workflowId) {
        queryClient.invalidateQueries({
          queryKey: formKeys.byWorkflow(result.data.workflowId),
        })
      }

      logger.info('Form updated successfully')
    },
  })
}

export function useDeleteForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (formId: string) => {
      const response = await fetch(`/api/form/manage/${formId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete form')
      }

      return response.json()
    },
    onSuccess: (result, formId) => {
      queryClient.removeQueries({ queryKey: formKeys.detail(formId) })
      queryClient.invalidateQueries({ queryKey: formKeys.lists() })

      if (result.data?.workflowId) {
        queryClient.invalidateQueries({
          queryKey: formKeys.byWorkflow(result.data.workflowId),
        })
      }

      logger.info('Form deleted successfully')
    },
    onError: (error) => {
      logger.error('Failed to delete form', error)
    },
  })
}
