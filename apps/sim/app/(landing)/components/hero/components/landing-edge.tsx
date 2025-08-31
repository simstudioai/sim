'use client'

import React from 'react'
import { gsap } from 'gsap'
import { BaseEdge, type EdgeProps, getSmoothStepPath } from 'reactflow'

/**
 * Custom edge component with fade-in animation
 * @param props - React Flow edge properties
 * @returns An animated edge component
 */
export const LandingEdge = React.memo(function LandingEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } =
    props

  const [edgeStyle, setEdgeStyle] = React.useState<React.CSSProperties | undefined>(style)

  React.useEffect(() => {
    const delay = (data as any)?.delay ?? 0
    const dc = gsap.delayedCall(Math.max(0, delay), () => {
      setEdgeStyle((prev) => ({ ...(prev || {}), opacity: 1 }))
    })
    return () => {
      dc.kill()
    }
  }, [data])

  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 16,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.08))',
        ...edgeStyle,
      }}
    />
  )
})
