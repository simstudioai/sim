'use client'

import {
  isTerminalAppearanceTheme,
  type TerminalAppearanceTheme,
  type TerminalThemeProfile,
  terminalProfileThemeValue,
} from '@sim/desktop-bridge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, Clipboard, Duplicate, Palette, Plus, Trash, X } from '@sim/emcn/icons'

interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /** Whether the terminal currently has a selection, gating Copy. */
  hasSelection: boolean
  onCopy: () => void
  onPaste: () => void
  onClear: () => void
  appearanceTheme: TerminalAppearanceTheme
  profiles: TerminalThemeProfile[]
  onAppearanceThemeChange?: (theme: TerminalAppearanceTheme) => void
  appearanceThemePending?: boolean
  onNewTab: () => void
  /** Closes this terminal. Absent when it is the only one left. */
  onCloseTerminal?: () => void
}

/**
 * Right-click menu for the terminal surface.
 *
 * xterm.js renders into a canvas and drives input through an offscreen
 * textarea, so the shell's native editable menu (Cut/Copy/Paste/Select All)
 * targets that empty textarea and does nothing useful. These actions go
 * through xterm's own selection and the PTY instead, which is what makes them
 * work — and Cut is absent because a terminal's scrollback cannot be cut from.
 *
 * Every action is scoped to the terminal that was right-clicked rather than
 * "the active one", so the menu stays correct no matter which terminal owns
 * focus. Positioning mirrors the sidebar's context menu: a zero-size trigger
 * pinned at the cursor, so the platform's dropdown owns the popover behaviour
 * (focus, dismissal, collision handling) rather than a hand-rolled one.
 */
export function TerminalContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  hasSelection,
  onCopy,
  onPaste,
  onClear,
  appearanceTheme,
  profiles,
  onAppearanceThemeChange,
  appearanceThemePending = false,
  onNewTab,
  onCloseTerminal,
}: TerminalContextMenuProps) {
  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        <DropdownMenuItem disabled={!hasSelection} onSelect={run(onCopy)}>
          <Duplicate />
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(onPaste)}>
          <Clipboard />
          Paste
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(onClear)}>
          <Trash />
          Clear
        </DropdownMenuItem>
        {onAppearanceThemeChange && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={appearanceThemePending}>
              <Palette />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                aria-label='Terminal theme'
                value={appearanceTheme}
                onValueChange={(theme) => {
                  if (isTerminalAppearanceTheme(theme)) onAppearanceThemeChange(theme)
                }}
              >
                <DropdownMenuRadioItem value='app'>Default</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='light'>Sim Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='dark'>Sim Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {profiles.map((profile) => {
                const value = terminalProfileThemeValue(profile.id)
                return (
                  <DropdownMenuItem
                    key={profile.id}
                    onSelect={() => onAppearanceThemeChange(value)}
                  >
                    <Check className={appearanceTheme === value ? 'opacity-100' : 'opacity-0'} />
                    {profile.source === 'iterm2' ? 'iTerm2' : 'Terminal'} · {profile.name}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={run(onNewTab)}>
          <Plus />
          New tab
        </DropdownMenuItem>
        {onCloseTerminal && (
          <DropdownMenuItem onSelect={run(onCloseTerminal)}>
            <X />
            Close terminal
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
