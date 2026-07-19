import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { FullstackWorkflowSeed } from '@/lib/apps/build-interface/types'
import {
  buildFullstackNarrationPrompt,
  fallbackFullstackFinalResponse,
} from '@/lib/apps/demo/final-response'
import { runDemoIsolatedAskPass } from '@/lib/apps/demo/headless-mothership'
import { runFullstackDemoOrchestration } from '@/lib/apps/demo/orchestrator'
import { assertHostedDemoRuntime } from '@/lib/apps/demo/runtime'
import {
  FULLSTACK_BACKEND_AGENT_ID,
  FullstackWorkerStreamBridge,
} from '@/lib/apps/demo/stream-bridge'
import type { DemoProgressEvent } from '@/lib/apps/demo/types'
import {
  MothershipStreamV1AppEventName,
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { ContentBlock, OrchestratorResult, StreamEvent } from '@/lib/copilot/request/types'

const logger = createLogger('FullstackDemoChatCoordinator')

function appEventForProgress(event: DemoProgressEvent): StreamEvent | null {
  const projectId = event.projectId
  if (!projectId) return null

  if (
    event.phase === 'building_backend' ||
    event.phase === 'generating_frontend' ||
    event.phase === 'building_app'
  ) {
    return {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: MothershipStreamV1AppEventName['app.generation.started'],
        payload: {
          projectId,
          phase: event.phase,
          ...(event.chatId ? { chatId: event.chatId } : {}),
        },
      },
    }
  }

  if (event.phase === 'frontend_generated') {
    return {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: MothershipStreamV1AppEventName['app.frontend.generated'],
        payload: {
          projectId,
          source: event.frontendSource ?? 'hosted',
          filePaths: event.frontendFiles ?? [],
          fileCount: event.frontendFiles?.length ?? 0,
          repairAttempted: event.repairAttempted ?? false,
          ...(event.chatId ? { chatId: event.chatId } : {}),
        },
      },
    }
  }

  if (event.phase === 'preview_ready' && event.revisionId && event.sessionId) {
    return {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: MothershipStreamV1AppEventName['app.preview.ready'],
        payload: {
          projectId,
          revisionId: event.revisionId,
          sessionId: event.sessionId,
          ...(event.buildId ? { buildId: event.buildId } : {}),
          ...(event.channelNonce ? { channelNonce: event.channelNonce } : {}),
          ...(event.appPublicOrigin ? { appPublicOrigin: event.appPublicOrigin } : {}),
          ...(event.artifactPreview !== undefined
            ? { artifactPreview: event.artifactPreview }
            : {}),
          ...(event.chatId ? { chatId: event.chatId } : {}),
        },
      },
    }
  }

  if (event.phase === 'credential_selection_required') {
    return {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: MothershipStreamV1AppEventName['app.binding.drift'],
        payload: {
          projectId,
          phase: 'credential_selection_required',
          ...(event.chatId ? { chatId: event.chatId } : {}),
          credentialSelections: event.credentialSelections ?? [],
        },
      },
    }
  }

  if (event.phase === 'failed') {
    return {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: MothershipStreamV1AppEventName['app.generation.failed'],
        payload: {
          projectId,
          ...(event.chatId ? { chatId: event.chatId } : {}),
          ...(event.revisionId ? { revisionId: event.revisionId } : {}),
          ...(event.code ? { code: event.code } : {}),
          message: event.error || event.message || 'Full-stack generation failed',
        },
      },
    }
  }

  return null
}

function toOrchestratorResult(
  finalEvent: DemoProgressEvent,
  content: string,
  backendResult: OrchestratorResult | undefined,
  backendSpanId: string,
  frontendSpanId: string,
  frontendToolCalls: Array<{
    id: string
    name: string
    status: 'success' | 'error'
    error?: string
  }>
): OrchestratorResult {
  const contentBlocks = [
    ...buildBackendPersistenceBlocks(backendResult, backendSpanId),
    ...buildFrontendPersistenceBlocks(frontendToolCalls, frontendSpanId),
  ]
  if (finalEvent.phase === 'preview_ready') {
    return {
      success: true,
      content,
      contentBlocks,
      toolCalls: backendResult?.toolCalls ?? [],
      chatId: finalEvent.chatId,
    }
  }
  if (finalEvent.phase === 'credential_selection_required') {
    return {
      success: true,
      content,
      contentBlocks,
      toolCalls: backendResult?.toolCalls ?? [],
      chatId: finalEvent.chatId,
    }
  }
  if (finalEvent.code === 'CANCELLED') {
    return {
      success: false,
      cancelled: true,
      content,
      contentBlocks,
      toolCalls: backendResult?.toolCalls ?? [],
      chatId: finalEvent.chatId,
      error: finalEvent.error || 'Cancelled',
    }
  }
  return {
    success: false,
    content,
    contentBlocks,
    toolCalls: backendResult?.toolCalls ?? [],
    chatId: finalEvent.chatId,
    error: finalEvent.error || 'Full-stack generation failed.',
  }
}

