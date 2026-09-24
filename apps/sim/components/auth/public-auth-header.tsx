import type { ReactNode } from 'react'
import styles from './public-auth-header.module.css'

interface PublicAuthHeaderProps {
  title: ReactNode
  description: ReactNode
}

/** Heading shared by public chat, file-share and SSO access gates. */
export function PublicAuthHeader({ title, description }: PublicAuthHeaderProps) {
  return (
    <div className='space-y-1 text-center'>
      <h1 className='text-balance text-[var(--text-primary)] text-display leading-[110%] tracking-[-0.02em]'>
        {title}
      </h1>
      <p className={`${styles.description} text-lg leading-[125%] tracking-[0.02em]`}>
        {description}
      </p>
    </div>
  )
}
