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

const TOP_LEVEL_COMMANDS = [
  { id: 'fast', label: 'Fast' },
  { id: 'research', label: 'Research' },
  { id: 'superagent', label: 'Actions' },
] as const

const WEB_COMMANDS = [
  { id: 'search', label: 'Search' },
  { id: 'read', label: 'Read' },
  { id: 'scrape', label: 'Scrape' },
  { id: 'crawl', label: 'Crawl' },
] as const

const ALL_COMMANDS = [...TOP_LEVEL_COMMANDS, ...WEB_COMMANDS]

interface SlashMenuProps {
  mentionMenu: ReturnType<typeof useMentionMenu>
  message: string
  onSelectCommand: (command: string) => void
}

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

  const currentQuery = useMemo(() => {
    const caretPos = getCaretPos()
    const active = getActiveSlashQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, getCaretPos, getActiveSlashQueryAtPosition])

  const filteredCommands = useMemo(() => {
    if (!currentQuery) return null
    return ALL_COMMANDS.filter(
      (cmd) =>
        cmd.id.toLowerCase().includes(currentQuery) ||
        cmd.label.toLowerCase().includes(currentQuery)
    )
  }, [currentQuery])

  const showAggregatedView = currentQuery.length > 0
  const isInFolderNavigationMode = !openSubmenuFor && !showAggregatedView

  const textareaEl = mentionMenu.textareaRef.current
  if (!textareaEl) return null

  const caretPos = getCaretPos()
  const textareaRect = textareaEl.getBoundingClientRect()
  const style = window.getComputedStyle(textareaEl)

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
  mirrorDiv.textContent = message.substring(0, caretPos)

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

  const caretViewport = {
    left: textareaRect.left + (markerRect.left - mirrorRect.left) - textareaEl.scrollLeft,
    top: textareaRect.top + (markerRect.top - mirrorRect.top) - textareaEl.scrollTop,
  }

  const margin = 8
  const spaceBelow = window.innerHeight - caretViewport.top - margin
  const side: 'top' | 'bottom' = spaceBelow >= caretViewport.top - margin ? 'bottom' : 'top'

  return (
    <Popover open={true} onOpenChange={() => {}}>
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
        <PopoverBackButton onClick={() => setOpenSubmenuFor(null)} />
        <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
          {openSubmenuFor === 'Web' ? (
            <>
              {WEB_COMMANDS.map((cmd, index) => (
                <PopoverItem
                  key={cmd.id}
                  onClick={() => onSelectCommand(cmd.id)}
                  data-idx={index}
                  active={index === submenuActiveIndex}
                >
                  <span className='truncate'>{cmd.label}</span>
                </PopoverItem>
              ))}
            </>
          ) : showAggregatedView ? (
            <>
              {filteredCommands && filteredCommands.length === 0 ? (
                <div className='px-[8px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                  No commands found
                </div>
              ) : (
                filteredCommands?.map((cmd, index) => (
                  <PopoverItem
                    key={cmd.id}
                    onClick={() => onSelectCommand(cmd.id)}
                    data-idx={index}
                    active={index === submenuActiveIndex}
                  >
                    <span className='truncate'>{cmd.label}</span>
                  </PopoverItem>
                ))
              )}
            </>
          ) : (
            <>
              {TOP_LEVEL_COMMANDS.map((cmd, index) => (
                <PopoverItem
                  key={cmd.id}
                  onClick={() => onSelectCommand(cmd.id)}
                  data-idx={index}
                  active={isInFolderNavigationMode && index === mentionActiveIndex}
                >
                  <span className='truncate'>{cmd.label}</span>
                </PopoverItem>
              ))}

              <PopoverFolder
                id='web'
                title='Web'
                onOpen={() => setOpenSubmenuFor('Web')}
                active={
                  isInFolderNavigationMode && mentionActiveIndex === TOP_LEVEL_COMMANDS.length
                }
                data-idx={TOP_LEVEL_COMMANDS.length}
              >
                {WEB_COMMANDS.map((cmd) => (
                  <PopoverItem key={cmd.id} onClick={() => onSelectCommand(cmd.id)}>
                    <span className='truncate'>{cmd.label}</span>
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
