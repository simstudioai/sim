'use client'

import type { ComponentType, HTMLAttributes } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile.module.css'
import {
  ChipTag,
  type ChipTagLayout,
  type ChipTagPaint,
  type ChipTagTone,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/chip-tag'
import { getBlock, isLightTileColor, Repeat, Split } from '@/platform/lib/data/workflows'

const WORKFLOW_ROLE_TONES = {
  agentic: 'inverse',
  interface: 'blue',
  logic: 'orange',
  state: 'yellow',
  flow: 'ash',
  records: 'green',
  identity: 'identity',
  neutral: 'neutral',
  generative: 'purple',
  knowledge: 'content',
} as const satisfies Record<string, ChipTagTone>

type WorkflowTypeRole = keyof typeof WORKFLOW_ROLE_TONES

const WORKFLOW_TYPE_ROLES = {
  a2a: 'neutral',
  agent: 'agentic',
  api: 'interface',
  condition: 'logic',
  credential: 'state',
  credential_group: 'identity',
  deployments: 'neutral',
  enrichment: 'knowledge',
  evaluator: 'logic',
  file: 'knowledge',
  file_v2: 'knowledge',
  file_v3: 'knowledge',
  file_v4: 'knowledge',
  file_v5: 'knowledge',
  function: 'logic',
  generic_webhook: 'interface',
  guardrails: 'logic',
  human_in_the_loop: 'state',
  human_in_the_loop_v2: 'state',
  image_generator: 'generative',
  image_generator_v2: 'generative',
  imap: 'interface',
  knowledge: 'knowledge',
  logs: 'records',
  logs_v2: 'records',
  loop: 'flow',
  mcp: 'interface',
  memory: 'state',
  mothership: 'agentic',
  note: 'neutral',
  parallel: 'flow',
  pi: 'agentic',
  response: 'interface',
  router: 'flow',
  router_v2: 'flow',
  rss: 'knowledge',
  schedule: 'flow',
  search: 'knowledge',
  sim_workspace_event: 'interface',
  start_trigger: 'flow',
  starter: 'neutral',
  stt: 'generative',
  stt_v2: 'generative',
  table: 'records',
  table_v2: 'records',
  thinking: 'agentic',
  translate: 'generative',
  tts: 'generative',
  variables: 'state',
  video_generator: 'generative',
  video_generator_v2: 'generative',
  video_generator_v3: 'generative',
  vision: 'generative',
  vision_v2: 'generative',
  wait: 'flow',
  webhook_request: 'interface',
  workflow: 'interface',
  workflow_input: 'interface',
} as const satisfies Record<string, WorkflowTypeRole>

const DEFAULT_WORKFLOW_TYPE_ROLE: WorkflowTypeRole = 'neutral'

/** Whether the canvas maps this block type to a role accent. */
const hasWorkflowTypeRole = (type: string): type is keyof typeof WORKFLOW_TYPE_ROLES =>
  Object.hasOwn(WORKFLOW_TYPE_ROLES, type)

const getWorkflowTypeRole = (type: string): WorkflowTypeRole =>
  WORKFLOW_TYPE_ROLES[type as keyof typeof WORKFLOW_TYPE_ROLES] ?? DEFAULT_WORKFLOW_TYPE_ROLE

/** The workflow-tag paint a block type wears on the canvas (its role's tone; neutral when unmapped). */
export const getWorkflowTypeAccent = (type: string): ChipTagPaint => ({
  variant: 'workflow',
  tone: WORKFLOW_ROLE_TONES[getWorkflowTypeRole(type)],
})

/** Tile fill for a block that has no config of its own to colour it. */
const DEFAULT_BLOCK_TILE_COLOR = '#6B7280'

/**
 * Subflow tiles. Loop and Parallel are canvas blocks with no registry config,
 * so every surface that lists them had to special-case the pair; they resolve
 * here instead.
 */
const SUBFLOW_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  loop: Repeat,
  parallel: Split,
}

/**
 * Whether a block's tile takes the canvas role accent rather than the block's
 * own provider colour. This is the canvas's own rule, read from one place so
 * every surface that lists a block agrees with the card it names: only a
 * third-party integration wears its brand, everything first-party wears its
 * role accent — landing on `neutral` when the role map has no entry yet,
 * exactly as the canvas does.
 *
 * A type with no config at all falls back to role membership, which accents the
 * subflows (`loop`, `parallel`, `workflow`) and leaves the terminal's
 * synthesized `error`/`validation`/`cancelled` rows on their status fill.
 */
export function hasBlockAccent(blockType: string): boolean {
  const config = getBlock(blockType)
  return config ? config.category !== 'tools' : hasWorkflowTypeRole(blockType)
}

/** A block's tile icon, including the subflows that carry no registry config. */
function getBlockTileIcon(blockType: string): ComponentType<{ className?: string }> | undefined {
  return getBlock(blockType)?.icon ?? SUBFLOW_ICONS[blockType]
}

/** A block's provider tile fill. Only reached when it takes no accent. */
function getBlockTileColor(blockType: string): string {
  return getBlock(blockType)?.bgColor || DEFAULT_BLOCK_TILE_COLOR
}

/**
 * Slot sizes the tile ships in: the 18px detail header, the canvas 16px chip,
 * or 14px for dense rows.
 */
type BlockTileSize = 'lg' | 'md' | 'sm'

const TILE_SIZE_CLASS: Record<BlockTileSize, string | undefined> = {
  lg: styles.sizeLg,
  md: styles.sizeMd,
  sm: styles.sizeSm,
}

