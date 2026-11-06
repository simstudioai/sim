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
import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import { Toolbar } from '@base-ui/react/toolbar'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Button, IconButton } from '@/platform/design-system/components/button/button'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'
import { Icon } from '@/platform/design-system/components/icon/icon'
import styles from '@/platform/design-system/components/menu/menu.module.css'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { MenuSearchField } from '@/platform/design-system/components/search-field/menu-search-field'

interface InlineSelection {
  layout?: 'browser' | 'visibility'
  value?: string
  select: (value: string) => void
}
const InlineMenu = createContext<InlineSelection | null>(null)
const BrowserRows = createContext(false)
const SearchableMenu = createContext(false)
const FloatingMenu = createContext<RefObject<HTMLDivElement | null> | null>(null)

export type MenuAction = {
  id: string
  label: string
  icon?: IconName
  headingBefore?: string
  detail?: string
  separatorBefore?: boolean
} & (
  | { children: readonly [MenuAction, ...MenuAction[]]; onSelect?: never; trailingIcon?: never }
  | {
      children?: never
      onSelect?: () => void
      trailingIcon?: IconName
      checked?: boolean
      disabled?: boolean
      destructive?: boolean
      shortcut?: string
    }
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
  /** A row or toolbar trigger's glyph. `null` draws the label as a text button instead. */
  icon: IconName | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'end'
  heading?: string
  search?: { label: string; value: string; onValueChange: (value: string) => void }
  triggerSize?: 'small' | 'row' | 'compact'
  tooltip?: boolean
  children?: never
  defaultValue?: never
}

export function ActionMenu(props: ActionMenuProps | TriggeredMenuProps) {
  if (props.actions)
    return (
      <TriggeredMenu
        label={props.label}
        actions={props.actions}
        icon={props.icon}
        open={props.open}
        onOpenChange={props.onOpenChange}
        align={props.align}
        heading={props.heading}
        search={props.search}
        triggerSize={props.triggerSize}
        tooltip={props.tooltip}
      />
    )
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
      {action.headingBefore && (
        <div className={popup.heading} role='presentation' data-type='T052'>
          {action.headingBefore}
        </div>
      )}
      {action.children ? (
        <SubmenuItem label={action.label} icon={action.icon} detail={action.detail}>
          {actionRows(action.children)}
        </SubmenuItem>
      ) : (
        <MenuItem
          label={action.label}
          icon={action.icon}
          trailingIcon={action.trailingIcon}
          detail={action.detail}
          checked={action.checked}
          disabled={action.disabled}
          destructive={action.destructive}
          shortcut={action.shortcut}
          onSelect={action.onSelect}
        />
      )}
    </Fragment>
  ))
}

function TriggeredMenu({
  label,
  actions,
  icon,
  open,
  onOpenChange,
  align,
  heading,
  search,
  triggerSize = 'small',
  tooltip = true,
}: TriggeredMenuProps) {
  const { trigger, container, opener } = usePopoverContainer()
  const menu = (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'item-press') opener.current?.focus({ preventScroll: true })
        onOpenChange?.(next)
      }}
    >
      {icon ? (
        <IconButton
          tooltip={tooltip}
          render={<Menu.Trigger ref={trigger} />}
          size={triggerSize}
          label={label}
          icon={icon}
          disabled={!actions.length && !search}
        />
      ) : (
        <Button
          render={<Menu.Trigger ref={trigger} />}
          variant='quiet'
          disabled={!actions.length && !search}
        >
          {label}
        </Button>
      )}
      <ActionMenuPopup
        label={label}
        container={container}
        align={align}
        searchLabel={search?.label}
      >
        {heading && (
          <div className={popup.heading} data-type='T052'>
            {heading}
          </div>
        )}
        {actionRows(actions)}
      </ActionMenuPopup>
    </Menu.Root>
  )
  if (!search) return menu
  return (
    <SearchableMenu.Provider value>
      <Menu.FilterProvider
        filter={null}
        autoHighlight
        value={search.value}
        onValueChange={search.onValueChange}
      >
        {menu}
      </Menu.FilterProvider>
    </SearchableMenu.Provider>
  )
}

