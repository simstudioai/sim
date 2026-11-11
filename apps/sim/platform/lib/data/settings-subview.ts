'use client'

import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs'

const subviewParsers = { id: parseAsString, creating: parseAsBoolean.withDefault(false) }

/** A section's record sub-view: one record's detail, which is also where it is edited. */
export interface SettingsRecordSubview {
  /** The open record's id. Resolve it against the loaded list: a dead or stale id shows the list. */
  id: string | null
  /** Opens a record's detail as a new history entry. */
  open: (recordId: string) => void
  /** Returns to the list, replacing the entry that opened the sub-view. */
  close: () => void
}

/** A section's record sub-view and its create flow. */
export interface SettingsCreateSubview extends SettingsRecordSubview {
  creating: boolean
  /** Opens the create flow as a new history entry. */
  create: () => void
  /** After a create, the form gives way to the record it made, without a second history entry. */
  showCreated: (recordId: string) => void
}

/**
 * The open sub-view of a Settings section, in the URL, so Back closes it and a refresh or a shared
 * link reopens it. `idParam` is the URL key of the open record's id (`provider`) and `createParam`
 * the key of the create flow (`createProvider`), named only where the section has one. Opening
 * pushes a history entry; closing, and showing what a create made, replace it, so Back from the
 * list leaves the page instead of reopening the record (`sim-url-state.md`).
 *
 * Open the detail only when `id` names a loaded record. While the list's first read is pending and
 * `id` or `creating` is set, render nothing rather than the list, so a deep link never flashes it.
 */
export function useSettingsSubview(keys: { idParam: string }): SettingsRecordSubview
export function useSettingsSubview(keys: {
  idParam: string
  createParam: string
}): SettingsCreateSubview
export function useSettingsSubview({
  idParam,
  createParam,
}: {
  idParam: string
  createParam?: string
}): SettingsRecordSubview | SettingsCreateSubview {
  const [{ id, creating }, setSubview] = useQueryStates(subviewParsers, {
    history: 'push',
    clearOnDefault: true,
    // A section without a create flow never writes its create key, since it has no `create`.
    urlKeys: { id: idParam, creating: createParam ?? `${idParam}Create` },
  })
  const record: SettingsRecordSubview = {
    id,
    open: (recordId) => void setSubview({ id: recordId, creating: null }),
    close: () => void setSubview({ id: null, creating: null }, { history: 'replace' }),
  }
  if (!createParam) return record
  return {
    ...record,
    creating,
    create: () => void setSubview({ id: null, creating: true }),
    showCreated: (recordId) =>
      void setSubview({ id: recordId, creating: null }, { history: 'replace' }),
  }
}
