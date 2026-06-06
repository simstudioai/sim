'use client'

import { memo } from 'react'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { Handle, type NodeProps, Position } from 'reactflow'
import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'
import {
  BLOCK_STAGGER,
  EASE_OUT,
  type PreviewTool,
} from '@/components/workflow-preview/workflow-data'

interface PreviewBlockData {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  tools?: PreviewTool[]
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
  index?: number
  animate?: boolean
  isHighlighted?: boolean
  isDimmed?: boolean
}

/**
 * Handle styling matching the real WorkflowBlock handles.
 * --workflow-edge in dark mode: #454545
 */
const HANDLE_BASE = '!z-[10] !border-none !bg-[#454545]'
const HANDLE_LEFT = `${HANDLE_BASE} !left-[-8px] !h-5 !w-[7px] !rounded-r-none !rounded-l-[2px]`
const HANDLE_RIGHT = `${HANDLE_BASE} !right-[-8px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px]`

/**
 * Static preview block node matching the real WorkflowBlock styling.
 * Renders a header (icon + name), sub-block rows, and tool chips.
 *
 * Dark-theme colors mirror the app canvas:
 * surface #232323, border #3d3d3d, text #e6e6e6 / #b3b3b3.
 */
export const PreviewBlockNode = memo(function PreviewBlockNode({
  data,
}: NodeProps<PreviewBlockData>) {
  const {
    name,
    blockType,
    bgColor,
    rows,
    tools,
    hideTargetHandle,
    hideSourceHandle,
    index = 0,
    animate = false,
    isHighlighted = false,
    isDimmed = false,
  } = data
  const Icon = BLOCK_ICONS[blockType]
  const delay = animate ? index * BLOCK_STAGGER : 0
  const hasContent = rows.length > 0 || (tools && tools.length > 0)

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className='relative transition-opacity duration-300'
        style={{ opacity: isDimmed ? 0.35 : 1 }}
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: isDimmed ? 0.35 : 1 }}
        transition={{ duration: 0.45, delay, ease: EASE_OUT }}
      >
        <div className='relative z-[20] w-[250px] select-none rounded-[8px] border border-[#3d3d3d] bg-[#232323]'>
          {isHighlighted && (
            <div className='pointer-events-none absolute inset-0 z-40 rounded-[8px] ring-[#33b4ff] ring-2' />
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
            className={`flex items-center justify-between p-2 ${hasContent ? 'border-[#3d3d3d] border-b' : ''}`}
          >
            <div className='relative z-10 flex min-w-0 flex-1 items-center gap-2.5'>
              <div
                className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
                style={{ background: bgColor }}
              >
                {Icon && <Icon className='size-[16px] text-white' />}
              </div>
              <span className='truncate font-medium text-[#e6e6e6] text-[16px]'>{name}</span>
            </div>
          </div>

          {hasContent && (
            <div className='flex flex-col gap-2 p-2'>
              {rows.map((row) => (
                <div key={row.title} className='flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[#b3b3b3] text-[14px] capitalize'>
                    {row.title}
                  </span>
                  {row.value && (
                    <span className='flex min-w-0 flex-1 items-center justify-end gap-2 font-normal text-[#e6e6e6] text-[14px]'>
                      <span className='truncate'>{row.value}</span>
                    </span>
                  )}
                </div>
              ))}

              {tools && tools.length > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[#b3b3b3] text-[14px]'>
                    Tools
                  </span>
                  <div className='flex flex-1 flex-wrap items-center justify-end gap-[5px]'>
                    {tools.map((tool) => {
                      const ToolIcon = BLOCK_ICONS[tool.type]
                      return (
                        <div
                          key={tool.type}
                          className='flex items-center gap-[5px] rounded-[5px] border border-[#3d3d3d] bg-[#2a2a2a] px-[6px] py-[3px]'
                        >
                          <div
                            className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                            style={{ background: tool.bgColor }}
                          >
                            {ToolIcon && <ToolIcon className='size-[10px] text-white' />}
                          </div>
                          <span className='font-normal text-[#e6e6e6] text-[12px]'>
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

          {!hideSourceHandle && (
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
