import type { MouseEventHandler, ReactNode } from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/components.module.css'
import { Icon } from '@/platform/design-system/components/icon'
import { Tooltip } from '@/platform/design-system/components/tooltip'

interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive' | 'pill'
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
      {children}
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  )
}

interface IconButtonProps {
  label: string
  icon: IconName
  size?: 'small' | 'compact' | 'touch'
  variant?: 'quiet' | 'solid' | 'floating'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  'aria-describedby'?: string
}

export function IconButton({
  label,
  icon,
  size = 'small',
  variant = 'quiet',
  disabled,
  onClick,
  'aria-describedby': describedBy,
}: IconButtonProps) {
  return (
    <button
      type='button'
      className={styles.iconButton}
      aria-label={label}
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
}

interface ChipProps {
  children: ReactNode
  icon?: IconName
  selected?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
}

export function Chip({ children, icon, selected = false, onClick }: ChipProps) {
  return (
    <button
      type='button'
      className={styles.chip}
      data-type='T043'
      aria-pressed={selected}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

interface AvatarProps {
  name: string
  src?: string
  organization?: 'small' | 'large'
}

export function Avatar({ name, src, organization }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, organization ? 1 : 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()
  return (
    <span
      className={styles.avatar}
      data-organization={organization}
      role='img'
      aria-label={name}
      data-type={organization === 'large' ? 'T043' : organization === 'small' ? 'T034' : 'T050'}
    >
      {src ? <img alt='' src={src} /> : initials}
    </span>
  )
}

interface Person {
  name: string
  src?: string
}

interface PersonRowProps {
  name: string
  src?: string
}

export function PersonRow({ name, src }: PersonRowProps) {
  return (
    <span className={styles.personRow}>
      <Avatar name={name} src={src} />
      <span data-type='T060'>{name}</span>
    </span>
  )
}

interface PeoplePopoverProps {
  title: string
  people: readonly Person[]
}

export function PeoplePopover({ title, people }: PeoplePopoverProps) {
  return (
    <span className={styles.peoplePopover} data-material='floating' data-elevation='menu'>
      <span className={styles.peopleHeading} data-type='T052'>
        {title}
      </span>
      {people.map((person) => (
        <PersonRow key={person.name} name={person.name} src={person.src} />
      ))}
    </span>
  )
}

interface AvatarOverflowProps {
  people: readonly Person[]
  label?: string
  visibleCount?: number
}

export function AvatarOverflow({
  people,
  label = 'People',
  visibleCount = 0,
}: AvatarOverflowProps) {
  if (people.length <= visibleCount) return null
  return (
    <Tooltip label={label} panel={<PeoplePopover title={label} people={people} />}>
      <IconButton
        label={`Show ${people.length - visibleCount} more people`}
        icon='I108'
        size='compact'
      />
    </Tooltip>
  )
}

interface AvatarGroupProps {
  people: readonly Person[]
  label?: string
}

export function AvatarGroup({ people, label }: AvatarGroupProps) {
  return (
    <span className={styles.avatarGroup}>
      {people.slice(0, 2).map((person) => (
        <Avatar key={person.name} name={person.name} src={person.src} />
      ))}
      <AvatarOverflow people={people} visibleCount={2} label={label} />
    </span>
  )
}

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className={styles.empty} data-action={action ? true : undefined}>
      <div>
        <h2 data-type='T042'>{title}</h2>
        {description && <p data-type='T067'>{description}</p>}
      </div>
      {action}
    </section>
  )
}
