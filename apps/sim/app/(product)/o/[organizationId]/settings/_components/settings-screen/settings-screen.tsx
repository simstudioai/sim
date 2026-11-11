'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { PageColumn } from '@sim/emcn-platform/page-column'
import { SettingsBody } from '@/app/(product)/_components/settings-parts/settings-page'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen.module.css'

interface SettingsScreenProps {
  title: string
  /** The page's one-line summary under its title, from the Settings navigation metadata. */
  description?: string
  children: ReactNode
}

/**
 * An organization Settings page: its location breadcrumb over the page column, around the shared
 * {@link SettingsBody}. The open section renders the page's header.
 */
export function SettingsScreen({ title, description, children }: SettingsScreenProps) {
  const start = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const marker = start.current
    if (!marker) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(marker)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div ref={start} className={styles.scrollStart} aria-hidden='true' />
      <header
        aria-label='Settings location'
        className={styles.breadcrumb}
        data-scrolled={scrolled || undefined}
      >
        <span className={styles.parent} data-type='T057'>
          Settings
        </span>
        <span aria-hidden='true' className={styles.parent} data-type='T057'>
          /
        </span>
        <span className={styles.fullTitle} data-type='T057'>
          {title}
        </span>
        <span className={styles.compactTitle} data-type='T042'>
          {title}
        </span>
      </header>
      <PageColumn>
        <main className={styles.content}>
          <SettingsBody title={title} description={description} headingLevel='h1'>
            {children}
          </SettingsBody>
        </main>
      </PageColumn>
    </>
  )
}
