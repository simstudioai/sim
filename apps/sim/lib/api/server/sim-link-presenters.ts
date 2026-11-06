import type { SimLink } from '@/lib/api/contracts/sim-links'
import type { SimLinkView } from '@/lib/sim-links/application/use-cases'

export function presentSimLink({ normalizedName, ...link }: SimLinkView): SimLink {
  return { ...link, updatedAt: link.updatedAt.toISOString() }
}
