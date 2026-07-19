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
        await params.onEvent({
          phase: 'generating_frontend',
          projectId: 'project-1',
        })
        await params.onEvent({
          phase: 'frontend_generated',
          projectId: 'project-1',
        })
        await params.onEvent({
          phase: 'building_app',
          projectId: 'project-1',
          revisionId: 'revision-1',
          buildId: 'build-1',
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
    expect(appEvents).toEqual([
      'app.generation.started',
      'app.frontend.generated',
      'app.generation.started',
      'app.build.finished',
      'app.preview.ready',
    ])
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
    const interfaceEvents = events
      .filter(
        (event) =>
          event.type === MothershipStreamV1EventType.tool &&
          (event as { scope?: { agentId?: string } }).scope?.agentId === 'fullstack_frontend'
      )
      .map((event) => ({
        phase: event.payload.phase,
        toolName: event.payload.toolName,
        success: event.payload.success,
      }))
    expect(interfaceEvents).toEqual([
      { phase: 'call', toolName: 'generate_interface', success: undefined },
      { phase: 'result', toolName: 'generate_interface', success: true },
      { phase: 'call', toolName: 'build_live_preview', success: undefined },
      { phase: 'result', toolName: 'build_live_preview', success: true },
    ])
    expect(result.success).toBe(true)
    expect(result.content).toBe('Your app is ready.')
    expect(result.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'subagent', content: 'fullstack_frontend' }),
        expect.objectContaining({
          type: 'tool_call',
          calledBy: 'fullstack_frontend',
          toolCall: expect.objectContaining({
            name: 'build_live_preview',
            status: 'success',
          }),
        }),
      ])
    )
    expect(JSON.stringify(result)).not.toContain('Leaked backend prose')
  })

  it('closes the interface builder step when frontend generation fails', async () => {
    assertRuntime.mockResolvedValue({ ok: true })
    runOrchestration.mockImplementationOnce(
      async (params: { onEvent: (event: Record<string, unknown>) => Promise<void> }) => {
        await params.onEvent({
          phase: 'generating_frontend',
          projectId: 'project-1',
        })
        const failed = {
          phase: 'failed',
          projectId: 'project-1',
          error: 'Interface generation failed',
        }
        await params.onEvent(failed)
        return failed
      }
    )
    const events: Array<{
      type: string
      scope?: { agentId?: string }
      payload: Record<string, unknown>
    }> = []

    const result = await runFullstackDemoChatCoordinator({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      prompt: 'Build an app',
      onEvent: (event) => {
        events.push(event as (typeof events)[number])
      },
    })

    const interfaceEvents = events.filter(
      (event) => event.scope?.agentId === 'fullstack_frontend'
    )
    expect(interfaceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          payload: expect.objectContaining({
            phase: 'result',
            toolName: 'generate_interface',
            success: false,
          }),
        }),
        expect.objectContaining({
          type: 'span',
          payload: expect.objectContaining({ event: 'end' }),
        }),
      ])
    )
    expect(result.success).toBe(false)
    expect(result.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          calledBy: 'fullstack_frontend',
          toolCall: expect.objectContaining({ status: 'error' }),
        }),
      ])
    )
  })
})
