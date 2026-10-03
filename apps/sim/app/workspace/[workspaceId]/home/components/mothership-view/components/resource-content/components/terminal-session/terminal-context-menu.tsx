'use client'

import {
  isDesktopAppearanceTheme,
  type TerminalAppearanceTheme,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import {
  Check,
  Clipboard,
  Duplicate,
  Palette,
  Plus,
  Send,
  Settings,
  Trash,
  X,
} from '@sim/emcn/icons'
import { ResourceZoomMenuItems } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/resource-zoom-menu-items'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface TerminalContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /** Whether the terminal currently has a selection, gating Copy. */
  hasSelection: boolean
  /** Adds the captured selection to the active chat composer. */
  onAddToChat?: () => void
  onCopy: () => void
  onPaste: () => void
  onClear: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onActualSize: () => void
  appearanceTheme: TerminalAppearanceTheme
  profiles: TerminalThemeProfile[]
  onAppearanceThemeChange?: (theme: TerminalAppearanceTheme) => void
  appearanceThemePending?: boolean
  onNewTab: () => void
  /** Closes this terminal (deliberately offered even for the only one left). */
  onCloseTerminal: () => void
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
  onAddToChat,
  onCopy,
  onPaste,
  onClear,
  onZoomIn,
  onZoomOut,
  onActualSize,
  appearanceTheme,
  profiles,
  onAppearanceThemeChange,
  appearanceThemePending = false,
  onNewTab,
  onCloseTerminal,
}: TerminalContextMenuProps) {
  const { navigateToSettings } = useSettingsNavigation()
  const selectedValue = typeof appearanceTheme === 'string' ? appearanceTheme : appearanceTheme.id
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
        {onAddToChat && (
          <>
            <DropdownMenuItem onSelect={run(onAddToChat)}>
              <Send />
              Add to chat
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
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
                value={selectedValue}
                onValueChange={(theme) => {
                  if (isDesktopAppearanceTheme(theme)) onAppearanceThemeChange(theme)
                }}
              >
                <DropdownMenuRadioItem value='app'>Default</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='light'>Sim Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='dark'>Sim Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {profiles.map((profile) => {
                return (
                  <DropdownMenuItem
                    key={profile.id}
                    onSelect={() => onAppearanceThemeChange(profile)}
                  >
                    <Check className={selectedValue === profile.id ? 'opacity-100' : 'opacity-0'} />
                    {profile.source === 'iterm2' ? 'iTerm2' : 'Terminal'} · {profile.name}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        <ResourceZoomMenuItems
          onZoomIn={run(onZoomIn)}
          onZoomOut={run(onZoomOut)}
          onActualSize={run(onActualSize)}
        />

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={run(onNewTab)}>
          <Plus />
          New Tab
          <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(onCloseTerminal)}>
          <X />
          Close Terminal
          <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={run(() => navigateToSettings({ section: 'terminal' }))}>
          <Settings />
          Terminal Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
