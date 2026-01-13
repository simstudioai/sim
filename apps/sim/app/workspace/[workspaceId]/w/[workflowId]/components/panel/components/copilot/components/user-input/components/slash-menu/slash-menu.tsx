'use client'

import { useMemo } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
} from '@/components/emcn'
import type { useMentionMenu } from '../../hooks/use-mention-menu'

/**
 * Top-level slash command options
 */
const TOP_LEVEL_COMMANDS = [
  { id: 'plan', label: 'plan' },
  { id: 'debug', label: 'debug' },
  { id: 'fast', label: 'fast' },
  { id: 'superagent', label: 'superagent' },
  { id: 'deploy', label: 'deploy' },
] as const

/**
 * Web submenu commands
 */
const WEB_COMMANDS = [
  { id: 'search', label: 'search' },
  { id: 'research', label: 'research' },
  { id: 'crawl', label: 'crawl' },
  { id: 'read', label: 'read' },
  { id: 'scrape', label: 'scrape' },
] as const

/**
 * All command labels for filtering
 */
const ALL_COMMANDS = [...TOP_LEVEL_COMMANDS, ...WEB_COMMANDS]

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
  const {
    mentionMenuRef,
    menuListRef,
    getActiveSlashQueryAtPosition,
    getCaretPos,
    submenuActiveIndex,
    mentionActiveIndex,
    openSubmenuFor,
    setOpenSubmenuFor,
  } = mentionMenu

  /**
   * Get the current query string after /
   */
  const currentQuery = useMemo(() => {
    const caretPos = getCaretPos()
    const active = getActiveSlashQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, getCaretPos, getActiveSlashQueryAtPosition])

  /**
   * Filter commands based on query (search across all commands when there's a query)
   */
  const filteredCommands = useMemo(() => {
    if (!currentQuery) return null // Show folder view when no query
    return ALL_COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(currentQuery))
  }, [currentQuery])

  // Show aggregated view when there's a query
  const showAggregatedView = currentQuery.length > 0

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

  // Check if we're in folder navigation mode (no query, not in submenu)
  const isInFolderNavigationMode = !openSubmenuFor && !showAggregatedView

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
        <PopoverBackButton />
        <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
          {openSubmenuFor === 'Web' ? (
            // Web submenu view
            <>
              {WEB_COMMANDS.map((cmd, index) => (
                <PopoverItem
                  key={cmd.id}
                  onClick={() => onSelectCommand(cmd.label)}
                  data-idx={index}
                  active={index === submenuActiveIndex}
                >
                  <span className='truncate capitalize'>{cmd.label}</span>
                </PopoverItem>
              ))}
            </>
          ) : showAggregatedView ? (
            // Aggregated filtered view
            <>
              {filteredCommands && filteredCommands.length === 0 ? (
                <div className='px-[8px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                  No commands found
                </div>
              ) : (
                filteredCommands?.map((cmd, index) => (
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
            </>
          ) : (
            // Folder navigation view
            <>
              {TOP_LEVEL_COMMANDS.map((cmd, index) => (
                <PopoverItem
                  key={cmd.id}
                  onClick={() => onSelectCommand(cmd.label)}
                  data-idx={index}
                  active={isInFolderNavigationMode && index === mentionActiveIndex}
                >
                  <span className='truncate capitalize'>{cmd.label}</span>
                </PopoverItem>
              ))}

              <PopoverFolder
                id='web'
                title='Web'
                onOpen={() => setOpenSubmenuFor('Web')}
                active={isInFolderNavigationMode && mentionActiveIndex === TOP_LEVEL_COMMANDS.length}
                data-idx={TOP_LEVEL_COMMANDS.length}
              >
                {WEB_COMMANDS.map((cmd) => (
                  <PopoverItem key={cmd.id} onClick={() => onSelectCommand(cmd.label)}>
                    <span className='truncate capitalize'>{cmd.label}</span>
                  </PopoverItem>
                ))}
              </PopoverFolder>
            </>
          )}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
