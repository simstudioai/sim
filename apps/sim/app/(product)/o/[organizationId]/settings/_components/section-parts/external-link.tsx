import { Button } from '@sim/emcn/button'
import Link from 'next/link'

interface ExternalLinkProps {
  href: string
  /** The link's whole name, rendered once: Docs, Managed keys, Open in Slack. */
  label: string
}

/**
 * The one way an organization Settings page links out: a quiet compact button that opens `href` in a
 * new tab, its label rendered once and the external-link glyph trailing. A page-level link (a guide)
 * sits in the control bar under the page header; a record's link sits with that record.
 */
export function ExternalLink({ href, label }: ExternalLinkProps) {
  return (
    <Button
      variant='quiet'
      size='compact'
      trailingIcon='I037'
      render={<Link href={href} target='_blank' rel='noopener noreferrer' />}
    >
      {label}
    </Button>
  )
}
