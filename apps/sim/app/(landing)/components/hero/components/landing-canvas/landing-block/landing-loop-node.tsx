'use client'

import React from 'react'
import { LoopBlock } from './loop-block'

/**
 * Data structure for the loop node
 */
export interface LoopNodeData {
  /** Label for the loop block */
  label?: string
  /** Child content to render inside */
  children?: React.ReactNode
}

/**
 * React Flow node component for the loop block
 * Acts as a group node for subflow functionality
 * @param props - Component properties containing node data
 * @returns A React Flow compatible loop node component
 */
export const LandingLoopNode = React.memo(function LandingLoopNode({
  data,
  style,
}: {
  data: LoopNodeData
  style?: React.CSSProperties
}) {
  return (
    <div
      className='nodrag nopan nowheel relative cursor-grab active:cursor-grabbing'
      style={{
        width: style?.width || 1198,
        height: style?.height || 528,
        backgroundColor: 'transparent',
        outline: 'none !important',
        boxShadow: 'none !important',
        border: 'none !important',
      }}
    >
      <LoopBlock style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
        <div className='flex items-start gap-3 px-6 py-4'>
          <span className='font-medium text-base text-blue-500'>Loop</span>
        </div>
        {data.children}
      </LoopBlock>
    </div>
  )
})
