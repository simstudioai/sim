import type { ReactNode } from 'react'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

interface IntegrationIconProps {
  type: string
  color: string
}

/** Provider artwork is rendered on the server at its original colors, without a decorative tile. */
export function IntegrationIcon({ type }: IntegrationIconProps): ReactNode {
  const Icon = blockTypeToIconMap[type]
  return Icon ? <Icon aria-hidden className='size-8 shrink-0 text-[var(--docs-text)]' /> : null
}
