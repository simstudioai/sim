import type React from 'react'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'

/**
 * Props for the headless SubBlockInputController.
 *
 * @remarks
 * This component wires the useSubBlockInput controller to popovers (env-var and tag)
 * and exposes a render-prop for rendering the concrete input element.
 */
export interface SubBlockInputControllerProps {
  /** Workflow block identifier. */
  blockId: string
  /** Sub-block identifier. */
  subBlockId: string
  /** Sub-block configuration. */
  config: SubBlockConfig
  /** Optional externally controlled value. */
  value?: string
  /** Optional change handler for controlled inputs. */
  onChange?: (value: string) => void
  /** Whether the view is in preview mode. */
  isPreview?: boolean
  /** Whether the input should be disabled. */
  disabled?: boolean
  /** When true, user edits are blocked and streaming text may display. */
  isStreaming?: boolean
  /** Callback when streaming ends. */
  onStreamingEnd?: () => void
  /** Optional preview value for read-only preview. */
  previewValue?: string | null
  /** Optional workspace id for env var scoping. */
  workspaceId?: string
  /**
   * Optional callback to force/show the env var dropdown (e.g., API key fields).
   * Return { show: true, searchTerm?: string } to override defaults.
   * Called on 'change' (typing), 'focus', and 'deleteAll' (full selection delete/backspace).
   */
  shouldForceEnvDropdown?: (args: {
    value: string
    cursor: number
    event: 'change' | 'focus' | 'deleteAll'
  }) => { show: boolean; searchTerm?: string } | undefined
  /** Render prop for the actual input element. */
  children: (args: {
    ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement>
    value: string
    disabled: boolean
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onDrop: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onDragOver: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onFocus: () => void
    onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void
  }) => React.ReactNode
}

/**
 * Headless input behavior controller that renders env-var and tag popovers.
 */
export function SubBlockInputController(props: SubBlockInputControllerProps): React.ReactElement {
  const {
    blockId,
    subBlockId,
    config,
    value,
    onChange,
    isPreview,
    disabled,
    isStreaming,
    onStreamingEnd,
    previewValue,
    workspaceId,
    shouldForceEnvDropdown,
    children,
  } = props

  const ctrl = useSubBlockInput({
    blockId,
    subBlockId,
    config,
    value,
    onChange,
    isPreview,
    disabled,
    isStreaming,
    onStreamingEnd,
    previewValue,
    workspaceId,
    shouldForceEnvDropdown,
  })

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  return (
    <>
      {children({
        ref: ctrl.inputRef,
        value: ctrl.valueString,
        disabled: ctrl.isDisabled,
        onChange: ctrl.handlers.onChange,
        onKeyDown: ctrl.handlers.onKeyDown,
        onDrop: ctrl.handlers.onDrop,
        onDragOver: ctrl.handlers.onDragOver,
        onFocus: ctrl.handlers.onFocus,
        onScroll: ctrl.handlers.onScroll,
      })}

      <EnvVarDropdown
        visible={ctrl.showEnvVars && !isStreaming}
        onSelect={(newValue: string) => {
          if (onChange) {
            onChange(newValue)
          } else if (!isPreview) {
            emitTagSelection(newValue)
          }
          ctrl.controls.hideEnvVars()
        }}
        searchTerm={ctrl.searchTerm}
        inputValue={ctrl.valueString}
        cursorPosition={ctrl.cursorPosition}
        workspaceId={ctrl.workspaceId}
        onClose={ctrl.controls.hideEnvVars}
        maxHeight='192px'
        inputRef={ctrl.inputRef}
      />

      <TagDropdown
        visible={ctrl.showTags && !isStreaming}
        onSelect={(newValue: string) => {
          if (onChange) {
            onChange(newValue)
          } else if (!isPreview) {
            emitTagSelection(newValue)
          }
          ctrl.controls.hideTags()
        }}
        blockId={blockId}
        activeSourceBlockId={ctrl.activeSourceBlockId}
        inputValue={ctrl.valueString}
        cursorPosition={ctrl.cursorPosition}
        onClose={ctrl.controls.hideTags}
        inputRef={ctrl.inputRef}
      />
    </>
  )
}
