import styles from '@/platform/app/(shell)/people/_components/people-page/people-page.module.css'

interface PeopleStatusProps {
  children: string
}

/** The body of a People view while its first read is pending, the same size in every view. */
export function PeopleStatus({ children }: PeopleStatusProps) {
  return (
    <p className={styles.status} role='status' data-type='T060'>
      {children}
    </p>
  )
}
