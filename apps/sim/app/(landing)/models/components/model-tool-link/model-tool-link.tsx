import Link from 'next/link'

interface ModelToolLinkProps {
  href: string
  title: string
  description: string
}

/** A bordered link card for a row of related pages; rows stack below `sm`. */
export function ModelToolLink({ href, title, description }: ModelToolLinkProps) {
  return (
    <Link
      href={href}
      className='flex flex-1 flex-col gap-1 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
    >
      <span className='text-[var(--text-primary)] text-base'>{title}</span>
      <span className='text-[var(--text-muted)] text-sm leading-[150%]'>{description}</span>
    </Link>
  )
}