function buildFrontendPersistenceBlocks(
  toolCalls: Array<{
    id: string
    name: string
    status: 'success' | 'error'
    error?: string
  }>,
  spanId: string
): ContentBlock[] {
  if (!toolCalls.length) return []
  const startedAt = Date.now()
  return [
    {
      type: 'subagent',
      content: 'fullstack_frontend',
      timestamp: startedAt,
      spanId,
      parentSpanId: 'main',
      endedAt: startedAt + 1,
    },
    ...toolCalls.map(
      (call): ContentBlock => ({
        type: 'tool_call',
        calledBy: 'fullstack_frontend',
        timestamp: startedAt,
        spanId,
        parentSpanId: 'main',
        toolCall: {
          id: call.id,
          name: call.name,
          status: call.status,
          result: {
            success: call.status === 'success',
            ...(call.error ? { error: call.error } : {}),
          },
        },
      })
    ),
  ]
}

function buildBackendPersistenceBlocks(
  result: OrchestratorResult | undefined,
  spanId: string
): ContentBlock[] {
  if (!result?.toolCalls.length) return []
  const startedAt = Date.now()
  return [
    {
      type: 'subagent',
      content: FULLSTACK_BACKEND_AGENT_ID,
      timestamp: startedAt,
      spanId,
      parentSpanId: 'main',
      endedAt: startedAt + 1,
    },
    ...result.toolCalls.map(
      (call): ContentBlock => ({
        type: 'tool_call',
        calledBy: FULLSTACK_BACKEND_AGENT_ID,
        timestamp: startedAt,
        spanId,
        parentSpanId: 'main',
        toolCall: {
          id: call.id,
          name: call.name,
          status: call.status,
          ...(call.params ? { params: call.params } : {}),
          result: {
            success: call.status === 'success',
            ...(call.error ? { error: call.error } : {}),
          },
        },
      })
    ),
  ]
}

/**
 * Run the hosted Full-stack demo coordinator inside the normal mothership chat SSE
 * lifecycle, mapping progress + nested backend events onto StreamWriter envelopes.
 */
