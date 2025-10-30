import type React from 'react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Search } from 'lucide-react'
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
}

interface CommandInputProps {
  placeholder?: string
  className?: string
  onValueChange?: (value: string) => void
}

interface CommandListProps {
  children: ReactNode
  className?: string
}

interface CommandEmptyProps {
  children: ReactNode
  className?: string
}

interface CommandGroupProps {
  children: ReactNode
  className?: string
  heading?: string
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

export function Command({ children, className, filter }: CommandProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [items, setItems] = useState<string[]>([])
  const [filteredItems, setFilteredItems] = useState<string[]>([])

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
      setSearchQuery,
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
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5',
          className
        )}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </CommandContext.Provider>
  )
}

export function CommandInput({
  placeholder = 'Search...',
  className,
  onValueChange,
}: CommandInputProps) {
  const { searchQuery, setSearchQuery } = useCommandContext()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    onValueChange?.(value)
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className='flex items-center border-b px-3'>
      <Search className='mr-2 h-4 w-4 shrink-0 opacity-50' />
      <input
        ref={inputRef}
        className={cn(
          'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        placeholder={placeholder}
        value={searchQuery}
        onChange={handleChange}
      />
    </div>
  )
}

export function CommandList({ children, className }: CommandListProps) {
  return (
    <div className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}>
      {children}
    </div>
  )
}

export function CommandEmpty({ children, className }: CommandEmptyProps) {
  const { filteredItems } = useCommandContext()

  if (filteredItems.length > 0) return null

  return (
    <div className={cn('pt-3.5 pb-2 text-center text-muted-foreground text-sm', className)}>
      {children}
    </div>
  )
}

export function CommandGroup({ children, className, heading }: CommandGroupProps) {
  return (
    <div
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs',
        className
      )}
    >
      {heading && (
        <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>{heading}</div>
      )}
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
        'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50',
        isActive && 'bg-accent text-accent-foreground',
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
  Input: CommandInput,
  List: CommandList,
  Empty: CommandEmpty,
  Group: CommandGroup,
  Item: CommandItem,
  Separator: CommandSeparator,
}
