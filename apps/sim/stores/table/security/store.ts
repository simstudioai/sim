'use client'

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { BrowserStorage } from '@/lib/core/utils/browser-storage'
import {
  TABLE_LOCK_FLAGS,
  TABLE_LOCK_KINDS,
  type TableLockKind,
  type TableLocks,
} from '@/lib/table/types'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

export interface TableSecuritySettings {
  enabled: boolean
  allowedActions: Record<TableLockKind, boolean>
}

interface TableSecurityState {
  preferences: Record<string, TableSecuritySettings>
  setPreference: (tableId: string, settings: TableSecuritySettings) => void
  reset: () => void
}

const DEFAULT_SETTINGS: TableSecuritySettings = {
  enabled: false,
  allowedActions: { insert: false, update: false, delete: false, schema: false },
}

/** Maps Table Security settings to the backend lock flags. */
export function getTableSecurityLocks(settings: TableSecuritySettings): TableLocks {
  return {
    insertLocked: settings.enabled && !settings.allowedActions.insert,
    updateLocked: settings.enabled && !settings.allowedActions.update,
    deleteLocked: settings.enabled && !settings.allowedActions.delete,
    schemaLocked: settings.enabled && !settings.allowedActions.schema,
  }
}

/**
 * Server locks are authoritative. When none are set, the browser preference
 * supplies the remembered per-action choices and distinguishes
 * enabled-with-everything-allowed from disabled, which both use four false
 * backend flags.
 */
export function getTableSecuritySettings(
  locks: TableLocks,
  preference?: TableSecuritySettings
): TableSecuritySettings {
  if (TABLE_LOCK_KINDS.some((kind) => locks[TABLE_LOCK_FLAGS[kind]])) {
    return {
      enabled: true,
      allowedActions: {
        insert: !locks.insertLocked,
        update: !locks.updateLocked,
        delete: !locks.deleteLocked,
        schema: !locks.schemaLocked,
      },
    }
  }

  if (!preference) return DEFAULT_SETTINGS
  return {
    enabled:
      preference.enabled && TABLE_LOCK_KINDS.every((kind) => preference.allowedActions[kind]),
    allowedActions: preference.allowedActions,
  }
}

export function tableSecuritySettingsEqual(
  a: TableSecuritySettings,
  b: TableSecuritySettings
): boolean {
  return (
    a.enabled === b.enabled &&
    TABLE_LOCK_KINDS.every((kind) => a.allowedActions[kind] === b.allowedActions[kind])
  )
}

/** Device-local presentation preferences; actual locks are owned by React Query. */
export const useTableSecurityStore = create<TableSecurityState>()(
  devtools(
    persist(
      (set) => ({
        preferences: {},
        setPreference: (tableId, settings) =>
          set((state) => ({ preferences: { ...state.preferences, [tableId]: settings } })),
        reset: () => set({ preferences: {} }),
      }),
      {
        name: 'table-security-preferences',
        partialize: (state) => ({ preferences: state.preferences }),
        storage: {
          getItem: (name) => BrowserStorage.getItem(name, null),
          setItem: (name, value) => {
            BrowserStorage.setItem(name, value)
          },
          removeItem: (name) => {
            BrowserStorage.removeItem(name)
          },
        },
      }
    ),
    { name: 'table-security-preferences' }
  )
)

registerUserDataReset('table-security-preferences', () => useTableSecurityStore.getState().reset())
