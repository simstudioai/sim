import { Button } from '@sim/emcn/button'
import Link from 'next/link'

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
