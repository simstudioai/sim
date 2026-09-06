/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type CollabReadinessInputs,
  isCollabReady,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/readiness'

/** An observation, with the healthy defaults filled in so each case states only what it exercises. */
const at = (input: Partial<CollabReadinessInputs>): CollabReadinessInputs => ({
  synced: false,
  seeded: false,
  fatal: false,
  ...input,
})

describe('isCollabReady', () => {
  it('is not ready before syncing or seeding', () => {
    expect(isCollabReady(at({ synced: false, seeded: false }))).toBe(false)
  })

  it('is not ready when synced but not yet seeded', () => {
    expect(isCollabReady(at({ synced: true, seeded: false }))).toBe(false)
  })

  it('is ready only when the current session is synced and the server seed is present', () => {
    expect(isCollabReady(at({ synced: true, seeded: true }))).toBe(true)
  })

  it('closes readiness as soon as the current session loses sync', () => {
    expect(isCollabReady(at({ synced: false, seeded: true }))).toBe(false)
  })

  it('revokes readiness when a live document turns fatal', () => {
    expect(isCollabReady(at({ synced: true, seeded: true, fatal: true }))).toBe(false)
  })
})