/** Icon drawn inside each slot. Only the header tile takes the larger glyph. */
const TILE_ICON_SIZE_CLASS: Record<BlockTileSize, string | undefined> = {
  lg: styles.glyphLg,
  md: styles.glyph,
  sm: styles.glyph,
}

type AccentTileLayout = Extract<ChipTagLayout, 'tile-lg' | 'tile-md' | 'tile-sm'>

const ACCENT_TILE_LAYOUT: Record<BlockTileSize, AccentTileLayout> = {
  lg: 'tile-lg',
  md: 'tile-md',
  sm: 'tile-sm',
}

type TileAttributes = Omit<HTMLAttributes<HTMLElement>, 'children' | 'style' | 'className'>

interface BlockTileViewProps extends TileAttributes {
  /** Inline root for a tile placed inside a native button. */
  as?: 'div' | 'span'
  /**
   * Block the tile represents; decides whether it takes the canvas role accent.
   * Omitted by rows that name no block, such as catalog and section headers.
   */
  blockType?: string
  /** Resolved icon from the caller's registry or static catalog. */
  icon?: ComponentType<{ className?: string }>
  /** Provider fill, used only when the block takes no accent. */
  bgColor?: string
  /** Drawn on the provider tile when there is no icon — usually a name initial. */
  fallbackLabel?: string
  useAccent: boolean
  size?: BlockTileSize
}

/** Shared block tile; callers resolve registry metadata before rendering. */
function BlockTileView({
  as: Element = 'div',
  blockType,
  icon,
  bgColor,
  fallbackLabel,
  size = 'md',
  useAccent,
  ...props
}: BlockTileViewProps) {
  const Icon = icon

  if (blockType && Icon && useAccent) {
    return (
      <WorkflowTypeIcon
        type={blockType}
        Icon={Icon}
        layout={ACCENT_TILE_LAYOUT[size]}
        iconClassName={size === 'lg' ? styles.accentGlyphLg : undefined}
        {...props}
      />
    )
  }

  const fill = bgColor
  const foregroundClass = isLightTileColor(fill) ? styles.inkDark : styles.inkLight

  return (
    <Element
      className={cn(styles.tile, TILE_SIZE_CLASS[size])}
      style={{ background: fill }}
      {...props}
    >
      {Icon ? (
        <Icon className={cn(TILE_ICON_SIZE_CLASS[size], styles.glyphMotion, foregroundClass)} />
      ) : (
        fallbackLabel && (
          <span className={cn(styles.fallbackLabel, foregroundClass)}>{fallbackLabel}</span>
        )
      )}
    </Element>
  )
}

interface WorkflowTypeIconProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style' | 'className'> {
  type: string
  Icon: ComponentType<{ className?: string }>
  /** The tile size; the canvas chip is `tile-md`. */
  layout?: AccentTileLayout
  /** Overrides the glyph size when the chip is rendered at a non-default slot. */
  iconClassName?: string
}

/** Shared compact core-block icon used by workflow discovery surfaces. */
function WorkflowTypeIcon({
  type,
  Icon,
  layout = 'tile-md',
  iconClassName,
  ...props
}: WorkflowTypeIconProps) {
  return (
    <ChipTag
      paint={getWorkflowTypeAccent(type)}
      layout={layout}
      data-workflow-type-icon={type}
      {...props}
    >
      <Icon className={cn(styles.accentGlyph, styles.glyphMotion, iconClassName)} />
    </ChipTag>
  )
}

interface WorkflowTypeTagProps {
  type: string
  typeLabel?: string
  Icon: ComponentType<{ className?: string }>
  iconBgColor: string
  isIntegration?: boolean
  isEnabled?: boolean
}

/** Shared provider/type tag used by editable and read-only workflow canvases. */
export function WorkflowTypeTag({
  type,
  typeLabel,
  Icon,
  iconBgColor,
  isIntegration = false,
  isEnabled = true,
}: WorkflowTypeTagProps) {
  /**
   * The tag names the block's kind, and it says so whether or not the title
   * happens to repeat it. Dropping the label when the two matched meant a card
   * changed shape the moment it was renamed — a freshly dropped Wait showed a
   * bare icon, its second copy showed "Wait" — so the tag read as a badge that
   * came and went rather than as one fixed part of the header.
   */
  const label = typeLabel || null

  if (isIntegration) {
    return (
      <ChipTag
        paint={{
          variant: 'brand',
          brandColor: iconBgColor,
          brandForeground: isLightTileColor(iconBgColor) ? 'dark' : 'light',
        }}
        layout='tag'
        dimmed={!isEnabled}
        data-workflow-type-accent={type}
        data-workflow-brand-tag=''
      >
        <Icon className={styles.tagGlyph} />
        {label}
      </ChipTag>
    )
  }

  return (
    <ChipTag
      paint={getWorkflowTypeAccent(type)}
      layout='tag'
      dimmed={!isEnabled}
      data-workflow-type-accent={type}
    >
      <Icon className={styles.tagGlyph} />
      {label}
    </ChipTag>
  )
}

interface BlockTileProps extends Omit<BlockTileViewProps, 'useAccent'> {}

/** Resolves workspace registry metadata for the shared block tile. */
export function BlockTile({ blockType, icon, bgColor, ...props }: BlockTileProps) {
  return (
    <BlockTileView
      {...props}
      blockType={blockType}
      icon={icon ?? (blockType ? getBlockTileIcon(blockType) : undefined)}
      bgColor={bgColor ?? (blockType ? getBlockTileColor(blockType) : undefined)}
      useAccent={Boolean(blockType && hasBlockAccent(blockType))}
    />
  )
}
