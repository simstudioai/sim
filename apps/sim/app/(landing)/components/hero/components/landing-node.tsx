'use client'

import React from 'react'
import { gsap } from 'gsap'
import { Handle, Position } from 'reactflow'
import { LandingBlock } from './landing-block'
import type { LandingCardData } from './types'

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

  return (
    <div ref={wrapperRef} className='landing-node relative'>
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
      <div
        ref={innerRef}
        className='landing-node-inner'
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
