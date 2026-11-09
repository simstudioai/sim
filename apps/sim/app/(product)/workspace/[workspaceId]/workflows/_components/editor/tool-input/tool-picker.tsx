'use client'

import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import { Tooltip } from '@sim/emcn/tooltip'
import {
  FieldPopover,
  FieldPopoverHeading,
  FieldPopoverNote,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/workspace/[workspaceId]/_components/field-popover/field-popover'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-picker.module.css'

/** One row of the tool picker. */
export interface ToolPickerItem {
  id: string
  label: string
  leading?: ReactNode
  disabled?: boolean
  /** Why the block cannot run this kind of tool; the row reads "Unavailable" and explains on hover. */
  unavailableReason?: string
  /** Opens a nested level, such as an MCP server's tools, and keeps the picker open. */
  nested?: boolean
  /** Keeps the picker open after the row runs. */
  keepOpen?: boolean
  /** Listed whatever the search, as Back is. */
  pinned?: boolean
  onSelect: () => void
}

/** A captioned group of picker rows. */
export interface ToolPickerGroup {
  id: string
  heading?: string
  items: readonly ToolPickerItem[]
}

interface ToolPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: readonly ToolPickerGroup[]
  disabled?: boolean
  /** Steps out of a nested level; Left from an empty search does the same. */
  onBack?: () => void
  /** Names the level the picker shows, so entering or leaving one clears the search. */
  level: string
}

function matches(item: ToolPickerItem, query: string): boolean {
  return item.pinned || !query || item.label.toLowerCase().includes(query)
}

/**
 * The "Add tool" field: typing searches every tool the block may add, grouped into actions, custom
 * tools, MCP servers, built-in tools, integrations, workflows and advanced bindings. Arrow keys move
 * through the rows while focus stays in the field, Enter adds, Right opens an MCP server and Left
 * steps back out, Escape closes.
 */
export function ToolPicker({
  open,
  onOpenChange,
  groups,
  disabled = false,
  onBack,
  level,
}: ToolPickerProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const [settledLevel, setSettledLevel] = useState(level)
  if (settledLevel !== level) {
    setSettledLevel(level)
    setQuery('')
  }

  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setQuery('')
  }

  const normalizedQuery = query.trim().toLowerCase()
  const { visibleGroups, rows } = useMemo(() => {
    const flat: ToolPickerItem[] = []
    const shown = groups.flatMap((group) => {
      const items = group.items
        .filter((item) => matches(item, normalizedQuery))
        .map((item) => {
          flat.push(item)
          return { item, index: flat.length - 1 }
        })
      return items.length > 0 ? [{ id: group.id, heading: group.heading, items }] : []
    })
    return { visibleGroups: shown, rows: flat }
  }, [groups, normalizedQuery])
  const firstEnabled = rows.findIndex((row) => !row.disabled)

  const listKey = `${level}:${normalizedQuery}:${rows.length}`
  const [settledList, setSettledList] = useState(listKey)
  if (settledList !== listKey) {
    setSettledList(listKey)
    setActiveIndex(firstEnabled)
  }

  useActiveRowIntoView(open, activeIndex)

  const setOpen = (next: boolean) => {
    if (disabled && next) return
    onOpenChange(next)
  }

  const select = (item: ToolPickerItem) => {
    if (item.disabled) return
    item.onSelect()
    if (!item.nested && !item.keepOpen) onOpenChange(false)
  }

  const step = (direction: 1 | -1) => {
    if (rows.length === 0) return
    let index = activeIndex
    for (let tries = 0; tries < rows.length; tries++) {
      index = (index + direction + rows.length) % rows.length
      if (!rows[index].disabled) {
        setActiveIndex(index)
        return
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (!open) {
          setOpen(true)
          return
        }
        step(event.key === 'ArrowDown' ? 1 : -1)
        return
      case 'Enter': {
        if (!open) return
        event.preventDefault()
        const active = rows[activeIndex]
        if (active) select(active)
        return
      }
      case 'Escape':
        if (!open) return
        event.preventDefault()
        event.stopPropagation()
        onOpenChange(false)
        return
      case 'ArrowLeft':
        if (open && onBack && query === '') {
          event.preventDefault()
          onBack()
        }
        return
      case 'ArrowRight': {
        const active = rows[activeIndex]
        const caretAtEnd = event.currentTarget.selectionStart === query.length
        if (open && active?.nested && caretAtEnd) {
          event.preventDefault()
          select(active)
        }
        return
      }
      case 'Tab':
        if (open) onOpenChange(false)
        return
    }
  }

  return (
    <>
      <div
        ref={frameRef}
        role='presentation'
        className={styles.frame}
        data-disabled={disabled || undefined}
        onMouseDown={(event) => {
          if (disabled || event.target === inputRef.current) return
          event.preventDefault()
          inputRef.current?.focus()
          setOpen(!open)
        }}
      >
        <input
          ref={inputRef}
          className={styles.input}
          data-type='T043'
          role='combobox'
          aria-label='Add tool'
          aria-expanded={open}
          aria-autocomplete='list'
          placeholder={open ? 'Search tools...' : 'Add tool...'}
          value={query}
          disabled={disabled}
          autoComplete='off'
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!open) setOpen(true)
          }}
          onMouseDown={() => {
            if (!open) setOpen(true)
          }}
          onBlur={() => {
            if (open) onOpenChange(false)
          }}
          onKeyDown={handleKeyDown}
        />
        <Icon name='I051' />
      </div>
      <FieldPopover
        label='Tools'
        open={open && !disabled}
        anchor={frameRef}
        matchAnchorWidth
        onDismiss={() => onOpenChange(false)}
      >
        {visibleGroups.length === 0 ? (
          <FieldPopoverNote>No tools found</FieldPopoverNote>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.id} role='group' aria-label={group.heading} className={styles.group}>
              {group.heading && <FieldPopoverHeading>{group.heading}</FieldPopoverHeading>}
              {group.items.map(({ item, index }) => (
                <FieldPopoverRow
                  key={item.id}
                  index={index}
                  active={index === activeIndex}
                  disabled={item.disabled}
                  nested={item.nested}
                  leading={item.leading}
                  trailing={
                    item.unavailableReason ? (
                      <Tooltip label={item.unavailableReason}>
                        <span className={styles.trailing} data-type='T052'>
                          Unavailable
                        </span>
                      </Tooltip>
                    ) : item.nested ? (
                      <span className={styles.trailing}>
                        <Icon name='I032' />
                      </span>
                    ) : undefined
                  }
                  onHover={() => {
                    if (!item.disabled) setActiveIndex(index)
                  }}
                  onSelect={() => select(item)}
                >
                  {item.label}
                </FieldPopoverRow>
              ))}
            </div>
          ))
        )}
      </FieldPopover>
    </>
  )
}
