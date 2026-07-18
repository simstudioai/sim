/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'

const { runOrchestration, assertRuntime, runIsolated } = vi.hoisted(() => ({
  runOrchestration: vi.fn(),
  assertRuntime: vi.fn(),
  runIsolated: vi.fn(),
}))

vi.mock('@/lib/apps/demo/orchestrator', () => ({
  runFullstackDemoOrchestration: runOrchestration,
}))

vi.mock('@/lib/apps/demo/runtime', () => ({
  assertHostedDemoRuntime: assertRuntime,
}))

vi.mock('@/lib/apps/demo/headless-mothership', () => ({
  runDemoIsolatedAskPass: runIsolated,
}))

import {
  runFullstackDemoChatCoordinator,
  shouldRunFullstackDemoChatCoordinator,
} from '@/lib/apps/demo/chat-coordinator'

describe('shouldRunFullstackDemoChatCoordinator', () => {
  it('runs only for fullstack chat payloads', () => {
    expect(shouldRunFullstackDemoChatCoordinator({ chatType: 'fullstack' })).toBe(true)
    expect(shouldRunFullstackDemoChatCoordinator({ chatType: 'mothership' })).toBe(false)
    expect(shouldRunFullstackDemoChatCoordinator({})).toBe(false)
  })
})

describe('runFullstackDemoChatCoordinator', () => {
  it('emits build finished before preview ready', async () => {
    assertRuntime.mockResolvedValue({ ok: true })
    runIsolated.mockResolvedValue({
      success: true,
      content: 'Your app is ready.',
      contentBlocks: [],
      toolCalls: [],
    })
    runOrchestration.mockImplementation(
      async (params: {
        onEvent: (event: {
          phase: string
          projectId: string
          revisionId: string
          buildId: string
          sessionId: string
          channelNonce: string
          appPublicOrigin: string
        }) => Promise<void>
        onStreamEvent: (event: unknown) => Promise<void>
        onBackendResult: (result: unknown) => Promise<void>
      }) => {
        await params.onStreamEvent({
          type: 'text',
          payload: { channel: 'assistant', text: 'Leaked backend prose' },
        })
        await params.onStreamEvent({
          type: 'tool',
          payload: {
            phase: 'call',
            toolCallId: 'tool-1',
            toolName: 'create_workflow',
            executor: 'sim',
            mode: 'async',
          },
        })
        await params.onBackendResult({
          success: true,
          content: 'Leaked backend prose',
          contentBlocks: [],
          toolCalls: [
            {
              id: 'tool-1',
              name: 'create_workflow',
              status: 'success',
            },
          ],
        })
        const ready = {
          phase: 'preview_ready',
          projectId: 'project-1',
          revisionId: 'revision-1',
          buildId: 'build-1',
          sessionId: 'session-1',
          channelNonce: 'nonce-1',
          appPublicOrigin: 'https://apps.test',
        }
        await params.onEvent(ready)
        return ready
      }
    )
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []

    const result = await runFullstackDemoChatCoordinator({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      prompt: 'Build an app',
      onEvent: (event) => {
        events.push(event as { type: string; payload: Record<string, unknown> })
      },
    })

    const appEvents = events
      .filter((event) => event.type === MothershipStreamV1EventType.app)
      .map((event) => event.payload.event)
    expect(appEvents).toEqual(['app.build.finished', 'app.preview.ready'])
    const textEvents = events.filter((event) => event.type === MothershipStreamV1EventType.text)
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0]?.payload.text).toBe('Your app is ready.')
    const toolEvent = events.find((event) => event.type === MothershipStreamV1EventType.tool)
    expect(toolEvent).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          lane: 'subagent',
          agentId: 'fullstack_backend',
        }),
      })
    )
    expect(result.success).toBe(true)
    expect(result.content).toBe('Your app is ready.')
    expect(JSON.stringify(result)).not.toContain('Leaked backend prose')
  })
})
