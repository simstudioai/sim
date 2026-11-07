'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import type { PermissionGroup } from '@/ee/access-control/hooks/permission-groups'
import { hasPermissionConfigChanges } from '@/ee/access-control/lib/editor'
import { useServerDraft } from '@/platform/embedded/app/(shell)/_components/use-server-draft'
import { useUpdatePermissionGroup } from '@/platform/embedded/lib/data/access-control'
import { toast } from '@/platform/shared/toast'

/** Every edit on the page, so one Save commits them together in one atomic request. */
interface GroupDraft {
  name: string
  description: string
  config: PermissionGroupConfig
  isDefault: boolean
  workspaceIds: string[]
}

function sameWorkspaces(left: GroupDraft, right: GroupDraft) {
  /** A default group governs every workspace, so a selection under it is not an edit. */
  if (left.isDefault && right.isDefault) return true
  const known = new Set(left.workspaceIds)
  return (
    left.workspaceIds.length === right.workspaceIds.length &&
    right.workspaceIds.every((id) => known.has(id))
  )
}

function sameGroupDraft(left: GroupDraft, right: GroupDraft) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.isDefault === right.isDefault &&
    sameWorkspaces(left, right) &&
    !hasPermissionConfigChanges(left.config, right.config)
  )
}

/** Trimmed: an older row may hold untrimmed text and would otherwise open dirty. */
function groupDraftOf(
  group: Pick<PermissionGroup, 'name' | 'description' | 'config' | 'isDefault'>,
  workspaceIds: string[]
): GroupDraft {
  return {
    name: group.name.trim(),
    description: (group.description ?? '').trim(),
    config: group.config,
    isDefault: group.isDefault,
    workspaceIds,
  }
}

/** The group's editing buffer and its one write. Members are not in it: each is its own action. */
export function useGroupDraft(group: PermissionGroup, organizationId: string) {
  const update = useUpdatePermissionGroup()
  const server = useMemo(
    () =>
      groupDraftOf(
        group,
        group.workspaces.map((workspace) => workspace.id)
      ),
    [group]
  )
  const draft = useServerDraft({
    server,
    isEqual: sameGroupDraft,
    saving: update.isPending,
  })
  const { baseline } = draft
  const name = draft.draft.name.trim()
  const description = draft.draft.description.trim()

  async function save() {
    if (update.isPending || draft.conflict || !name) return
    const submitted = draft.draft
    const configChanged = hasPermissionConfigChanges(baseline.config, submitted.config)
    const defaultChanged = submitted.isDefault !== baseline.isDefault
    const workspacesChanged = !submitted.isDefault && !sameWorkspaces(submitted, baseline)
    try {
      const { permissionGroup: saved } = await update.mutateAsync({
        id: group.id,
        organizationId,
        ...(configChanged && { config: submitted.config }),
        ...(name !== baseline.name && { name }),
        ...(description !== baseline.description && { description: description || null }),
        ...(defaultChanged && { isDefault: submitted.isDefault }),
        ...(workspacesChanged && { workspaceIds: submitted.workspaceIds }),
      })
      // From the server's copy, so a normalization cannot leave a baseline never persisted.
      draft.markSaved(submitted, groupDraftOf(saved, saved.isDefault ? [] : saved.workspaceIds))
    } catch (error) {
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Try again in a moment.'),
      })
    }
  }

  return {
    ...draft,
    saving: update.isPending,
    /** The name as saved, for the page heading; the field holds the edit. */
    savedName: baseline.name,
    savedDescription: baseline.description,
    nameValid: Boolean(name),
    patch: (patch: Partial<GroupDraft>) => draft.edit((current) => ({ ...current, ...patch })),
    patchConfig: (patch: Partial<PermissionGroupConfig>) =>
      draft.edit((current) => ({ ...current, config: { ...current.config, ...patch } })),
    save,
  }
}
