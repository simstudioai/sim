'use client'

import React from 'react'
import { Handle, Position } from 'reactflow'
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
 * @param props - Component properties containing node data
 * @returns A React Flow compatible loop node component
 */
export const LandingLoopNode = React.memo(function LandingLoopNode({
  data,
}: {
  data: LoopNodeData
}) {
  return (
    <div className='landing-loop-node relative'>
      <Handle
        type='target'
        position={Position.Left}
        style={{
          opacity: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
        }}
        isConnectable={false}
      />
      <Handle
        type='source'
        position={Position.Right}
        style={{
          opacity: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
        }}
        isConnectable={false}
      />
      <LoopBlock>
        <div className='flex items-start gap-3 px-6 py-4'>
          <span className='font-medium text-base text-blue-500'>Loop</span>
        </div>
        {data.children}
      </LoopBlock>
    </div>
  )
})
