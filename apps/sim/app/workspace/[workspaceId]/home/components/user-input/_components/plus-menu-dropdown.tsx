'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { cn } from '@/lib/core/utils/cn'
import type { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/_components/constants'
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
    const [activeIndex, setActiveIndex] = useState(0)
    const activeIndexRef = useRef(activeIndex)

    useEffect(() => {
      activeIndexRef.current = activeIndex
    }, [activeIndex])

    React.useImperativeHandle(
      ref,
      () => ({
        open: () => {
          setOpen(true)
          setSearch('')
          setActiveIndex(0)
        },
      }),
      []
    )

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
        setActiveIndex(0)
      },
      [onResourceSelect]
    )

    const filteredItemsRef = useRef(filteredItems)
    filteredItemsRef.current = filteredItems

    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        const items = filteredItemsRef.current
        if (!items) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((prev) => Math.min(prev + 1, items.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((prev) => Math.max(prev - 1, 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const idx = activeIndexRef.current
          if (items.length > 0 && items[idx]) {
            const { type, item } = items[idx]
            handleSelect({ type, id: item.id, title: item.name })
          }
        }
      },
      [handleSelect]
    )

    const handleOpenChange = useCallback(
      (isOpen: boolean) => {
        setOpen(isOpen)
        if (!isOpen) {
          setSearch('')
          setActiveIndex(0)
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
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]'
            title='Add attachments or resources'
          >
            <Plus className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          side='top'
          sideOffset={8}
          className='flex w-[240px] flex-col overflow-hidden'
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DropdownMenuSearchInput
            placeholder='Search resources...'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setActiveIndex(0)
            }}
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
                      className={cn(index === activeIndex && 'bg-[var(--surface-active)]')}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        handleSelect({
                          type,
                          id: item.id,
                          title: item.name,
                        })
                      }}
                    >
                      {config.renderDropdownItem({ item })}
                      <span className='ml-auto pl-[8px] text-[11px] text-[var(--text-tertiary)]'>
                        {config.label}
                      </span>
                    </DropdownMenuItem>
                  )
                })
              ) : (
                <div className='px-[8px] py-[5px] text-center font-medium text-[12px] text-[var(--text-tertiary)]'>
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
    )
  })
)
