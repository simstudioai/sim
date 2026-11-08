'use client'

import type { PointerEvent, ReactNode, Ref } from 'react'
import { IconButton } from '@sim/emcn/button'
import type { IconName } from '@sim/emcn/icon'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { Tooltip } from '@sim/emcn/tooltip'
import type { ChainedCommands } from '@tiptap/core'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/toolbar.module.css'
import { normalizeLinkHref } from '@/platform/lib/data/files/markdown'

/**
 * Keeps the editor's selection while a toolbar button is pressed: a pressed button would otherwise
 * take focus, and the selection it acts on, from the document. Fields and menu triggers keep focus.
 */
function keepEditorFocus(event: PointerEvent<HTMLElement>) {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('input, [aria-haspopup]')) return
  event.preventDefault()
}

interface FloatingToolbarProps {
  label: string
  /** `group` while the bar holds a field, such as the link editor. */
  role: 'toolbar' | 'group'
  toolbarRef?: Ref<HTMLDivElement>
  onFocusCapture?: (event: React.FocusEvent<HTMLDivElement>) => void
  onClickCapture?: (event: React.MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

/** The floating bar the selection and table toolbars share: the menu surface, one row of controls. */
export function FloatingToolbar({
  label,
  role,
  toolbarRef,
  onFocusCapture,
  onClickCapture,
  onKeyDown,
  children,
}: FloatingToolbarProps) {
  return (
    <div
      ref={toolbarRef}
      role={role}
      aria-label={label}
      aria-keyshortcuts='Alt+F10'
      className={styles.toolbar}
      data-material='floating'
      data-elevation='menu'
      onPointerDown={keepEditorFocus}
      onFocusCapture={onFocusCapture}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

interface ToolbarButtonProps {
  label: string
  /** A glyph draws an icon-only button; without one the label is the button. */
  icon?: IconName
  shortcut?: string
  /** For a format that toggles on the selection, such as Bold. */
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
}

/** One command in a floating toolbar. */
export function ToolbarButton({
  label,
  icon,
  shortcut,
  pressed,
  disabled,
  onClick,
}: ToolbarButtonProps) {
  if (icon && pressed === undefined)
    return (
      <IconButton
        label={shortcut ? `${label} (${shortcut})` : label}
        icon={icon}
        size='compact'
        tooltip
        disabled={disabled}
        onClick={onClick}
      />
    )
  const button = (
    <button
      type='button'
      className={styles.toggle}
      data-type='T060'
      aria-pressed={pressed}
      aria-label={shortcut ? `${label} (${shortcut})` : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
  return shortcut ? <Tooltip label={`${label} (${shortcut})`}>{button}</Tooltip> : button
}

/** A hairline between groups of toolbar commands. */
export function ToolbarDivider() {
  return <span className={styles.divider} aria-hidden='true' />
}

interface ToolbarMenuProps {
  label: string
  /** The trigger's visible text; an icon-only trigger shows the ellipsis. */
  triggerText?: string
  actions: readonly MenuAction[]
}

/**
 * A toolbar choice that opens the shared menu. The trigger takes focus on press, so the document's
 * blur lands inside the toolbar and the bar stays open while the menu does.
 */
export function ToolbarMenu({ label, triggerText, actions }: ToolbarMenuProps) {
  return (
    <span
      className={styles.menu}
      onPointerDown={(event) => {
        const trigger = event.currentTarget.querySelector('button')
        if (trigger && document.activeElement !== trigger) trigger.focus({ preventScroll: true })
      }}
    >
      <ActionMenu
        label={label}
        triggerText={triggerText}
        icon={triggerText ? null : 'I108'}
        triggerSize='compact'
        actions={actions}
      />
    </span>
  )
}

interface ToolbarInputProps {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  inputRef: Ref<HTMLInputElement>
  readOnly?: boolean
}

/** A flush field inside a floating toolbar, such as the link URL. */
function ToolbarInput({
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
  readOnly = false,
}: ToolbarInputProps) {
  return (
    <input
      ref={inputRef}
      aria-label={label}
      type='text'
      inputMode='url'
      value={value}
      readOnly={readOnly}
      className={styles.input}
      data-type='T060'
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.stopPropagation()
          return
        }
        if (event.key === 'Enter' && !readOnly) {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

interface LinkUrlInputProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  inputRef: Ref<HTMLInputElement>
  readOnly?: boolean
}

/** The inline link field the selection toolbar and the link hover card share. */
export function LinkUrlInput({
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
  readOnly,
}: LinkUrlInputProps) {
  return (
    <ToolbarInput
      label='Link URL'
      placeholder='Paste or type a link…'
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={onCancel}
      inputRef={inputRef}
      readOnly={readOnly}
    />
  )
}

/**
 * Applies a link to the chain's selection. Clearing the field removes the link; a target that
 * survives normalization replaces it; one that normalizes away (an unsafe scheme) changes nothing.
 */
export function applyLink(chain: ChainedCommands, rawHref: string): void {
  const trimmed = rawHref.trim()
  const href = normalizeLinkHref(trimmed)
  if (!href && trimmed) return
  chain.extendMarkRange('link')
  if (href) chain.setLink({ href })
  else chain.unsetLink()
  chain.run()
}
