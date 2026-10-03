import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { filterUndefined } from '@sim/utils/object'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { requestRaw } from '@/lib/api/client'
import { isApiClientError } from '@/lib/api/client/errors'
import { wandGenerateStreamContract } from '@/lib/api/contracts'
import { readSSEStream } from '@/lib/core/utils/sse'
import { shouldStripCodeFences, stripCodeFences } from '@/lib/wand/strip-code-fences'
import type { GenerationType } from '@/blocks/types'
import { scheduleUsageRefresh } from '@/hooks/queries/utils/invalidate-usage'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useWand')

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface BuildWandContextInfoOptions {
  currentValue?: string
  generationType?: string
}

/**
 * Builds rich context information based on current content and generation type.
 * Note: Table schema context is now fetched server-side in /api/wand for simplicity.
 */
function buildWandContextInfo({
  currentValue,
  generationType,
}: BuildWandContextInfoOptions): string {
  const hasContent = Boolean(currentValue && currentValue.trim() !== '')
  const contentLength = currentValue?.length ?? 0
  const lineCount = currentValue ? currentValue.split('\n').length : 0

  let contextInfo = hasContent
    ? `Current content (${contentLength} characters, ${lineCount} lines):\n${currentValue}`
    : 'no current content'

  if (generationType && currentValue) {
    switch (generationType) {
      case 'javascript-function-body':
      case 'typescript-function-body': {
        const hasFunction = /function\s+\w+/.test(currentValue)
        const hasArrowFunction = /=>\s*{/.test(currentValue)
        const hasReturn = /return\s+/.test(currentValue)
        contextInfo += `\n\nCode analysis: ${hasFunction ? 'Contains function declaration. ' : ''}${hasArrowFunction ? 'Contains arrow function. ' : ''}${hasReturn ? 'Has return statement.' : 'No return statement.'}`
        break
      }

      case 'json-schema':
      case 'json-object':
      case 'json-array':
      case 'table-schema':
        try {
          const parsed = JSON.parse(currentValue)
          // Reporting "top-level keys" for an array would list numeric indices,
          // which tells the model nothing about the shape it should produce.
          contextInfo += Array.isArray(parsed)
            ? `\n\nJSON analysis: Valid JSON array with ${parsed.length} items`
            : `\n\nJSON analysis: Valid JSON with ${Object.keys(parsed).length} top-level keys: ${Object.keys(parsed).join(', ')}`
        } catch {
          contextInfo += `\n\nJSON analysis: Invalid JSON - needs fixing`
        }
        break
    }
  }

  return contextInfo
}

export interface WandConfig {
  enabled: boolean
  prompt: string
  generationType?: GenerationType
  placeholder?: string
  maintainHistory?: boolean // Whether to keep conversation history
}

/**
 * Client-supplied context the server's `wandEnrichers` expand into extra system
 * prompt. Sent as ids only — the enricher does the DB/registry lookup, so no
 * schema or package metadata has to round-trip through the browser.
 */
interface WandContextParams {
  tableId?: string | null
  sandboxId?: string | null
}

/** Drops the unset keys so an all-empty context is omitted from the request. */
function buildWandContext(params?: WandContextParams): Record<string, string> | undefined {
  const context = filterUndefined({
    tableId: params?.tableId ?? undefined,
    sandboxId: params?.sandboxId ?? undefined,
  })
  return Object.keys(context).length > 0 ? context : undefined
}

interface UseWandProps {
  wandConfig?: WandConfig
  currentValue?: string
  contextParams?: WandContextParams
  /**
   * Clears the conversation history whenever this value changes. Pass anything
   * that invalidates prior turns — a Function block switching language rewrites
   * `wandConfig.prompt`, but replayed history would keep steering the model back
   * to the previous language.
   */
  historyResetKey?: string
  onGeneratedContent: (content: string) => void
  onStreamChunk?: (chunk: string) => void
  onStreamStart?: () => void
}

export function useWand({
  wandConfig,
  currentValue,
  contextParams,
  historyResetKey,
  onGeneratedContent,
  onStreamChunk,
  onStreamStart,
}: UseWandProps) {
  const queryClient = useQueryClient()
  const { navigateToSettings } = useSettingsNavigation()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const workflowId = useWorkflowRegistry((state) => state.hydration.workflowId)
  const [isLoading, setIsLoading] = useState(false)
  const [isPromptVisible, setIsPromptVisible] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([])

  /**
   * Adjusted during render rather than in an effect so a generation started in
   * the same commit as the change can never send the stale history. History is
   * already empty on mount, so seeding the tracker with the current key
   * correctly makes the first render a no-op.
   */
  const [prevHistoryResetKey, setPrevHistoryResetKey] = useState(historyResetKey)
  const [historyEpoch, setHistoryEpoch] = useState(0)
  if (prevHistoryResetKey !== historyResetKey) {
    setPrevHistoryResetKey(historyResetKey)
    setConversationHistory([])
    setHistoryEpoch((epoch) => epoch + 1)
  }

  /**
   * Mirrors {@link historyEpoch} for the in-flight request to read on completion.
   * A request that started before a reset must not append its turn to the fresh
   * history — its prompt and reply belong to the superseded context.
   *
   * Synced in a layout effect, not a passive one: passive effects flush in a later
   * task, so a request settling between the reset's commit and that flush would
   * still read the old epoch and append anyway. Layout effects run synchronously
   * during commit, before any promise continuation can observe the ref.
   */
  const historyEpochRef = useRef(historyEpoch)
  useLayoutEffect(() => {
    historyEpochRef.current = historyEpoch
  }, [historyEpoch])

  const abortControllerRef = useRef<AbortController | null>(null)

  const showPromptInline = useCallback(() => {
    setIsPromptVisible(true)
    setError(null)
  }, [])

  const hidePromptInline = useCallback(() => {
    setIsPromptVisible(false)
    setPromptInputValue('')
    setError(null)
  }, [])

  const updatePromptValue = useCallback((value: string) => {
    setPromptInputValue(value)
  }, [])

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
    setIsLoading(false)
    setError(null)
  }, [])

  const generateStream = useCallback(
    async ({ prompt }: { prompt: string }) => {
      if (!prompt) {
        setError('Prompt cannot be empty.')
        return
      }

      if (!wandConfig?.enabled) {
        setError('Wand is not enabled.')
        return
      }

      setIsLoading(true)
      setIsStreaming(true)
      setError(null)
      setPromptInputValue('')

      /** The context this request belongs to; a reset while it streams retires it. */
      const startedHistoryEpoch = historyEpochRef.current

      abortControllerRef.current = new AbortController()

      if (onStreamStart) {
        onStreamStart()
      }

      try {
        const contextInfo = buildWandContextInfo({
          currentValue,
          generationType: wandConfig?.generationType,
        })

        let systemPrompt = wandConfig?.prompt || ''
        if (systemPrompt.includes('{context}')) {
          systemPrompt = systemPrompt.replace('{context}', contextInfo)
        }

        const userMessage = prompt

        const currentPrompt = prompt

        const response = await requestRaw(
          wandGenerateStreamContract,
          {
            body: {
              prompt: userMessage,
              systemPrompt: systemPrompt,
              stream: true,
              history: wandConfig?.maintainHistory ? conversationHistory : [],
              generationType: wandConfig?.generationType,
              workflowId: workflowId ?? undefined,
              workspaceId: workspaceId ?? undefined,
              wandContext: buildWandContext(contextParams),
            },
            signal: abortControllerRef.current.signal,
          },
          {
            headers: {
              'Cache-Control': 'no-cache, no-transform',
            },
            cache: 'no-store',
          }
        )

        if (!response.body) {
          throw new Error('Response body is null')
        }

        const accumulatedContent = await readSSEStream(response.body, {
          onChunk: onStreamChunk,
          signal: abortControllerRef.current?.signal,
        })

        /**
         * Sanitized once the full response is known, then written back over the
         * streamed text. Doing it per-chunk would mean guessing whether a
         * trailing backtick run opens a fence or is part of the code, so the
         * editor may briefly show a fence that the final value does not.
         */
        const generatedContent = shouldStripCodeFences(wandConfig?.generationType)
          ? stripCodeFences(accumulatedContent)
          : accumulatedContent

        if (generatedContent) {
          onGeneratedContent(generatedContent)

          /**
           * The sanitized form goes into history so a single fenced reply cannot
           * become the in-context example for every later turn. Skipped entirely
           * when a reset retired this request's context mid-flight.
           */
          if (wandConfig?.maintainHistory && historyEpochRef.current === startedHistoryEpoch) {
            setConversationHistory((prev) => [
              ...prev,
              { role: 'user', content: currentPrompt },
              { role: 'assistant', content: generatedContent },
            ])
          }
        }

        logger.debug('Wand generation completed', {
          prompt,
          contentLength: generatedContent.length,
          strippedFences: generatedContent !== accumulatedContent,
        })

        scheduleUsageRefresh(queryClient)
      } catch (error: any) {
        if (error.name === 'AbortError') {
          logger.debug('Wand generation cancelled')
        } else if (isApiClientError(error) && error.status === 402) {
          // A per-member cap is only raisable by an org admin, so skip the Upgrade
          // affordance the member can't act on.
          const isMemberLimit = (error.body as { scope?: string } | null)?.scope === 'member'
          toast.error(
            error.message || 'Usage limit reached',
            isMemberLimit
              ? undefined
              : {
                  action: {
                    label: 'Upgrade',
                    onClick: () => navigateToSettings({ section: 'billing' }),
                  },
                }
          )
        } else {
          logger.error('Wand generation failed', { error })
          setError(error.message || 'Generation failed')
        }
      } finally {
        setIsLoading(false)
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    },
    [
      wandConfig,
      currentValue,
      onGeneratedContent,
      onStreamChunk,
      onStreamStart,
      queryClient,
      contextParams?.tableId,
      contextParams?.sandboxId,
      workflowId,
      workspaceId,
      navigateToSettings,
    ]
  )

  return {
    isLoading,
    isStreaming,
    isPromptVisible,
    promptInputValue,
    error,
    conversationHistory,
    generateStream,
    showPromptInline,
    hidePromptInline,
    updatePromptValue,
    cancelGeneration,
  }
}
