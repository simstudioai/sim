import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Input } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/core/utils/cn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

/**
 * Props for the ShortInput component
 */
interface ShortInputProps {
  /** Placeholder text to display when empty */
  placeholder?: string
  /** Whether to mask the input as a password field */
  password?: boolean
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Configuration object for the sub-block */
  config: SubBlockConfig
  /** Controlled value from parent */
  value?: string
  /** Callback when value changes */
  onChange?: (value: string) => void
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | null
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
  /** Whether to use webhook URL as value */
  useWebhookUrl?: boolean
  /** Ref to expose wand control handlers to parent */
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  /** Whether to hide the internal wand button (controlled by parent) */
  hideInternalWand?: boolean
}

/**
 * Single-line text input component with advanced features
 *
 * @remarks
 * - Supports AI-powered content generation via Wand functionality
 * - Auto-detects API key fields and provides environment variable suggestions
 * - Handles drag-and-drop for connections and variable references
 * - Provides environment variable and tag autocomplete
 * - Password masking with reveal on focus
 * - Integrates with ReactFlow for zoom control
 */
export const ShortInput = memo(function ShortInput({
  blockId,
  subBlockId,
  placeholder,
  password,
  config,
  onChange,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
  readOnly = false,
  useWebhookUrl = false,
  wandControlRef,
  hideInternalWand = false,
}: ShortInputProps) {
  const [localContent, setLocalContent] = useState<string>('')
  const [isFocused, setIsFocused] = useState(false)
  const persistSubBlockValueRef = useRef<(value: string) => void>(() => {})

  const justPastedRef = useRef(false)

  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    isPreview,
    useWebhookUrl,
  })

  const wandHook = useWand({
    wandConfig: config.wandConfig,
    currentValue: localContent,
    onStreamStart: () => {
      setLocalContent('')
    },
    onStreamChunk: (chunk) => {
      setLocalContent((current) => current + chunk)
    },
    onGeneratedContent: (content) => {
      setLocalContent(content)
      if (!isPreview && !disabled && !readOnly) {
        persistSubBlockValueRef.current(content)
      }
    },
  })

  const [, setSubBlockValue] = useSubBlockValue<string>(blockId, subBlockId, false, {
    isStreaming: wandHook.isStreaming,
  })

  useEffect(() => {
    persistSubBlockValueRef.current = (value: string) => {
      setSubBlockValue(value)
    }
  }, [setSubBlockValue])

  const isWandEnabled = config.wandConfig?.enabled ?? false

  const overlayRef = useRef<HTMLDivElement>(null)

  const reactFlowInstance = useReactFlow()

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const isApiKeyField = useMemo(() => {
    const normalizedId = config?.id?.replace(/\s+/g, '').toLowerCase() || ''
    const normalizedTitle = config?.title?.replace(/\s+/g, '').toLowerCase() || ''

    const apiKeyPatterns = [
      'apikey',
      'api_key',
      'api-key',
      'secretkey',
      'secret_key',
      'secret-key',
      'token',
      'access_token',
      'auth_token',
      'secret',
      'password',
    ]

    return apiKeyPatterns.some(
      (pattern) =>
        normalizedId === pattern ||
        normalizedTitle === pattern ||
        normalizedId.includes(pattern) ||
        normalizedTitle.includes(pattern)
    )
  }, [config?.id, config?.title])

  const shouldForceEnvDropdown = useCallback(
    ({
      value,
      event,
    }: {
      value: string
      cursor: number
      event: 'change' | 'focus' | 'deleteAll'
    }) => {
      if (!isApiKeyField || isPreview || disabled || readOnly) return { show: false }

      if (justPastedRef.current) {
        return { show: false }
      }

      if (event === 'focus') {
        if (value.length > 20 && !value.includes('{{')) {
          return { show: false }
        }
        return { show: true, searchTerm: '' }
      }
      if (event === 'change') {
        const looksLikeRawApiKey =
          value.length > 30 && !value.includes('{{') && !value.match(/^[A-Z_][A-Z0-9_]*$/i)
        if (looksLikeRawApiKey) {
          return { show: false }
        }
        return { show: true, searchTerm: value }
      }
      if (event === 'deleteAll') {
        return { show: true, searchTerm: '' }
      }
      return { show: false }
    },
    [isApiKeyField, isPreview, disabled, readOnly]
  )

  const shouldForceTagDropdown = useCallback(
    ({
      value,
    }: {
      value: string
      cursor: number
      event: 'focus'
    }): { show: boolean } | undefined => {
      if (isPreview || disabled || readOnly) return { show: false }
      // Show tag dropdown on focus when input is empty (unless it's an API key field)
      if (!isApiKeyField && value.trim() === '') {
        return { show: true }
      }
      return { show: false }
    },
    [isPreview, disabled, readOnly, isApiKeyField]
  )

  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : undefined

  const effectiveValue =
    useWebhookUrl && webhookManagement.webhookUrl ? webhookManagement.webhookUrl : baseValue

  const value = wandHook?.isStreaming ? localContent : effectiveValue

  useEffect(() => {
    if (!wandHook.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook.isStreaming, localContent])

  const handleScroll = useCallback((e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  const handlePaste = useCallback((_e: React.ClipboardEvent<HTMLInputElement>) => {
    justPastedRef.current = true
    setTimeout(() => {
      justPastedRef.current = false
    }, 100)
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const currentZoom = reactFlowInstance.getZoom()
        const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

        const delta = e.deltaY > 0 ? 1 : -1
        const zoomFactor = 0.96 ** delta

        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

        const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        })

        const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
        const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

        reactFlowInstance.setViewport(
          {
            x: newViewportX,
            y: newViewportY,
            zoom: newZoom,
          },
          { duration: 0 }
        )

        return false
      }

      return true
    },
    [reactFlowInstance]
  )

  const handleBlur = useCallback(() => {
    setIsFocused(false)
  }, [])

  // Expose wand control handlers to parent via ref
  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        wandHook.generateStream({ prompt })
      },
      isWandActive: wandHook.isPromptVisible,
      isWandStreaming: wandHook.isStreaming,
    }),
    [wandHook]
  )

  return (
    <>
      {isWandEnabled && !hideInternalWand && (
        <WandPromptBar
          isVisible={wandHook.isPromptVisible}
          isLoading={wandHook.isLoading}
          isStreaming={wandHook.isStreaming}
          promptValue={wandHook.promptInputValue}
          onSubmit={(prompt: string) => wandHook.generateStream({ prompt })}
          onCancel={wandHook.isStreaming ? wandHook.cancelGeneration : wandHook.hidePromptInline}
          onChange={(newValue: string) => wandHook.updatePromptValue(newValue)}
          placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
        />
      )}

      <div className='group relative w-full'>
        <SubBlockInputController
          blockId={blockId}
          subBlockId={subBlockId}
          config={config}
          value={propValue}
          onChange={onChange}
          isPreview={isPreview}
          disabled={disabled}
          isStreaming={wandHook.isStreaming}
          previewValue={previewValue}
          shouldForceEnvDropdown={shouldForceEnvDropdown}
          shouldForceTagDropdown={shouldForceTagDropdown}
        >
          {({
            ref,
            value: ctrlValue,
            onChange: handleChange,
            onKeyDown,
            onDrop,
            onDragOver,
            onFocus,
          }) => {
            const actualValue = wandHook.isStreaming
              ? localContent
              : useWebhookUrl && webhookManagement.webhookUrl
                ? webhookManagement.webhookUrl
                : ctrlValue

            const displayValue =
              password && !isFocused ? '•'.repeat(actualValue?.length ?? 0) : actualValue

            const formattedText =
              password && !isFocused
                ? '•'.repeat(actualValue?.length ?? 0)
                : formatDisplayText(actualValue, {
                    accessiblePrefixes,
                    highlightAll: !accessiblePrefixes,
                  })

            return (
              <>
                <Input
                  ref={ref as React.RefObject<HTMLInputElement>}
                  className='allow-scroll w-full overflow-auto text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden'
                  readOnly={readOnly}
                  placeholder={placeholder ?? ''}
                  type='text'
                  value={displayValue}
                  onChange={handleChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
                  onFocus={(e) => {
                    setIsFocused(true)
                    onFocus(e)
                  }}
                  onBlur={handleBlur}
                  onDrop={onDrop as (e: React.DragEvent<HTMLInputElement>) => void}
                  onDragOver={onDragOver as (e: React.DragEvent<HTMLInputElement>) => void}
                  onScroll={handleScroll}
                  onPaste={handlePaste}
                  onWheel={handleWheel}
                  onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLInputElement>) => void}
                  autoComplete='off'
                  disabled={disabled}
                />
                <div
                  ref={overlayRef}
                  className={cn(
                    'pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] pr-3 font-medium font-sans text-foreground text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                    (isPreview || disabled) && 'opacity-50'
                  )}
                >
                  <div className='min-w-fit whitespace-pre'>{formattedText}</div>
                </div>
              </>
            )
          }}
        </SubBlockInputController>

        {/* Wand Button - only show if not hidden by parent */}
        {isWandEnabled && !isPreview && !wandHook.isStreaming && !hideInternalWand && (
          <div className='-translate-y-1/2 absolute top-1/2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
            <Button
              variant='ghost'
              size='icon'
              onClick={
                wandHook.isPromptVisible ? wandHook.hidePromptInline : wandHook.showPromptInline
              }
              disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
              aria-label='Generate content with AI'
              className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          </div>
        )}
      </div>
    </>
  )
})
