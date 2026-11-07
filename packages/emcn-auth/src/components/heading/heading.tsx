import type { ReactNode } from 'react'
import styles from '#auth/components/heading/heading.module.css'

interface AuthHeaderProps {
  title: string
  titleId?: string
  description?: ReactNode
}
/** Owns the page heading; description accepts inline content rendered in a paragraph. */
export function AuthHeader({ title, titleId, description }: AuthHeaderProps) {
  return (
    <div className={styles.heading}>
      <h1 id={titleId}>{title}</h1>
      {description != null && <p>{description}</p>}
    </div>
  )
}
