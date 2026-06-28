/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildWorkflowNameRegistry } from '@/lib/workspaces/fork/copy/copy-workflows'

describe('buildWorkflowNameRegistry', () => {
  it('reports a name as taken by another workflow in the same folder', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f1', 'Onboarding', null)).toBe(true)
    expect(reg.isTaken('f1', 'Onboarding', 'w2')).toBe(true)
  })

  it('excludes the workflow itself so a replace can keep its own name', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f1', 'Onboarding', 'w1')).toBe(false)
  })

  it('is folder-scoped: the same name in another folder is free', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f2', 'Onboarding', null)).toBe(false)
    expect(reg.isTaken(null, 'Onboarding', null)).toBe(false)
  })

  it('treats the root (null) folder distinctly, matching coalesce(folderId, "")', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: null, name: 'Root WF' }])
    expect(reg.isTaken(null, 'Root WF', null)).toBe(true)
    expect(reg.isTaken('f1', 'Root WF', null)).toBe(false)
  })

  it('claims a new name so a later workflow in the same copy loop sees it taken', () => {
    const reg = buildWorkflowNameRegistry([])
    expect(reg.isTaken('f1', 'Report', null)).toBe(false)
    reg.claim('f1', 'Report', 'wA')
    expect(reg.isTaken('f1', 'Report', null)).toBe(true)
    expect(reg.isTaken('f1', 'Report', 'wA')).toBe(false)
  })

  it('releases the prior name when a workflow is renamed (claim moves keys)', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Old' }])
    reg.claim('f1', 'New', 'w1')
    expect(reg.isTaken('f1', 'Old', null)).toBe(false)
    expect(reg.isTaken('f1', 'New', null)).toBe(true)
  })

  it('re-claiming the same (folder, name) is a no-op', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Same' }])
    reg.claim('f1', 'Same', 'w1')
    expect(reg.isTaken('f1', 'Same', 'w1')).toBe(false)
    expect(reg.isTaken('f1', 'Same', null)).toBe(true)
  })

  it('handles multiple holders (legacy duplicates) and partial release', () => {
    const reg = buildWorkflowNameRegistry([
      { id: 'w1', folderId: 'f1', name: 'Dup' },
      { id: 'w2', folderId: 'f1', name: 'Dup' },
    ])
    expect(reg.isTaken('f1', 'Dup', 'w1')).toBe(true)
    reg.claim('f1', 'Other', 'w2')
    expect(reg.isTaken('f1', 'Dup', 'w1')).toBe(false)
  })
})
