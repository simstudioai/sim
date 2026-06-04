import type { ReactNode } from 'react'

interface DetailSectionProps {
  title: ReactNode
  children: ReactNode
}

/**
 * Labeled section with a muted title and a thin inset divider above the body.
 * Shared by the credential detail surfaces so every section keeps the same
 * vertical rhythm without repeating markup at the callsites.
 */
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{title}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      {children}
    </section>
  )
}
