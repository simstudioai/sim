'use client'

import {
  type MutableRefObject,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import { useReactFlow } from '@xyflow/react'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/password-mask'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input.module.css'
import type { WandControlHandlers } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import { SubBlockInputController } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block-input-controller/sub-block-input-controller'
import {
  WandButton,
  WandPromptBar,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/wand-prompt-bar/wand-prompt-bar'
import {
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useSubBlockValue,
  useWand,
  useWebhookManagement,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'

/** How long a paste keeps a key field from opening the secret picker on the change it causes. */
const PASTE_SETTLE_MS = 100
const ZOOM_STEP = 0.96
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1

const API_KEY_PATTERNS = [
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

interface ShortInputProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  placeholder?: string
  /** Conceal the value until the field is focused. */
  password?: boolean
  /** Controlled value; leave it out to read and write the sub-block's stored value. */
  value?: string
  onChange?: (value: string) => void
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  readOnly?: boolean
  /** Show the block's webhook URL instead of a stored value. */
  useWebhookUrl?: boolean
  wandControlRef?: MutableRefObject<WandControlHandlers | null>
  /** The sub-block's label row owns the AI prompt, so the field shows none of its own. */
  hideInternalWand?: boolean
  workflowSearchValuePath?: Array<string | number>
  /** Which kind of workflow-search match the field highlights: a sub-block's or a subflow's. */
  workflowSearchTargetKind?: 'subblock' | 'subflow'
  /** Whether the secret and reference pickers may open. Defaults to `true`. */
  allowReferences?: boolean
  onBlur?: () => void
}

/**
 * A single-line sub-block field: references and secrets highlight over the typed text, `<` and
 * `{{` open their pickers at the caret, a key field offers secrets on focus, and a password field
 * conceals its value until focused.
 */
export const ShortInput = memo(function ShortInput({
  blockId,
  subBlockId,
  config,
  placeholder,
  password,
  value: propValue,
  onChange,
  isPreview = false,
  previewValue,
  disabled = false,
  readOnly = false,
  useWebhookUrl = false,
  wandControlRef,
  hideInternalWand = false,
  workflowSearchValuePath = [],
  workflowSearchTargetKind = 'subblock',
  allowReferences = true,
  onBlur,
}: ShortInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [localContent, setLocalContent] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const persistSubBlockValueRef = useRef<(value: string) => void>(() => {})
  const justPastedRef = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    isPreview,
    useWebhookUrl,
    providerWebhookUrl: config.providerWebhookUrl,
  })

  const { workspaceId } = useWorkflowScope()
  const wandHook = useWand({
    workspaceId,
    wandConfig: config.wandConfig,
    currentValue: localContent,
    onStreamStart: () => setLocalContent(''),
    onStreamChunk: (chunk) => setLocalContent((current) => current + chunk),
    onGeneratedContent: (content) => {
      setLocalContent(content)
      if (!isPreview && !disabled && !readOnly) persistSubBlockValueRef.current(content)
    },
  })

  const [, setSubBlockValue] = useSubBlockValue<string>(blockId, subBlockId, false, {
    isStreaming: wandHook.isStreaming,
  })
  persistSubBlockValueRef.current = (value: string) => setSubBlockValue(value)

  const isWandEnabled = config.wandConfig?.enabled ?? false
  const reactFlowInstance = useReactFlow()
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const isApiKeyField = useMemo(() => {
    const normalizedId = config?.id?.replace(/\s+/g, '').toLowerCase() || ''
    const normalizedTitle = config?.title?.replace(/\s+/g, '').toLowerCase() || ''
    return API_KEY_PATTERNS.some(
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
      if (justPastedRef.current) return { show: false }
      if (event === 'focus') {
        if (value.length > 20 && !value.includes('{{')) return { show: false }
        return { show: true, searchTerm: '' }
      }
      if (event === 'change') {
        const looksLikeRawApiKey =
          value.length > 30 && !value.includes('{{') && !value.match(/^[A-Z_][A-Z0-9_]*$/i)
        if (looksLikeRawApiKey) return { show: false }
        return { show: true, searchTerm: value }
      }
      if (event === 'deleteAll') return { show: true, searchTerm: '' }
      return { show: false }
    },
    [isApiKeyField, isPreview, disabled, readOnly]
  )

  const shouldForceTagDropdown = useCallback(
    ({ value }: { value: string; cursor: number; event: 'focus' }) => {
      if (isPreview || disabled || readOnly) return { show: false }
      return { show: !isApiKeyField && value.trim() === '' }
    },
    [isPreview, disabled, readOnly, isApiKeyField]
  )

  const baseValue = isPreview ? previewValue : propValue
  useEffect(() => {
    if (wandHook.isStreaming) return
    setLocalContent((prev) => {
      const next = baseValue?.toString() ?? ''
      return next !== prev ? next : prev
    })
  }, [baseValue, wandHook.isStreaming])

  const handlePaste = useCallback(() => {
    justPastedRef.current = true
    setTimeout(() => {
      justPastedRef.current = false
    }, PASTE_SETTLE_MS)
  }, [])

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLInputElement>) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()
      const delta = event.deltaY > 0 ? 1 : -1
      const newZoom = Math.min(Math.max(currentZoom * ZOOM_STEP ** delta, MIN_ZOOM), MAX_ZOOM)
      const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      reactFlowInstance.setViewport(
        {
          x: viewportX + (pointerX * currentZoom - pointerX * newZoom),
          y: viewportY + (pointerY * currentZoom - pointerY * newZoom),
          zoom: newZoom,
        },
        { duration: 0 }
      )
    },
    [reactFlowInstance]
  )

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

  const showInternalWand = isWandEnabled && !hideInternalWand
  const fieldDisabled = isPreview || disabled

  return (
    <div className={styles.field}>
      {showInternalWand && (
        <WandPromptBar
          isVisible={wandHook.isPromptVisible}
          isLoading={wandHook.isLoading}
          isStreaming={wandHook.isStreaming}
          promptValue={wandHook.promptInputValue}
          onSubmit={(prompt) => wandHook.generateStream({ prompt })}
          onCancel={wandHook.isStreaming ? wandHook.cancelGeneration : wandHook.hidePromptInline}
          onChange={wandHook.updatePromptValue}
          placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
        />
      )}
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
        allowReferences={allowReferences}
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
            : (useWebhookUrl || config.providerWebhookUrl) && webhookManagement.webhookUrl
              ? webhookManagement.webhookUrl
              : ctrlValue
          const actualValueString = actualValue ?? ''
          const shouldMask = shouldMaskSecretValue({ password, isFocused })
          const displayValue = shouldMask ? maskSecretText(actualValueString) : actualValueString
          const formattedText = shouldMask
            ? displayValue
            : formatDisplayText(actualValueString, {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
                workflowSearchHighlight: getActiveWorkflowSearchHighlight({
                  activeSearchTarget,
                  blockId: workflowSearchTargetKind === 'subflow' ? undefined : blockId,
                  subBlockId,
                  valuePath: workflowSearchValuePath,
                  targetKind: workflowSearchTargetKind,
                }),
              })
          return (
            <div
              className={styles.frame}
              data-disabled={fieldDisabled || undefined}
              data-trailing={showInternalWand || undefined}
            >
              <input
                ref={ref as RefObject<HTMLInputElement>}
                className={styles.input}
                data-type='T043'
                aria-label={config.title || placeholder || subBlockId}
                readOnly={readOnly}
                placeholder={placeholder ?? ''}
                type='text'
                value={displayValue}
                onChange={handleChange}
                onFocus={(event) => {
                  setIsFocused(true)
                  onFocus(event)
                }}
                onBlur={() => {
                  setIsFocused(false)
                  onBlur?.()
                }}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onScroll={(event) => {
                  if (overlayRef.current)
                    overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
                }}
                onPaste={handlePaste}
                onWheel={handleWheel}
                onKeyDown={onKeyDown}
                autoComplete='off'
                spellCheck={false}
                disabled={disabled}
              />
              <div ref={overlayRef} className={styles.overlay} data-type='T043' aria-hidden='true'>
                <span className={styles.overlayText}>{formattedText}</span>
              </div>
              {showInternalWand && !isPreview && !wandHook.isStreaming && (
                <span className={styles.trailing}>
                  <WandButton
                    onClick={
                      wandHook.isPromptVisible
                        ? wandHook.hidePromptInline
                        : wandHook.showPromptInline
                    }
                    disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
                  />
                </span>
              )}
            </div>
          )
        }}
      </SubBlockInputController>
    </div>
  )
})
