'use client'

import React from 'react'
import { gsap } from 'gsap'
import { Handle, Position } from 'reactflow'
import { LandingBlock, type LandingCardData } from './landing-block'

/**
 * React Flow node component for the landing canvas
 * Includes GSAP animations and connection handles
 * @param props - Component properties containing node data
 * @returns A React Flow compatible node component
 */
export const LandingNode = React.memo(function LandingNode({ data }: { data: LandingCardData }) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const innerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!innerRef.current) return
    const el = innerRef.current

    // Ensure hidden on mount to avoid any flash before GSAP runs
    el.style.opacity = '0'
    el.style.transform = 'translateY(8px) scale(0.98)'

    const delay = (data as any)?.delay ?? 0
    const dc = gsap.delayedCall(delay, () => {
      gsap.to(el, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.6,
        ease: 'power3.out',
      })
    })

    return () => {
      dc.kill()
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
        style={{
          opacity: 0,
          transform: 'translateY(8px) scale(0.98)',
          willChange: 'transform, opacity',
        }}
      >
        <LandingBlock icon={data.icon} color={data.color} name={data.name} tags={data.tags} />
      </div>
    </div>
  )
})
