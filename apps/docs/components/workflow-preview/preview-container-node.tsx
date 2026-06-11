'use client'

import { memo } from 'react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'

interface PreviewContainerData {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
}

const HANDLE_BASE = '!z-[10] !border-none !bg-[var(--wp-edge)]'
const HANDLE_LEFT = `${HANDLE_BASE} !left-[-8px] !h-5 !w-[7px] !rounded-r-none !rounded-l-[2px]`
const HANDLE_RIGHT = `${HANDLE_BASE} !right-[-8px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px]`
const HANDLE_START = `${HANDLE_BASE} !right-[-8px] !h-4 !w-[7px] !rounded-l-none !rounded-r-[2px]`

/** Legible icon class for the header swatch — dark glyph on a light bg, white on a dark one. */
function iconClassFor(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return 'text-white'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? 'text-[#1c1c1c]' : 'text-white'
}

/**
 * Container node for Loop / Parallel blocks, mirroring the app's subflow node:
 * a solid-bordered box with a header (icon + name), an internal "Start" pill
 * whose right handle feeds the first nested block, and target/source handles at
 * the vertical center. React Flow positions the child blocks inside via parentNode.
 */
export const PreviewContainerNode = memo(function PreviewContainerNode({
  data,
}: NodeProps<PreviewContainerData>) {
  const { name, blockType, bgColor, hideTargetHandle, hideSourceHandle } = data
  const Icon = BLOCK_ICONS[blockType]

  return (
    <div className='relative h-full w-full select-none rounded-[8px] border border-[var(--wp-border-1)] bg-[var(--wp-container-fill)]'>
      {!hideTargetHandle && (
        <Handle
          type='target'
          position={Position.Left}
          id='target'
          className={HANDLE_LEFT}
          style={{ top: '50%', transform: 'translateY(-50%)' }}
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      )}

      <div className='flex items-center gap-2.5 rounded-t-[8px] border-[var(--wp-border-1)] border-b bg-[var(--wp-header)] py-2 pr-3 pl-2'>
        <div
          className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
          style={{ background: bgColor }}
        >
          {Icon && <Icon className={`size-[16px] ${iconClassFor(bgColor)}`} />}
        </div>
        <span className='truncate font-medium text-[16px] text-[var(--wp-text)]'>{name}</span>
      </div>

      <div className='absolute top-[56px] left-4 flex items-center justify-center rounded-lg border border-[var(--wp-border-1)] bg-[var(--wp-header)] px-3 py-1.5'>
        <span className='font-medium text-[13px] text-[var(--wp-text)]'>Start</span>
        <Handle
          type='source'
          position={Position.Right}
          id='loop-start-source'
          className={HANDLE_START}
          style={{ top: '50%', transform: 'translateY(-50%)' }}
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      </div>

      {!hideSourceHandle && (
        <Handle
          type='source'
          position={Position.Right}
          id='source'
          className={HANDLE_RIGHT}
          style={{ top: '50%', transform: 'translateY(-50%)' }}
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      )}
    </div>
  )
})
