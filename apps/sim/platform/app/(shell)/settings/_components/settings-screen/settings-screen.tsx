'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen.module.css'

interface SettingsScreenProps {
  title: string
  children: ReactNode
}

export function SettingsScreen({ title, children }: SettingsScreenProps) {
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
      <div className={styles.content}>
        <header className={styles.heading}>
          <h1 data-type='T076'>{title}</h1>
        </header>
        {children}
      </div>
    </>
  )
}
