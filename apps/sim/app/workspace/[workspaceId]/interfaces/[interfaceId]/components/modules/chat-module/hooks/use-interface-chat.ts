'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { traverseObjectPath } from '@/lib/core/utils/response-format'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { InterfaceOutputConfig } from '@/lib/interfaces'
import type { ChatFile, ChatMessage } from '@/app/(interfaces)/chat/components/message/message'
import { CHAT_ERROR_MESSAGES } from '@/app/(interfaces)/chat/constants'
import type { UserFile } from '@/executor/types'
import { useExecutionStream } from '@/hooks/use-execution-stream'

const logger = createLogger('UseInterfaceChat')

/**
 * Upper bound on the retained thinking trace. A workflow with loops emits one
 * `block:started` per iteration, so an uncapped list would grow without limit
 * for the lifetime of the run.
 */
const MAX_THINKING_STEPS = 30

/** Mirrors the deployed chat's stop-streaming marker (`use-chat-streaming.ts`). */
const STOPPED_NOTE = '_Response stopped by user._'

/** Shown when a run succeeds but nothing selected — or produced — anything to display. */
const NO_OUTPUT_NOTE = '_The workflow returned no output._'

/** One block invocation surfaced while `showThinking` is on. */
export interface InterfaceChatStep {
  /** Stable per-invocation key — one block runs many times inside a loop. */
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
}

export interface UseInterfaceChatArgs {
  /**
   * Identifies this module's run among all runs of the same workflow. Two chat
   * modules can be wired to one workflow (the natural way to surface two output
   * selections), and streams are keyed per workflow by default — without a
   * per-module key each module's run would abort the other's.
   */
  moduleId: string
  /** `null` until a workflow is wired in the properties panel; sending is then a no-op. */
  workflowId: string | null
  /** Selected block outputs, mirroring a chat deployment's `outputConfigs`. */
  outputConfigs: InterfaceOutputConfig[]
  /** Surfaces per-block progress and every streamed chunk while a run is in flight. */
  showThinking: boolean
}

export interface UseInterfaceChatResult {
  messages: ChatMessage[]
  /** Empty unless `showThinking` was on for the most recent run. */
  steps: InterfaceChatStep[]
  isRunning: boolean
  send: (text: string) => void
  stop: () => void
}

/**
 * Serializes selected outputs onto the execute route's `selectedOutputs` wire,
 * byte-identical to the deployed chat route's own serialization — an empty path
 * means the block's `content` field.
 */
function toSelectedOutputs(outputConfigs: readonly InterfaceOutputConfig[]): string[] {
  return outputConfigs.map((config) =>
    config.path ? `${config.blockId}_${config.path}` : `${config.blockId}_content`
  )
}

/**
 * Reads one selected output out of a block's terminal output, mirroring the
 * deployed chat's resolution: an empty or `content` path prefers `content`,
 * then `result`, then the whole output; any other path is read directly before
 * falling back to a dot-path walk.
 */
function resolveOutputValue(output: unknown, path: string): unknown {
  if (!isRecordLike(output)) return output
  if (!path || path === 'content') {
    if (output.content !== undefined) return output.content
    if (output.result !== undefined) return output.result
    return output
  }
  if (output[path] !== undefined) return output[path]
  return traverseObjectPath(output, path)
}

/** Renders one resolved output as markdown, or `null` when it carries nothing to show. */
function formatOutputValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (isUserFileWithMetadata(value)) return null
  if (Array.isArray(value) && value.length === 0) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Narrows an executor file to the fields the chat renders. Copying rather than
 * passing the value through keeps inlined `base64` payloads out of the
 * transcript's React state, where they would be retained for the session.
 */
function toChatFile(file: UserFile): ChatFile {
  return {
    id: file.id,
    name: file.name,
    url: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
    context: file.context,
  }
}

/**
 * Pulls workflow-produced files out of a resolved output so they render as
 * download chips instead of a JSON dump of their storage metadata.
 */
function collectUserFiles(value: unknown): ChatFile[] {
  if (isUserFileWithMetadata(value)) {
    return [toChatFile(value)]
  }
  if (!Array.isArray(value)) return []
  const files: ChatFile[] = []
  for (const item of value) {
    if (isUserFileWithMetadata(item)) files.push(toChatFile(item))
  }
  return files
}

/** Routes one resolved value to either the file list or the markdown parts. */
function collectValue(value: unknown, parts: string[], files: ChatFile[]): void {
  const collected = collectUserFiles(value)
  if (collected.length > 0) {
    files.push(...collected)
    return
  }
  const formatted = formatOutputValue(value)
  if (formatted?.trim()) parts.push(formatted)
}

