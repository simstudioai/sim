import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  getEnv: (name: string) =>
    name === 'APPS_PROXY_HOP_SECRET' || name === 'APPS_FILE_CAPABILITY_SECRET'
      ? 'test-secret-with-at-least-32-characters!!'
      : undefined,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isProd: false,
}))

import {
  appsFileProxyPath,
  issueAppsFileCapability,
  parseExecutionFileKey,
  resolveSafeContentType,
  sniffContentType,
  toAppsPublicFile,
  verifyAppsFileCapability,
} from '@/lib/apps/file-capability'

describe('apps file capability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('issues and verifies a capability token', () => {
    const token = issueAppsFileCapability({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      workflowId: '22222222-2222-2222-2222-222222222222',
      executionId: '33333333-3333-3333-3333-333333333333',
      fileKey:
        'execution/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/avatar.jpg',
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      size: 12,
      releaseId: 'release-1',
      projectId: 'project-1',
    })

    const verified = verifyAppsFileCapability(token)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.claims.name).toBe('avatar.jpg')
    expect(verified.claims.releaseId).toBe('release-1')
  })

  it('rejects expired capabilities', () => {
    const token = issueAppsFileCapability({
      workspaceId: 'ws',
      workflowId: 'wf',
      executionId: 'ex',
      fileKey: 'execution/ws/wf/ex/a.bin',
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 1,
      previewSessionId: 'preview-1',
    })

    vi.setSystemTime(new Date('2026-07-18T13:00:00.000Z'))
    expect(verifyAppsFileCapability(token).ok).toBe(false)
  })

  it('builds same-origin proxy paths', () => {
    const file = toAppsPublicFile({
      workspaceId: 'ws',
      workflowId: 'wf',
      executionId: 'ex',
      fileKey: 'execution/ws/wf/ex/a.jpg',
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      size: 4,
      previewSessionId: 'p1',
    })
    expect(file.url.startsWith('/__sim/files/')).toBe(true)
    expect(appsFileProxyPath('tok')).toBe('/__sim/files/tok')
  })

  it('parses execution file keys', () => {
    expect(
      parseExecutionFileKey(
        'execution/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/avatar.jpg'
      )
    ).toEqual({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      workflowId: '22222222-2222-2222-2222-222222222222',
      executionId: '33333333-3333-3333-3333-333333333333',
    })
    expect(parseExecutionFileKey('workspace/foo')).toBeNull()
  })

  it('sniffs and validates content types', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffContentType(jpeg)).toBe('image/jpeg')
    expect(resolveSafeContentType('image/jpeg', jpeg)).toBe('image/jpeg')
    expect(resolveSafeContentType('image/png', jpeg)).toBeNull()

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(resolveSafeContentType('image/png', png)).toBe('image/png')
  })
})
