import Link from 'next/link'
import { Button } from '@/platform/design-system/components'

interface ExternalLinkProps {
  href: string
  children: string
}

export function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <div>
      <Button
        variant='quiet'
        size='compact'
        render={<Link href={href} target='_blank' rel='noreferrer' />}
      >
        {children}
      </Button>
    </div>
  )
}
