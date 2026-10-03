import { describe, expect, it } from 'vitest'
import {
  disambiguateLabelByFolder,
  findLockedAncestorFolder,
  getFolderPath,
  isFolderEffectivelyLocked,
  isFolderOrAncestorLocked,
  isWorkflowEffectivelyLocked,
} from '@/hooks/queries/utils/folder-tree'
import type { WorkflowFolder } from '@/stores/folders/types'

function makeFolder(overrides: Partial<WorkflowFolder> & { id: string }): WorkflowFolder {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    userId: 'user-1',
    workspaceId: 'ws-1',
    parentId: overrides.parentId ?? null,
    color: '#000000',
    isExpanded: false,
    locked: overrides.locked ?? false,
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  }
}

describe('isFolderOrAncestorLocked', () => {
  it('short-circuits on cycles instead of looping forever', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', parentId: 'f2' }),
      f2: makeFolder({ id: 'f2', parentId: 'f1' }),
    }
    expect(isFolderOrAncestorLocked('f1', folders)).toBe(false)
  })
})

describe('getFolderPath', () => {
  it('returns the partial path resolved before a missing ancestor', () => {
    const folders = {
      be: makeFolder({ id: 'be', name: 'Backend', parentId: 'missing' }),
    }
    expect(getFolderPath('be', folders)).toBe('Backend')
  })

  it('short-circuits on cycles instead of looping forever', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', name: 'A', parentId: 'f2' }),
      f2: makeFolder({ id: 'f2', name: 'B', parentId: 'f1' }),
    }
    expect(getFolderPath('f1', folders)).toBe('B / A')
  })
})

describe('findLockedAncestorFolder', () => {
  it('returns the closest locked ancestor, not the root', () => {
    const folders = {
      root: makeFolder({ id: 'root', name: 'Root', locked: true }),
      mid: makeFolder({ id: 'mid', name: 'Mid', parentId: 'root', locked: true }),
      leaf: makeFolder({ id: 'leaf', name: 'Leaf', parentId: 'mid' }),
    }
    expect(findLockedAncestorFolder('leaf', folders)?.id).toBe('mid')
  })

  it('short-circuits on cycles instead of looping forever', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', name: 'A', parentId: 'f2' }),
      f2: makeFolder({ id: 'f2', name: 'B', parentId: 'f1' }),
    }
    expect(findLockedAncestorFolder('f1', folders)).toBeNull()
  })
})

describe('isWorkflowEffectivelyLocked', () => {
  it('returns true when an ancestor folder is locked', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', locked: true }),
      be: makeFolder({ id: 'be', parentId: 'eng' }),
    }
    expect(isWorkflowEffectivelyLocked({ locked: false, folderId: 'be' }, folders)).toBe(true)
  })
})

describe('isFolderEffectivelyLocked', () => {
  it('returns true when an ancestor folder is locked', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', locked: true }),
      be: makeFolder({ id: 'be', parentId: 'eng' }),
    }
    expect(isFolderEffectivelyLocked({ locked: false, parentId: 'eng' }, folders)).toBe(true)
  })
})

describe('disambiguateLabelByFolder', () => {
  const folders = {
    sales: makeFolder({ id: 'sales', name: 'Sales' }),
    emea: makeFolder({ id: 'emea', name: 'EMEA', parentId: 'sales' }),
  }

  it('appends the full folder path to a colliding name', () => {
    expect(disambiguateLabelByFolder('Leads', 'emea', folders, new Set(['Leads']))).toBe(
      'Leads (Sales / EMEA)'
    )
  })
})
