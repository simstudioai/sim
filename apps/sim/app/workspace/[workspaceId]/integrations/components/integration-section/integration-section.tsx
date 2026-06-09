import type { ReactNode } from 'react'

interface IntegrationSectionProps {
  label: string
  children: ReactNode
}

/**
 * Labeled section used throughout the integrations surface. Renders a small
 * caption, a divider, and a responsive auto-fit grid for its children so the
 * vertical rhythm stays consistent across the integrations list, the connected
 * credentials list, and the integration detail page templates.
 */
export function IntegrationSection({ label, children }: IntegrationSectionProps) {
  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{label}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      <div className='-mx-2 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-2 gap-y-0.5'>
        {children}
      </div>
    </section>
  )
}
