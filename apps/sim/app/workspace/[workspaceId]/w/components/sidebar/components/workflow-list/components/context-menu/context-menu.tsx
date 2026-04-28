'use client'

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import {
  Check,
  Duplicate,
  Eye,
  FolderPlus,
  Lock,
  LogOut,
  Mail,
  Palette,
  Pencil,
  Plus,
  SquareArrowUpRight,
  Trash,
  Unlock,
  Upload,
  X,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { WORKFLOW_COLORS } from '@/lib/workflows/colors'

const GRID_COLUMNS = 6

/**
 * Color grid with keyboard navigation support.
 * Uses roving tabindex pattern for accessibility.
 */
function ColorGrid({
  hexInput,
  setHexInput,
  onColorChange,
  buttonRefs: cellButtonRefs,
}: {
  hexInput: string
  setHexInput: (color: string) => void
  onColorChange?: (color: string) => void
  buttonRefs: RefObject<(HTMLButtonElement | null)[]>
}) {
  const [focusedIndex, setFocusedIndex] = useState(-1)

  useEffect(() => {
    const selectedIndex = WORKFLOW_COLORS.findIndex(
      ({ color }) => color.toLowerCase() === hexInput.toLowerCase()
    )
    const idx = selectedIndex >= 0 ? selectedIndex : 0
    setFocusedIndex(idx)
    requestAnimationFrame(() => {
      cellButtonRefs.current[idx]?.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial roving focus when submenu content mounts
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const totalItems = WORKFLOW_COLORS.length
      let newIndex = index

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          newIndex = index + 1 < totalItems ? index + 1 : index
          break
        case 'ArrowLeft':
          e.preventDefault()
          newIndex = index - 1 >= 0 ? index - 1 : index
          break
        case 'ArrowDown':
          e.preventDefault()
          newIndex = index + GRID_COLUMNS < totalItems ? index + GRID_COLUMNS : index
          break
        case 'ArrowUp':
          e.preventDefault()
          newIndex = index - GRID_COLUMNS >= 0 ? index - GRID_COLUMNS : index
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          e.stopPropagation()
          setHexInput(WORKFLOW_COLORS[index].color)
          onColorChange?.(WORKFLOW_COLORS[index].color)
          return
        default:
          return
      }

      if (newIndex !== index) {
        setFocusedIndex(newIndex)
        cellButtonRefs.current[newIndex]?.focus()
      }
    },
    [setHexInput, onColorChange]
  )

  return (
    <div className='grid grid-cols-6 gap-1' role='grid'>
      {WORKFLOW_COLORS.map(({ color, name }, index) => (
        <button
          key={color}
          ref={(el) => {
            cellButtonRefs.current[index] = el
          }}
          type='button'
          role='gridcell'
          title={name}
          tabIndex={focusedIndex === index ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation()
            setHexInput(color)
          }}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onFocus={() => setFocusedIndex(index)}
          className={cn(
            'h-[16px] w-[16px] rounded-sm border border-black/10 outline-none transition-shadow duration-150',
            (focusedIndex === index ||
              (focusedIndex === -1 && hexInput.toLowerCase() === color.toLowerCase())) &&
              'shadow-[0_0_0_1.5px_var(--bg),0_0_0_3px_var(--text-icon)]'
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  )
}

function isValidHex(hex: string): boolean {
  const cleaned = hex.replace('#', '')
  return /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(cleaned)
}

function normalizeHex(hex: string): string {
  let cleaned = hex.replace('#', '').toLowerCase()
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return `#${cleaned}`
}

/**
 * Color picker submenu for the context menu.
 * Expands on hover using DropdownMenuSub.
 */
function ColorPickerSubmenu({
  hexInput,
  setHexInput,
  canSubmitHex,
  onColorChange,
  handleHexSubmit,
  handleHexChange,
  handleHexKeyDown,
  handleHexFocus,
  disabled,
}: {
  hexInput: string
  setHexInput: (color: string) => void
  canSubmitHex: boolean
  onColorChange?: (color: string) => void
  handleHexSubmit: () => void
  handleHexChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleHexKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleHexFocus: (e: React.FocusEvent<HTMLInputElement>) => void
  disabled?: boolean
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={disabled ? 'pointer-events-none opacity-50' : ''}>
        <Palette />
        Change color
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='p-2' onPointerDownOutside={(e) => e.preventDefault()}>
        <div className='flex w-[120px] flex-col gap-2 p-0.5'>
          <ColorGrid
            hexInput={hexInput}
            setHexInput={setHexInput}
            onColorChange={onColorChange}
            buttonRefs={buttonRefs}
          />
          <div className='flex items-center gap-1'>
            <div
              className='h-[16px] w-[16px] flex-shrink-0 rounded-sm border border-black/10'
              style={{
                backgroundColor: isValidHex(hexInput) ? normalizeHex(hexInput) : '#ffffff',
              }}
            />
            <input
              type='text'
              value={hexInput}
              onChange={handleHexChange}
              onKeyDown={handleHexKeyDown}
              onFocus={handleHexFocus}
              onClick={(e) => e.stopPropagation()}
              className='h-[20px] min-w-0 flex-1 rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-1.5 font-medium text-[var(--text-primary)] text-xs uppercase transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            />
            <Button
              variant='primary'
              disabled={!canSubmitHex}
              onClick={(e) => {
                e.stopPropagation()
                handleHexSubmit()
              }}
              className='h-[20px] w-[20px] flex-shrink-0 p-0'
            >
              <Check className='h-[12px] w-[12px]' />
            </Button>
          </div>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

interface ContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onOpenInNewTab?: () => void
  onMarkAsRead?: () => void
  onMarkAsUnread?: () => void
  onRename?: () => void
  onCreate?: () => void
  onCreateFolder?: () => void
  onDuplicate?: () => void
  onExport?: () => void
  onDelete: () => void
  onColorChange?: (color: string) => void
  currentColor?: string
  showOpenInNewTab?: boolean
  showMarkAsRead?: boolean
  showMarkAsUnread?: boolean
  showRename?: boolean
  showCreate?: boolean
  showCreateFolder?: boolean
  showDuplicate?: boolean
  showExport?: boolean
  showColorChange?: boolean
  disableExport?: boolean
  disableMarkAsRead?: boolean
  disableMarkAsUnread?: boolean
  disableColorChange?: boolean
  disableRename?: boolean
  disableDuplicate?: boolean
  disableDelete?: boolean
  disableCreate?: boolean
  disableCreateFolder?: boolean
  onLeave?: () => void
  showLeave?: boolean
  disableLeave?: boolean
  onToggleLock?: () => void
  showLock?: boolean
  disableLock?: boolean
  isLocked?: boolean
  showDelete?: boolean
  onUploadLogo?: () => void
  onRemoveLogo?: () => void
  showUploadLogo?: boolean
  showRemoveLogo?: boolean
  disableUploadLogo?: boolean
  disableRemoveLogo?: boolean
}

/**
 * Context menu component for workflow, folder, and workspace items.
 * Uses DropdownMenu for accessible, hover-expandable submenus.
 */
export function ContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onMarkAsRead,
  onMarkAsUnread,
  onRename,
  onCreate,
  onCreateFolder,
  onDuplicate,
  onExport,
  onDelete,
  onColorChange,
  currentColor,
  showOpenInNewTab = false,
  showMarkAsRead = false,
  showMarkAsUnread = false,
  showRename = true,
  showCreate = false,
  showCreateFolder = false,
  showDuplicate = true,
  showExport = false,
  showColorChange = false,
  disableExport = false,
  disableMarkAsRead = false,
  disableMarkAsUnread = false,
  disableColorChange = false,
  disableRename = false,
  disableDuplicate = false,
  disableDelete = false,
  disableCreate = false,
  disableCreateFolder = false,
  onLeave,
  showLeave = false,
  disableLeave = false,
  onToggleLock,
  showLock = false,
  disableLock = false,
  isLocked = false,
  showDelete = true,
  onUploadLogo,
  onRemoveLogo,
  showUploadLogo = false,
  showRemoveLogo = false,
  disableUploadLogo = false,
  disableRemoveLogo = false,
}: ContextMenuProps) {
  const [hexInput, setHexInput] = useState(currentColor || '#ffffff')

  useEffect(() => {
    setHexInput(currentColor || '#ffffff')
  }, [currentColor])

  const canSubmitHex = useMemo(() => {
    if (!isValidHex(hexInput)) return false
    const normalized = normalizeHex(hexInput)
    if (currentColor && normalized.toLowerCase() === currentColor.toLowerCase()) return false
    return true
  }, [hexInput, currentColor])

  const handleHexSubmit = useCallback(() => {
    if (!canSubmitHex || !onColorChange) return

    const normalized = normalizeHex(hexInput)
    onColorChange(normalized)
    setHexInput(normalized)
  }, [hexInput, canSubmitHex, onColorChange])

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        handleHexSubmit()
      }
    },
    [handleHexSubmit]
  )

  const handleHexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.trim()
    if (value && !value.startsWith('#')) {
      value = `#${value}`
    }
    value = value.slice(0, 1) + value.slice(1).replace(/[^0-9a-fA-F]/g, '')
    setHexInput(value.slice(0, 7))
  }, [])

  const handleHexFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select()
  }, [])

  const hasNavigationSection = showOpenInNewTab && onOpenInNewTab
  const hasStatusSection = (showMarkAsRead && onMarkAsRead) || (showMarkAsUnread && onMarkAsUnread)
  const hasEditSection =
    (showRename && onRename) ||
    (showCreate && onCreate) ||
    (showCreateFolder && onCreateFolder) ||
    (showColorChange && onColorChange) ||
    (showLock && onToggleLock) ||
    (showUploadLogo && onUploadLogo) ||
    (showRemoveLogo && onRemoveLogo)
  const hasCopySection = (showDuplicate && onDuplicate) || (showExport && onExport)

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
      <DropdownMenuContent
        ref={menuRef}
        align='start'
        side='bottom'
        sideOffset={4}
        className='max-h-[var(--radix-dropdown-menu-content-available-height,400px)]'
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {showOpenInNewTab && onOpenInNewTab && (
          <DropdownMenuItem
            onSelect={() => {
              onOpenInNewTab()
              onClose()
            }}
          >
            <SquareArrowUpRight />
            Open in new tab
          </DropdownMenuItem>
        )}
        {hasNavigationSection && (hasStatusSection || hasEditSection || hasCopySection) && (
          <DropdownMenuSeparator />
        )}

        {showMarkAsRead && onMarkAsRead && (
          <DropdownMenuItem
            disabled={disableMarkAsRead}
            onSelect={() => {
              onMarkAsRead()
              onClose()
            }}
          >
            <Eye />
            Mark as read
          </DropdownMenuItem>
        )}
        {showMarkAsUnread && onMarkAsUnread && (
          <DropdownMenuItem
            disabled={disableMarkAsUnread}
            onSelect={() => {
              onMarkAsUnread()
              onClose()
            }}
          >
            <Mail />
            Mark as unread
          </DropdownMenuItem>
        )}
        {hasStatusSection && (hasEditSection || hasCopySection) && <DropdownMenuSeparator />}

        {showRename && onRename && (
          <DropdownMenuItem
            disabled={disableRename}
            onSelect={() => {
              onRename()
              onClose()
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {showCreate && onCreate && (
          <DropdownMenuItem
            disabled={disableCreate}
            onSelect={() => {
              onCreate()
              onClose()
            }}
          >
            <Plus />
            Create workflow
          </DropdownMenuItem>
        )}
        {showCreateFolder && onCreateFolder && (
          <DropdownMenuItem
            disabled={disableCreateFolder}
            onSelect={() => {
              onCreateFolder()
              onClose()
            }}
          >
            <FolderPlus />
            Create folder
          </DropdownMenuItem>
        )}
        {showColorChange && onColorChange && (
          <ColorPickerSubmenu
            hexInput={hexInput}
            setHexInput={setHexInput}
            canSubmitHex={canSubmitHex}
            onColorChange={onColorChange}
            handleHexSubmit={handleHexSubmit}
            handleHexChange={handleHexChange}
            handleHexKeyDown={handleHexKeyDown}
            handleHexFocus={handleHexFocus}
            disabled={disableColorChange}
          />
        )}

        {showUploadLogo && onUploadLogo && (
          <DropdownMenuItem
            disabled={disableUploadLogo}
            onSelect={() => {
              onUploadLogo()
              onClose()
            }}
          >
            <Upload />
            Upload logo
          </DropdownMenuItem>
        )}
        {showRemoveLogo && onRemoveLogo && (
          <DropdownMenuItem
            disabled={disableRemoveLogo}
            onSelect={() => {
              onRemoveLogo()
              onClose()
            }}
          >
            <X />
            Remove logo
          </DropdownMenuItem>
        )}

        {showLock && onToggleLock && (
          <DropdownMenuItem
            disabled={disableLock}
            onSelect={() => {
              onToggleLock()
              onClose()
            }}
          >
            {isLocked ? <Unlock /> : <Lock />}
            {isLocked ? 'Unlock' : 'Lock'}
          </DropdownMenuItem>
        )}

        {hasEditSection && hasCopySection && <DropdownMenuSeparator />}
        {showDuplicate && onDuplicate && (
          <DropdownMenuItem
            disabled={disableDuplicate}
            onSelect={() => {
              onDuplicate()
              onClose()
            }}
          >
            <Duplicate />
            Duplicate
          </DropdownMenuItem>
        )}
        {showExport && onExport && (
          <DropdownMenuItem
            disabled={disableExport}
            onSelect={() => {
              onExport()
              onClose()
            }}
          >
            <Upload />
            Export
          </DropdownMenuItem>
        )}

        {(hasNavigationSection || hasStatusSection || hasEditSection || hasCopySection) &&
          (showLeave || showDelete) && <DropdownMenuSeparator />}
        {showLeave && onLeave && (
          <DropdownMenuItem
            disabled={disableLeave}
            onSelect={() => {
              onLeave()
              onClose()
            }}
          >
            <LogOut />
            Leave
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            disabled={disableDelete}
            onSelect={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
