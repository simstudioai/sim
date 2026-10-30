'use client'

import {
  Children,
  type ComponentPropsWithoutRef,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { cn } from '@/components/docs/classnames'

interface TabContextValue {
  baseId: string
  value: string
  select: (value: string) => void
  panelIds: Map<string, string>
}

const TabContext = createContext<TabContextValue | null>(null)

interface TabsProps extends Omit<ComponentPropsWithoutRef<typeof RadixTabs.Root>, 'defaultValue'> {
  items?: string[]
  defaultValue?: string
  defaultIndex?: number
  updateAnchor?: boolean
  groupId?: string
  persist?: boolean
}

interface TabProps extends Omit<ComponentPropsWithoutRef<typeof RadixTabs.Content>, 'value'> {
  value?: string
}

/** Accessible provider tabs retain every panel in HTML for search and deep links. */
export function Tabs({
  children,
  items,
  defaultValue,
  defaultIndex = 0,
  updateAnchor = false,
  groupId,
  persist = false,
  value: controlledValue,
  onValueChange,
  className,
  'aria-label': label,
  ...props
}: TabsProps) {
  const baseId = useId()
  const root = useRef<HTMLDivElement>(null)
  const panelIds = new Map<string, string>()
  let index = 0
  const panels = Children.map(children, (child) => {
    if (!isValidElement<TabProps>(child)) return child
    const panel = items || child.props.value !== undefined || child.type === Tab
    if (!panel) return child
    const value = child.props.value ?? items?.[index] ?? String(index)
    index++
    panelIds.set(value, child.props.id ?? `${baseId}-${value}`)
    return cloneElement(child, { value })
  })
  const first = defaultValue ?? items?.[defaultIndex] ?? panelIds.keys().next().value ?? ''
  const [selected, setSelected] = useState(first)
  const value = controlledValue ?? selected
  const reveal = useEffectEvent((next: string) => {
    if (!panelIds.has(next)) return
    setSelected(next)
    onValueChange?.(next)
  })

  function select(next: string) {
    setSelected(next)
    onValueChange?.(next)
    if (updateAnchor)
      window.history.replaceState(null, '', `#${encodeURIComponent(panelIds.get(next) ?? next)}`)
    if (persist && groupId) {
      try {
        localStorage.setItem(`docs-tab:${groupId}`, next)
      } catch {}
    }
  }

  useEffect(() => {
    const element = root.current
    if (!element) return
    function revealPanel(target: HTMLElement) {
      let panel = target.closest<HTMLElement>('[data-docs-tab-value]')
      while (panel && element?.contains(panel)) {
        if (panel.closest('[data-docs-tabs-root]') === element) {
          const next = panel.dataset.docsTabValue
          if (next !== undefined) reveal(next)
          return
        }
        panel = panel.parentElement?.closest<HTMLElement>('[data-docs-tab-value]') ?? null
      }
    }
    function revealTarget() {
      let target: HTMLElement | null = null
      try {
        target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
      } catch {
        return
      }
      if (!target || !element?.contains(target)) return
      revealPanel(target)
    }
    function revealMatch(event: Event) {
      if (!(event.target instanceof HTMLElement)) return
      revealPanel(event.target)
    }
    if (persist && groupId) {
      try {
        const saved = localStorage.getItem(`docs-tab:${groupId}`)
        if (saved && element.querySelector(`[data-docs-tab-value="${CSS.escape(saved)}"]`))
          reveal(saved)
      } catch {}
    }
    revealTarget()
    window.addEventListener('hashchange', revealTarget)
    element.addEventListener('beforematch', revealMatch)
    return () => {
      window.removeEventListener('hashchange', revealTarget)
      element.removeEventListener('beforematch', revealMatch)
    }
  }, [groupId, persist])

  return (
    <TabContext.Provider value={{ baseId, value, select, panelIds }}>
      <RadixTabs.Root
        ref={root}
        value={value}
        onValueChange={select}
        aria-label={label}
        className={cn('not-prose my-6 min-w-0', className)}
        {...props}
        data-docs-tabs-root=''
      >
        {items && (
          <TabsList aria-label={label}>
            {items.map((item) => (
              <TabsTrigger key={item} value={item}>
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {panels}
      </RadixTabs.Root>
    </TabContext.Provider>
  )
}

interface TabsListProps extends ComponentPropsWithoutRef<typeof RadixTabs.List> {}

export function TabsList({ className, children, ...props }: TabsListProps) {
  return (
    <div className='-m-1 min-w-0 max-w-full overflow-x-auto p-1 [scrollbar-width:thin]'>
      <RadixTabs.List
        className={cn(
          'inline-flex min-h-7 w-max items-center gap-px rounded-full bg-[var(--docs-surface)]',
          className
        )}
        {...props}
      >
        {children}
      </RadixTabs.List>
    </div>
  )
}

interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof RadixTabs.Trigger> {}

export function TabsTrigger({
  className,
  value,
  id,
  'aria-controls': controls,
  ...props
}: TabsTriggerProps) {
  const context = useContext(TabContext)
  return (
    <RadixTabs.Trigger
      {...props}
      value={value}
      id={id ?? `${context?.baseId}-${value}-trigger`}
      aria-controls={controls ?? context?.panelIds.get(value) ?? `${context?.baseId}-${value}`}
      className={cn(
        'pointer-coarse:before:-inset-y-2 relative inline-flex min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-transparent px-3 text-[var(--docs-segment-text)] text-docs-control leading-4 transition-colors pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 hover:bg-[var(--docs-hover)] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 disabled:opacity-40 data-[state=active]:border-[var(--docs-segment-border)] data-[state=active]:bg-[var(--docs-segment-fill)] data-[state=active]:text-[var(--docs-text)] data-[state=active]:shadow-[var(--docs-segment-shadow)] motion-reduce:transition-none dark:disabled:text-[var(--docs-disabled)] dark:disabled:opacity-100',
        className
      )}
    />
  )
}

export function Tab({
  value = '',
  id,
  className,
  children,
  'aria-labelledby': labelledBy,
  ...props
}: TabProps) {
  const context = useContext(TabContext)
  const active = context?.value === value
  return (
    <RadixTabs.Content
      {...props}
      forceMount
      value={value}
      id={id ?? context?.panelIds.get(value) ?? `${context?.baseId}-${value}`}
      aria-labelledby={labelledBy ?? `${context?.baseId}-${value}-trigger`}
      hidden={!active}
      ref={(node) => {
        if (!active) node?.setAttribute('hidden', 'until-found')
      }}
      data-docs-tab-panel=''
      data-docs-tab-value={value}
      className={cn(
        'min-w-0 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2',
        className
      )}
    >
      <div className='pt-4 [&>:first-child]:mt-0 [&>:last-child]:mb-0'>{children}</div>
    </RadixTabs.Content>
  )
}
