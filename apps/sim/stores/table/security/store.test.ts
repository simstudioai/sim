/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { UNLOCKED_TABLE_LOCKS } from '@/lib/table/types'
import {
  getTableSecurityLocks,
  getTableSecuritySettings,
  type TableSecuritySettings,
  useTableSecurityStore,
} from '@/stores/table/security/store'

const PREFERENCE: TableSecuritySettings = {
  enabled: false,
  allowedActions: { insert: true, update: false, delete: false, schema: false },
}

beforeEach(() => useTableSecurityStore.getState().reset())

describe('table security preferences', () => {
  it('uses current server locks over remembered local permissions', () => {
    const serverLocks = { ...UNLOCKED_TABLE_LOCKS, insertLocked: true }
    const settings = getTableSecuritySettings(serverLocks, PREFERENCE)
    expect(settings.enabled).toBe(true)
    expect(settings.allowedActions).toEqual({
      insert: false,
      update: true,
      delete: true,
      schema: true,
    })
    expect(getTableSecurityLocks(settings)).toEqual(serverLocks)
  })

  it('recognizes an external unlock even when the browser previously enabled restrictions', () => {
    const settings = getTableSecuritySettings(UNLOCKED_TABLE_LOCKS, {
      ...PREFERENCE,
      enabled: true,
    })
    expect(settings.enabled).toBe(false)
    expect(settings.allowedActions).toEqual(PREFERENCE.allowedActions)
  })

  it('keeps security visibly enabled when all actions are allowed', () => {
    const settings: TableSecuritySettings = {
      enabled: true,
      allowedActions: { insert: true, update: true, delete: true, schema: true },
    }
    expect(getTableSecurityLocks(settings)).toEqual(UNLOCKED_TABLE_LOCKS)
    expect(getTableSecuritySettings(UNLOCKED_TABLE_LOCKS, settings).enabled).toBe(true)
  })

  it('remembers disabled permissions across hydration without sharing them with another table', async () => {
    useTableSecurityStore.getState().setPreference('table-1', PREFERENCE)
    const saved = localStorage.getItem('table-security-preferences')
    useTableSecurityStore.getState().reset()
    localStorage.setItem('table-security-preferences', saved!)
    await useTableSecurityStore.persist.rehydrate()
    expect(useTableSecurityStore.getState().preferences['table-1']).toEqual(PREFERENCE)
    expect(useTableSecurityStore.getState().preferences['table-2']).toBeUndefined()
    expect(getTableSecurityLocks(useTableSecurityStore.getState().preferences['table-1'])).toEqual(
      UNLOCKED_TABLE_LOCKS
    )
  })
})