export async function runFullstackDemoChatCoordinator(params: {
  userId: string
  workspaceId: string
  chatId: string
  prompt: string
  credentialSelections?: Record<string, string>
  projectId?: string
  fullstackSeed?: FullstackWorkflowSeed
  abortSignal?: AbortSignal
  onEvent: (event: StreamEvent) => void | Promise<void>
}): Promise<OrchestratorResult> {
  const runtime = await assertHostedDemoRuntime()
  if (!runtime.ok) {
    const message = runtime.error
    await params.onEvent({
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: MothershipStreamV1TextChannel.assistant,
        text: message,
      },
    })
    return {
      success: false,
      content: message,
      contentBlocks: [],
      toolCalls: [],
      chatId: params.chatId,
      error: message,
    }
  }

  let backendResult: OrchestratorResult | undefined
  const workerBridge = new FullstackWorkerStreamBridge(params.onEvent)
  const frontendSpanId = `fullstack-frontend:${generateId()}`
  const generateToolId = `generate-interface:${generateId()}`
  const buildToolId = `build-preview:${generateId()}`
  let frontendOpened = false
  let generateOpened = false
  let buildOpened = false
  const frontendToolCalls: Array<{
    id: string
    name: string
    status: 'success' | 'error'
    error?: string
  }> = []

  const frontendScope = {
    lane: 'subagent' as const,
    agentId: 'fullstack_frontend',
    spanId: frontendSpanId,
    parentSpanId: 'main',
  }
  const openFrontend = async () => {
    if (frontendOpened) return
    frontendOpened = true
    await params.onEvent({
      type: 'span',
      scope: frontendScope,
      payload: {
        kind: 'subagent',
        event: 'start',
        agent: 'fullstack_frontend',
      },
    })
  }
  const toolCall = async (toolCallId: string, toolName: string) => {
    await params.onEvent({
      type: 'tool',
      scope: frontendScope,
      payload: {
        phase: 'call',
        toolCallId,
        toolName,
        executor: 'sim',
        mode: 'sync',
        status: 'executing',
      },
    })
  }
  const toolResult = async (
    toolCallId: string,
    toolName: string,
    success: boolean,
    error?: string
  ) => {
    frontendToolCalls.push({
      id: toolCallId,
      name: toolName,
      status: success ? 'success' : 'error',
      ...(error ? { error } : {}),
    })
    await params.onEvent({
      type: 'tool',
      scope: frontendScope,
      payload: {
        phase: 'result',
        toolCallId,
        toolName,
        executor: 'sim',
        mode: 'sync',
        success,
        status: success ? 'success' : 'error',
        ...(error ? { error } : {}),
      },
    })
  }
  const closeFrontend = async (success: boolean, error?: string) => {
    if (!frontendOpened) return
    if (generateOpened) {
      generateOpened = false
      await toolResult(generateToolId, 'generate_interface', success, error)
    }
    if (buildOpened) {
      buildOpened = false
      await toolResult(buildToolId, 'build_live_preview', success, error)
    }
    await params.onEvent({
      type: 'span',
      scope: frontendScope,
      payload: {
        kind: 'subagent',
        event: 'end',
        agent: 'fullstack_frontend',
        data: success ? {} : { error: error || 'Interface build failed' },
      },
    })
    frontendOpened = false
  }
  const publishFrontendProgress = async (event: DemoProgressEvent) => {
    if (event.phase === 'generating_frontend') {
      await openFrontend()
      if (!generateOpened) {
        generateOpened = true
        await toolCall(generateToolId, 'generate_interface')
      }
    } else if (event.phase === 'frontend_generated') {
      await openFrontend()
      if (generateOpened) {
        generateOpened = false
        await toolResult(generateToolId, 'generate_interface', true)
      }
    } else if (event.phase === 'building_app') {
      await openFrontend()
      if (generateOpened) {
        generateOpened = false
        await toolResult(generateToolId, 'generate_interface', true)
      }
      if (!buildOpened) {
        buildOpened = true
        await toolCall(buildToolId, 'build_live_preview')
      }
    } else if (event.phase === 'preview_ready' || event.phase === 'failed') {
      await closeFrontend(event.phase === 'preview_ready', event.error)
    }
  }

  const publishProgress = async (event: DemoProgressEvent) => {
    await publishFrontendProgress(event)
    const appEvent = appEventForProgress(event)
    if (event.phase === 'preview_ready' && event.projectId && event.revisionId && event.buildId) {
      await params.onEvent({
        type: MothershipStreamV1EventType.app,
        payload: {
          event: MothershipStreamV1AppEventName['app.build.finished'],
          payload: {
            projectId: event.projectId,
            revisionId: event.revisionId,
            buildId: event.buildId,
            success: true,
          },
        },
      })
    }
    if (appEvent) {
      await params.onEvent(appEvent)
    }
  }

  try {
    const finalEvent = await runFullstackDemoOrchestration({
      userId: params.userId,
      workspaceId: params.workspaceId,
      prompt: params.prompt,
      chatId: params.chatId,
      projectId: params.projectId,
      credentialSelections: params.credentialSelections,
      fullstackSeed: params.fullstackSeed,
      abortSignal: params.abortSignal,
      onEvent: publishProgress,
      onBackendResult: async (result) => {
        backendResult = result
        await workerBridge.close({
          ...(result.error ? { error: result.error } : {}),
          ...(result.cancelled ? { cancelled: true } : {}),
        })
      },
      onStreamEvent: (event) => workerBridge.forward(event),
    })
    await closeFrontend(
      finalEvent.phase === 'preview_ready',
      finalEvent.error || (finalEvent.code === 'CANCELLED' ? 'Cancelled' : undefined)
    )

    await workerBridge.close({
      ...(finalEvent.phase === 'failed' && finalEvent.error ? { error: finalEvent.error } : {}),
      ...(finalEvent.code === 'CANCELLED' ? { cancelled: true } : {}),
    })

    let content = fallbackFullstackFinalResponse(finalEvent)
    if (finalEvent.phase === 'preview_ready') {
      try {
        const narration = await runDemoIsolatedAskPass({
          userId: params.userId,
          workspaceId: params.workspaceId,
          message: buildFullstackNarrationPrompt({
            originalPrompt: params.prompt,
            finalEvent,
          }),
          abortSignal: params.abortSignal,
        })
        if (narration.success && narration.content.trim()) {
          content = narration.content.trim()
        }
      } catch (error) {
        logger.warn('Full-stack final narration failed; using deterministic response', {
          error: error instanceof Error ? error.message : String(error),
          chatId: params.chatId,
        })
      }
    }

    await params.onEvent({
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: MothershipStreamV1TextChannel.assistant,
        text: content,
      },
    })

    return toOrchestratorResult(
      finalEvent,
      content,
      backendResult,
      workerBridge.persistenceSpanId,
      frontendSpanId,
      frontendToolCalls
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await closeFrontend(false, message)
    await workerBridge.close({ error: message })
    logger.error('Full-stack chat coordinator failed', { error: message, chatId: params.chatId })
    await params.onEvent({
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: MothershipStreamV1TextChannel.assistant,
        text: message,
      },
    })
    return {
      success: false,
      content: message,
      contentBlocks: [],
      toolCalls: [],
      chatId: params.chatId,
      error: message,
    }
  }
}

export function shouldRunFullstackDemoChatCoordinator(
  requestPayload: Record<string, unknown>
): boolean {
  return requestPayload.chatType === 'fullstack'
}
