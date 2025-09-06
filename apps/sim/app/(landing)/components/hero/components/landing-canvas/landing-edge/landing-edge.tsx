'use client'

import React from 'react'
import { type EdgeProps, getSmoothStepPath, Position } from 'reactflow'

/**
 * Custom edge component with animated dotted line that floats between handles
 * @param props - React Flow edge properties
 * @returns An animated dotted edge component
 */
export const LandingEdge = React.memo(function LandingEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } =
    props

  // Adjust the connection points to create floating effect
  // Account for handle size (12px) and additional spacing
  const handleRadius = 6 // Half of handle width (12px)
  const floatingGap = 1 // Additional gap for floating effect

  // Calculate adjusted positions based on edge direction
  let adjustedSourceX = sourceX
  let adjustedTargetX = targetX

  if (sourcePosition === Position.Right) {
    adjustedSourceX = sourceX + handleRadius + floatingGap
  } else if (sourcePosition === Position.Left) {
    adjustedSourceX = sourceX - handleRadius - floatingGap
  }

  if (targetPosition === Position.Left) {
    adjustedTargetX = targetX - handleRadius - floatingGap
  } else if (targetPosition === Position.Right) {
    adjustedTargetX = targetX + handleRadius + floatingGap
  }

  const [path] = getSmoothStepPath({
    sourceX: adjustedSourceX,
    sourceY,
    targetX: adjustedTargetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 20,
    offset: 10,
  })

  return (
    <g style={{ zIndex: 1 }}>
      <style>
        {`
          @keyframes landing-edge-dash-${id} {
            from {
              stroke-dashoffset: 0;
            }
            to {
              stroke-dashoffset: -12;
            }
          }
        `}
      </style>
      <path
        id={id}
        d={path}
        fill='none'
        className='react-flow__edge-path'
        style={{
          stroke: '#D1D1D1',
          strokeWidth: 2,
          strokeDasharray: '6 6',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: 'none',
          animation: `landing-edge-dash-${id} 1s linear infinite`,
          willChange: 'stroke-dashoffset',
          ...style,
        }}
      />
    </g>
  )
})
