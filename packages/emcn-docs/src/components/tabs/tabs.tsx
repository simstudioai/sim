'use client'

import {
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  createContext,
  type HTMLAttributes,
  isValidElement,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'
import { Menu } from '@base-ui/react/menu'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import {
  docsControlClass,
  docsMenuClass,
  docsMenuItemClass,
  docsScrollAreaClass,
} from '#docs/components/chrome/chrome'
import styles from '#docs/components/tabs/tabs.module.css'

interface TabContextValue {
  baseId: string
  value: string
  select: (value: string) => void
  panelIds: Map<string, string>
}

const TabContext = createContext<TabContextValue | null>(null)
const GROUP_CHANGE_EVENT = 'docs-tab-group-change'

interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  items?: string[]
  defaultValue?: string
  defaultIndex?: number
  updateAnchor?: boolean
  groupId?: string
  groupValues?: Record<string, string>
  persist?: boolean
}

interface TabProps extends HTMLAttributes<HTMLDivElement> {
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
    panelIds.set(value, child.props.id ?? `${baseId}-${encodeURIComponent(value)}`)
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
        new CustomEvent(GROUP_CHANGE_EVENT, {
          detail: { groupId, value: preference, sourceId: baseId },
        })
      )
    }
  }

  const restorePreference = useEffectEvent((preference: string) => {
    if ((groupValues?.[value] ?? value) === preference) return
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
      const detail = (event as CustomEvent<{ groupId: string; value: string; sourceId: string }>)
        .detail
      if (detail?.groupId === groupId && detail.sourceId !== baseId) restorePreference(detail.value)
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
  }, [baseId, groupId, persist, groupOptions])

  return (
    <TabContext.Provider value={{ baseId, value, select, panelIds }}>
      <BaseTabs.Root
        ref={root}
        value={value}
        onValueChange={(next) => {
          if (typeof next === 'string') select(next)
        }}
        aria-label={label}
        className={cn('not-prose', styles.root, className)}
        {...props}
        data-docs-tabs-root=''
      >
        <noscript>
          <style>{`
            @layer base {
              .docs-root [data-docs-tab-panel][hidden] { display: block !important; }
            }
            .docs-root [data-docs-tabs-root] [role="tablist"],
            .docs-root [data-docs-tabs-select] { display: none; }
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
      </BaseTabs.Root>
    </TabContext.Provider>
  )
}

interface TabsListProps extends HTMLAttributes<HTMLDivElement> {}

interface TabsSelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  items: { value: string; label: string }[]
  label: string
}

export function TabsSelect({ items, label, className, ...props }: TabsSelectProps) {
  const scrollRef = useScrollEdges()
  const context = useContext(TabContext)
  if (!context) throw new Error('TabsSelect must be inside Tabs')
  const selected = items.find((item) => item.value === context.value)
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        {...props}
        data-docs-tabs-select=''
        aria-label={`${label}: ${selected?.label ?? ''}`}
        className={cn(docsControlClass, styles.select, className)}
      >
        <span className='truncate'>{selected?.label}</span>
        <Icon name='I051' className='size-4 shrink-0 text-[var(--docs-muted)]' aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align='start'
          sideOffset={6}
          collisionPadding={12}
          className={styles.positioner}
        >
          <Menu.Popup
            ref={scrollRef}
            data-emcn=''
            className={cn('docs-portal', docsMenuClass, docsScrollAreaClass, styles.popup)}
          >
            <Menu.RadioGroup value={context.value} onValueChange={context.select}>
              {items.map((item) => (
                <Menu.RadioItem
                  key={item.value}
                  value={item.value}
                  closeOnClick
                  className={docsMenuItemClass}
                >
                  <span className='size-4 shrink-0'>
                    <Menu.RadioItemIndicator>
                      <Icon name='I072' className='size-4' aria-hidden />
                    </Menu.RadioItemIndicator>
                  </span>
                  <span className='min-w-0 break-words'>{item.label}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function TabsList({ className, children, ...props }: TabsListProps) {
  const scrollRef = useScrollEdges('horizontal')
  return (
    <div ref={scrollRef} className={cn(docsScrollAreaClass, styles.listViewport)}>
      <BaseTabs.List activateOnFocus className={cn(styles.list, className)} {...props}>
        {children}
      </BaseTabs.List>
    </div>
  )
}

interface TabsTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string
}

export function TabsTrigger({
  className,
  value,
  id,
  'aria-controls': controls,
  ...props
}: TabsTriggerProps) {
  const context = useContext(TabContext)
  return (
    <BaseTabs.Tab
      {...props}
      value={value}
      id={id ?? `${context?.baseId}-${encodeURIComponent(value)}-trigger`}
      aria-controls={
        controls ??
        context?.panelIds.get(value) ??
        `${context?.baseId}-${encodeURIComponent(value)}`
      }
      className={cn(styles.trigger, className)}
    />
  )
}

export function Tab({
  value = '',
  label,
  id,
  className,
  children,
  tabIndex = 0,
  'aria-labelledby': labelledBy,
  ...props
}: TabProps) {
  const context = useContext(TabContext)
  const active = context?.value === value
  return (
    <BaseTabs.Panel
      {...props}
      keepMounted
      inert={false}
      tabIndex={active ? tabIndex : -1}
      value={value}
      id={id ?? context?.panelIds.get(value) ?? `${context?.baseId}-${encodeURIComponent(value)}`}
      aria-labelledby={labelledBy ?? `${context?.baseId}-${encodeURIComponent(value)}-trigger`}
      hidden={!active}
      ref={(element) => {
        if (!active) element?.setAttribute('hidden', 'until-found')
      }}
      data-docs-tab-panel=''
      data-docs-tab-value={value}
      className={cn(styles.panel, className)}
    >
      <noscript>
        <p className='px-3 pt-4 font-medium text-docs-caption'>{label ?? value}</p>
      </noscript>
      <div className={styles.content}>{children}</div>
    </BaseTabs.Panel>
  )
}
