'use client'

import {
  createContext,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useRef,
  useState,
} from 'react'
import { Menu } from '@base-ui/react/menu'
import { Toolbar } from '@base-ui/react/toolbar'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/choices.module.css'
import controls from '@/platform/design-system/components/components.module.css'
import { Icon } from '@/platform/design-system/components/icon'
import popup from '@/platform/design-system/components/popup.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/use-popover-container'

interface InlineSelection {
  layout?: 'browser' | 'visibility'
  value?: string
  select: (value: string) => void
}
const InlineMenu = createContext<InlineSelection | null>(null)
const FloatingMenu = createContext<RefObject<HTMLDivElement | null> | null>(null)

type MenuAction = { id: string; label: string; icon?: IconName; separatorBefore?: boolean } & (
  | { children: readonly [MenuAction, ...MenuAction[]]; onSelect?: never; trailingIcon?: never }
  | { children?: never; onSelect?: () => void; trailingIcon?: IconName }
)

interface ActionMenuProps {
  label: string
  defaultValue?: string
  children: ReactNode
  actions?: never
}

interface TriggeredMenuProps {
  label: string
  actions: readonly MenuAction[]
  children?: never
  defaultValue?: never
}

export function ActionMenu(props: ActionMenuProps | TriggeredMenuProps) {
  if (props.actions) return <TriggeredMenu label={props.label} actions={props.actions} />
  return (
    <MenuSurface label={props.label} defaultValue={props.defaultValue}>
      {props.children}
    </MenuSurface>
  )
}

function actionRows(actions: readonly MenuAction[]): ReactNode {
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separatorBefore && <Menu.Separator className={styles.separator} />}
      {action.children ? (
        <SubmenuItem label={action.label} icon={action.icon}>
          {actionRows(action.children)}
        </SubmenuItem>
      ) : (
        <MenuItem
          label={action.label}
          icon={action.icon}
          trailingIcon={action.trailingIcon}
          onSelect={action.onSelect}
        />
      )}
    </Fragment>
  ))
}

function TriggeredMenu({ label, actions }: TriggeredMenuProps) {
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={trigger}
        disabled={!actions.length}
        className={controls.button}
        data-type='T060'
        data-variant='quiet'
        data-size='regular'
      >
        {label}
      </Menu.Trigger>
      <ActionMenuPopup label={label} container={container}>
        {actionRows(actions)}
      </ActionMenuPopup>
    </Menu.Root>
  )
}

interface ActionMenuPopupProps {
  label: string
  container: HTMLElement | null
  submenu?: boolean
  align?: 'start' | 'end'
  children: ReactNode
}

/** Base UI measures the submenu from its item; Paper measures the gap between panel borders. */
function panelSpacing(panel: HTMLDivElement | null | undefined) {
  if (!panel) return { gap: 4, edge: 0 }
  const style = getComputedStyle(panel)
  const gap = Number.parseFloat(style.paddingInlineStart)
  return { gap, edge: gap + Number.parseFloat(style.borderInlineStartWidth) }
}

export function ActionMenuPopup({
  label,
  container,
  submenu,
  align = 'start',
  children,
}: ActionMenuPopupProps) {
  const parent = useContext(FloatingMenu)
  const panel = useRef<HTMLDivElement>(null)
  if (!container) return null
  return (
    <FloatingMenu.Provider value={panel}>
      <Menu.Portal container={container}>
        <Menu.Positioner
          className={popup.positioner}
          side={submenu ? 'inline-end' : 'bottom'}
          align={align}
          sideOffset={
            submenu
              ? () => {
                  const { gap, edge } = panelSpacing(parent?.current)
                  return edge + gap
                }
              : 4
          }
          alignOffset={submenu ? () => -panelSpacing(parent?.current).edge : 0}
          collisionPadding={8}
        >
          <Menu.Popup
            ref={panel}
            className={styles.menu}
            data-material='floating'
            data-elevation='menu'
          >
            <Menu.List className={popup.list} aria-label={label}>
              {children}
            </Menu.List>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </FloatingMenu.Provider>
  )
}

interface SubmenuItemProps {
  label: string
  icon?: IconName
  children: ReactNode
}

function SubmenuItem({ label, icon, children }: SubmenuItemProps) {
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        ref={trigger}
        render={<button type='button' />}
        nativeButton
        className={styles.menuItem}
        label={label}
        data-type='T060'
      >
        {icon && <Icon name={icon} />}
        <span className={popup.label}>{label}</span>
        <span className={styles.trailing}>
          <Icon name='I032' />
        </span>
      </Menu.SubmenuTrigger>
      <ActionMenuPopup label={label} container={container} submenu>
        {children}
      </ActionMenuPopup>
    </Menu.SubmenuRoot>
  )
}

