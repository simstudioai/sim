import { Globe } from '@sim/emcn/icons'
import { Favicon } from '@/components/favicon'
import { simLinkOrigin } from '@/lib/sim-links/validation'

interface SimLinkIconProps {
  /** The link's destination; a variable link's `{*}` never changes its host. */
  url: string
}

/** The destination site's favicon, or a globe when neither it nor a parent domain has one. */
export function SimLinkIcon({ url }: SimLinkIconProps) {
  const origin = simLinkOrigin(url)
  return <Favicon host={origin ? new URL(origin).hostname : null} fallback={<Globe />} />
}
