import Link from 'next/link'

interface ModelToolLinkProps {
  href: string
  title: string
  description: string
}

/** A bordered link card for a row of related pages; rows stack at `max-sm`. */
export function ModelToolLink({ href, title, description }: ModelToolLinkProps) {
  return (
    <Link
      href={href}
      className='flex flex-1 flex-col gap-1 border-[var(--border)] border-l p-6 transition-colors first:border-l-0 hover:bg-[var(--surface-hover)] max-sm:border-t max-sm:border-l-0 max-sm:first:border-t-0'
    >
      <span className='text-[var(--text-primary)] text-base'>{title}</span>
      <span className='text-[var(--text-muted)] text-sm leading-[150%]'>{description}</span>
    </Link>
  )
}