interface ResolveAssistantContentArgs {
  /** Concatenated `stream:chunk` text, in arrival order. */
  streamedText: string
  outputConfigs: readonly InterfaceOutputConfig[]
  /** Terminal output of every block referenced by `outputConfigs`. */
  blockOutputs: ReadonlyMap<string, unknown>
  /** Blocks whose content already reached the user as chunks. */
  streamedBlockIds: ReadonlySet<string>
  /** `execution:completed`/`execution:paused` output, used when nothing else resolved. */
  fallbackOutput: unknown
}

/**
 * Builds the assistant turn from a finished run, mirroring the deployed chat's
 * `buildMinimalResult` + client formatting: streamed text first, then every
 * selected output whose block did **not** stream (its content would otherwise
 * be duplicated), and the raw execution output only when neither produced
 * anything.
 */
function resolveAssistantContent({
  streamedText,
  outputConfigs,
  blockOutputs,
  streamedBlockIds,
  fallbackOutput,
}: ResolveAssistantContentArgs): { content: string; files: ChatFile[] } {
  const parts: string[] = []
  const files: ChatFile[] = []

  const streamed = streamedText.trim()
  if (streamed) parts.push(streamed)

  for (const config of outputConfigs) {
    if (streamedBlockIds.has(config.blockId)) continue
    if (!blockOutputs.has(config.blockId)) continue
    collectValue(resolveOutputValue(blockOutputs.get(config.blockId), config.path), parts, files)
  }

  if (parts.length === 0 && files.length === 0) {
    /**
     * The terminal event carries the last block's normalized output, so it is
     * unwrapped on the same default path a selected output uses — otherwise a
     * plain `{ content: '...' }` answer would render as a JSON code block.
     */
    collectValue(resolveOutputValue(fallbackOutput, 'content'), parts, files)
  }

  return { content: parts.join('\n\n'), files }
}

/** Joins non-empty markdown fragments with a blank line between them. */
function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
}

function appendStep(steps: InterfaceChatStep[], step: InterfaceChatStep): InterfaceChatStep[] {
  const next = [...steps, step]
  return next.length > MAX_THINKING_STEPS ? next.slice(next.length - MAX_THINKING_STEPS) : next
}

function markStep(
  steps: InterfaceChatStep[],
  id: string,
  status: InterfaceChatStep['status']
): InterfaceChatStep[] {
  return steps.map((step) => (step.id === id ? { ...step, status } : step))
}

/**
 * Runs a chat-module turn against the workspace workflow wired to the module.
 *
 * Reuses {@link useExecutionStream} — the shared consumer of
 * `POST /api/workflows/[id]/execute`'s SSE stream — so the interface chat runs
 * a workflow through exactly the same path as the workflow editor: the same
 * route, the same `triggerType: 'chat'` payload, the same
 * `selectedOutputs` serialization a chat deployment uses, and the same
 * `ExecutionEvent` decoding. Nothing about the stream is reimplemented here;
 * this hook only maps those events onto chat turns.
 *
 * Transcript state is deliberately local and ephemeral — an interface chat has
 * no server-side conversation record, so nothing here belongs in React Query,
 * a store, or the URL.
 */
