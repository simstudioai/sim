'use client'

import { memo } from 'react'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { Handle, type NodeProps, Position } from 'reactflow'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'
import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'
import {
  BLOCK_STAGGER,
  EASE_OUT,
  type PreviewTool,
} from '@/components/workflow-preview/workflow-data'

/** Core-block glyph first, then the integration icon map so diagrams can show tools too. */
function resolveIcon(type: string) {
  return BLOCK_ICONS[type] ?? blockTypeToIconMap[type] ?? null
}

interface PreviewBlockData {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  branches?: Array<{ id: string; label: string; value?: string }>
  showError?: boolean
  tools?: PreviewTool[]
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
  index?: number
  animate?: boolean
  isHighlighted?: boolean
  isDimmed?: boolean
}

/**
 * Handle styling matching the real WorkflowBlock handles (--wp-edge mirrors
 * the app's --workflow-edge in both modes).
 */
const HANDLE_BASE = '!z-[10] !border-none !bg-[var(--wp-edge)]'
const HANDLE_LEFT = `${HANDLE_BASE} !left-[-8px] !h-5 !w-[7px] !rounded-r-none !rounded-l-[2px]`
const HANDLE_RIGHT = `${HANDLE_BASE} !right-[-8px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px]`
const HANDLE_BRANCH =
  '!z-[10] !border-none !right-[-16px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px] !bg-[var(--wp-edge)]'
const HANDLE_ERROR =
  '!z-[10] !border-none !right-[-16px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px] !bg-[var(--text-error)]'

/**
 * Static preview block node matching the real WorkflowBlock styling.
 * Renders a header (icon + name), sub-block rows, and tool chips.
 *
 * Colors come from preview-theme.module.css, mirroring the app's tokens in
 * both light and dark mode.
 */
export const PreviewBlockNode = memo(function PreviewBlockNode({
  data,
}: NodeProps<PreviewBlockData>) {
  const {
    name,
    blockType,
    bgColor,
    rows,
    branches,
    showError,
    tools,
    hideTargetHandle,
    hideSourceHandle,
    index = 0,
    animate = false,
    isHighlighted = false,
    isDimmed = false,
  } = data
  const Icon = resolveIcon(blockType)
  const delay = animate ? index * BLOCK_STAGGER : 0
  const hasBranches = Boolean(branches && branches.length > 0)
  const hasContent =
    rows.length > 0 || hasBranches || Boolean(showError) || (tools && tools.length > 0)
  /* A block with branch handles emits from them, not from the header handle. */
  const showHeaderSource = !hideSourceHandle && !hasBranches

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className='relative transition-opacity duration-300'
        style={{ opacity: isDimmed ? 0.35 : 1 }}
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: isDimmed ? 0.35 : 1 }}
        transition={{ duration: 0.45, delay, ease: EASE_OUT }}
      >
        <div className='relative z-[20] w-[250px] select-none rounded-[8px] border border-[var(--wp-border-1)] bg-[var(--wp-surface)]'>
          {isHighlighted && (
            <div className='pointer-events-none absolute inset-0 z-40 rounded-[8px] ring-2 ring-[var(--wp-highlight)]' />
          )}
          {!hideTargetHandle && (
            <Handle
              type='target'
              position={Position.Left}
              id='target'
              className={HANDLE_LEFT}
              style={{ top: '20px', transform: 'translateY(-50%)' }}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          )}

          <div
            className={`flex items-center justify-between p-2 ${hasContent ? 'border-[var(--wp-border-1)] border-b' : ''}`}
          >
            <div className='relative z-10 flex min-w-0 flex-1 items-center gap-2.5'>
              <div
                className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
                style={{ background: bgColor }}
              >
                {Icon && <Icon className='size-[16px] text-white' />}
              </div>
              <span className='truncate font-medium text-[16px] text-[var(--wp-text)]'>{name}</span>
            </div>
          </div>

          {hasContent && (
            <div className='flex flex-col gap-2 p-2'>
              {rows.map((row) => (
                <div key={row.title} className='flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[14px] text-[var(--wp-text-3)] capitalize'>
                    {row.title}
                  </span>
                  {row.value && (
                    <span className='flex min-w-0 flex-1 items-center justify-end gap-2 font-normal text-[14px] text-[var(--wp-text)]'>
                      <span className='truncate'>{row.value}</span>
                    </span>
                  )}
                </div>
              ))}

              {branches?.map((branch) => (
                <div key={branch.id} className='relative flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[14px] text-[var(--wp-text-3)] capitalize'>
                    {branch.label}
                  </span>
                  <span className='flex min-w-0 flex-1 items-center justify-end font-normal text-[14px] text-[var(--wp-text)]'>
                    <span className='truncate'>{branch.value ?? '-'}</span>
                  </span>
                  <Handle
                    type='source'
                    position={Position.Right}
                    id={branch.id}
                    className={HANDLE_BRANCH}
                    isConnectableStart={false}
                    isConnectableEnd={false}
                  />
                </div>
              ))}

              {showError && (
                <div className='relative flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[14px] text-[var(--wp-text-3)] capitalize'>
                    error
                  </span>
                  <Handle
                    type='source'
                    position={Position.Right}
                    id='error'
                    className={HANDLE_ERROR}
                    isConnectableStart={false}
                    isConnectableEnd={false}
                  />
                </div>
              )}

              {tools && tools.length > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[14px] text-[var(--wp-text-3)]'>
                    Tools
                  </span>
                  <div className='flex flex-1 flex-wrap items-center justify-end gap-[5px]'>
                    {tools.map((tool) => {
                      const ToolIcon = resolveIcon(tool.type)
                      return (
                        <div
                          key={tool.type}
                          className='inline-flex h-5 items-center gap-1.5 rounded-md bg-[var(--wp-chip-bg)] px-1 shadow-[inset_0_0_0_1px_var(--wp-border-1)]'
                        >
                          <div
                            className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
                            style={{ background: tool.bgColor }}
                          >
                            {ToolIcon && <ToolIcon className='size-[9px] text-white' />}
                          </div>
                          <span className='font-normal text-[12px] text-[var(--wp-chip-text)] leading-5'>
                            {tool.name}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {showHeaderSource && (
            <Handle
              type='source'
              position={Position.Right}
              id='source'
              className={HANDLE_RIGHT}
              style={{ top: '20px', transform: 'translateY(-50%)' }}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          )}
        </div>
      </m.div>
    </LazyMotion>
  )
})
