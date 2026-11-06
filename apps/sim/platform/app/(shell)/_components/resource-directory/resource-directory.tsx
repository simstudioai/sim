import type { ComponentProps, ReactNode, Ref } from 'react'
import type Link from 'next/link'
import styles from '@/platform/app/(shell)/_components/resource-directory/resource-directory.module.css'
import { Chip, PageColumn } from '@/platform/design-system/components'

interface DirectoryContentProps {
  children: ReactNode
}

export function DirectoryPage({ children }: DirectoryContentProps) {
  return (
    <PageColumn>
      <main className={styles.page}>{children}</main>
    </PageColumn>
  )
}

interface DirectoryHeadingProps {
  title: string
  description?: string
  leading?: ReactNode
  action?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
  children?: ReactNode
}

export function DirectoryHeading({
  title,
  description,
  leading,
  action,
  titleRef,
  children,
}: DirectoryHeadingProps) {
  return (
    <header className={styles.heading}>
      <div className={styles.identity}>
        {leading && <span className={styles.mark}>{leading}</span>}
        <div className={styles.copy}>
          <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} data-type='T076'>
            {title}
          </h1>
          {description && <p data-type='T048'>{description}</p>}
          {children}
        </div>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </header>
  )
}

interface DirectoryBackProps {
  href: string
  label: string
  onNavigate?: ComponentProps<typeof Link>['onNavigate']
}
export function DirectoryBack({ href, label, onNavigate }: DirectoryBackProps) {
  return (
    <nav aria-label={`${label} navigation`} className={styles.back}>
      <Chip href={href} icon='I093' onNavigate={onNavigate}>
        {label}
      </Chip>
    </nav>
  )
}

export function DirectoryList({ children }: DirectoryContentProps) {
  return <div className={styles.list}>{children}</div>
}

interface DirectoryGroupProps extends DirectoryContentProps {
  label: string
}
export function DirectoryGroup({ label, children }: DirectoryGroupProps) {
  return (
    <section className={styles.group} aria-label={label}>
      <h2 data-type='T059'>{label}</h2>
      <ul className={styles.rows}>{children}</ul>
    </section>
  )
}

interface DirectoryFiltersProps {
  search: ReactNode
  category?: ReactNode
}
export function DirectoryFilters({ search, category }: DirectoryFiltersProps) {
  return (
    <div className={styles.filters}>
      <div className={styles.search}>{search}</div>
      {category && <div className={styles.category}>{category}</div>}
    </div>
  )
}
