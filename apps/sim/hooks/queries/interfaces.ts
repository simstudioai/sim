'use client'

/**
 * React Query hooks for workspace interfaces.
 */

import { toast } from '@sim/emcn'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  extractValidationIssues,
  isApiClientError,
  isValidationError,
} from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateInterfaceBodyInput,
  createInterfaceContract,
  deleteInterfaceContract,
  getInterfaceContract,
  listInterfacesContract,
  restoreInterfaceContract,
  type SubmitInterfaceFormValues,
  submitInterfaceFormContract,
  updateInterfaceContract,
} from '@/lib/api/contracts/interfaces'
import type { InterfaceDefinition, InterfaceLayout } from '@/lib/interfaces'
import {
  INTERFACE_DETAIL_STALE_TIME,
  INTERFACE_LIST_STALE_TIME,
  type InterfaceQueryScope,
  interfaceKeys,
} from '@/hooks/queries/utils/interface-keys'

async function fetchInterfaces(
  workspaceId: string,
  scope: InterfaceQueryScope,
  signal?: AbortSignal
): Promise<InterfaceDefinition[]> {
  const response = await requestJson(listInterfacesContract, {
    query: { workspaceId, scope },
    signal,
  })
  return response.data.interfaces
}

async function fetchInterface(
  workspaceId: string,
  interfaceId: string,
  signal?: AbortSignal
): Promise<InterfaceDefinition> {
  const response = await requestJson(getInterfaceContract, {
    params: { interfaceId },
    query: { workspaceId },
    signal,
  })
  return response.data
}

/** Patch an interface across every cached list (any scope) it appears in. */
function patchCachedLists(
  queryClient: ReturnType<typeof useQueryClient>,
  interfaceId: string,
  patch: (definition: InterfaceDefinition) => InterfaceDefinition
) {
  queryClient.setQueriesData<InterfaceDefinition[]>({ queryKey: interfaceKeys.lists() }, (old) =>
    old?.map((definition) => (definition.id === interfaceId ? patch(definition) : definition))
  )
}

/**
 * Fetch all interfaces for a workspace.
 */
export function useInterfacesList(workspaceId?: string, scope: InterfaceQueryScope = 'active') {
  return useQuery({
    queryKey: interfaceKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchInterfaces(workspaceId as string, scope, signal),
    enabled: Boolean(workspaceId),
    staleTime: INTERFACE_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch a single interface by id.
 *
 * Errors are rethrown to the nearest error boundary: a deleted or
 * cross-workspace id resolves to no data at all, and the editor rendered
 * against `undefined` is a permanently blank canvas with a `…` breadcrumb.
 * The route's co-located `error.tsx` is the surface for that case.
 */
export function useInterface(workspaceId: string | undefined, interfaceId: string | undefined) {
  // rq-lint-allow: interfaceId is a globally-unique id; workspaceId is only an authz scope on the fetch and cannot collide across workspaces
  return useQuery({
    queryKey: interfaceKeys.detail(interfaceId ?? ''),
    queryFn: ({ signal }) => fetchInterface(workspaceId as string, interfaceId as string, signal),
    enabled: Boolean(workspaceId && interfaceId),
    staleTime: INTERFACE_DETAIL_STALE_TIME,
    throwOnError: true,
  })
}

/**
 * Create a new interface in a workspace.
 */
export function useCreateInterface(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: Omit<CreateInterfaceBodyInput, 'workspaceId'>) =>
      requestJson(createInterfaceContract, {
        body: { ...params, workspaceId },
      }),
    // Create has no inline validation surface — the issue message (or the 409
    // name-conflict message) must reach the user as a toast.
    onError: (error) => {
      toast.error(extractValidationIssues(error)[0]?.message ?? error.message, { duration: 5000 })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: interfaceKeys.lists() })
    },
  })
}

interface RenameInterfaceVariables {
  interfaceId: string
  name: string
}

interface RenameInterfaceContext {
  previousLists: Array<[readonly unknown[], InterfaceDefinition[] | undefined]>
  previousDetail: InterfaceDefinition | undefined
}

/**
 * Rename an interface, optimistically patching the cached lists and detail so
 * the row and breadcrumb update instantly.
 */
export function useRenameInterface(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ interfaceId, name }: RenameInterfaceVariables) =>
      requestJson(updateInterfaceContract, {
        params: { interfaceId },
        body: { workspaceId, name },
      }),
    onMutate: async ({ interfaceId, name }): Promise<RenameInterfaceContext> => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: interfaceKeys.lists() }),
        queryClient.cancelQueries({ queryKey: interfaceKeys.detail(interfaceId) }),
      ])
      const previousLists = queryClient.getQueriesData<InterfaceDefinition[]>({
        queryKey: interfaceKeys.lists(),
      })
      const previousDetail = queryClient.getQueryData<InterfaceDefinition>(
        interfaceKeys.detail(interfaceId)
      )
      patchCachedLists(queryClient, interfaceId, (definition) => ({ ...definition, name }))
      if (previousDetail) {
        queryClient.setQueryData<InterfaceDefinition>(interfaceKeys.detail(interfaceId), {
          ...previousDetail,
          name,
        })
      }
      return { previousLists, previousDetail }
    },
    // Inline rename reverts the field on failure with no message of its own,
    // so the validation issue (or the 409 name-conflict message) must surface
    // as a toast.
    onError: (error, { interfaceId }, context) => {
      for (const [queryKey, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(queryKey, data)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(interfaceKeys.detail(interfaceId), context.previousDetail)
      }
      toast.error(extractValidationIssues(error)[0]?.message ?? error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { interfaceId }) => {
      queryClient.invalidateQueries({ queryKey: interfaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: interfaceKeys.detail(interfaceId) })
    },
  })
}

