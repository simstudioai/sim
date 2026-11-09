'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/client'
import type { WorkspaceCredential } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { toast } from '@/platform/shared/toast'

const logger = createLogger('SecretValue')

interface UseSecretValueParams {
  workspaceId: string
  credential: WorkspaceCredential | null
}

/**
 * Reads and persists one secret's value through the secrets list's environment queries, so
 * decryption and save semantics never diverge.
 *
 * - Workspace env merges per key; personal env is replace-all, so a personal save refetches the
 *   latest set and changes only this key. If that set cannot be resolved the save aborts, since a
 *   single-key replace-all would wipe the rest of the store.
 * - Workspace values need the credential admin role; personal values only their owner. A personal
 *   key shadowed by a same-named workspace key is `isConflicted` (read-only).
 * - The draft seeds from the resolved value but keeps unsaved edits when the value changes upstream.
 */
export function useSecretValue({ workspaceId, credential }: UseSecretValueParams) {
  const { data: session } = useSession()
  const isPersonal = credential?.type === 'env_personal'
  const envKey = credential?.envKey ?? ''

  const { data: personalEnvData, refetch: refetchPersonal } = usePersonalEnvironment()
  const { data: workspaceEnvData } = useWorkspaceEnvironment(workspaceId)

  const savePersonal = useSavePersonalEnvironment()
  const upsertWorkspace = useUpsertWorkspaceEnvironment()

  const currentValue = isPersonal
    ? (personalEnvData?.[envKey]?.value ?? '')
    : (workspaceEnvData?.workspace?.[envKey] ?? '')

  const isConflicted =
    isPersonal && envKey.length > 0 && envKey in (workspaceEnvData?.workspace ?? {})

  const canEdit = isPersonal
    ? Boolean(session?.user?.id && credential?.envOwnerUserId === session.user.id)
    : credential?.role === 'admin'

  const [draft, setDraft] = useState(currentValue)
  const [seeded, setSeeded] = useState(currentValue)
  if (currentValue !== seeded) {
    setSeeded(currentValue)
    if (draft === seeded) setDraft(currentValue)
  }

  const isDirty = draft !== currentValue
  const isSaving = savePersonal.isPending || upsertWorkspace.isPending

  const save = useCallback(async (): Promise<boolean> => {
    if (!credential || !canEdit || isConflicted || !isDirty || isSaving) return true
    try {
      if (isPersonal) {
        const { data: latest } = await refetchPersonal()
        if (!latest) {
          toast.error("Couldn't save value", {
            description: 'Could not load your latest secrets. Please try again in a moment.',
          })
          logger.warn('Aborted personal secret save: latest environment unavailable')
          return false
        }
        const merged: Record<string, string> = Object.fromEntries(
          Object.entries(latest).map(([key, entry]) => [key, entry.value])
        )
        merged[envKey] = draft
        await savePersonal.mutateAsync({ variables: merged })
      } else {
        await upsertWorkspace.mutateAsync({ workspaceId, variables: { [envKey]: draft } })
      }
      return true
    } catch (error) {
      toast.error("Couldn't save value", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to save secret value', error)
      return false
    }
  }, [
    credential,
    canEdit,
    isConflicted,
    isDirty,
    isSaving,
    isPersonal,
    envKey,
    draft,
    workspaceId,
    refetchPersonal,
    savePersonal.mutateAsync,
    upsertWorkspace.mutateAsync,
  ])

  const discard = useCallback(() => setDraft(currentValue), [currentValue])

  /** Stable as one object, since the detail form folds it into its combined save and discard. */
  return useMemo(
    () => ({
      value: draft,
      setValue: setDraft,
      canEdit,
      isConflicted,
      isDirty,
      save,
      discard,
      isSaving,
    }),
    [draft, canEdit, isConflicted, isDirty, save, discard, isSaving]
  )
}
