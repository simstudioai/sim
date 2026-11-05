import styles from '@/platform/design-system/components/avatar/avatar.module.css'
import { avatarInitials } from '@/platform/design-system/components/avatar/avatar-initials'
import { IconButton } from '@/platform/design-system/components/button/button'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface AvatarImageProps {
  src: string
  name?: string
}

export function AvatarImage({ src, name = '' }: AvatarImageProps) {
  return <img className={styles.avatarImage} alt={name} src={src} />
}

interface AvatarProps {
  name: string
  src?: string
  organization?: boolean
  size?: 'inline'
}

export function Avatar({ name, src, organization, size }: AvatarProps) {
  const initials = avatarInitials(name, organization ? 1 : 2)
  return (
    <span
      className={styles.avatar}
      data-organization={organization || undefined}
      data-size={size}
      role='img'
      aria-label={name}
      data-type={size ? 'T021' : organization ? 'T034' : 'T050'}
    >
      {src ? <AvatarImage src={src} /> : initials}
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
      <Avatar name={name} src={src} size='inline' />
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
      <IconButton label={`Show ${people.length - visibleCount} more people`} icon='I108' />
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
        <Tooltip key={person.name} label={person.name}>
          <Avatar name={person.name} src={person.src} />
        </Tooltip>
      ))}
      <AvatarOverflow people={people} visibleCount={2} label={label} />
    </span>
  )
}
