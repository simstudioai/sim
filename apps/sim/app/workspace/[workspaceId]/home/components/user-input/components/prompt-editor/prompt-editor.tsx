'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { cn } from '@sim/emcn'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import {
  OVERLAY_CLASSES,
  SCROLLER_CLASSES,
  TEXTAREA_BASE_CLASSES,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { PlusMenuDropdown } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown'
import type {
  PromptEditorInstance,
  PromptEditorKeyPolicy,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import { SkillsMenuDropdown } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/skills-menu-dropdown'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
  stripMentionTrigger,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'

export interface PromptEditorProps extends PromptEditorKeyPolicy {
  /** Editor instance from {@link usePromptEditor}. */
  editor: PromptEditorInstance
  /** Placeholder shown while the editor is empty. */
  placeholder?: string
  /** Focuses the editor (caret at end) on mount. */
  autoFocus?: boolean
  /**
   * Renders the editor as a non-editable display surface: the textarea becomes
   * `readOnly` (so the chip overlay still paints `@`-mention / `/`-skill chips
   * and the text stays selectable/copyable) and the caret-anchored resource and
   * skill menus are not mounted. Use for read-only records — e.g. a finished
   * scheduled task — where the prompt should render with chips but not be edited.
   */
  readOnly?: boolean
  /**
   * Layout/sizing only — a height cap (`max-h-[200px]`) or fill (`flex-1`)
   * for the scroll container. The text chrome is owned by the editor.
   */
  className?: string
  /** Accessible label for the textarea. */
  'aria-label'?: string
}

/**
 * The rendered face of {@link usePromptEditor}: a transparent-text textarea
 * under a mirror overlay that paints mention chips (icon + label) in place of
 * their tokens, plus the caret-anchored `@`-resource and `/`-skill menus. The
 * textarea grows to its content height inside a single scroller, so overlay
 * and caret co-scroll natively and never drift.
 *
 * Everything intrinsic to editing lives here; host-specific keys (Enter
 * submit, ArrowUp history) are threaded in via {@link PromptEditorKeyPolicy}.
 *
 * @example
 * ```tsx
 * const editor = usePromptEditor({ workspaceId })
 * <PromptEditor editor={editor} placeholder='Describe the task...' autoFocus onSubmit={save} />
 * ```
 */
export function PromptEditor({
  editor,
  placeholder,
  autoFocus = false,
  readOnly = false,
  className,
  'aria-label': ariaLabel,
  onSubmit,
  onArrowUpOnEmpty,
}: PromptEditorProps) {
  const { textareaRef, value } = editor

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    // Grow the textarea to its full content height; the scroller caps the
    // visible height and scrolls textarea + overlay together natively.
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value, textareaRef])

  useEffect(() => {
    if (autoFocus && !readOnly) editor.focusAtEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only focus
  }, [])

  /**
   * Clicking the editor's empty regions (padding, space below the last line)
   * focuses the textarea; clicks on the textarea itself keep native caret
   * placement. No-op in read-only mode: the surface is display-only, so a
   * padding click should not pull focus onto the non-editable textarea.
   */
  const handleSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return
      if (e.target === textareaRef.current) return
      if ((e.target as HTMLElement).closest('button')) return
      textareaRef.current?.focus()
    },
    [readOnly, textareaRef]
  )

  const overlayContent = useMemo(() => {
    const contexts = editor.contexts

    if (!value) {
      return <span>{'\u00A0'}</span>
    }

    if (contexts.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const tokens = extractContextTokens(contexts)
    const ranges = computeMentionHighlightRanges(value, tokens)

    if (ranges.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const contextByLabel = new Map<string, (typeof contexts)[number]>()
    for (const c of contexts) {
      if (!contextByLabel.has(c.label)) contextByLabel.set(c.label, c)
    }

    const elements: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]

      if (range.start > lastIndex) {
        const before = value.slice(lastIndex, range.start)
        elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
      }

      const mentionLabel = stripMentionTrigger(range.token)
      const matchingCtx = contextByLabel.get(mentionLabel)

      const mentionIconNode = matchingCtx ? (
        <ContextMentionIcon
          context={matchingCtx}
          className='absolute inset-0 m-auto size-[12px] translate-y-[1.25px] text-[var(--text-icon)]'
        />
      ) : null

      elements.push(
        <span key={`mention-${i}-${range.start}-${range.end}`}>
          <span className='relative'>
            {/* Invisible trigger glyph keeps the overlay's advance identical to
                the transparent textarea; the icon centers over its slot. */}
            <span className='invisible'>{range.token.charAt(0)}</span>
            {mentionIconNode}
          </span>
          {mentionLabel}
        </span>
      )
      lastIndex = range.end
    }

    const tail = value.slice(lastIndex)
    if (tail) {
      const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
      elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
    }

    return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
  }, [value, editor.contexts])

  return (
    <div className={cn(SCROLLER_CLASSES, 'cursor-text', className)} onClick={handleSurfaceClick}>
      {/* Sizer for textarea + overlay: the textarea grows to full content
          height and the overlay fills it via `inset-0`, so both are flow
          children of the same scroller and co-scroll natively. */}
      <div className='relative'>
        <div className={OVERLAY_CLASSES} aria-hidden='true'>
          {overlayContent}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : editor.handleInputChange}
          onKeyDown={
            readOnly ? undefined : (e) => editor.handleKeyDown(e, { onSubmit, onArrowUpOnEmpty })
          }
          onPaste={readOnly ? undefined : editor.handlePaste}
          onCopy={editor.handleCopy}
          onCut={readOnly ? undefined : editor.handleCut}
          onSelect={readOnly ? undefined : editor.handleSelectAdjust}
          onMouseUp={readOnly ? undefined : editor.handleSelectAdjust}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={1}
          className={cn(TEXTAREA_BASE_CLASSES, readOnly && 'cursor-default caret-transparent')}
        />
      </div>

      {!readOnly && (
        <>
          <PlusMenuDropdown
            ref={editor.plusMenuRef}
            availableResources={editor.availableResources}
            onResourceSelect={editor.insertResource}
            onClose={editor.handlePlusMenuClose}
            textareaRef={editor.textareaRef}
            pendingCursorRef={editor.pendingCursorRef}
            mentionQuery={editor.mentionQuery ?? undefined}
          />
          <SkillsMenuDropdown
            ref={editor.skillsMenuRef}
            skills={editor.skills}
            onSkillSelect={editor.handleSkillSelect}
            onClose={editor.handleSkillsMenuClose}
            textareaRef={editor.textareaRef}
            pendingCursorRef={editor.pendingCursorRef}
            slashQuery={editor.slashQuery ?? undefined}
          />
        </>
      )}
    </div>
  )
}
