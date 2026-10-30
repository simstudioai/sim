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
const GROUP_CHANGE_EVENT = 'docs-tab-group-change'

interface TabsProps extends Omit<ComponentPropsWithoutRef<typeof RadixTabs.Root>, 'defaultValue'> {
  items?: string[]
  defaultValue?: string
  defaultIndex?: number
  updateAnchor?: boolean
  groupId?: string
  groupValues?: Record<string, string>
  persist?: boolean
}

interface TabProps extends Omit<ComponentPropsWithoutRef<typeof RadixTabs.Content>, 'value'> {
  value?: string
  label?: string
}

/** Accessible provider tabs retain every panel in HTML for search and deep links. */
export function Tabs({
  children,
  items,
  defaultValue,
  defaultIndex = 0,
  updateAnchor = false,
  groupId,
  groupValues,
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
  const groupOptions = JSON.stringify(
    [...panelIds.keys()].map((option) => [option, groupValues?.[option] ?? option])
  )
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
    if (groupId) {
      const preference = groupValues?.[next] ?? next
      try {
        sessionStorage.setItem(`docs-tab:${groupId}`, preference)
        if (persist) localStorage.setItem(`docs-tab:${groupId}`, preference)
      } catch {}
      window.dispatchEvent(
        new CustomEvent(GROUP_CHANGE_EVENT, { detail: { groupId, value: preference } })
      )
    }
  }

  const restorePreference = useEffectEvent((preference: string) => {
    const available = [...panelIds.keys()].find(
      (candidate) => (groupValues?.[candidate] ?? candidate) === preference
    )
    if (available !== undefined) reveal(available)
  })

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
    function groupChanged(event: Event) {
      const detail = (event as CustomEvent<{ groupId: string; value: string }>).detail
      if (detail?.groupId === groupId) restorePreference(detail.value)
    }
    if (groupId) {
      try {
        const saved =
          sessionStorage.getItem(`docs-tab:${groupId}`) ??
          (persist ? localStorage.getItem(`docs-tab:${groupId}`) : null)
        if (saved) restorePreference(saved)
      } catch {}
      window.addEventListener(GROUP_CHANGE_EVENT, groupChanged)
    }
    revealTarget()
    window.addEventListener('hashchange', revealTarget)
    element.addEventListener('beforematch', revealMatch)
    return () => {
      window.removeEventListener('hashchange', revealTarget)
      element.removeEventListener('beforematch', revealMatch)
      window.removeEventListener(GROUP_CHANGE_EVENT, groupChanged)
    }
  }, [groupId, persist, groupOptions])

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
        <noscript>
          <style>{`
            @layer base {
              .docs-root [data-docs-tab-panel][hidden] { display: block !important; }
            }
            .docs-root [data-docs-tabs-root] [role="tablist"],
            .docs-root [data-docs-tabs-root] select,
            .docs-root [data-docs-tabs-root] button { display: none; }
          `}</style>
        </noscript>
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

interface TabsSelectProps extends ComponentPropsWithoutRef<'select'> {}

export function TabsSelect({ onChange, ...props }: TabsSelectProps) {
  const context = useContext(TabContext)
  if (!context) throw new Error('TabsSelect must be inside Tabs')
  return (
    <select
      {...props}
      value={context.value}
      onChange={(event) => {
        context.select(event.target.value)
        onChange?.(event)
      }}
    />
  )
}

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
  label,
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
      <noscript>
        <p className='px-3 pt-4 font-medium text-docs-caption'>{label ?? value}</p>
      </noscript>
      <div className='pt-4 [&>:first-child]:mt-0 [&>:last-child]:mb-0'>{children}</div>
    </RadixTabs.Content>
  )
}
