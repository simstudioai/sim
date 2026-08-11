import { Duplicate, PlayOutline, Trash } from '@sim/emcn'
import { Circle, Unlock } from '@sim/emcn/icons'
import { WorkflowBlockBorder, type WorkflowBorderPort } from '@sim/workflow-renderer'
import { getSmoothStepPath, Position } from 'reactflow'
import { EmptyState } from '@/components/empty-state/empty-state'

const MINIATURE_BLOCK_PORTS: WorkflowBorderPort[] = [
  {
    id: 'target',
    side: 'left',
    position: 'center',
    plateau: 32,
    restAmplitude: 1,
    hoverAmplitude: 1,
  },
  {
    id: 'source-upper',
    side: 'right',
    position: 59,
    plateau: 24,
    restAmplitude: 1,
    hoverAmplitude: 1,
  },
  {
    id: 'source-lower',
    side: 'right',
    position: 87,
    plateau: 24,
    restAmplitude: 1,
    hoverAmplitude: 1,
  },
  {
    id: 'action-menu',
    side: 'top',
    position: { fromEnd: 107 },
    plateau: 166,
    restAmplitude: 7,
    hoverAmplitude: 7,
    magnetizable: false,
  },
]

const [LEFT_CONNECTION_PATH] = getSmoothStepPath({
  sourceX: 0,
  sourceY: 92,
  sourcePosition: Position.Right,
  targetX: 62,
  targetY: 92,
  targetPosition: Position.Left,
  borderRadius: 6,
  offset: 12,
})

const [UPPER_RIGHT_CONNECTION_PATH] = getSmoothStepPath({
  sourceX: 258,
  sourceY: 86,
  sourcePosition: Position.Right,
  targetX: 320,
  targetY: 42,
  targetPosition: Position.Left,
  centerX: 289,
  borderRadius: 6,
  offset: 12,
})

const [LOWER_RIGHT_CONNECTION_PATH] = getSmoothStepPath({
  sourceX: 258,
  sourceY: 108,
  sourcePosition: Position.Right,
  targetX: 320,
  targetY: 142,
  targetPosition: Position.Left,
  centerX: 289,
  borderRadius: 6,
  offset: 12,
})

/**
 * Compact workflow vignette rendered with the canonical workflow block silhouette.
 */
function EditorEmptyStateGraphic() {
  return (
    <div aria-hidden='true' className='relative h-[148px] w-[320px] overflow-hidden'>
      <svg className='absolute inset-0' fill='none' viewBox='0 0 320 148' width='320' height='148'>
        <defs>
          <linearGradient
            id='editor-empty-left-connection'
            x1='0'
            y1='0'
            x2='62'
            y2='0'
            gradientUnits='userSpaceOnUse'
          >
            <stop stopColor='var(--workflow-edge)' stopOpacity='0' />
            <stop offset='0.42' stopColor='var(--workflow-edge)' />
            <stop offset='1' stopColor='var(--workflow-edge)' />
          </linearGradient>
          <linearGradient
            id='editor-empty-right-connection'
            x1='258'
            y1='0'
            x2='320'
            y2='0'
            gradientUnits='userSpaceOnUse'
          >
            <stop stopColor='var(--workflow-edge)' />
            <stop offset='0.58' stopColor='var(--workflow-edge)' />
            <stop offset='1' stopColor='var(--workflow-edge)' stopOpacity='0' />
          </linearGradient>
        </defs>
        <path
          d={LEFT_CONNECTION_PATH}
          stroke='url(#editor-empty-left-connection)'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d={UPPER_RIGHT_CONNECTION_PATH}
          stroke='url(#editor-empty-right-connection)'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d={LOWER_RIGHT_CONNECTION_PATH}
          stroke='url(#editor-empty-right-connection)'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>

      <div className='absolute top-[40px] left-[62px] h-[104px] w-[196px]'>
        <div className='relative h-[132px] w-[250px] origin-top-left scale-[0.784]'>
          <WorkflowBlockBorder
            ports={MINIATURE_BLOCK_PORTS}
            cursorSwellEnabled={false}
            hasRing={false}
            ringStyles=''
            staticActionMenuSwell
            width={250}
            height={132}
          />

          <div className='-top-[28px] absolute right-[24px] z-10 flex h-[28px] w-[166px] items-center gap-[2px] overflow-hidden px-[3px] py-0.5 text-[var(--text-icon)]'>
            <span className='flex h-[24px] w-[40px] shrink-0 items-center justify-center'>
              <PlayOutline className='size-[14px] translate-x-[8px] translate-y-px' />
            </span>
            <span className='flex size-[24px] shrink-0 items-center justify-center'>
              <Circle className='size-[14px]' />
            </span>
            <span className='flex size-[24px] shrink-0 items-center justify-center'>
              <Unlock className='size-[14px]' />
            </span>
            <span className='flex size-[24px] shrink-0 items-center justify-center'>
              <Duplicate className='size-[14px]' />
            </span>
            <span className='flex h-[24px] w-[40px] shrink-0 items-center justify-center'>
              <Trash className='-translate-x-[6px] size-[14px] translate-y-px' />
            </span>
          </div>

          <div className='relative z-10 flex h-[40px] items-center justify-between px-2'>
            <span className='h-3 w-[92px] rounded-[3px] bg-[color-mix(in_srgb,var(--text-secondary)_22%,transparent)]' />
            <span className='h-[20px] w-[52px] rounded-[6px] bg-[var(--surface-5)]' />
          </div>

          <div className='relative z-10 space-y-2 p-2'>
            <span className='block h-3 w-[148px] rounded-[3px] bg-[var(--surface-4)]' />
            <span className='block h-3 w-[102px] rounded-[3px] bg-[var(--surface-4)]' />
          </div>

          <div className='absolute right-2 bottom-2 left-2 z-10 flex h-[24px] items-center rounded-[6px] bg-[var(--surface-5)] px-2'>
            <span className='ml-auto h-[16px] w-[30px] rounded-full bg-[var(--border-1)] p-0.5'>
              <span className='block size-3 rounded-full bg-[var(--surface-2)] shadow-sm' />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Guidance shown when the editor has no selected workflow block.
 */
export function EditorEmptyState() {
  return (
    <EmptyState
      graphic={<EditorEmptyStateGraphic />}
      title='Select a block to edit'
      description='Choose a block on the canvas to view and configure its settings.'
    />
  )
}
