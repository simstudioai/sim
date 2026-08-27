import { ChipLink } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'

interface EmptyStateDocsLinkProps {
  href: string
}

/** The docs chip every resource empty state carries, so the four stay identical. */
export function EmptyStateDocsLink({ href }: EmptyStateDocsLinkProps) {
  return (
    <ChipLink
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      variant='border'
      leftIcon={BookOpen}
    >
      Docs
    </ChipLink>
  )
}
