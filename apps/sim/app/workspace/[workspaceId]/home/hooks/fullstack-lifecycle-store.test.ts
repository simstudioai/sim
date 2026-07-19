import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyFullstackAppLifecycleEvent,
  clearFullstackPreviewAfterPublication,
  getFullstackLifecycleState,
  hydrateFullstackLifecycleSummary,
  resetFullstackLifecycleForChat,
} from '@/app/workspace/[workspaceId]/home/hooks/fullstack-lifecycle-store'

describe('fullstack lifecycle store', () => {
  beforeEach(() => {
    resetFullstackLifecycleForChat(`reset-${Math.random()}`)
  })

  it('drops lifecycle events belonging to another selected chat', () => {
    resetFullstackLifecycleForChat('chat-current')
    applyFullstackAppLifecycleEvent({
      eventName: 'app.generation.started',
      chatId: 'chat-stale',
      payload: { projectId: 'project-stale', phase: 'building_backend' },
    })

    expect(getFullstackLifecycleState()).toMatchObject({
      chatId: 'chat-current',
      projectId: null,
      phase: 'idle',
    })
  })

  it('hydrates a completed preview when reopening its chat', () => {
    resetFullstackLifecycleForChat('chat-1')
    hydrateFullstackLifecycleSummary(
      {
        version: 1,
        status: 'preview_ready',
        phase: 'preview_ready',
        chatId: 'chat-1',
        projectId: 'project-1',
        originalPrompt: 'Build an app',
        revisionId: 'revision-1',
        buildId: 'build-1',
        sessionId: 'session-1',
        channelNonce: 'nonce-1',
        appPublicOrigin: 'https://apps.example.test',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      'chat-1'
    )

    expect(getFullstackLifecycleState()).toMatchObject({
      chatId: 'chat-1',
      projectId: 'project-1',
      phase: 'preview_ready',
      preview: {
        revisionId: 'revision-1',
        sessionId: 'session-1',
      },
    })
  })

  it('keeps the current preview through deploy failure and clears it only after publication', () => {
    resetFullstackLifecycleForChat('chat-1')
    hydrateFullstackLifecycleSummary(
      {
        version: 1,
        status: 'preview_ready',
        phase: 'preview_ready',
        chatId: 'chat-1',
        projectId: 'project-1',
        originalPrompt: 'Build an app',
        revisionId: 'revision-1',
        buildId: 'build-1',
        sessionId: 'session-1',
        channelNonce: 'nonce-1',
        appPublicOrigin: 'https://apps.example.test',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      'chat-1'
    )

    applyFullstackAppLifecycleEvent({
      eventName: 'app.deploy.started',
      chatId: 'chat-1',
      payload: { projectId: 'project-1' },
    })
    applyFullstackAppLifecycleEvent({
      eventName: 'app.deploy.failed',
      chatId: 'chat-1',
      payload: { projectId: 'project-1', message: 'Deploy failed' },
    })
    expect(getFullstackLifecycleState().preview?.sessionId).toBe('session-1')

    clearFullstackPreviewAfterPublication()
    expect(getFullstackLifecycleState().preview).toBeNull()
  })
})
