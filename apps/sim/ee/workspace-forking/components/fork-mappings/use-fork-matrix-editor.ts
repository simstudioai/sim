'use client'

import { useMemo, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  ForkMappingCandidate,
  ForkMatrixRow,
  ForkMatrixWorkspace,
  GetForkMatrixResponse,
} from '@/lib/api/contracts/workspace-fork'
import { useUpdateForkMapping } from '@/ee/workspace-forking/hooks/workspace-fork'

/** `${workspaceId}:${rowKey}` — one editable cell of the matrix. */
const cellKey = (workspaceId: string, rowKey: string) => `${workspaceId}:${rowKey}`

/** No candidates for a kind, shared so an empty picker never re-allocates per render. */
const NO_CANDIDATES: ForkMappingCandidate[] = []

export interface ForkMatrixEditor {
  workspaces: ForkMatrixWorkspace[]
  rows: ForkMatrixRow[]
  /** Mapping targets a cell may pick, for the workspace column and the row's kind. */
  candidatesFor: (workspaceId: string, kind: string) => ForkMappingCandidate[]
  /** Effective value of a cell: the in-session edit if there is one, else what is stored. */
  valueFor: (row: ForkMatrixRow, workspaceId: string) => string
  setValue: (row: ForkMatrixRow, workspaceId: string, value: string) => void
  /**
   * Whether a cell can be re-pointed. A cell is the child half of exactly one edge, so it needs a
   * source to key the mapping on — the chain's value in the parent column — and admin on both
   * sides of that edge, which is what the mapping route enforces.
   */
  isEditable: (row: ForkMatrixRow, workspaceId: string) => boolean
  /** Names of the workspaces whose candidate lists are capped, so their pickers are partial. */
  truncatedWorkspaceNames: string[]
  dirty: boolean
  saving: boolean
  save: () => Promise<void>
  discard: () => void
}

/**
 * Editing state for the mappings matrix.
 *
 * A cell edits the edge that LANDS in its column, so a save is one request per edge that changed —
 * issued sequentially against the same per-edge route the sync page uses, rather than through a
 * bespoke batch endpoint. Each edge's mapping is independent, so a failure part-way leaves the
 * edges that already succeeded correctly saved and reports exactly which one did not.
 */
export function useForkMatrixEditor(data: GetForkMatrixResponse | undefined): ForkMatrixEditor {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const updateMapping = useUpdateForkMapping()

  const workspaces = useMemo(() => data?.workspaces ?? [], [data?.workspaces])
  const rows = useMemo(() => data?.rows ?? [], [data?.rows])

  const workspaceById = useMemo(
    () => new Map(workspaces.map((entry) => [entry.id, entry])),
    [workspaces]
  )

  const storedValue = (row: ForkMatrixRow, targetWorkspaceId: string) =>
    row.cells[targetWorkspaceId]?.resourceId ?? ''

  const valueFor = (row: ForkMatrixRow, targetWorkspaceId: string) =>
    edits[cellKey(targetWorkspaceId, row.key)] ?? storedValue(row, targetWorkspaceId)

  const isEditable = (row: ForkMatrixRow, targetWorkspaceId: string) => {
    const column = workspaceById.get(targetWorkspaceId)
    if (!column?.parentId) return false
    const parent = workspaceById.get(column.parentId)
    if (!parent || !column.viewerCanAdmin || !parent.viewerCanAdmin) return false
    return Boolean(row.cells[column.parentId]?.resourceId)
  }

  const setValue = (row: ForkMatrixRow, targetWorkspaceId: string, value: string) => {
    setEdits((previous) => {
      const key = cellKey(targetWorkspaceId, row.key)
      // Returning a cell to its stored value un-dirties it, so Save never re-writes a no-op row.
      if (value === storedValue(row, targetWorkspaceId)) {
        if (!(key in previous)) return previous
        const { [key]: _removed, ...rest } = previous
        return rest
      }
      return { ...previous, [key]: value }
    })
  }

  const candidatesFor = (targetWorkspaceId: string, kind: string) =>
    data?.candidates[targetWorkspaceId]?.[kind] ?? NO_CANDIDATES

  const truncatedWorkspaceNames = useMemo(
    () =>
      (data?.candidatesTruncated ?? []).flatMap((id) => {
        const name = workspaceById.get(id)?.name
        return name ? [name] : []
      }),
    [data?.candidatesTruncated, workspaceById]
  )

  const dirty = Object.keys(edits).length > 0

  const discard = () => setEdits({})

  const save = async () => {
    if (!dirty || updateMapping.isPending) return
    const rowByKey = new Map(rows.map((row) => [row.key, row]))

    /** Changed cells grouped by the edge they land in, keyed by that edge's child workspace. */
    const byChild = new Map<
      string,
      Array<{
        resourceType: ForkMatrixRow['resourceType']
        sourceId: string
        targetId: string | null
      }>
    >()
    for (const [key, targetId] of Object.entries(edits)) {
      const separator = key.indexOf(':')
      const childId = key.slice(0, separator)
      const row = rowByKey.get(key.slice(separator + 1))
      const parentId = workspaceById.get(childId)?.parentId
      if (!row || !parentId) continue
      const sourceId = row.cells[parentId]?.resourceId
      if (!sourceId) continue
      const entries = byChild.get(childId) ?? []
      entries.push({ resourceType: row.resourceType, sourceId, targetId: targetId || null })
      byChild.set(childId, entries)
    }

    const failures = new Map<string, string>()
    for (const [childId, entries] of byChild) {
      const parentId = workspaceById.get(childId)?.parentId
      if (!parentId) continue
      try {
        await updateMapping.mutateAsync({
          workspaceId: childId,
          // `pull` is the orientation the matrix reads in: the parent column supplies the source,
          // the child column receives the target.
          body: { otherWorkspaceId: parentId, direction: 'pull', entries },
        })
      } catch (error) {
        failures.set(childId, getErrorMessage(error, 'Save failed'))
      }
    }

    if (failures.size === 0) {
      setEdits({})
      toast.success('Mappings saved')
      return
    }

    // Edges that succeeded keep their writes and stop being dirty; only the failed columns stay
    // pending, so a retry re-sends exactly what did not land.
    setEdits((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => failures.has(key.slice(0, key.indexOf(':'))))
      )
    )
    toast.error(
      failures.size === 1
        ? "Couldn't save one workspace"
        : `Couldn't save ${failures.size} workspaces`,
      {
        description: Array.from(
          failures,
          ([childId, message]) => `${workspaceById.get(childId)?.name ?? childId}: ${message}`
        ).join('\n'),
      }
    )
  }

  return {
    workspaces,
    rows,
    candidatesFor,
    valueFor,
    setValue,
    isEditable,
    truncatedWorkspaceNames,
    dirty,
    saving: updateMapping.isPending,
    save,
    discard,
  }
}
