'use client'

import React from 'react'
import { type EdgeProps, getSmoothStepPath, Position } from 'reactflow'

/**
 * Custom edge component with animated dashed line
 * Styled to match the application's workflow edges with rectangular handles
 * @param props - React Flow edge properties
 * @returns An animated dashed edge component
 */
export const LandingEdge = React.memo(function LandingEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style } = props

  // Adjust the connection points to connect flush with rectangular handles
  // Handle width is 7px, positioned at -7px from edge
  let adjustedSourceX = sourceX
  let adjustedTargetX = targetX

  if (sourcePosition === Position.Right) {
    adjustedSourceX = sourceX + 1
  } else if (sourcePosition === Position.Left) {
    adjustedSourceX = sourceX - 1
  }

  if (targetPosition === Position.Left) {
    adjustedTargetX = targetX - 1
  } else if (targetPosition === Position.Right) {
    adjustedTargetX = targetX + 1
  }

  const [path] = getSmoothStepPath({
    sourceX: adjustedSourceX,
    sourceY,
    targetX: adjustedTargetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset: 16,
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
