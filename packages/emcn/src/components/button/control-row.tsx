'use client'

import type { ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
import styles from '#emcn/components/button/button.shared.module.css'
import type { IconName } from '#emcn/components/icon/icon'
import { Icon } from '#emcn/components/icon/icon'
import { OverflowText } from '#emcn/components/overflow-text/overflow-text'

interface ControlRowProps {
  render: ReactElement
  label?: string
  accessibleLabel?: string
  leading?: ReactNode
  trailingIcon?: IconName
  onClick?: () => void
  icon?: IconName
  wrap?: boolean
  action?: ReactNode
  actionSide?: 'start' | 'end'
  /** A read-only state at the row's end. It yields to `action` where a pointer can reveal it. */
  status?: ReactNode
  replaceActionOnTouch?: boolean
}

export function ControlRow({
  render,
  label,
  accessibleLabel,
  leading,
  trailingIcon,
  onClick,
  icon,
  wrap,
  action,
  actionSide = 'end',
  status,
  replaceActionOnTouch,
}: ControlRowProps) {
  const control = useRender({
    render,
    props: {
      className: styles.chip,
      'data-type': 'T043',
      'aria-label': accessibleLabel,
      onClick,
      children: (
        <>
          {leading ?? (icon && <Icon name={icon} />)}
          {label &&
            (wrap ? (
              <span className={styles.wrappedLabel}>{label}</span>
            ) : (
              <OverflowText text={label}>{label}</OverflowText>
            ))}
          {trailingIcon && <Icon name={trailingIcon} />}
        </>
      ),
    },
  })
  if (!action && !status) return control
  return (
    <div
      className={styles.chipRow}
      data-action-side={actionSide}
      data-status={status ? (replaceActionOnTouch ? 'replace' : 'beside') : undefined}
    >
      {control}
      {status && <span className={styles.chipStatus}>{status}</span>}
      {action && <span className={styles.chipAction}>{action}</span>}
    </div>
  )
}
