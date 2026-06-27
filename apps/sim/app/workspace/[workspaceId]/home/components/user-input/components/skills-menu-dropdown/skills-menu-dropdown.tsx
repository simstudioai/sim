'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/emcn'
import { AgentSkillsIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import type { SkillDefinition } from '@/hooks/queries/skills'

/**
 * Imperative handle for driving the skills menu from the host textarea's
 * keyboard handler. Mirrors the shape of `PlusMenuHandle` but exposes only
 * the operations the slash-trigger flow needs.
 */
export interface SkillsMenuHandle {
  /** Opens the menu, optionally anchored at a caret position. */
  open: (anchor?: { left: number; top: number }) => void
  /** Closes the menu. */
  close: () => void
  /** Moves the active highlight by `delta` rows (wrapping). */
  moveActive: (delta: number) => void
  /** Selects the active row. Returns true when a skill was selected. */
  selectActive: () => boolean
}

interface SkillsMenuDropdownProps {
  /** Skills available in the current workspace. */
  skills: SkillDefinition[]
  /** Called when a skill row is chosen (click / keyboard). */
  onSkillSelect: (skill: SkillDefinition) => void
  /** Called when the menu closes so the host can reset slash state. */
  onClose: () => void
  /** Host textarea — focus is restored to it on close. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** Shared caret position restored after the dormant focus trap closes. */
  pendingCursorRef: React.MutableRefObject<number | null>
  /** Active `/`-query used to filter the list (case-insensitive substring). */
  slashQuery?: string
}

/**
 * Floating autocomplete list of workspace skills, anchored at the caret. It
 * mirrors the anchored-trigger + dormant-focus-trap pattern of
 * `PlusMenuDropdown` so the textarea keeps focus and typing continues
 * uninterrupted while the user navigates skills with the keyboard.
 */
export const SkillsMenuDropdown = React.memo(
  React.forwardRef<SkillsMenuHandle, SkillsMenuDropdownProps>(function SkillsMenuDropdown(
    { skills, onSkillSelect, onClose, textareaRef, pendingCursorRef, slashQuery },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const contentRef = useRef<HTMLDivElement>(null)

    const filteredSkills = useMemo(() => {
      const q = (slashQuery ?? '').toLowerCase().trim()
      if (!q) return skills
      return skills.filter((skill) => skill.name.toLowerCase().includes(q))
    }, [skills, slashQuery])

    const filteredSkillsRef = useRef(filteredSkills)
    filteredSkillsRef.current = filteredSkills
    const activeIndexRef = useRef(activeIndex)
    activeIndexRef.current = activeIndex

    const doOpen = useCallback((anchor?: { left: number; top: number }) => {
      if (anchor) setAnchorPos(anchor)
      setOpen(true)
      setActiveIndex(0)
    }, [])

    const doClose = useCallback(() => {
      setOpen(false)
    }, [])

    const handleSelect = useCallback(
      (skill: SkillDefinition) => {
        onSkillSelect(skill)
        setOpen(false)
        setActiveIndex(0)
      },
      [onSkillSelect]
    )

    const handleSelectRef = useRef(handleSelect)
    handleSelectRef.current = handleSelect

    React.useImperativeHandle(
      ref,
      () => ({
        open: doOpen,
        close: doClose,
        moveActive: (delta: number) => {
          const items = filteredSkillsRef.current
          if (items.length === 0) return
          setActiveIndex((i) => {
            const next = i + delta
            if (next < 0) return items.length - 1
            if (next >= items.length) return 0
            return next
          })
        },
        selectActive: () => {
          const items = filteredSkillsRef.current
          if (items.length === 0) return false
          const target = items[activeIndexRef.current] ?? items[0]
          if (!target) return false
          handleSelectRef.current(target)
          return true
        },
      }),
      [doOpen, doClose]
    )

    // Reset highlight to the top whenever the query changes so the best match
    // is always selected as the user types.
    useEffect(() => {
      setActiveIndex(0)
    }, [slashQuery])

    // Sync DOM scroll to the keyboard-highlighted row.
    useEffect(() => {
      if (filteredSkills.length === 0) return
      const row = contentRef.current?.querySelector<HTMLElement>(
        `[data-filtered-idx="${activeIndex}"]`
      )
      row?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex, filteredSkills])

    const handleOpenChange = (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen) {
        setAnchorPos(null)
        setActiveIndex(0)
        onClose()
      }
    }

    const handleCloseAutoFocus = (e: Event) => {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      if (pendingCursorRef.current !== null) {
        textarea.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
        pendingCursorRef.current = null
      }
      textarea.focus()
    }

    // Preventing the mount auto-focus keeps the textarea focused and leaves the
    // Radix focus trap dormant, so typing continues uninterrupted.
    const handleOpenAutoFocus = (e: Event) => {
      e.preventDefault()
    }

    return (
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <div
            style={{
              position: 'fixed',
              left: anchorPos?.left ?? 0,
              top: anchorPos?.top ?? 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={contentRef}
          align='start'
          side='top'
          sideOffset={8}
          avoidCollisions
          collisionPadding={8}
          className='flex max-w-[min(300px,calc(100vw-32px))] flex-col overflow-hidden'
          onCloseAutoFocus={handleCloseAutoFocus}
          onOpenAutoFocus={handleOpenAutoFocus}
        >
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-none'>
            {filteredSkills.length > 0 ? (
              filteredSkills.map((skill, index) => {
                const isActive = index === activeIndex
                return (
                  <button
                    key={skill.id}
                    type='button'
                    role='menuitem'
                    data-filtered-idx={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => handleSelect(skill)}
                    className={cn(
                      'relative flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-medium text-[var(--text-body)] text-caption outline-none transition-colors [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
                      isActive && 'bg-[var(--surface-active)]'
                    )}
                  >
                    <AgentSkillsIcon />
                    <span>{skill.name}</span>
                  </button>
                )
              })
            ) : (
              <div className='px-2 py-1.5 text-center font-medium text-[var(--text-tertiary)] text-caption'>
                {t('no_skills')}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  })
)
