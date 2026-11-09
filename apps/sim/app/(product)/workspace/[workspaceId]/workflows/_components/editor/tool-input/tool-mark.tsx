'use client'

import type { ComponentType, SVGProps } from 'react'
import { Icon, type IconName } from '@sim/emcn/icon'
import { BlockTile } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-input.module.css'

interface ToolMarkProps {
  /** A registry block, drawn with its own glyph. */
  blockType?: string
  /** Drawn when the block has no glyph, usually its name's first letter. */
  fallbackLabel?: string
  /** An interface glyph, for custom tools, workflows and MCP servers. */
  glyph?: IconName
  /** A connector's own artwork, such as a managed MCP server's mark. */
  artwork?: ComponentType<SVGProps<SVGSVGElement>>
}

/** A tool's identity tile in the picker and on its card. */
export function ToolMark({ blockType, fallbackLabel, glyph, artwork: Artwork }: ToolMarkProps) {
  if (blockType) return <BlockTile size='sm' blockType={blockType} fallbackLabel={fallbackLabel} />
  return (
    <span className={styles.mark} aria-hidden='true'>
      {Artwork ? <Artwork /> : glyph ? <Icon name={glyph} /> : null}
    </span>
  )
}
