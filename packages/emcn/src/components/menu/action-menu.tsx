'use client'

import {
  createContext,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import { Toolbar } from '@base-ui/react/toolbar'
import Link from 'next/link'
import { Button, IconButton } from '#emcn/components/button/button'
import { useClipboard } from '#emcn/components/feedback/use-clipboard'
import type { IconName } from '#emcn/components/icon/icon'
import { Icon } from '#emcn/components/icon/icon'
import styles from '#emcn/components/menu/menu.module.css'
import popup from '#emcn/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { MenuSearchField } from '#emcn/components/search-field/menu-search-field'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

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
  | {
      children: readonly [MenuAction, ...MenuAction[]]
      /** Called as the submenu opens, so a caller can read what it lists on demand. */
      onOpen?: () => void
      onSelect?: never
      trailingIcon?: never
    }
  | {
      children?: never
      onSelect?: () => void
      /** A row that navigates, such as a collapsed breadcrumb, as a link rather than a command. */
      href?: string
      trailingIcon?: IconName
      checked?: boolean
      disabled?: boolean
      disabledReason?: string
      destructive?: boolean
      shortcut?: string
      /** Keeps the menu open after the row runs, for a row that adds to the list it sits in. */
      keepOpen?: boolean
    }
)

/** A function is called only once the menu opens, so a closed row builds none of its actions. */
type MenuActions = readonly MenuAction[] | (() => readonly MenuAction[])

interface ActionMenuProps {
  label: string
  defaultValue?: string
  children: ReactNode
  actions?: never
}

interface TriggeredMenuProps {
  label: string
  disabled?: boolean
  disabledReason?: string
  actions: MenuActions
  /** A row or toolbar trigger's glyph. Omitted or `null` draws the label as a text button instead. */
  icon?: IconName | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'end'
  heading?: string
  search?: { label: string; value: string; onValueChange: (value: string) => void }
  triggerSize?: 'small' | 'bar' | 'row' | 'compact'
  triggerVariant?: 'secondary' | 'quiet'
  tooltip?: boolean
  /** A short visible trigger, such as a count, which `label` then names for assistive technology. */
  triggerText?: string
  children?: never
  defaultValue?: never
}

export function ActionMenu(props: ActionMenuProps | TriggeredMenuProps) {
  if (props.actions)
    return (
      <TriggeredMenu
        label={props.label}
        disabled={props.disabled}
        disabledReason={props.disabledReason}
        actions={props.actions}
        icon={props.icon}
        open={props.open}
        onOpenChange={props.onOpenChange}
        align={props.align}
        heading={props.heading}
        search={props.search}
        triggerSize={props.triggerSize}
        triggerVariant={props.triggerVariant}
        tooltip={props.tooltip}
        triggerText={props.triggerText}
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
        <SubmenuItem
          label={action.label}
          icon={action.icon}
          detail={action.detail}
          onOpen={action.onOpen}
        >
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
          disabledReason={action.disabledReason}
          destructive={action.destructive}
          shortcut={action.shortcut}
          href={action.href}
          onSelect={action.onSelect}
          keepOpen={action.keepOpen}
        />
      )}
    </Fragment>
  ))
}

/** A boundary: the popup's portal renders it only while the menu is open. */
function MenuActionRows({ actions }: { actions: MenuActions }) {
  return actionRows(typeof actions === 'function' ? actions() : actions)
}

function TriggeredMenu({
  label,
  disabled,
  disabledReason,
  actions,
  icon,
  open,
  onOpenChange,
  align,
  heading,
  search,
  triggerSize = 'small',
  triggerVariant = 'quiet',
  tooltip = true,
  triggerText,
}: TriggeredMenuProps) {
  const { trigger, container, opener } = usePopoverContainer()
  const empty = typeof actions !== 'function' && !actions.length && !search
  const control = icon ? (
    <IconButton
      tooltip={tooltip && !(disabled && disabledReason)}
      render={<Menu.Trigger ref={trigger} />}
      size={triggerSize}
      label={label}
      icon={icon}
      disabled={disabled || empty}
    />
  ) : (
    <Button
      render={<Menu.Trigger ref={trigger} aria-label={triggerText ? label : undefined} />}
      variant={triggerVariant}
      size={triggerText || triggerSize === 'compact' ? 'compact' : 'regular'}
      disabled={disabled || empty}
    >
      {triggerText ?? label}
    </Button>
  )
  const menu = (
    <Menu.Root
      modal={false}
      open={open}
      disabled={disabled}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'item-press') opener.current?.focus({ preventScroll: true })
        onOpenChange?.(next)
      }}
    >
      {disabled && disabledReason ? (
        <Tooltip label={disabledReason} disabledControl>
          {control}
        </Tooltip>
      ) : (
        control
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
        <MenuActionRows actions={actions} />
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
  actions: MenuActions
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
        <MenuActionRows actions={actions} />
      </ActionMenuPopup>
    </ContextMenu.Root>
  )
}

