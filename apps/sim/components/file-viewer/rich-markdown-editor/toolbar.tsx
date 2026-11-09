'use client'

import type { PointerEvent, ReactNode, Ref } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import type { IconName } from '@sim/emcn/icon'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { Tooltip } from '@sim/emcn/tooltip'
import type { ChainedCommands } from '@tiptap/core'
import { normalizeLinkHref } from '@/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import styles from '@/components/file-viewer/rich-markdown-editor/toolbar.module.css'

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

/** One command in a floating toolbar: an icon, a text action, or a format that toggles on the selection. */
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
  const action = (
    <Button
      variant='quiet'
      size='compact'
      selected={pressed}
      aria-label={shortcut ? `${label} (${shortcut})` : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  )
  return shortcut ? <Tooltip label={`${label} (${shortcut})`}>{action}</Tooltip> : action
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

interface LinkUrlInputProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  inputRef: Ref<HTMLInputElement>
  readOnly?: boolean
}

/**
 * The inline link field the selection toolbar and the link hover card share. Enter applies the link
 * and Escape cancels; a key that composes text (an IME candidate) stays with the field.
 */
export function LinkUrlInput({
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
  readOnly = false,
}: LinkUrlInputProps) {
  return (
    <span
      className={styles.link}
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
    >
      <Input
        label='Link URL'
        type='text'
        inputMode='url'
        placeholder='Paste or type a link…'
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        inputRef={inputRef}
      />
    </span>
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
