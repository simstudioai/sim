import type { ComponentType, HTMLAttributes } from 'react'
import { ChipTag, chipIconSlotClass, cn } from '@sim/emcn'
import { isLightTileColor } from '@sim/workflow-renderer/tile-icon-color'

const WORKFLOW_ROLE_ACCENTS = {
  agentic: { variant: 'workflow', tone: 'inverse' },
  interface: { variant: 'workflow', tone: 'blue' },
  logic: { variant: 'workflow', tone: 'orange' },
  state: { variant: 'workflow', tone: 'yellow' },
  flow: { variant: 'workflow', tone: 'ash' },
  records: { variant: 'workflow', tone: 'green' },
  identity: { variant: 'workflow', tone: 'identity' },
  neutral: { variant: 'workflow', tone: 'neutral' },
  generative: { variant: 'workflow', tone: 'purple' },
  knowledge: { variant: 'workflow', tone: 'content' },
} as const

export type WorkflowTypeRole = keyof typeof WORKFLOW_ROLE_ACCENTS

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

export const hasWorkflowTypeRole = (type: string): type is keyof typeof WORKFLOW_TYPE_ROLES =>
  Object.hasOwn(WORKFLOW_TYPE_ROLES, type)

export const getWorkflowTypeRole = (type: string): WorkflowTypeRole =>
  WORKFLOW_TYPE_ROLES[type as keyof typeof WORKFLOW_TYPE_ROLES] ?? DEFAULT_WORKFLOW_TYPE_ROLE

export const getWorkflowTypeAccent = (type: string) =>
  WORKFLOW_ROLE_ACCENTS[getWorkflowTypeRole(type)]

/**
 * Slot sizes the tile ships in: the 18px detail header, the canvas 16px chip,
 * or 14px for dense rows.
 */
const TILE_SIZE_CLASS = {
  lg: 'size-[18px]',
  md: 'size-[16px]',
  sm: 'size-[14px]',
} as const

/** Icon drawn inside each slot. Only the header tile takes the larger glyph. */
const TILE_ICON_SIZE_CLASS = {
  lg: 'size-[12px]',
  md: 'size-[10px]',
  sm: 'size-[10px]',
} as const

export interface BlockTileViewProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'> {
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
  size?: keyof typeof TILE_SIZE_CLASS
}

/** Shared block tile; callers resolve registry metadata before rendering. */
export function BlockTileView({
  blockType,
  icon,
  bgColor,
  fallbackLabel,
  size = 'md',
  useAccent,
  className,
  ...props
}: BlockTileViewProps) {
  const Icon = icon
  const sizeClass = cn(TILE_SIZE_CLASS[size], className)
  const iconSizeClass = TILE_ICON_SIZE_CLASS[size]

  if (blockType && Icon && useAccent) {
    return (
      <WorkflowTypeIcon
        type={blockType}
        Icon={Icon}
        className={sizeClass}
        iconClassName={iconSizeClass}
        {...props}
      />
    )
  }

  const fill = bgColor
  const foregroundClass = isLightTileColor(fill) ? 'text-black!' : 'text-white!'

  return (
    <div
      className={cn(chipIconSlotClass, 'overflow-hidden rounded-md [&_img]:size-full', sizeClass)}
      style={{ background: fill }}
      {...props}
    >
      {Icon ? (
        <Icon
          className={cn(
            iconSizeClass,
            'transition-transform duration-100 group-hover:scale-110',
            foregroundClass
          )}
        />
      ) : (
        fallbackLabel && (
          <span className={cn('font-bold text-micro', foregroundClass)}>{fallbackLabel}</span>
        )
      )}
    </div>
  )
}

export interface WorkflowTypeIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  type: string
  Icon: ComponentType<{ className?: string }>
  /** Overrides the glyph size when the chip is rendered at a non-default slot. */
  iconClassName?: string
}

/** Shared compact core-block icon used by workflow discovery surfaces. */
export function WorkflowTypeIcon({
  type,
  Icon,
  className,
  iconClassName,
  ...props
}: WorkflowTypeIconProps) {
  const typeAccent = getWorkflowTypeAccent(type)

  return (
    <ChipTag
      variant={typeAccent.variant}
      tone={typeAccent.tone}
      className={cn('size-[16px] shrink-0 justify-center p-0', className)}
      data-workflow-type-icon={type}
      {...props}
    >
      <Icon
        className={cn(
          'size-[10px] transition-transform duration-100 group-hover:scale-110',
          iconClassName
        )}
      />
    </ChipTag>
  )
}

export interface WorkflowTypeTagProps {
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
  const typeAccent = getWorkflowTypeAccent(type)
  const sharedClassName = cn(
    'shrink-0 justify-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
    !isEnabled && 'opacity-50'
  )
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
        variant='brand'
        brandColor={iconBgColor}
        brandForeground={isLightTileColor(iconBgColor) ? 'dark' : 'light'}
        className={sharedClassName}
        data-workflow-type-accent={type}
        data-workflow-brand-tag=''
      >
        <Icon className='size-[14px] shrink-0' />
        {label}
      </ChipTag>
    )
  }

  return (
    <ChipTag
      variant={typeAccent.variant}
      tone={typeAccent.tone}
      className={sharedClassName}
      data-workflow-type-accent={type}
    >
      <Icon className='size-[14px] shrink-0' />
      {label}
    </ChipTag>
  )
}
