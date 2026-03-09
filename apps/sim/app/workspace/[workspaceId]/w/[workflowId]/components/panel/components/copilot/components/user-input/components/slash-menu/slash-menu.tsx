'use client'

import { useEffect, useMemo } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  usePopoverContext,
} from '@/components/emcn'
import {
  ALL_SLASH_COMMANDS,
  MENU_STATE_TEXT_CLASSES,
  TOP_LEVEL_COMMANDS,
  WEB_COMMANDS,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import { useCaretViewport } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { useMentionMenu } from '../../hooks/use-mention-menu'

export interface SlashFolderNav {
  isInFolder: boolean
  openWebFolder: () => void
  closeFolder: () => void
}

interface SlashMenuProps {
  mentionMenu: ReturnType<typeof useMentionMenu>
  message: string
  onSelectCommand: (command: string) => void
  onFolderNavChange?: (nav: SlashFolderNav) => void
}

function SlashMenuContent({
  mentionMenu,
  message,
  onSelectCommand,
  onFolderNavChange,
}: SlashMenuProps) {
  const { currentFolder, openFolder, closeFolder } = usePopoverContext()

  const {
    menuListRef,
    getActiveSlashQueryAtPosition,
    getCaretPos,
    submenuActiveIndex,
    mentionActiveIndex,
    setSubmenuActiveIndex,
  } = mentionMenu

  const caretPos = getCaretPos()

  const currentQuery = useMemo(() => {
    const active = getActiveSlashQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, caretPos, getActiveSlashQueryAtPosition])

  const filteredCommands = useMemo(() => {
    if (!currentQuery) return null
    return ALL_SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.id.toLowerCase().includes(currentQuery) ||
        cmd.label.toLowerCase().includes(currentQuery)
    )
  }, [currentQuery])

  const showAggregatedView = currentQuery.length > 0
  const isInFolder = currentFolder !== null
  const isInFolderNavigationMode = !isInFolder && !showAggregatedView

  useEffect(() => {
    if (onFolderNavChange) {
      onFolderNavChange({
        isInFolder,
        openWebFolder: () => {
          openFolder('web', 'Web')
          setSubmenuActiveIndex(0)
        },
        closeFolder: () => {
          closeFolder()
          setSubmenuActiveIndex(0)
        },
      })
    }
  }, [onFolderNavChange, isInFolder, openFolder, closeFolder, setSubmenuActiveIndex])

  return (
    <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
      {isInFolder ? (
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
            <div className={MENU_STATE_TEXT_CLASSES}>No commands found</div>
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
            onOpen={() => setSubmenuActiveIndex(0)}
            active={isInFolderNavigationMode && mentionActiveIndex === TOP_LEVEL_COMMANDS.length}
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
  )
}

export function SlashMenu({
  mentionMenu,
  message,
  onSelectCommand,
  onFolderNavChange,
}: SlashMenuProps) {
  const { mentionMenuRef, textareaRef, getCaretPos } = mentionMenu

  const caretPos = getCaretPos()

  const { caretViewport, side } = useCaretViewport({
    textareaRef,
    message,
    caretPos,
  })

  if (!caretViewport) return null

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
        style={{ width: '180px' }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
      >
        <PopoverBackButton />
        <SlashMenuContent
          mentionMenu={mentionMenu}
          message={message}
          onSelectCommand={onSelectCommand}
          onFolderNavChange={onFolderNavChange}
        />
      </PopoverContent>
    </Popover>
  )
}
