'use client'

import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/password-mask'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/long-input/long-input.module.css'
import type { WandControlHandlers } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import { SubBlockInputController } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block-input-controller/sub-block-input-controller'
import {
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useSubBlockValue,
  useWand,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'

const DEFAULT_ROWS = 5

interface LongInputProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  placeholder?: string
  password?: boolean
  /** The field's resting height in lines; it grows with its content beyond that. */
  rows?: number
  isPreview?: boolean
  previewValue?: string | null
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  wandControlRef?: MutableRefObject<WandControlHandlers | null>
  workflowSearchValuePath?: Array<string | number>
}

/**
 * A multi-line sub-block field with the same references, secrets, masking and AI prompt as
 * ShortInput. It rests at `rows` lines and grows with what it holds, so the whole value is always
 * readable in the panel's scroll.
 */
export function LongInput({
  blockId,
  subBlockId,
  config,
  placeholder,
  password,
  rows,
  isPreview = false,
  previewValue,
  value: propValue,
  onChange,
  disabled,
  wandControlRef,
  workflowSearchValuePath = [],
}: LongInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [localContent, setLocalContent] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const persistSubBlockValueRef = useRef<(value: string) => void>(() => {})

  const { workspaceId } = useWorkflowScope()
  const wandHook = useWand({
    workspaceId,
    wandConfig: config.wandConfig,
    currentValue: localContent,
    onStreamStart: () => setLocalContent(''),
    onStreamChunk: (chunk) => setLocalContent((current) => current + chunk),
    onGeneratedContent: (content) => {
      setLocalContent(content)
      if (!isPreview && !disabled) persistSubBlockValueRef.current(content)
    },
  })

  const [storedValue, setSubBlockValue] = useSubBlockValue<string>(blockId, subBlockId, false, {
    isStreaming: wandHook.isStreaming,
  })
  persistSubBlockValueRef.current = (value: string) => setSubBlockValue(value)

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const shouldForceTagDropdown = useCallback(
    ({ value }: { value: string; cursor: number; event: 'focus' }) => {
      if (isPreview || disabled) return { show: false }
      return { show: value.trim() === '' }
    },
    [isPreview, disabled]
  )

  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : storedValue
  useEffect(() => {
    if (wandHook.isStreaming) return
    setLocalContent((prev) => {
      const next = baseValue?.toString() ?? ''
      return next !== prev ? next : prev
    })
  }, [baseValue, wandHook.isStreaming])

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

  const fieldDisabled = isPreview || disabled

  return (
    <div className={styles.field}>
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
          const value = wandHook.isStreaming ? localContent : ctrlValue
          const shouldMask = shouldMaskSecretValue({ password, isFocused })
          const displayValue = shouldMask ? maskSecretText(value) : value
          return (
            <div
              className={styles.frame}
              data-rows={rows ?? DEFAULT_ROWS}
              data-disabled={fieldDisabled || undefined}
              data-streaming={wandHook.isStreaming || undefined}
            >
              <div className={styles.mirror} data-type='T043' aria-hidden='true'>
                {shouldMask
                  ? displayValue
                  : formatDisplayText(value, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                      workflowSearchHighlight: getActiveWorkflowSearchHighlight({
                        activeSearchTarget,
                        blockId,
                        subBlockId,
                        valuePath: workflowSearchValuePath,
                      }),
                    })}
                {'​'}
              </div>
              <textarea
                ref={ref as RefObject<HTMLTextAreaElement>}
                className={styles.textarea}
                data-type='T043'
                aria-label={config.title || placeholder || subBlockId}
                placeholder={placeholder ?? ''}
                value={displayValue}
                onChange={handleChange}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onKeyDown={onKeyDown}
                onFocus={(event) => {
                  setIsFocused(true)
                  onFocus(event)
                }}
                onBlur={() => setIsFocused(false)}
                disabled={fieldDisabled}
                spellCheck={false}
              />
            </div>
          )
        }}
      </SubBlockInputController>
    </div>
  )
}
