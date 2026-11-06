import styles from '@/platform/app/(shell)/people/_components/person-identity/person-identity.module.css'
import { Avatar } from '@/platform/design-system/components'
import type { PersonSummary } from '@/platform/shared/people'

interface PersonIdentityProps {
  person: Pick<PersonSummary, 'name' | 'email' | 'image' | 'title'>
}

/** A person's avatar, name and what they do: the row that directory and profile lists share. */
export function PersonIdentity({ person }: PersonIdentityProps) {
  return (
    <span className={styles.identity}>
      <Avatar name={person.name} src={person.image ?? undefined} size='row' />
      <span className={styles.copy}>
        <span data-type='T042'>{person.name}</span>
        <span className={styles.detail} data-type='T043'>
          {person.title || person.email}
        </span>
      </span>
    </span>
  )
}
