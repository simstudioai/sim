'use client'

import { useMemo } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
} from '@/components/emcn'
import type { useMentionMenu } from '../../hooks/use-mention-menu'

/**
 * Slash command options
 */
const SLASH_COMMANDS = [
  { id: 'plan', label: 'plan' },
  { id: 'debug', label: 'debug' },
  { id: 'fast', label: 'fast' },
  { id: 'superagent', label: 'superagent' },
  { id: 'research', label: 'research' },
  { id: 'deploy', label: 'deploy' },
] as const

interface SlashMenuProps {
  mentionMenu: ReturnType<typeof useMentionMenu>
  message: string
  onSelectCommand: (command: string) => void
}

/**
 * SlashMenu component for slash command dropdown.
 * Shows command options when user types '/'.
 *
 * @param props - Component props
 * @returns Rendered slash menu
 */
export function SlashMenu({ mentionMenu, message, onSelectCommand }: SlashMenuProps) {
  const { mentionMenuRef, menuListRef, getActiveSlashQueryAtPosition, getCaretPos, submenuActiveIndex } =
    mentionMenu

  /**
   * Get the current query string after /
   */
  const currentQuery = useMemo(() => {
    const caretPos = getCaretPos()
    const active = getActiveSlashQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, getCaretPos, getActiveSlashQueryAtPosition])

  /**
   * Filter commands based on query
   */
  const filteredCommands = useMemo(() => {
    if (!currentQuery) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(currentQuery))
  }, [currentQuery])

  // Compute caret viewport position via mirror technique for precise anchoring
  const textareaEl = mentionMenu.textareaRef.current
  if (!textareaEl) return null

  const getCaretViewport = (textarea: HTMLTextAreaElement, caretPosition: number, text: string) => {
    const textareaRect = textarea.getBoundingClientRect()
    const style = window.getComputedStyle(textarea)

    const mirrorDiv = document.createElement('div')
    mirrorDiv.style.position = 'absolute'
    mirrorDiv.style.visibility = 'hidden'
    mirrorDiv.style.whiteSpace = 'pre-wrap'
    mirrorDiv.style.wordWrap = 'break-word'
    mirrorDiv.style.font = style.font
    mirrorDiv.style.padding = style.padding
    mirrorDiv.style.border = style.border
    mirrorDiv.style.width = style.width
    mirrorDiv.style.lineHeight = style.lineHeight
    mirrorDiv.style.boxSizing = style.boxSizing
    mirrorDiv.style.letterSpacing = style.letterSpacing
    mirrorDiv.style.textTransform = style.textTransform
    mirrorDiv.style.textIndent = style.textIndent
    mirrorDiv.style.textAlign = style.textAlign

    mirrorDiv.textContent = text.substring(0, caretPosition)

    const caretMarker = document.createElement('span')
    caretMarker.style.display = 'inline-block'
    caretMarker.style.width = '0px'
    caretMarker.style.padding = '0'
    caretMarker.style.border = '0'
    mirrorDiv.appendChild(caretMarker)

    document.body.appendChild(mirrorDiv)
    const markerRect = caretMarker.getBoundingClientRect()
    const mirrorRect = mirrorDiv.getBoundingClientRect()
    document.body.removeChild(mirrorDiv)

    const leftOffset = markerRect.left - mirrorRect.left - textarea.scrollLeft
    const topOffset = markerRect.top - mirrorRect.top - textarea.scrollTop

    return {
      left: textareaRect.left + leftOffset,
      top: textareaRect.top + topOffset,
    }
  }

  const caretPos = getCaretPos()
  const caretViewport = getCaretViewport(textareaEl, caretPos, message)

  // Decide preferred side based on available space
  const margin = 8
  const spaceAbove = caretViewport.top - margin
  const spaceBelow = window.innerHeight - caretViewport.top - margin
  const side: 'top' | 'bottom' = spaceBelow >= spaceAbove ? 'bottom' : 'top'

  return (
    <Popover
      open={true}
      onOpenChange={() => {
        /* controlled externally */
      }}
    >
      <PopoverAnchor asChild>
        <div
          style={{
            position: 'fixed',
            top: `${caretViewport.top}px`,
            left: `${caretViewport.left}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={mentionMenuRef}
        side={side}
        align='start'
        collisionPadding={6}
        maxHeight={360}
        className='pointer-events-auto'
        style={{
          width: `180px`,
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
          {filteredCommands.length === 0 ? (
            <div className='px-[8px] py-[8px] text-[12px] text-[var(--text-muted)]'>
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <PopoverItem
                key={cmd.id}
                onClick={() => onSelectCommand(cmd.label)}
                data-idx={index}
                active={index === submenuActiveIndex}
              >
                <span className='truncate capitalize'>{cmd.label}</span>
              </PopoverItem>
            ))
          )}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}