interface PointActionMenuProps {
  label: string
  actions: MenuActions
  /** The viewport point the rows open from, such as a secondary click the caller measured; `null` closes the menu. */
  point: { x: number; y: number } | null
  onClose: () => void
  /** Receives the open popup, for a caller that tells its own outside presses apart from the rows. */
  popupRef?: RefObject<HTMLDivElement | null>
}

/**
 * The same rows as `ActionMenu`, opened at a point for a surface that decides its own secondary
 * click, such as a canvas or a spreadsheet cell. The rows hang from that point as a native context
 * menu's do, and place, flip and dismiss like every other menu.
 */
export function PointActionMenu({
  label,
  actions,
  point,
  onClose,
  popupRef,
}: PointActionMenuProps) {
  const { trigger, container } = usePopoverContainer()
  const x = point?.x ?? 0
  const y = point?.y ?? 0
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) }),
    [x, y]
  )
  return (
    <>
      <span ref={trigger} hidden />
      <Menu.Root
        modal={false}
        open={point !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <ActionMenuPopup label={label} container={container} anchor={anchor} popupRef={popupRef}>
          <MenuActionRows actions={actions} />
        </ActionMenuPopup>
      </Menu.Root>
    </>
  )
}

interface ActionMenuPopupProps {
  label: string
  container: HTMLElement | null
  submenu?: boolean
  browser?: boolean
  searchLabel?: string
  align?: 'start' | 'end'
  /** A point to open from in place of the trigger, which then adds no offset. */
  anchor?: { getBoundingClientRect: () => DOMRect }
  popupRef?: RefObject<HTMLDivElement | null>
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
  anchor,
  popupRef,
  children,
}: ActionMenuPopupProps) {
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const searchEdges = useScrollEdges<HTMLInputElement>('horizontal')
  const searchable = useContext(SearchableMenu)
  const parent = useContext(FloatingMenu)
  const browserRows = useContext(BrowserRows) || Boolean(browser)
  const panel = useRef<HTMLDivElement>(null)
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panel.current = node
      if (popupRef) popupRef.current = node
    },
    [popupRef]
  )
  if (!container) return null
  return (
    <FloatingMenu.Provider value={panel}>
      <Menu.Portal container={container}>
        <Menu.Positioner
          className={popup.positioner}
          anchor={anchor}
          side={submenu ? 'inline-end' : searchable ? 'top' : 'bottom'}
          align={align}
          sideOffset={
            submenu
              ? () => {
                  const { gap, edge } = panelSpacing(parent?.current)
                  return edge + gap
                }
              : anchor
                ? 0
                : browserRows
                  ? 8
                  : 4
          }
          alignOffset={submenu ? () => -panelSpacing(parent?.current).edge : 0}
          collisionPadding={8}
        >
          <Menu.Popup
            ref={setPanel}
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
  /** Called as the submenu opens. */
  onOpen?: () => void
}

export function SubmenuItem({ label, icon, children, detail, onOpen }: SubmenuItemProps) {
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.SubmenuRoot
      onOpenChange={(open) => {
        if (open) onOpen?.()
      }}
    >
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
  disabledReason?: string
  value?: string
  selected?: boolean
  href?: string
  onSelect?: () => void
  /** Keeps a floating menu open after the row runs. */
  keepOpen?: boolean
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
  disabledReason,
  href,
  onSelect,
  keepOpen,
}: MenuItemProps) {
  const inline = useContext(InlineMenu)
  const floating = useContext(FloatingMenu)
  const choice = value !== undefined || selected !== undefined
  const active =
    checked ?? (inline?.value === undefined ? selected : inline.value === (value ?? label))
  const type = 'T060'
  function explain(item: ReactElement) {
    return disabled && disabledReason ? <Tooltip label={disabledReason}>{item}</Tooltip> : item
  }
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
    if (href !== undefined)
      return (
        <Menu.LinkItem
          render={<Link href={href} />}
          className={styles.menuItem}
          label={label}
          data-type={type}
          closeOnClick
        >
          {content}
        </Menu.LinkItem>
      )
    if (checked !== undefined)
      return explain(
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
      return explain(
        <Menu.RadioItem
          disabled={disabled}
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
    return explain(
      <Menu.Item
        data-destructive-quiet={destructive || undefined}
        disabled={disabled}
        className={styles.menuItem}
        label={label}
        data-type={type}
        onClick={onSelect}
        closeOnClick={!keepOpen}
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
    return explain(
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
  return explain(
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

/** @public check-platform-design requires every catalog evidence owner to be an exported component. */
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
