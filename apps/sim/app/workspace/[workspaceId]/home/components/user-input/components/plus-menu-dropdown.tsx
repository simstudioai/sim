'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus, Sim } from '@/components/emcn/icons'
import type { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

export type AvailableResourceGroup = ReturnType<typeof useAvailableResources>[number]

interface PlusMenuDropdownProps {
  availableResources: AvailableResourceGroup[]
  onResourceSelect: (resource: MothershipResource) => void
  onFileSelect: () => void
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingCursorRef: React.MutableRefObject<number | null>
}

export const PlusMenuDropdown = React.memo(
  React.forwardRef<PlusMenuHandle, PlusMenuDropdownProps>(function PlusMenuDropdown(
    { availableResources, onResourceSelect, onFileSelect, onClose, textareaRef, pendingCursorRef },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const doOpen = useCallback((anchor?: { left: number; top: number }) => {
      if (anchor) {
        setAnchorPos(anchor)
      } else {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (!rect) return
        setAnchorPos({ left: rect.left, top: rect.top })
      }
      setOpen(true)
      setSearch('')
    }, [])

    React.useImperativeHandle(ref, () => ({ open: doOpen }), [doOpen])

    const filteredItems = useMemo(() => {
      const q = search.toLowerCase().trim()
      if (!q) return null
      return availableResources.flatMap(({ type, items }) =>
        items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
      )
    }, [search, availableResources])

    const handleSelect = useCallback(
      (resource: MothershipResource) => {
        onResourceSelect(resource)
        setOpen(false)
        setSearch('')
      },
      [onResourceSelect]
    )

    const filteredItemsRef = useRef(filteredItems)
    filteredItemsRef.current = filteredItems

    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          const firstItem = contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
          firstItem?.focus()
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const first = filteredItemsRef.current?.[0]
          if (first) handleSelect({ type: first.type, id: first.item.id, title: first.item.name })
        }
      },
      [handleSelect]
    )

    const handleContentKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') {
        const items = Array.from(
          contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
        )
        if (items[0] && items[0] === document.activeElement) {
          e.preventDefault()
          searchRef.current?.focus()
        }
      } else if (e.key === 'Tab') {
        const focused = document.activeElement as HTMLElement | null
        if (focused?.getAttribute('role') === 'menuitem') {
          e.preventDefault()
          focused.click()
        }
      }
    }, [])

    const handleOpenChange = useCallback(
      (isOpen: boolean) => {
        setOpen(isOpen)
        if (!isOpen) {
          setSearch('')
          setAnchorPos(null)
          onClose()
        }
      },
      [onClose]
    )

    const handleCloseAutoFocus = useCallback(
      (e: Event) => {
        e.preventDefault()
        const textarea = textareaRef.current
        if (!textarea) return
        if (pendingCursorRef.current !== null) {
          textarea.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
          pendingCursorRef.current = null
        }
        textarea.focus()
      },
      [textareaRef, pendingCursorRef]
    )

    return (
      <>
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
            className='flex w-[240px] flex-col overflow-hidden'
            onCloseAutoFocus={handleCloseAutoFocus}
            onKeyDown={handleContentKeyDown}
          >
            <DropdownMenuSearchInput
              ref={searchRef}
              placeholder='Search resources...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <div className='min-h-0 flex-1 overflow-y-auto'>
              {filteredItems ? (
                filteredItems.length > 0 ? (
                  filteredItems.map(({ type, item }, index) => {
                    const config = getResourceConfig(type)
                    return (
                      <DropdownMenuItem
                        key={`${type}:${item.id}`}
                        onClick={() => {
                          handleSelect({
                            type,
                            id: item.id,
                            title: item.name,
                          })
                        }}
                      >
                        {config.renderDropdownItem({ item })}
                        <span className='ml-auto pl-2 text-[11px] text-[var(--text-tertiary)]'>
                          {config.label}
                        </span>
                      </DropdownMenuItem>
                    )
                  })
                ) : (
                  <div className='px-2 py-1.5 text-center font-medium text-[12px] text-[var(--text-tertiary)]'>
                    No results
                  </div>
                )
              ) : (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      setOpen(false)
                      onFileSelect()
                    }}
                  >
                    <Paperclip className='h-[14px] w-[14px]' strokeWidth={2} />
                    <span>Attachments</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Sim className='h-[14px] w-[14px]' fill='currentColor' />
                      <span>Workspace</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {availableResources.map(({ type, items }) => {
                        if (items.length === 0) return null
                        const config = getResourceConfig(type)
                        const Icon = config.icon
                        return (
                          <DropdownMenuSub key={type}>
                            <DropdownMenuSubTrigger>
                              {type === 'workflow' ? (
                                <div
                                  className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                                  style={{
                                    backgroundColor: '#808080',
                                    borderColor: '#80808060',
                                    backgroundClip: 'padding-box',
                                  }}
                                />
                              ) : (
                                <Icon className='h-[14px] w-[14px]' />
                              )}
                              <span>{config.label}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {items.map((item) => (
                                <DropdownMenuItem
                                  key={item.id}
                                  onClick={() => {
                                    handleSelect({
                                      type,
                                      id: item.id,
                                      title: item.name,
                                    })
                                  }}
                                >
                                  {config.renderDropdownItem({ item })}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          ref={buttonRef}
          type='button'
          onClick={() => doOpen()}
          className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]'
          title='Add attachments or resources'
        >
          <Plus className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        </button>
      </>
    )
  })
)
