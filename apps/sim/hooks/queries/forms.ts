import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deploymentKeys } from './deployments'

const logger = createLogger('FormMutations')

/**
 * Query keys for form-related queries
 */
export const formKeys = {
  all: ['forms'] as const,
  status: deploymentKeys.formStatus,
  detail: deploymentKeys.formDetail,
}

/**
 * Auth types for form access control
 */
export type FormAuthType = 'public' | 'password' | 'email'

/**
 * Field configuration for form fields
 */
export interface FieldConfig {
  name: string
  type: string
  label: string
  description?: string
  required?: boolean
}

/**
 * Customizations for form appearance
 */
export interface FormCustomizations {
  primaryColor?: string
  welcomeMessage?: string
  thankYouTitle?: string
  thankYouMessage?: string
  logoUrl?: string
  fieldConfigs?: FieldConfig[]
}

/**
 * Existing form data returned from API
 */
export interface ExistingForm {
  id: string
  identifier: string
  title: string
  description?: string
  customizations: FormCustomizations
  authType: FormAuthType
  hasPassword?: boolean
  allowedEmails?: string[]
  showBranding: boolean
  isActive: boolean
}

/**
 * Form status response from workflow form status API
 */
interface FormStatusResponse {
  isDeployed: boolean
  form?: {
    id: string
  }
}

/**
 * Fetches form status for a workflow
 */
async function fetchFormStatus(workflowId: string): Promise<FormStatusResponse> {
  const response = await fetch(`/api/workflows/${workflowId}/form/status`)

  if (!response.ok) {
    throw new Error('Failed to fetch form status')
  }

  return response.json()
}

/**
 * Fetches form detail by ID
 */
async function fetchFormDetail(formId: string): Promise<ExistingForm> {
  const response = await fetch(`/api/form/manage/${formId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch form details')
  }

  const data = await response.json()
  return data.form as ExistingForm
}

/**
 * Fetches form by workflow - combines status check and detail fetch
 */
async function fetchFormByWorkflow(workflowId: string): Promise<ExistingForm | null> {
  const status = await fetchFormStatus(workflowId)

  if (!status.isDeployed || !status.form?.id) {
    return null
  }

  return fetchFormDetail(status.form.id)
}

/**
 * Hook to fetch form by workflow ID.
 * Returns the existing form if deployed, null otherwise.
 */
export function useFormByWorkflow(workflowId: string | null) {
  return useQuery({
    queryKey: formKeys.status(workflowId),
    queryFn: () => fetchFormByWorkflow(workflowId!),
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: keepPreviousData,
  })
}

/**
 * Variables for create form mutation
 */
interface CreateFormVariables {
  workflowId: string
  identifier: string
  title: string
  description?: string
  customizations?: FormCustomizations
  authType?: FormAuthType
  password?: string
  allowedEmails?: string[]
  showBranding?: boolean
}

/**
 * Variables for update form mutation
 */
interface UpdateFormVariables {
  formId: string
  workflowId: string
  data: {
    identifier?: string
    title?: string
    description?: string
    customizations?: FormCustomizations
    authType?: FormAuthType
    password?: string
    allowedEmails?: string[]
    showBranding?: boolean
    isActive?: boolean
  }
}

/**
 * Variables for delete form mutation
 */
interface DeleteFormVariables {
  formId: string
  workflowId: string
}

/**
 * Response from form create mutation
 */
interface CreateFormResult {
  id: string
  formUrl: string
}

/**
 * Mutation hook for creating a new form deployment.
 * Invalidates form status queries on success.
 */
export function useCreateForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateFormVariables): Promise<CreateFormResult> => {
      const response = await fetch('/api/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle specific error cases
        if (data.error === 'Identifier already in use') {
          throw new Error('This identifier is already in use')
        }
        throw new Error(data.error || 'Failed to create form')
      }

      logger.info('Form created successfully:', { id: data.id })
      return {
        id: data.id,
        formUrl: data.formUrl,
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: formKeys.status(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to create form', { error })
    },
  })
}

/**
 * Mutation hook for updating an existing form deployment.
 * Invalidates form status and detail queries on success.
 */
export function useUpdateForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ formId, data }: UpdateFormVariables): Promise<void> => {
      const response = await fetch(`/api/form/manage/${formId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error === 'Identifier already in use') {
          throw new Error('This identifier is already in use')
        }
        throw new Error(result.error || 'Failed to update form')
      }

      logger.info('Form updated successfully:', { id: formId })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: formKeys.status(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: formKeys.detail(variables.formId),
      })
    },
    onError: (error) => {
      logger.error('Failed to update form', { error })
    },
  })
}

/**
 * Mutation hook for deleting a form deployment.
 * Invalidates form status and removes form detail from cache on success.
 */
export function useDeleteForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ formId }: DeleteFormVariables): Promise<void> => {
      const response = await fetch(`/api/form/manage/${formId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete form')
      }

      logger.info('Form deleted successfully:', { id: formId })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: formKeys.status(variables.workflowId),
      })
      queryClient.removeQueries({
        queryKey: formKeys.detail(variables.formId),
      })
    },
    onError: (error) => {
      logger.error('Failed to delete form', { error })
    },
  })
}
