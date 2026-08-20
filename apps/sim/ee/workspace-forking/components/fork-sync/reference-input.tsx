'use client'

import { useRef, useState } from 'react'
import { ChipInput, ChipTextarea } from '@sim/emcn'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'

interface ReferenceInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Multi-line editor, for the JSON-valued (`object` / `array`) fields. */
  multiline?: boolean
  /**
   * Workspace whose secrets `{{` offers. This is the workspace the value is written INTO, so
   * the suggestions are the ones that will actually resolve at run time — a secret from the
   * workspace the user happens to be looking at would not.
   */
  workspaceId: string
  /**
   * Block the value belongs to. Positions the `<` suggestions within its workflow, which is
   * supplied by the enclosing `WorkflowReferenceScopeProvider` rather than the live editor.
   */
  blockId: string
  'aria-label'?: string
}

/**
 * A value field that resolves `{{SECRET}}` and `<block.output>` the same way the canvas does.
 *
 * Both dropdowns are the canvas components verbatim — the same trigger helpers, the same
 * caret anchoring, the same insertion semantics — so a reference authored here reads and
 * behaves identically to one authored on the block itself. Only their DATA differs, and that
 * is the point: secrets come from the workspace being written into, and block outputs from
 * the workflow that will host the block, neither of which is the one on screen.
 */
export function ReferenceInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  workspaceId,
  blockId,
  'aria-label': ariaLabel,
}: ReferenceInputProps) {
  // One ref for both branches: the dropdowns anchor to whichever element is mounted, and only
  // ever call `focus`/`setSelectionRange`, which input and textarea share.
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const closeDropdowns = () => {
    setShowEnvVars(false)
    setShowTags(false)
    setSearchTerm('')
    setActiveSourceBlockId(null)
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = event.target.value
    const cursor = event.target.selectionStart ?? next.length
    onChange(next)
    setCursorPosition(cursor)

    const envVar = checkEnvVarTrigger(next, cursor)
    setShowEnvVars(envVar.show)
    setSearchTerm(envVar.show ? envVar.searchTerm : '')

    const tag = checkTagTrigger(next, cursor)
    setShowTags(tag.show)
    if (!tag.show) setActiveSourceBlockId(null)
  }

  /**
   * A dropdown rewrites the whole value, so the caret has to be put back explicitly — the
   * field is controlled and would otherwise land at the end, mid-reference.
   */
  const applySelection = (next: string, nextCursor: number) => {
    onChange(next)
    setCursorPosition(nextCursor)
    closeDropdowns()
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && (showEnvVars || showTags)) {
      event.preventDefault()
      event.stopPropagation()
      closeDropdowns()
    }
  }

  // Deliberately no `onBlur` close: both dropdowns commit on `onMouseDown`, and a blur handler
  // races that even with the items' `preventDefault`. They close on select, Escape, or an
  // outside press routed through the popover's own dismissal.
  const shared = {
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    placeholder,
    'aria-label': ariaLabel,
  }

  return (
    <div className='relative w-full'>
      {multiline ? (
        <ChipTextarea
          {...shared}
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className='w-full'
          rows={3}
        />
      ) : (
        <ChipInput
          {...shared}
          ref={inputRef as React.RefObject<HTMLInputElement>}
          className='w-full'
        />
      )}
      <EnvVarDropdown
        visible={showEnvVars}
        onSelect={applySelection}
        searchTerm={searchTerm}
        inputValue={value}
        cursorPosition={cursorPosition}
        workspaceId={workspaceId}
        inputRef={inputRef}
        onClose={closeDropdowns}
      />
      <TagDropdown
        visible={showTags}
        onSelect={applySelection}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={value}
        cursorPosition={cursorPosition}
        inputRef={inputRef}
        onClose={closeDropdowns}
      />
    </div>
  )
}
