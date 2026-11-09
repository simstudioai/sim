'use client'

import type {
  ChangeEvent,
  DragEvent,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  UIEvent,
} from 'react'
import { EnvVarDropdown } from '@/app/(product)/_components/env-var-dropdown/env-var-dropdown'
import { TagDropdown } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import {
  type SubBlockConfig,
  useSubBlockInput,
  useTagSelection,
} from '@/platform/lib/data/workflow-editor'

type FieldElement = HTMLTextAreaElement | HTMLInputElement

/** What a text field needs from the controller to type, drop references and open the pickers. */
interface SubBlockInputRenderArgs {
  ref: RefObject<FieldElement>
  value: string
  disabled: boolean
  onChange: (event: ChangeEvent<FieldElement>) => void
  onKeyDown: (event: KeyboardEvent<FieldElement>) => void
  onDrop: (event: DragEvent<FieldElement>) => void
  onDragOver: (event: DragEvent<FieldElement>) => void
  onFocus: (event: FocusEvent<FieldElement>) => void
  onScroll?: (event: UIEvent<HTMLTextAreaElement>) => void
}

interface SubBlockInputControllerProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  value?: string
  onChange?: (value: string) => void
  isPreview?: boolean
  disabled?: boolean
  isStreaming?: boolean
  onStreamingEnd?: () => void
  previewValue?: string | null
  /** Whether the secret and reference pickers may open. Defaults to `true`. */
  allowReferences?: boolean
  shouldForceEnvDropdown?: (args: {
    value: string
    cursor: number
    event: 'change' | 'focus' | 'deleteAll'
  }) => { show: boolean; searchTerm?: string } | undefined
  shouldForceTagDropdown?: (args: {
    value: string
    cursor: number
    event: 'focus'
  }) => { show: boolean } | undefined
  children: (args: SubBlockInputRenderArgs) => ReactNode
}

/**
 * Wires a sub-block's text field to the shared input controller and hangs the secret (`{{`) and
 * reference (`<`) pickers from its caret.
 */
export function SubBlockInputController({
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
  allowReferences,
  shouldForceEnvDropdown,
  shouldForceTagDropdown,
  children,
}: SubBlockInputControllerProps) {
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
    allowReferences,
    shouldForceEnvDropdown,
    shouldForceTagDropdown,
  })
  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const applySelection = (next: string) => {
    if (onChange) onChange(next)
    else if (!isPreview) emitTagSelection(next)
  }

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
        onSelect={(next) => {
          applySelection(next)
          ctrl.controls.hideEnvVars()
        }}
        searchTerm={ctrl.searchTerm}
        inputValue={ctrl.valueString}
        cursorPosition={ctrl.cursorPosition}
        workspaceId={ctrl.workspaceId}
        onClose={ctrl.controls.hideEnvVars}
        inputRef={ctrl.inputRef}
      />
      <TagDropdown
        visible={ctrl.showTags && !isStreaming}
        onSelect={(next) => {
          applySelection(next)
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
