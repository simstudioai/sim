'use client'

import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import { getBlock } from '@/blocks'
import { getTileIconColorClass } from '@/blocks/icon-color'

interface ConnectorTileProps {
  /** Connector type, which doubles as the block type owning the brand colour. */
  connectorType: string
  icon?: ComponentType<{ className?: string }>
}

/**
 * 36px brand tile for a knowledge-base connector. The fill comes from the block
 * registry so a connector reads the same as the integration it syncs from;
 * connectors carry an icon of their own but no colour, which is why the two are
 * resolved from different places here.
 *
 * A connector whose type has no block config keeps the neutral surface rather
 * than inventing a colour.
 */
export function ConnectorTile({ connectorType, icon: Icon }: ConnectorTileProps) {
  const brandBg = getBlock(connectorType)?.bgColor ?? null

  return (
    <div
      className={cn(
        'flex size-full items-center justify-center rounded-xl border',
        brandBg ? 'border-[var(--border-1)]' : 'border-[var(--border-muted)] bg-[var(--surface-4)]'
      )}
      style={brandBg ? { background: brandBg } : undefined}
    >
      {Icon && (
        <Icon
          className={cn(
            'size-5',
            brandBg ? getTileIconColorClass(brandBg) : 'text-[var(--text-icon)]'
          )}
        />
      )}
    </div>
  )
}
