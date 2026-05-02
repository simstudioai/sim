/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
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
  it('returns false for root', () => {
    expect(isFolderOrAncestorLocked(null, {})).toBe(false)
    expect(isFolderOrAncestorLocked(undefined, {})).toBe(false)
  })

  it('returns true when the folder itself is locked', () => {
    const folders = { f1: makeFolder({ id: 'f1', locked: true }) }
    expect(isFolderOrAncestorLocked('f1', folders)).toBe(true)
  })

  it('returns true when an ancestor is locked', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', locked: true }),
      f2: makeFolder({ id: 'f2', parentId: 'f1' }),
      f3: makeFolder({ id: 'f3', parentId: 'f2' }),
    }
    expect(isFolderOrAncestorLocked('f3', folders)).toBe(true)
  })

  it('returns false when nothing in the chain is locked', () => {
    const folders = {
      f1: makeFolder({ id: 'f1' }),
      f2: makeFolder({ id: 'f2', parentId: 'f1' }),
    }
    expect(isFolderOrAncestorLocked('f2', folders)).toBe(false)
  })

  it('short-circuits on cycles instead of looping forever', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', parentId: 'f2' }),
      f2: makeFolder({ id: 'f2', parentId: 'f1' }),
    }
    expect(isFolderOrAncestorLocked('f1', folders)).toBe(false)
  })
})

describe('getFolderPath', () => {
  it('returns null for root or unknown folders', () => {
    expect(getFolderPath(null, {})).toBeNull()
    expect(getFolderPath(undefined, {})).toBeNull()
    expect(getFolderPath('missing', {})).toBeNull()
  })

  it('returns the leaf folder name when at top level', () => {
    const folders = { f1: makeFolder({ id: 'f1', name: 'Engineering' }) }
    expect(getFolderPath('f1', folders)).toBe('Engineering')
  })

  it('joins ancestor names from root to leaf', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', name: 'Engineering' }),
      be: makeFolder({ id: 'be', name: 'Backend', parentId: 'eng' }),
      api: makeFolder({ id: 'api', name: 'API', parentId: 'be' }),
    }
    expect(getFolderPath('api', folders)).toBe('Engineering / Backend / API')
  })

  it('respects custom separators', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', name: 'Engineering' }),
      be: makeFolder({ id: 'be', name: 'Backend', parentId: 'eng' }),
    }
    expect(getFolderPath('be', folders, ' > ')).toBe('Engineering > Backend')
  })

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
  it('returns null for root or unknown folders', () => {
    expect(findLockedAncestorFolder(null, {})).toBeNull()
    expect(findLockedAncestorFolder(undefined, {})).toBeNull()
    expect(findLockedAncestorFolder('missing', {})).toBeNull()
  })

  it('returns the folder itself when it is the locked one', () => {
    const folders = { f1: makeFolder({ id: 'f1', name: 'Engineering', locked: true }) }
    expect(findLockedAncestorFolder('f1', folders)?.name).toBe('Engineering')
  })

  it('returns the closest locked ancestor, not the root', () => {
    const folders = {
      root: makeFolder({ id: 'root', name: 'Root', locked: true }),
      mid: makeFolder({ id: 'mid', name: 'Mid', parentId: 'root', locked: true }),
      leaf: makeFolder({ id: 'leaf', name: 'Leaf', parentId: 'mid' }),
    }
    expect(findLockedAncestorFolder('leaf', folders)?.id).toBe('mid')
  })

  it('returns null when no folder in the chain is locked', () => {
    const folders = {
      f1: makeFolder({ id: 'f1', name: 'A' }),
      f2: makeFolder({ id: 'f2', name: 'B', parentId: 'f1' }),
    }
    expect(findLockedAncestorFolder('f2', folders)).toBeNull()
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
  it('treats undefined or null workflows as unlocked', () => {
    expect(isWorkflowEffectivelyLocked(undefined, {})).toBe(false)
    expect(isWorkflowEffectivelyLocked(null, {})).toBe(false)
  })

  it('returns true when the workflow row itself is locked', () => {
    expect(isWorkflowEffectivelyLocked({ locked: true, folderId: null }, {})).toBe(true)
  })

  it('returns true when an ancestor folder is locked', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', locked: true }),
      be: makeFolder({ id: 'be', parentId: 'eng' }),
    }
    expect(isWorkflowEffectivelyLocked({ locked: false, folderId: 'be' }, folders)).toBe(true)
  })

  it('returns false when neither row nor any ancestor is locked', () => {
    const folders = { eng: makeFolder({ id: 'eng' }) }
    expect(isWorkflowEffectivelyLocked({ locked: false, folderId: 'eng' }, folders)).toBe(false)
  })

  it('returns false for a workflow at workspace root with no row lock', () => {
    expect(isWorkflowEffectivelyLocked({ locked: false, folderId: null }, {})).toBe(false)
  })
})

describe('isFolderEffectivelyLocked', () => {
  it('treats undefined or null folders as unlocked', () => {
    expect(isFolderEffectivelyLocked(undefined, {})).toBe(false)
    expect(isFolderEffectivelyLocked(null, {})).toBe(false)
  })

  it('returns true when the folder itself is locked', () => {
    expect(isFolderEffectivelyLocked({ locked: true, parentId: null }, {})).toBe(true)
  })

  it('returns true when an ancestor folder is locked', () => {
    const folders = {
      eng: makeFolder({ id: 'eng', locked: true }),
      be: makeFolder({ id: 'be', parentId: 'eng' }),
    }
    expect(isFolderEffectivelyLocked({ locked: false, parentId: 'eng' }, folders)).toBe(true)
  })

  it('returns false when neither the folder nor any ancestor is locked', () => {
    const folders = { eng: makeFolder({ id: 'eng' }) }
    expect(isFolderEffectivelyLocked({ locked: false, parentId: 'eng' }, folders)).toBe(false)
  })

  it('returns false for a root-level folder with no own lock', () => {
    expect(isFolderEffectivelyLocked({ locked: false, parentId: null }, {})).toBe(false)
  })
})
