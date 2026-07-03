'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/auth-client'
import type { WorkspaceCredential } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'

const logger = createLogger('SecretValue')

interface UseSecretValueParams {
  workspaceId: string
  credential: WorkspaceCredential | null
}

/**
 * Reads and persists a single secret's value, reusing the secrets list's
 * environment queries/mutations so decryption and save semantics never diverge.
 *
 * - Asymmetric save model: workspace env merges per-key (PUT); personal env is
 *   replace-all (POST), so a personal save refetches the latest set first and
 *   rebuilds it with only this key changed, avoiding dropped keys from a stale
 *   cache. If that set can't be resolved (refetch failed and nothing is cached)
 *   the save aborts, since a single-key replace-all would wipe the rest of the
 *   store; a successfully-loaded empty set still saves (first personal key).
 * - Scope-aware edit permission: workspace requires the credential admin role;
 *   personal values live in the owner's own environment, so only the owner can
 *   edit. A personal key shadowed by a same-named workspace key is surfaced as
 *   `isConflicted` (read-only), since editing it would have no runtime effect.
 * - The draft seeds from the resolved value but preserves unsaved edits when the
 *   value changes upstream (e.g. a concurrent save by another admin).
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

  const save = async () => {
    if (!credential || !canEdit || isConflicted || !isDirty || isSaving) return
    try {
      if (isPersonal) {
        const { data: latest } = await refetchPersonal()
        if (!latest) {
          toast.error("Couldn't save value", {
            description: 'Could not load your latest secrets. Please try again in a moment.',
          })
          logger.warn('Aborted personal secret save: latest environment unavailable')
          return
        }
        const merged: Record<string, string> = Object.fromEntries(
          Object.entries(latest).map(([key, entry]) => [key, entry.value])
        )
        merged[envKey] = draft
        await savePersonal.mutateAsync({ variables: merged })
      } else {
        await upsertWorkspace.mutateAsync({ workspaceId, variables: { [envKey]: draft } })
      }
    } catch (error) {
      toast.error("Couldn't save value", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to save secret value', error)
    }
  }

  return { value: draft, setValue: setDraft, canEdit, isConflicted, isDirty, save, isSaving }
}
