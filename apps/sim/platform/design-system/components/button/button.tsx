import type { MouseEventHandler, ReactNode } from 'react'
import Link from 'next/link'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/button/button.shared.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface ButtonProps {
  children: string
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive' | 'muted'
  size?: 'regular' | 'compact'
  submit?: boolean
  icon?: IconName
  trailingIcon?: IconName
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
}

export function Button({
  children,
  variant = 'secondary',
  size = 'regular',
  submit,
  icon,
  trailingIcon,
  disabled,
  onClick,
}: ButtonProps) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-elevation={variant === 'secondary' ? 'control' : undefined}
      data-type='T060'
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      <OverflowText text={children}>{children}</OverflowText>
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  )
}

interface IconButtonProps {
  label: string
  icon: IconName
  size?: 'small' | 'row' | 'compact' | 'touch'
  variant?: 'quiet' | 'solid' | 'floating'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  tooltip?: boolean
  'aria-describedby'?: string
}

export function IconButton({
  label,
  icon,
  size = 'small',
  variant = 'quiet',
  disabled,
  onClick,
  tooltip,
  'aria-describedby': describedBy,
}: IconButtonProps) {
  const button = (
    <button
      type='button'
      className={styles.iconButton}
      aria-label={label}
      data-type='T060'
      aria-describedby={describedBy}
      data-size={size}
      data-variant={variant}
      data-material={variant === 'floating' ? 'floating' : undefined}
      data-elevation={variant === 'floating' ? 'menu' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button
}

type ChipProps = {
  children: string
  icon?: IconName
  selected?: boolean
} & (
  | { href: string; onClick?: never; action?: ReactNode }
  | { href?: never; onClick?: MouseEventHandler<HTMLButtonElement>; action?: never }
)

export function Chip({ children, icon, selected = false, onClick, href, action }: ChipProps) {
  const content = (
    <>
      {icon && <Icon name={icon} />}
      <OverflowText text={children}>{children}</OverflowText>
    </>
  )
  if (href) {
    const link = (
      <Link
        href={href}
        className={styles.chip}
        data-type='T043'
        aria-current={selected ? 'page' : undefined}
      >
        {content}
      </Link>
    )
    if (!action) return link
    return (
      <div className={styles.chipRow}>
        {link}
        <span className={styles.chipAction}>{action}</span>
      </div>
    )
  }
  return (
    <button
      type='button'
      className={styles.chip}
      data-type='T043'
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
