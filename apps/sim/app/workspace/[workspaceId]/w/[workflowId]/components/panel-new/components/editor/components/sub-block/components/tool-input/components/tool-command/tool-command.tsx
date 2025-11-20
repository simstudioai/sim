import type React from 'react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

type CommandContextType = {
  searchQuery: string
  setSearchQuery: (value: string) => void
  activeIndex: number
  setActiveIndex: (index: number) => void
  filteredItems: string[]
  registerItem: (id: string) => void
  unregisterItem: (id: string) => void
  selectItem: (id: string) => void
}

const CommandContext = createContext<CommandContextType | undefined>(undefined)

const useCommandContext = () => {
  const context = useContext(CommandContext)
  if (!context) {
    throw new Error('Command components must be used within a CommandProvider')
  }
  return context
}

interface CommandProps {
  children: ReactNode
  className?: string
  filter?: (value: string, search: string) => number
  searchQuery?: string
}

interface CommandListProps {
  children: ReactNode
  className?: string
}

interface CommandEmptyProps {
  children: ReactNode
  className?: string
}

interface CommandItemProps {
  children: ReactNode
  className?: string
  value: string
  onSelect?: () => void
  disabled?: boolean
}

interface CommandSeparatorProps {
  className?: string
}

export function Command({
  children,
  className,
  filter,
  searchQuery: externalSearchQuery,
}: CommandProps) {
  const [internalSearchQuery, setInternalSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [items, setItems] = useState<string[]>([])
  const [filteredItems, setFilteredItems] = useState<string[]>([])

  // Use external searchQuery if provided, otherwise use internal state
  const searchQuery = externalSearchQuery ?? internalSearchQuery

  const registerItem = useCallback((id: string) => {
    setItems((prev) => {
      if (prev.includes(id)) return prev
      return [...prev, id]
    })
  }, [])

  const unregisterItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item !== id))
  }, [])

  const selectItem = useCallback(
    (id: string) => {
      const index = filteredItems.indexOf(id)
      if (index >= 0) {
        setActiveIndex(index)
      }
    },
    [filteredItems]
  )

  useEffect(() => {
    if (!searchQuery) {
      setFilteredItems(items)
      return
    }

    const filtered = items
      .map((item) => {
        const score = filter ? filter(item, searchQuery) : defaultFilter(item, searchQuery)
        return { item, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.item)

    setFilteredItems(filtered)
    setActiveIndex(filtered.length > 0 ? 0 : -1)
  }, [searchQuery, items, filter])

  const defaultFilter = useCallback((value: string, search: string): number => {
    const normalizedValue = value.toLowerCase()
    const normalizedSearch = search.toLowerCase()

    if (normalizedValue === normalizedSearch) return 1
    if (normalizedValue.startsWith(normalizedSearch)) return 0.8
    if (normalizedValue.includes(normalizedSearch)) return 0.6
    return 0
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filteredItems.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((prev) => (prev + 1) % filteredItems.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length)
          break
        case 'Enter':
          if (activeIndex >= 0) {
            e.preventDefault()
            document.getElementById(filteredItems[activeIndex])?.click()
          }
          break
      }
    },
    [filteredItems, activeIndex]
  )

  const contextValue = useMemo(
    () => ({
      searchQuery,
      setSearchQuery: setInternalSearchQuery,
      activeIndex,
      setActiveIndex,
      filteredItems,
      registerItem,
      unregisterItem,
      selectItem,
    }),
    [searchQuery, activeIndex, filteredItems, registerItem, unregisterItem, selectItem]
  )

  return (
    <CommandContext.Provider value={contextValue}>
      <div className={cn('flex w-full flex-col', className)} onKeyDown={handleKeyDown}>
        {children}
      </div>
    </CommandContext.Provider>
  )
}

export function CommandList({ children, className }: CommandListProps) {
  return <div className={cn(className)}>{children}</div>
}

export function CommandEmpty({ children, className }: CommandEmptyProps) {
  const { filteredItems } = useCommandContext()

  if (filteredItems.length > 0) return null

  return (
    <div className={cn('px-[6px] py-[8px] text-[12px] text-[var(--white)]/60', className)}>
      {children}
    </div>
  )
}

export function CommandItem({
  children,
  className,
  value,
  onSelect,
  disabled = false,
}: CommandItemProps) {
  const { activeIndex, filteredItems, registerItem, unregisterItem } = useCommandContext()
  const isActive = filteredItems.indexOf(value) === activeIndex
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    if (value) {
      registerItem(value)
      return () => unregisterItem(value)
    }
  }, [value, registerItem, unregisterItem])

  const shouldDisplay = filteredItems.includes(value)

  if (!shouldDisplay) return null

  return (
    <button
      id={value}
      className={cn(
        'flex h-[25px] w-full cursor-pointer select-none items-center gap-[8px] rounded-[6px] px-[6px] font-base text-[12px] text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[disabled=true]:pointer-events-none data-[selected=true]:bg-[var(--surface-9)] data-[selected=true]:text-[var(--text-primary)] data-[disabled=true]:opacity-50',
        (isActive || isHovered) && 'bg-[var(--surface-9)] text-[var(--text-primary)]',
        className
      )}
      onClick={() => !disabled && onSelect?.()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-selected={isActive || isHovered}
      data-disabled={disabled}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function CommandSeparator({ className }: CommandSeparatorProps) {
  return <div className={cn('-mx-1 h-px bg-border', className)} />
}

export const ToolCommand = {
  Root: Command,
  List: CommandList,
  Empty: CommandEmpty,
  Item: CommandItem,
  Separator: CommandSeparator,
}