interface UpdateInterfaceVariables {
  interfaceId: string
  name?: string
  /** Omitted = unchanged; `null` = clear. */
  description?: string | null
  layout?: InterfaceLayout
  /**
   * Optimistic-concurrency precondition — the `updatedAt` this layout was
   * derived from. The server rejects the write with a 409 when the stored row
   * has moved on. Layout writes only; name and description are last-write-wins.
   */
  expectedUpdatedAt?: string
}

interface UpdateInterfaceContext {
  previousDetail: InterfaceDefinition | undefined
}

/**
 * `INTERFACE_STALE_WRITE` shares its 409 with the name-conflict error, so the
 * body's `code` is what tells them apart.
 */
function isStaleWriteError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 409 && error.code === 'INTERFACE_STALE_WRITE'
}

/**
 * Shown instead of the server's message on a stale write: the server tells the
 * caller to reload, but the `onSettled` invalidation below already refetches
 * the record, so the editor re-renders on the latest version on its own.
 */
const STALE_WRITE_MESSAGE =
  'This interface was changed elsewhere. Your edit was not saved — loading the latest version.'

/**
 * Patch an interface's name, description, and/or layout. The cached detail is
 * patched optimistically so the editor's local draft and the cache never
 * visibly diverge while a save is in flight.
 */
export function useUpdateInterface(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      interfaceId,
      name,
      description,
      layout,
      expectedUpdatedAt,
    }: UpdateInterfaceVariables) =>
      requestJson(updateInterfaceContract, {
        params: { interfaceId },
        body: { workspaceId, name, description, layout, expectedUpdatedAt },
      }),
    onMutate: async ({
      interfaceId,
      name,
      description,
      layout,
    }): Promise<UpdateInterfaceContext> => {
      await queryClient.cancelQueries({ queryKey: interfaceKeys.detail(interfaceId) })
      const previousDetail = queryClient.getQueryData<InterfaceDefinition>(
        interfaceKeys.detail(interfaceId)
      )
      if (previousDetail) {
        queryClient.setQueryData<InterfaceDefinition>(interfaceKeys.detail(interfaceId), {
          ...previousDetail,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(layout !== undefined ? { layout } : {}),
        })
      }
      return { previousDetail }
    },
    /**
     * Adopt the server's record straight away rather than waiting for the
     * `onSettled` refetch: it carries the new `updatedAt`, which the next
     * layout write sends as its precondition. Without this, an edit made inside
     * the refetch window would assert a superseded `updatedAt` and 409 against
     * this client's own previous write.
     */
    onSuccess: (response, { interfaceId }) => {
      queryClient.setQueryData(interfaceKeys.detail(interfaceId), response.data)
    },
    // The editor has no inline validation surface for layout writes (e.g. a
    // cross-workspace reference rejection), so the issue message must surface
    // as a toast.
    onError: (error, { interfaceId }, context) => {
      /**
       * The rollback runs on a stale write too — the optimistic layout was
       * never persisted, so it must come off the cache either way. What it
       * restores is itself out of date, which is why the `onSettled`
       * invalidation below is the thing that actually repairs the editor; the
       * toast only explains why the edit disappeared.
       */
      if (context?.previousDetail) {
        queryClient.setQueryData(interfaceKeys.detail(interfaceId), context.previousDetail)
      }
      if (isStaleWriteError(error)) {
        toast.error(STALE_WRITE_MESSAGE, { duration: 5000 })
        return
      }
      toast.error(extractValidationIssues(error)[0]?.message ?? error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { interfaceId }) => {
      queryClient.invalidateQueries({ queryKey: interfaceKeys.detail(interfaceId) })
      queryClient.invalidateQueries({ queryKey: interfaceKeys.lists() })
    },
  })
}

/**
 * Archive (soft-delete) an interface.
 */
export function useDeleteInterface(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (interfaceId: string) =>
      requestJson(deleteInterfaceContract, {
        params: { interfaceId },
        query: { workspaceId },
      }),
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, interfaceId) => {
      queryClient.invalidateQueries({ queryKey: interfaceKeys.lists() })
      queryClient.removeQueries({ queryKey: interfaceKeys.detail(interfaceId) })
    },
  })
}

/**
 * Restore an archived interface.
 */
export function useRestoreInterface(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (interfaceId: string) =>
      requestJson(restoreInterfaceContract, {
        params: { interfaceId },
        body: { workspaceId },
      }),
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, interfaceId) => {
      queryClient.invalidateQueries({ queryKey: interfaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: interfaceKeys.detail(interfaceId) })
    },
  })
}

interface SubmitInterfaceFormVariables {
  interfaceId: string
  moduleId: string
  /** Keyed by field id (stable across renames), not field name. */
  values: SubmitInterfaceFormValues
}

/**
 * Submit a form module's values, executing its connected workflow. Per-field
 * validation errors (400 with `details`) are surfaced inline by the form
 * module, not toasted here.
 */
export function useSubmitInterfaceForm(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ interfaceId, moduleId, values }: SubmitInterfaceFormVariables) =>
      requestJson(submitInterfaceFormContract, {
        params: { interfaceId, moduleId },
        body: { workspaceId, values },
      }),
    // Per-field errors render inline, so they carry no toast — but the server
    // validated against field definitions the visitor's cached copy may have
    // fallen behind, so refetch the definition to re-render the form against
    // the fields that actually rejected it.
    onError: (error, { interfaceId }) => {
      if (isValidationError(error)) {
        queryClient.invalidateQueries({ queryKey: interfaceKeys.detail(interfaceId) })
        return
      }
      toast.error(error.message, { duration: 5000 })
    },
  })
}
