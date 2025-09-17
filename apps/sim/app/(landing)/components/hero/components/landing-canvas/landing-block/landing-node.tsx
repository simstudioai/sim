'use client'

import React from 'react'
import { Handle, Position } from 'reactflow'
import { LandingBlock, type LandingCardData } from './landing-block'

/**
 * React Flow node component for the landing canvas
 * Includes CSS animations and connection handles
 * @param props - Component properties containing node data
 * @returns A React Flow compatible node component
 */
export const LandingNode = React.memo(function LandingNode({ data }: { data: LandingCardData }) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  const [isAnimated, setIsAnimated] = React.useState(false)

  React.useEffect(() => {
    const delay = (data as any)?.delay ?? 0
    const timer = setTimeout(() => {
      setIsAnimated(true)
    }, delay * 1000)

    return () => {
      clearTimeout(timer)
    }
  }, [data])

  // Check if this node should have a target handle (schedule node shouldn't)
  const hideTargetHandle = (data as any)?.hideTargetHandle || false
  // Check if this node should have a source handle (agent and function nodes shouldn't)
  const hideSourceHandle = (data as any)?.hideSourceHandle || false

  return (
    <div ref={wrapperRef} className='relative cursor-grab active:cursor-grabbing'>
      {!hideTargetHandle && (
        <Handle
          type='target'
          position={Position.Left}
          style={{
            width: '12px',
            height: '12px',
            background: '#FEFEFE',
            border: '1px solid #E5E5E5',
            borderRadius: '50%',
            top: '50%',
            left: '-20px',
            transform: 'translateY(-50%)',
            zIndex: 2,
          }}
          isConnectable={false}
        />
      )}
      {!hideSourceHandle && (
        <Handle
          type='source'
          position={Position.Right}
          style={{
            width: '12px',
            height: '12px',
            background: '#FEFEFE',
            border: '1px solid #E5E5E5',
            borderRadius: '50%',
            top: '50%',
            right: '-20px',
            transform: 'translateY(-50%)',
            zIndex: 2,
          }}
          isConnectable={false}
        />
      )}
      <div
        ref={innerRef}
        className={isAnimated ? 'landing-node-animated' : 'landing-node-initial'}
        style={{
          opacity: isAnimated ? 1 : 0,
          transform: isAnimated ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
          transition:
            'opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1), transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform, opacity',
        }}
      >
        <LandingBlock icon={data.icon} color={data.color} name={data.name} tags={data.tags} />
      </div>
    </div>
  )
})