interface MenuSurfaceProps {
  label: string
  children: ReactNode
  defaultValue?: string
  layout?: InlineSelection['layout']
}

function MenuSurface({ label, children, defaultValue, layout }: MenuSurfaceProps) {
  const [value, select] = useState(defaultValue)
  const [navigating, setNavigating] = useState(false)
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key.startsWith('Arrow')) {
      setNavigating(true)
      return
    }
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]')
    )
    const index = rows.findIndex((row) => row === document.activeElement)
    const next =
      event.key === 'Home'
        ? rows[0]
        : event.key === 'End'
          ? rows.at(-1)
          : /^\S$/.test(event.key)
            ? [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((row) =>
                row.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase())
              )
            : undefined
    if (!next) return
    event.preventDefault()
    setNavigating(true)
    next.focus()
  }
  return (
    <InlineMenu.Provider value={{ value, select, layout }}>
      <Toolbar.Root
        orientation='vertical'
        role='menu'
        aria-label={label}
        className={styles.menu}
        data-menu={layout}
        data-navigating={navigating || undefined}
        data-material='floating'
        data-elevation='menu'
        onKeyDown={navigate}
        onPointerMove={() => setNavigating(false)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setNavigating(false)
        }}
      >
        {children}
      </Toolbar.Root>
    </InlineMenu.Provider>
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
  const inline = useContext(InlineMenu)
  const floating = useContext(FloatingMenu)
  const choice = value !== undefined || selected !== undefined
  const active =
    checked ?? (inline?.value === undefined ? selected : inline.value === (value ?? label))
  const type = inline?.layout === 'browser' ? 'T067' : 'T060'
  const content = (
    <>
      {icon && <Icon name={icon} />}
      <span className={popup.label}>{label}</span>
      {!(choice || checked !== undefined) && shortcut && (
        <kbd className={styles.hint} data-type={inline?.layout === 'browser' ? 'T052' : 'T001'}>
          {shortcut}
        </kbd>
      )}
      {detail && (
        <span className={styles.hint} data-type='T052'>
          {detail}
        </span>
      )}
      {(trailingIcon ||
        (icon && !inline?.layout && !choice && checked === undefined && !detail && !shortcut)) && (
        <span className={styles.trailing}>{trailingIcon && <Icon name={trailingIcon} />}</span>
      )}
    </>
  )
  if (floating) {
    if (checked !== undefined)
      return (
        <Menu.CheckboxItem
          checked={checked}
          onClick={onSelect}
          label={label}
          className={styles.menuItem}
          data-type={type}
        >
          {content}
          <Menu.CheckboxItemIndicator className={popup.indicator}>
            <Icon name='I072' />
          </Menu.CheckboxItemIndicator>
        </Menu.CheckboxItem>
      )
    if (choice)
      return (
        <Menu.RadioItem
          value={value ?? label}
          onClick={onSelect}
          closeOnClick
          label={label}
          className={styles.menuItem}
          data-option={value !== undefined || undefined}
          data-type={type}
        >
          {content}
          <Menu.RadioItemIndicator className={popup.indicator}>
            <Icon name='I072' />
          </Menu.RadioItemIndicator>
        </Menu.RadioItem>
      )
    return (
      <Menu.Item className={styles.menuItem} label={label} data-type={type} onClick={onSelect}>
        {content}
      </Menu.Item>
    )
  }
  function choose() {
    if (choice) inline?.select(value ?? label)
    onSelect?.()
  }
  const row = (
    <>
      {content}
      {active && <Icon name='I072' />}
    </>
  )
  if (!inline)
    return (
      <button
        type='button'
        className={styles.menuItem}
        aria-pressed={checked !== undefined || choice ? Boolean(active) : undefined}
        data-type={type}
        onClick={choose}
      >
        {row}
      </button>
    )
  return (
    <Toolbar.Button
      className={styles.menuItem}
      data-type={type}
      data-option={value !== undefined || undefined}
      role={checked !== undefined ? 'menuitemcheckbox' : choice ? 'menuitemradio' : 'menuitem'}
      aria-checked={choice || checked !== undefined ? Boolean(active) : undefined}
      onClick={choose}
    >
      {row}
    </Toolbar.Button>
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
