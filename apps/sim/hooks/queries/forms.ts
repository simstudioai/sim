import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateFormInput,
  type CreateFormResponse,
  createFormContract,
  deleteFormContract,
  type ExistingForm,
  type FormAuthType,
  type FormCustomizations,
  type FormFieldConfig,
  type FormStatusResponse,
  getFormDetailContract,
  getFormStatusContract,
  type UpdateFormInput,
  updateFormContract,
} from '@/lib/api/contracts/forms'
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
export type { FormAuthType }

/**
 * Field configuration for form fields
 */
export type FieldConfig = FormFieldConfig

/**
 * Customizations for form appearance
 */
export type { FormCustomizations }

/**
 * Existing form data returned from API
 */
export type { ExistingForm }

/**
 * Form status response from workflow form status API
 */
export type { FormStatusResponse }

function throwUserFriendlyIdentifierError(error: unknown): never {
  if (error instanceof ApiClientError && error.message === 'Identifier already in use') {
    throw new Error('This identifier is already in use', { cause: error })
  }

  throw error
}

/**
 * Fetches form status for a workflow
 */
async function fetchFormStatus(
  workflowId: string,
  signal?: AbortSignal
): Promise<FormStatusResponse> {
  return requestJson(getFormStatusContract, {
    params: { id: workflowId },
    signal,
  })
}

/**
 * Fetches form detail by ID
 */
async function fetchFormDetail(formId: string, signal?: AbortSignal): Promise<ExistingForm> {
  const data = await requestJson(getFormDetailContract, {
    params: { id: formId },
    signal,
  })
  return data.form
}

/**
 * Fetches form by workflow - combines status check and detail fetch
 */
async function fetchFormByWorkflow(
  workflowId: string,
  signal?: AbortSignal
): Promise<ExistingForm | null> {
  const status = await fetchFormStatus(workflowId, signal)

  if (!status.isDeployed || !status.form?.id) {
    return null
  }

  return fetchFormDetail(status.form.id, signal)
}

/**
 * Hook to fetch form by workflow ID.
 * Returns the existing form if deployed, null otherwise.
 */
export function useFormByWorkflow(workflowId: string | null) {
  return useQuery({
    queryKey: formKeys.status(workflowId),
    queryFn: ({ signal }) => fetchFormByWorkflow(workflowId!, signal),
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: keepPreviousData,
  })
}

/**
 * Variables for create form mutation
 */
type CreateFormVariables = CreateFormInput

/**
 * Variables for update form mutation
 */
interface UpdateFormVariables {
  formId: string
  workflowId: string
  data: UpdateFormInput
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
type CreateFormResult = CreateFormResponse

/**
 * Mutation hook for creating a new form deployment.
 * Invalidates form status queries on success.
 */
export function useCreateForm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateFormVariables): Promise<CreateFormResult> => {
      try {
        const data = await requestJson(createFormContract, { body: params })
        logger.info('Form created successfully:', { id: data.id })
        return data
      } catch (error) {
        throwUserFriendlyIdentifierError(error)
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
      try {
        await requestJson(updateFormContract, {
          params: { id: formId },
          body: data,
        })
        logger.info('Form updated successfully:', { id: formId })
      } catch (error) {
        throwUserFriendlyIdentifierError(error)
      }
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
      await requestJson(deleteFormContract, { params: { id: formId } })
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