interface ContextActionMenuProps {
  label: string
  actions: readonly MenuAction[]
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/** The same rows as `ActionMenu`, opened at the pointer by a secondary click on `children`. */
export function ContextActionMenu({
  label,
  actions,
  onOpenChange,
  children,
}: ContextActionMenuProps) {
  const { trigger, container } = usePopoverContainer()
  return (
    <ContextMenu.Root onOpenChange={(open) => onOpenChange?.(open)}>
      <ContextMenu.Trigger ref={trigger} className={styles.contextTrigger}>
        {children}
      </ContextMenu.Trigger>
      <ActionMenuPopup label={label} container={container}>
        {actionRows(actions)}
      </ActionMenuPopup>
    </ContextMenu.Root>
  )
}

interface ActionMenuPopupProps {
  label: string
  container: HTMLElement | null
  submenu?: boolean
  browser?: boolean
  searchLabel?: string
  align?: 'start' | 'end'
  children: ReactNode
}

/** Base UI measures the submenu from its item; Paper measures the gap between panel borders. */
function panelSpacing(panel: HTMLDivElement | null | undefined) {
  if (!panel) return { gap: 4, edge: 0 }
  const style = getComputedStyle(panel)
  const gap = Number.parseFloat(style.paddingInlineStart)
  return {
    gap: panel.dataset.menu === 'browser' ? gap * 2 : gap,
    edge: gap + Number.parseFloat(style.borderInlineStartWidth),
  }
}

export function ActionMenuPopup({
  label,
  container,
  submenu,
  browser,
  searchLabel,
  align = 'start',
  children,
}: ActionMenuPopupProps) {
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const searchEdges = useScrollEdges<HTMLInputElement>('horizontal')
  const searchable = useContext(SearchableMenu)
  const parent = useContext(FloatingMenu)
  const browserRows = useContext(BrowserRows) || Boolean(browser)
  const panel = useRef<HTMLDivElement>(null)
  if (!container) return null
  return (
    <FloatingMenu.Provider value={panel}>
      <Menu.Portal container={container}>
        <Menu.Positioner
          className={popup.positioner}
          side={submenu ? 'inline-end' : searchable ? 'top' : 'bottom'}
          align={align}
          sideOffset={
            submenu
              ? () => {
                  const { gap, edge } = panelSpacing(parent?.current)
                  return edge + gap
                }
              : browserRows
                ? 8
                : 4
          }
          alignOffset={submenu ? () => -panelSpacing(parent?.current).edge : 0}
          collisionPadding={8}
        >
          <Menu.Popup
            ref={panel}
            data-menu={browserRows ? (submenu ? 'zoom' : 'browser') : undefined}
            data-searchable={searchable || undefined}
            aria-label={searchLabel ? label : undefined}
            className={styles.menu}
            data-material='floating'
            data-elevation='menu'
          >
            <BrowserRows.Provider value={browserRows}>
              {searchLabel && (
                <>
                  <MenuSearchField
                    input={
                      <Menu.Input
                        ref={searchEdges}
                        aria-label={searchLabel}
                        placeholder={searchLabel}
                      />
                    }
                  />
                  <Menu.Empty className={popup.heading} data-type='T052'>
                    No matches
                  </Menu.Empty>
                </>
              )}
              <Menu.List ref={scrollEdges} className={popup.list} aria-label={label}>
                {children}
              </Menu.List>
            </BrowserRows.Provider>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </FloatingMenu.Provider>
  )
}

interface SubmenuItemProps {
  detail?: string
  label: string
  icon?: IconName
  children: ReactNode
}

function SubmenuItem({ label, icon, children, detail }: SubmenuItemProps) {
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
        {detail && (
          <span className={styles.hint} data-type='T052'>
            {detail}
          </span>
        )}
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
  destructive?: boolean
  label: string
  icon?: IconName
  shortcut?: string
  detail?: string
  trailingIcon?: IconName
  checked?: boolean
  disabled?: boolean
  value?: string
  selected?: boolean
  onSelect?: () => void
}

export function MenuItem({
  label,
  icon,
  shortcut,
  destructive,
  detail,
  trailingIcon,
  value,
  selected,
  checked,
  disabled,
  onSelect,
}: MenuItemProps) {
  const inline = useContext(InlineMenu)
  const floating = useContext(FloatingMenu)
  const choice = value !== undefined || selected !== undefined
  const active =
    checked ?? (inline?.value === undefined ? selected : inline.value === (value ?? label))
  const type = 'T060'
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
          disabled={disabled}
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
      <Menu.Item
        data-destructive-quiet={destructive || undefined}
        disabled={disabled}
        className={styles.menuItem}
        label={label}
        data-type={type}
        onClick={onSelect}
      >
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
        data-menu-row=''
        data-destructive-quiet={destructive || undefined}
        disabled={disabled}
        aria-pressed={checked !== undefined || choice ? Boolean(active) : undefined}
        data-type={type}
        onClick={choose}
      >
        {row}
      </button>
    )
  return (
    <Toolbar.Button
      data-destructive-quiet={destructive || undefined}
      disabled={disabled}
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

type BrowserAction = 'find' | 'zoom' | 'downloads'

interface BrowserActionsMenuProps {
  address?: string
  zoomPercent?: number
  onZoom?: (percent: number) => void
  onAction?: (action: BrowserAction) => void
}

export function BrowserActionsMenu({
  address,
  zoomPercent = 100,
  onAction,
  onZoom,
}: BrowserActionsMenuProps) {
  const { copied, copy } = useClipboard()
  const { trigger, container } = usePopoverContainer()
  const rows = (
    <>
      <MenuItem
        icon={copied ? 'I072' : 'I006'}
        label={copied ? 'Copied' : 'Copy link'}
        disabled={!address}
        onSelect={() => address && void copy(address)}
      />
      <MenuItem icon='I037' label='Open in default browser' disabled />
      <MenuItem
        icon='I089'
        label='Find on page'
        shortcut='⌘F'
        onSelect={() => onAction?.('find')}
      />
      {onZoom ? (
        <SubmenuItem label='Zoom' icon='I089' detail={`${zoomPercent}%`}>
          <Menu.RadioGroup
            value={String(zoomPercent)}
            onValueChange={(value) => onZoom(Number(value))}
          >
            {[75, 100, 125, 150, 200].map((percent) => (
              <MenuItem key={percent} value={String(percent)} label={`${percent}%`} />
            ))}
          </Menu.RadioGroup>
        </SubmenuItem>
      ) : (
        <MenuItem
          icon='I089'
          label='Zoom'
          detail={`${zoomPercent}%`}
          trailingIcon='I032'
          onSelect={() => onAction?.('zoom')}
        />
      )}
      <hr className={styles.separator} />
      <MenuItem icon='I049' label='Downloads' onSelect={() => onAction?.('downloads')} />
    </>
  )
  if (!onZoom)
    return (
      <MenuSurface label='Browser actions' layout='browser'>
        {rows}
      </MenuSurface>
    )
  return (
    <Menu.Root modal={false}>
      <IconButton
        tooltip
        render={<Menu.Trigger ref={trigger} />}
        label='Browser actions'
        icon='I108'
      />
      <ActionMenuPopup label='Browser actions' container={container} align='end' browser>
        {rows}
      </ActionMenuPopup>
    </Menu.Root>
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
      <div className={popup.heading} data-type='T052'>
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
