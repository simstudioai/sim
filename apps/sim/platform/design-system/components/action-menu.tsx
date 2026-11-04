'use client'

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/choices.module.css'
import { Icon } from '@/platform/design-system/components/icon'

interface MenuSelection {
  value?: string
  select: (value: string) => void
}
const MenuContext = createContext<MenuSelection | null>(null)

function items(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')).filter(
    (item) => item.closest('[role="menu"]') === menu
  )
}

function activateItem(event: KeyboardEvent<HTMLDivElement>) {
  const rows = items(event.currentTarget)
  const index = rows.findIndex((item) => item === document.activeElement)
  const direction = ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key)
  let next: HTMLButtonElement | undefined
  if (direction >= 0) {
    const position = [index + 1, index - 1, 0, rows.length - 1][direction]
    next = rows[(position + rows.length) % rows.length]
  } else if (!event.altKey && !event.ctrlKey && !event.metaKey && /^\S$/.test(event.key)) {
    next = [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((item) =>
      item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase())
    )
  }
  if (!next) return
  event.preventDefault()
  next.focus()
}

interface ActionMenuProps {
  label: string
  defaultValue?: string
  children: ReactNode
}

export function ActionMenu({ label, defaultValue, children }: ActionMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const [value, select] = useState(defaultValue)
  useEffect(() => {
    if (!root.current) return
    const rows = items(root.current)
    if (rows.length && !rows.some((row) => row.tabIndex === 0)) {
      const first = rows.find((row) => row.getAttribute('aria-checked') === 'true') ?? rows[0]
      first.tabIndex = 0
    }
  }, [children])
  return (
    <MenuContext.Provider value={{ value, select }}>
      <div
        ref={root}
        className={styles.menu}
        role='menu'
        data-material='floating'
        data-elevation='menu'
        aria-label={label}
        onKeyDown={activateItem}
        onFocus={(event) => {
          for (const item of items(event.currentTarget))
            item.tabIndex = item === document.activeElement ? 0 : -1
        }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  )
}

interface MenuItemProps {
  label: string
  icon?: IconName
  shortcut?: string
  value?: string
  selected?: boolean
  onSelect?: () => void
}

export function MenuItem({ label, icon, shortcut, value, selected, onSelect }: MenuItemProps) {
  const menu = useContext(MenuContext)
  const choice = value !== undefined || selected !== undefined
  const checked = menu?.value !== undefined ? menu.value === (value ?? label) : selected === true
  return (
    <button
      type='button'
      className={styles.menuItem}
      data-type='T060'
      data-option={value !== undefined || undefined}
      role={menu ? (choice ? 'menuitemradio' : 'menuitem') : undefined}
      tabIndex={menu ? -1 : undefined}
      aria-checked={menu && choice ? checked : undefined}
      aria-pressed={!menu && choice ? checked : undefined}
      onClick={() => {
        if (choice) menu?.select(value ?? label)
        onSelect?.()
      }}
    >
      {icon && <Icon name={icon} />}
      <span className={styles.menuLabel}>{label}</span>
      {choice
        ? checked && <Icon name='I072' />
        : shortcut && (
            <kbd className={styles.hint} data-type='T001'>
              {shortcut}
            </kbd>
          )}
    </button>
  )
}
