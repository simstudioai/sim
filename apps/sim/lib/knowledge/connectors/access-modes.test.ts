/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  aclIsDerived,
  CONNECTOR_ACCESS_MODES,
  CONTENT_ENGINE_ACCESS_MODES,
  documentAccessForMode,
  isContentEngineAccessMode,
} from '@/lib/knowledge/connectors/access-modes'

describe('which engine drives a mode', () => {
  /**
   * The content engine and the member engine hold mutually exclusive leases, so
   * a mode claimed by both — or by neither — is a connector that either never
   * runs or runs twice.
   */
  it('assigns every mode to exactly one engine', () => {
    const contentDriven = CONNECTOR_ACCESS_MODES.filter(isContentEngineAccessMode)
    expect(contentDriven).toEqual(['workspace', 'admin'])
    expect(CONNECTOR_ACCESS_MODES.filter((mode) => !isContentEngineAccessMode(mode))).toEqual([
      'members',
    ])
  })

  it('drives admin mode with the content engine, since it is one crawl under one credential', () => {
    expect(isContentEngineAccessMode('admin')).toBe(true)
    expect(CONTENT_ENGINE_ACCESS_MODES).toContain('admin')
  })

  it('leaves members mode to the member engine', () => {
    expect(isContentEngineAccessMode('members')).toBe(false)
  })

  it('refuses a mode it does not know rather than defaulting one in', () => {
    expect(isContentEngineAccessMode('something-else')).toBe(false)
  })
})

describe('who may read what a sync writes', () => {
  it('publishes a workspace-mode document to the workspace', () => {
    expect(documentAccessForMode('workspace')).toBe('workspace')
    expect(aclIsDerived('workspace')).toBe(false)
  })

  /**
   * Both derived modes are born hidden, because the pass that knows their ACL —
   * the observation graph, or the crawl that mirrors source permissions — has
   * not run yet. Hidden early is recoverable; visible early is not.
   */
  it('hides a document whose ACL a later pass owns', () => {
    expect(documentAccessForMode('admin')).toBe('admin')
    expect(aclIsDerived('admin')).toBe(true)
    expect(aclIsDerived('members')).toBe(true)
  })

  it('treats an unknown mode as workspace-driven, matching the engine that claimed it', () => {
    expect(documentAccessForMode('unknown')).toBe('workspace')
  })
})
