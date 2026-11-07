'use client'

import styles from '#emcn/components/avatar/avatar.module.css'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { Stack } from '#emcn/components/stack/stack'

interface AvatarImageProps {
  src: string
  name?: string
}

export function AvatarImage({ src, name = '' }: AvatarImageProps) {
  return <img className={styles.avatarImage} alt={name} src={src} />
}

const AVATAR_TYPE = { inline: 'T021', row: 'T050', card: 'T042', hero: 'T076' } as const

interface AvatarProps {
  name: string
  src?: string
  organization?: boolean
  size?: 'inline' | 'row' | 'card' | 'hero'
}

export function Avatar({ name, src, organization, size }: AvatarProps) {
  return (
    <span
      className={styles.avatar}
      data-organization={organization || undefined}
      data-size={size}
      role='img'
      aria-label={name}
      data-type={size ? AVATAR_TYPE[size] : organization ? 'T034' : 'T050'}
    >
      {src ? (
        <AvatarImage src={src} />
      ) : (
        <span className={styles.initial}>{Array.from(name.trim().toUpperCase())[0]}</span>
      )}
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
  const scrollRef = useScrollEdges<HTMLSpanElement>()
  return (
    <span
      ref={scrollRef}
      className={styles.peoplePopover}
      data-material='floating'
      data-elevation='menu'
    >
      <span className={styles.peopleHeading} data-type='T052'>
        {title}
      </span>
      {people.map((person, index) => (
        <PersonRow key={`${person.name}-${index}`} name={person.name} src={person.src} />
      ))}
    </span>
  )
}

interface AvatarGroupProps {
  people: readonly Person[]
  total?: number
  label?: string
}

export function AvatarGroup({ people, total, label }: AvatarGroupProps) {
  return (
    <Stack
      items={people.map((person, index) => ({
        id: `${person.name}-${index}`,
        label: person.name,
        content: <Avatar name={person.name} src={person.src} />,
      }))}
      total={total}
      label={label}
    />
  )
}
