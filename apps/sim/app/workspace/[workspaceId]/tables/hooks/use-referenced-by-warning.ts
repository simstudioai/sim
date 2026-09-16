'use client'

import type { ChipConfirmTextSegment } from '@sim/emcn'
import { findReferencingTables } from '@/lib/table/reference-columns/referrers'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useTablesList } from '@/hooks/queries/tables'

const MAX_LISTED_REFERRERS = 3
const NAME_LIST_FORMAT = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
const NO_SEGMENTS: readonly ChipConfirmTextSegment[] = []

/**
 * Confirmation copy naming the surviving tables that reference a pending deletion. Deletion is
 * not blocked; the copy warns that those references will stop resolving.
 */
export function referencedByWarningText(
  referrerNames: readonly string[]
): readonly ChipConfirmTextSegment[] {
  if (referrerNames.length === 0) return NO_SEGMENTS

  const listed = referrerNames.slice(0, MAX_LISTED_REFERRERS)
  const remaining = referrerNames.length - listed.length
  const names = remaining > 0 ? [...listed, `${remaining} more`] : listed

  return [` Reference columns in ${NAME_LIST_FORMAT.format(names)} will point to a missing table.`]
}

/**
 * Warning copy for the tables a delete confirmation would archive. Empty while Reference
 * columns are disabled, nothing is pending, or no surviving table references the deletion.
 */
export function useReferencedByWarning(
  workspaceId: string,
  deletedTableIds: readonly string[]
): readonly ChipConfirmTextSegment[] {
  const hostContext = useOptionalWorkspaceHostContext()
  const enabled = (hostContext?.features?.referenceColumns ?? false) && deletedTableIds.length > 0
  const { data: tables } = useTablesList(workspaceId, 'active', { enabled })

  if (!enabled || !tables) return NO_SEGMENTS
  const referrers = findReferencingTables(tables, new Set(deletedTableIds))
  return referencedByWarningText(referrers.map((table) => table.name))
}
