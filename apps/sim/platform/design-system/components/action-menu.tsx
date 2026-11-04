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
  layout?: 'browser' | 'visibility'
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
  return (
    <MenuSurface label={label} defaultValue={defaultValue}>
      {children}
    </MenuSurface>
  )
}

interface MenuSurfaceProps extends ActionMenuProps {
  layout?: MenuSelection['layout']
}

function MenuSurface({ label, defaultValue, children, layout }: MenuSurfaceProps) {
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
    <MenuContext.Provider value={{ value, select, layout }}>
      <div
        ref={root}
        className={styles.menu}
        role='menu'
        data-menu={layout}
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
  detail?: string
  trailingIcon?: IconName
  checked?: boolean
  value?: string
  selected?: boolean
  onSelect?: () => void
}

export function MenuItem({
  label,
  icon,
  shortcut,
  detail,
  trailingIcon,
  value,
  selected,
  checked,
  onSelect,
}: MenuItemProps) {
  const menu = useContext(MenuContext)
  const choice = value !== undefined || selected !== undefined
  const active =
    checked ?? (menu?.value !== undefined ? menu.value === (value ?? label) : selected === true)
  return (
    <button
      type='button'
      className={styles.menuItem}
      data-type={menu?.layout === 'browser' ? 'T067' : 'T060'}
      data-option={value !== undefined || undefined}
      role={
        menu
          ? checked !== undefined
            ? 'menuitemcheckbox'
            : choice
              ? 'menuitemradio'
              : 'menuitem'
          : undefined
      }
      tabIndex={menu ? -1 : undefined}
      aria-checked={menu && (choice || checked !== undefined) ? active : undefined}
      aria-pressed={!menu && (choice || checked !== undefined) ? active : undefined}
      onClick={() => {
        if (choice) menu?.select(value ?? label)
        onSelect?.()
      }}
    >
      {icon && <Icon name={icon} />}
      <span className={styles.menuLabel}>{label}</span>
      {choice || checked !== undefined
        ? active && <Icon name='I072' />
        : shortcut && (
            <kbd className={styles.hint} data-type={menu?.layout === 'browser' ? 'T052' : 'T001'}>
              {shortcut}
            </kbd>
          )}
      {detail && (
        <span className={styles.hint} data-type='T052'>
          {detail}
        </span>
      )}
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  )
}

type BrowserAction = 'copy' | 'open' | 'find' | 'zoom' | 'downloads'

interface BrowserActionsMenuProps {
  zoomPercent?: number
  onAction?: (action: BrowserAction) => void
}

export function BrowserActionsMenu({ zoomPercent = 100, onAction }: BrowserActionsMenuProps) {
  return (
    <MenuSurface label='Browser actions' layout='browser'>
      <MenuItem icon='I006' label='Copy link' onSelect={() => onAction?.('copy')} />
      <MenuItem icon='I037' label='Open in default browser' onSelect={() => onAction?.('open')} />
      <MenuItem
        icon='I089'
        label='Find on page'
        shortcut='⌘F'
        onSelect={() => onAction?.('find')}
      />
      <MenuItem
        icon='I089'
        label='Zoom'
        detail={`${zoomPercent}%`}
        trailingIcon='I032'
        onSelect={() => onAction?.('zoom')}
      />
      <hr className={styles.separator} />
      <MenuItem icon='I049' label='Downloads' onSelect={() => onAction?.('downloads')} />
    </MenuSurface>
  )
}

interface VisibilityMenuProps {
  label: string
  options: readonly { id: string; label: string; visible: boolean }[]
  onChange?: (id: string, visible: boolean) => void
}

export function VisibilityMenu({ label, options, onChange }: VisibilityMenuProps) {
  const [choices, setChoices] = useState<Readonly<Record<string, boolean>>>({})
  return (
    <MenuSurface label={label} layout='visibility'>
      <div className={styles.menuTitle} data-type='T052'>
        {label}
      </div>
      {options.map((option) => {
        const checked = choices[option.id] ?? option.visible
        return (
          <MenuItem
            key={option.id}
            label={option.label}
            checked={checked}
            onSelect={() => {
              setChoices((current) => ({ ...current, [option.id]: !checked }))
              onChange?.(option.id, !checked)
            }}
          />
        )
      })}
    </MenuSurface>
  )
}
