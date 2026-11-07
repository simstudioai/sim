'use client'

import type { ComponentProps, MouseEventHandler, ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
import Link from 'next/link'
import styles from '#emcn/components/button/button.shared.module.css'
import { ControlRow } from '#emcn/components/button/control-row'
import type { IconName } from '#emcn/components/icon/icon'
import { Icon } from '#emcn/components/icon/icon'
import { CountedLabel } from '#emcn/components/overflow-text/counted-label'
import { Tooltip } from '#emcn/components/tooltip/tooltip'
import { isAbsoluteHref } from '#emcn/lib/navigation'

interface ButtonProps {
  render?: ReactElement
  children: string
  count?: number
  /** Replaces the label below 48rem. Give the button an `aria-label` so its name holds at any width. */
  narrowLabel?: string
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive' | 'muted'
  /** Give a quiet action the menu's destructive hover and press treatment. */
  destructive?: boolean
  size?: 'regular' | 'compact'
  submit?: boolean
  icon?: IconName | { providerId: string }
  trailingIcon?: IconName
  disabled?: boolean
  /** Explain an unavailable action through the shared pointer and keyboard tooltip. */
  disabledReason?: string
  /** Names the action when several identical buttons sit side by side. */
  'aria-label'?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
}

export function Button({
  render,
  children,
  count,
  narrowLabel,
  variant = 'secondary',
  destructive,
  size = 'regular',
  submit,
  icon,
  trailingIcon,
  disabled,
  disabledReason,
  'aria-label': ariaLabel,
  onClick,
}: ButtonProps) {
  const button = useRender({
    defaultTagName: 'button',
    render,
    props: {
      type: submit ? 'submit' : 'button',
      className: styles.button,
      'data-variant': variant,
      'data-destructive-quiet': (variant === 'quiet' && destructive) || undefined,
      'data-solid': variant === 'primary' || variant === 'destructive' || undefined,
      'data-size': size,
      'data-elevation': variant === 'secondary' ? 'control' : undefined,
      'data-type': 'T060',
      'aria-label':
        ariaLabel ??
        (disabled && disabledReason
          ? count === undefined
            ? children
            : `${children} ${count}`
          : undefined),
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
  return disabled && disabledReason ? (
    <Tooltip label={disabledReason} disabledControl>
      {button}
    </Tooltip>
  ) : (
    button
  )
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
  /** Points the glyph the other way, for the opposite of a directional action. */
  mirrored?: boolean
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
  mirrored,
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
      'data-mirrored': mirrored || undefined,
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
  | {
      href: string
      onNavigate?: ComponentProps<typeof Link>['onNavigate']
      onClick?: never
      action?: ReactNode
      status?: ReactNode
      replaceActionOnTouch?: boolean
    }
  | {
      href?: never
      onNavigate?: never
      onClick?: MouseEventHandler<HTMLButtonElement>
      action?: never
      status?: never
      replaceActionOnTouch?: never
    }
)

export function Chip({
  children,
  icon,
  selected = false,
  onClick,
  href,
  onNavigate,
  action,
  status,
  replaceActionOnTouch,
}: ChipProps) {
  return (
    <ControlRow
      label={children}
      icon={icon}
      action={action}
      status={status}
      replaceActionOnTouch={replaceActionOnTouch}
      render={
        href ? (
          isAbsoluteHref(href) ? (
            <a href={href} aria-current={selected ? 'page' : undefined}>
              {children}
            </a>
          ) : (
            <Link
              href={href}
              onNavigate={onNavigate}
              aria-current={selected ? 'page' : undefined}
            />
          )
        ) : (
          <button type='button' aria-pressed={selected} onClick={onClick} />
        )
      }
    />
  )
}
