'use client'

import type { MouseEventHandler, ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
import Link from 'next/link'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/button/button.shared.module.css'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'
import { isAbsoluteHref } from '@/platform/design-system/navigation'

interface ButtonProps {
  render?: ReactElement
  children: string
  count?: number
  /** Replaces the label below 48rem. Give the button an `aria-label` so its name holds at any width. */
  narrowLabel?: string
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive' | 'muted'
  size?: 'regular' | 'compact'
  submit?: boolean
  icon?: IconName | { providerId: string }
  trailingIcon?: IconName
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
}

export function Button({
  render,
  children,
  count,
  narrowLabel,
  variant = 'secondary',
  size = 'regular',
  submit,
  icon,
  trailingIcon,
  disabled,
  onClick,
}: ButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      type: submit ? 'submit' : 'button',
      className: styles.button,
      'data-variant': variant,
      'data-solid': variant === 'primary' || variant === 'destructive' || undefined,
      'data-size': size,
      'data-elevation': variant === 'secondary' ? 'control' : undefined,
      'data-type': 'T060',
      disabled,
      onClick,
      children: (
        <>
          {icon &&
            (typeof icon === 'string' ? (
              <Icon name={icon} />
            ) : (
              <Icon providerId={icon.providerId} />
            ))}
          {narrowLabel ? (
            <>
              <span className={styles.wideLabel}>
                <CountedLabel label={children} count={count} />
              </span>
              <span className={styles.narrowLabel}>
                <CountedLabel label={narrowLabel} count={count} />
              </span>
            </>
          ) : (
            <CountedLabel label={children} count={count} />
          )}
          {trailingIcon && <Icon name={trailingIcon} />}
        </>
      ),
    },
  })
}

interface IconButtonProps {
  render?: ReactElement
  label: string
  icon: IconName
  size?: 'small' | 'row' | 'compact' | 'inline'
  variant?: 'quiet' | 'solid' | 'floating'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  tooltip?: boolean
  'aria-describedby'?: string
}

export function IconButton({
  render,
  label,
  icon,
  size = 'small',
  variant = 'quiet',
  disabled,
  onClick,
  tooltip,
  'aria-describedby': describedBy,
}: IconButtonProps) {
  const button = useRender({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      className: styles.iconButton,
      'aria-label': label,
      'aria-describedby': describedBy,
      'data-type': 'T060',
      'data-size': size,
      'data-variant': variant,
      'data-solid': variant === 'solid' || undefined,
      'data-material': variant === 'floating' ? 'reading' : undefined,
      'data-elevation': variant === 'floating' ? 'composer' : undefined,
      disabled,
      onClick,
      children: <Icon name={icon} />,
    },
  })
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button
}

type ChipProps = {
  children: string
  icon?: IconName
  selected?: boolean
} & (
  | { href: string; onClick?: never; action?: ReactNode; status?: ReactNode }
  | { href?: never; onClick?: MouseEventHandler<HTMLButtonElement>; action?: never; status?: never }
)

export function Chip({
  children,
  icon,
  selected = false,
  onClick,
  href,
  action,
  status,
}: ChipProps) {
  const LinkElement = href && isAbsoluteHref(href) ? 'a' : Link
  return (
    <ControlRow
      label={children}
      icon={icon}
      action={action}
      status={status}
      render={
        href ? (
          <LinkElement href={href} aria-current={selected ? 'page' : undefined} />
        ) : (
          <button type='button' aria-pressed={selected} onClick={onClick} />
        )
      }
    />
  )
}