export function useInterfaceChat({
  moduleId,
  workflowId,
  outputConfigs,
  showThinking,
}: UseInterfaceChatArgs): UseInterfaceChatResult {
  const { execute, cancelExecute } = useExecutionStream()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [steps, setSteps] = useState<InterfaceChatStep[]>([])
  const [isRunning, setIsRunning] = useState(false)

  /** One conversation id per mounted module, so multi-turn context stays coherent. */
  const conversationIdRef = useRef<string | null>(null)
  conversationIdRef.current ??= generateId()

  const moduleIdRef = useRef(moduleId)
  const workflowIdRef = useRef(workflowId)
  const outputConfigsRef = useRef(outputConfigs)
  const showThinkingRef = useRef(showThinking)
  /** Guards against a second turn starting while one is still streaming. */
  const runningRef = useRef(false)
  /** Workflow of the in-flight run — the key `cancelExecute` aborts on. */
  const runWorkflowIdRef = useRef<string | null>(null)

  useEffect(() => {
    moduleIdRef.current = moduleId
    workflowIdRef.current = workflowId
    outputConfigsRef.current = outputConfigs
    showThinkingRef.current = showThinking
  }, [moduleId, workflowId, outputConfigs, showThinking])

  useEffect(
    () => () => {
      const active = runWorkflowIdRef.current
      if (active) cancelExecute(active, moduleIdRef.current)
    },
    [cancelExecute]
  )

  const stop = useCallback(() => {
    const active = runWorkflowIdRef.current
    if (active) cancelExecute(active, moduleIdRef.current)
  }, [cancelExecute])

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      const activeWorkflowId = workflowIdRef.current
      if (!text || !activeWorkflowId || runningRef.current) return

      const selectedOutputConfigs = outputConfigsRef.current
      const assistantId = generateId()

      runningRef.current = true
      runWorkflowIdRef.current = activeWorkflowId
      setMessages((previous) => [
        ...previous,
        { id: generateId(), content: text, type: 'user', timestamp: new Date() },
        {
          id: assistantId,
          content: '',
          type: 'assistant',
          timestamp: new Date(),
          isStreaming: true,
        },
      ])
      setSteps([])
      setIsRunning(true)

      let streamedText = ''
      const streamedBlockIds = new Set<string>()
      const blockOutputs = new Map<string, unknown>()
      /** Only blocks feeding a selected output are retained — the rest are dropped. */
      const wantedBlockIds = new Set(selectedOutputConfigs.map((config) => config.blockId))
      let settled = false
      let frame: number | null = null

      const cancelFlush = () => {
        if (frame === null) return
        cancelAnimationFrame(frame)
        frame = null
      }

      /**
       * Chunks arrive far faster than the browser paints, so the growing text is
       * committed once per frame instead of once per token.
       */
      const scheduleFlush = () => {
        if (frame !== null) return
        frame = requestAnimationFrame(() => {
          frame = null
          const snapshot = streamedText
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId && message.isStreaming
                ? { ...message, content: snapshot }
                : message
            )
          )
        })
      }

      const settle = (content: string, files?: ChatFile[]) => {
        settled = true
        cancelFlush()
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? { ...message, content, isStreaming: false, files }
              : message
          )
        )
      }

      const settleFromOutput = (fallbackOutput: unknown, succeeded: boolean) => {
        const { content, files } = resolveAssistantContent({
          streamedText,
          outputConfigs: selectedOutputConfigs,
          blockOutputs,
          streamedBlockIds,
          fallbackOutput,
        })
        if (content || files.length > 0) {
          settle(content, files.length > 0 ? files : undefined)
          return
        }
        settle(succeeded ? NO_OUTPUT_NOTE : CHAT_ERROR_MESSAGES.GENERIC_ERROR)
      }

      try {
        await execute({
          workflowId: activeWorkflowId,
          streamKey: moduleIdRef.current,
          triggerType: 'chat',
          input: { input: text, conversationId: conversationIdRef.current },
          selectedOutputs: toSelectedOutputs(selectedOutputConfigs),
          callbacks: {
            onBlockStarted: (data) => {
              if (!showThinkingRef.current) return
              setSteps((previous) =>
                appendStep(previous, {
                  id: `${data.blockId}:${data.executionOrder}`,
                  label: data.blockName,
                  status: 'running',
                })
              )
            },
            onBlockCompleted: (data) => {
              if (wantedBlockIds.has(data.blockId)) blockOutputs.set(data.blockId, data.output)
              if (!showThinkingRef.current) return
              setSteps((previous) =>
                markStep(previous, `${data.blockId}:${data.executionOrder}`, 'completed')
              )
            },
            onBlockError: (data) => {
              if (!showThinkingRef.current) return
              setSteps((previous) =>
                markStep(previous, `${data.blockId}:${data.executionOrder}`, 'failed')
              )
            },
            onStreamChunk: (data) => {
              streamedBlockIds.add(data.blockId)
              streamedText += data.chunk
              scheduleFlush()
            },
            onExecutionCompleted: (data) => settleFromOutput(data.output, data.success),
            /**
             * A human-in-the-loop pause is terminal for the chat turn: whatever
             * ran before the pause is the answer, exactly as a chat deployment
             * treats it.
             */
            onExecutionPaused: (data) => settleFromOutput(data.output, true),
            onExecutionError: (data) => {
              settle(joinParts([streamedText, data.error || CHAT_ERROR_MESSAGES.GENERIC_ERROR]))
            },
            onExecutionCancelled: () => {
              settle(joinParts([streamedText, STOPPED_NOTE]))
            },
          },
        })
      } catch (error) {
        logger.error('Interface chat run failed', { error })
        if (!settled) {
          settle(
            joinParts([streamedText, getErrorMessage(error, CHAT_ERROR_MESSAGES.GENERIC_ERROR)])
          )
        }
      } finally {
        cancelFlush()
        /**
         * A user-initiated abort resolves the stream without a terminal event,
         * so the partial turn is closed out here rather than left streaming.
         */
        if (!settled) settle(joinParts([streamedText, STOPPED_NOTE]))
        runningRef.current = false
        runWorkflowIdRef.current = null
        setIsRunning(false)
      }
    },
    [execute]
  )

  return { messages, steps, isRunning, send, stop }
}
