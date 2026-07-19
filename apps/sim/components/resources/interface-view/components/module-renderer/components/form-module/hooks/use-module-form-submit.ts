'use client'

import { useCallback } from 'react'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import type { SubmitInterfaceFormValues } from '@/lib/api/contracts/interfaces'
import { useSubmitInterfaceForm } from '@/hooks/queries/interfaces'
import { useSubmitPublicInterfaceForm } from '@/hooks/queries/public-interfaces'

export interface ModuleFormSubmitOptions {
  onSuccess?: () => void
  onError?: (error: unknown) => void
}

export interface UseModuleFormSubmitResult {
  submit: (values: SubmitInterfaceFormValues, options?: ModuleFormSubmitOptions) => void
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
  reset: () => void
}

/**
 * Runs a form module's submission through whichever source the interface is
 * mounted against, so `FormModule` renders and reports errors one way in both.
 *
 * The two routes differ only in how they authorize: the workspace route by
 * session and workspace permission, the public route by share token — and both
 * validate the submitted values against the **stored** field definitions, so
 * the per-field `details` the form renders inline have the same shape either
 * way.
 *
 * Both mutations are created on every render; only the source's own is ever
 * fired, so the inactive one issues no request.
 */
export function useModuleFormSubmit(moduleId: string): UseModuleFormSubmitResult {
  const { source } = useResourceOfKind('interface')
  const isWorkspaceScope = source.via === 'workspace'

  const workspaceSubmit = useSubmitInterfaceForm(
    source.via === 'workspace' ? source.workspaceId : ''
  )
  const shareSubmit = useSubmitPublicInterfaceForm(source.via === 'share' ? source.token : '')

  const interfaceId = source.via === 'workspace' ? source.resourceId : ''
  const workspaceMutate = workspaceSubmit.mutate
  const shareMutate = shareSubmit.mutate

  const submit = useCallback(
    (values: SubmitInterfaceFormValues, options?: ModuleFormSubmitOptions) => {
      if (isWorkspaceScope) {
        workspaceMutate({ interfaceId, moduleId, values }, options)
        return
      }
      shareMutate({ moduleId, values }, options)
    },
    [isWorkspaceScope, workspaceMutate, shareMutate, interfaceId, moduleId]
  )

  /**
   * The one scope's mutation every status read goes through. `reset` is
   * returned directly — TanStack v5 mutation `reset` is stable.
   */
  const active = isWorkspaceScope ? workspaceSubmit : shareSubmit

  return {
    submit,
    isPending: active.isPending,
    isSuccess: active.isSuccess,
    isError: active.isError,
    error: active.error ?? null,
    reset: active.reset,
  }
}
