import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  getEnv: () => 'test-secret-with-at-least-32-characters!!',
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isProd: false,
}))

import { materializeAppsPublicOutputs } from '@/lib/apps/materialize-public-outputs'

describe('materializeAppsPublicOutputs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'))
  })

  it('rewrites UserFile objects to signed same-origin public files', () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111'
    const workflowId = '22222222-2222-2222-2222-222222222222'
    const executionId = '33333333-3333-3333-3333-333333333333'
    const key = `execution/${workspaceId}/${workflowId}/${executionId}/avatar.jpg`

    const out = materializeAppsPublicOutputs(
      {
        avatarFile: {
          id: 'file_1',
          name: 'avatar.jpg',
          url: 'https://cdn.example/private.jpg',
          key,
          size: 128,
          type: 'image/jpeg',
          context: 'execution',
          base64: 'abc',
        },
      },
      {
        workspaceId,
        workflowId,
        executionId,
        previewSessionId: 'preview-1',
        projectId: 'project-1',
      }
    ) as { avatarFile: { url: string; name: string; mimeType: string; size: number } }

    expect(out.avatarFile.name).toBe('avatar.jpg')
    expect(out.avatarFile.mimeType).toBe('image/jpeg')
    expect(out.avatarFile.size).toBe(128)
    expect(out.avatarFile.url.startsWith('/__sim/files/')).toBe(true)
    expect(JSON.stringify(out)).not.toContain('base64')
    expect(JSON.stringify(out)).not.toContain(key)
    expect(JSON.stringify(out)).not.toContain('cdn.example')
  })
})
