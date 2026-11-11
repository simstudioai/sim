import type { ComponentProps, ReactNode, Ref } from 'react'
import { Chip } from '@sim/emcn/button'
import { PageColumn, PageOverflow } from '@sim/emcn-platform/page-column'
import type Link from 'next/link'
import styles from '@/app/(product)/_components/resource-directory/resource-directory.module.css'

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
    <PageOverflow>
      <nav aria-label={`${label} navigation`}>
        <Chip href={href} icon='I093' onNavigate={onNavigate}>
          {label}
        </Chip>
      </nav>
    </PageOverflow>
  )
}
