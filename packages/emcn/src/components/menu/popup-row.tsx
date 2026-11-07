import type { MouseEventHandler, ReactNode } from 'react'
import type { IconName } from '#emcn/catalog/icon-geometry'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'

interface PopupRowProps {
  icon?: IconName
  /** The row a field's own arrow keys have reached, for a list that keeps focus in the field. */
  highlighted?: boolean
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  onMouseDown?: MouseEventHandler<HTMLButtonElement>
  onMouseEnter?: MouseEventHandler<HTMLButtonElement>
  children: ReactNode
}

/** A row in a popup a field owns, outside a `Menu` or `Select`. */
export function PopupRow({
  icon,
  highlighted,
  disabled,
  onClick,
  onMouseDown,
  onMouseEnter,
  children,
}: PopupRowProps) {
  return (
    <button
      type='button'
      className={popup.item}
      data-type='T060'
      data-highlighted={highlighted || undefined}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

/** A label above or below a popup's rows. */
export function PopupNote({ children }: { children: ReactNode }) {
  return (
    <p className={popup.heading} data-type='T060'>
      {children}
    </p>
  )
}
