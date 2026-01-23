'use client'

import { useEffect, useState } from 'react'

export function DiffControlsDemo() {
  const [mounted, setMounted] = useState(false)
  const [rejectHover, setRejectHover] = useState(false)
  const [acceptHover, setAcceptHover] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', margin: '24px 0', height: '30px' }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          height: '30px',
          overflow: 'hidden',
          borderRadius: '4px',
          isolation: 'isolate',
        }}
      >
        {/* Reject button */}
        <button
          onClick={() => {}}
          onMouseEnter={() => setRejectHover(true)}
          onMouseLeave={() => setRejectHover(false)}
          title='Reject changes'
          style={{
            position: 'relative',
            display: 'flex',
            height: '100%',
            cursor: 'pointer',
            alignItems: 'center',
            border: rejectHover ? '1px solid #3d3d3d' : '1px solid #2c2c2c',
            backgroundColor: rejectHover ? '#363636' : '#292929',
            paddingRight: '20px',
            paddingLeft: '12px',
            fontWeight: 500,
            fontSize: '13px',
            color: rejectHover ? '#e6e6e6' : '#cccccc',
            clipPath: 'polygon(0 0, calc(100% + 10px) 0, 100% 100%, 0 100%)',
            borderRadius: '4px 0 0 4px',
            transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
          }}
        >
          Reject
        </button>
        {/* Slanted divider */}
        <div
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '66px',
            width: '2px',
            transform: 'skewX(-18.4deg)',
            background: 'linear-gradient(to right, #2c2c2c 50%, #238559 50%)',
            zIndex: 10,
          }}
        />
        {/* Accept button */}
        <button
          onClick={() => {}}
          onMouseEnter={() => setAcceptHover(true)}
          onMouseLeave={() => setAcceptHover(false)}
          title='Accept changes (⇧⌘⏎)'
          style={{
            position: 'relative',
            display: 'flex',
            height: '100%',
            cursor: 'pointer',
            alignItems: 'center',
            border: '1px solid rgba(0,0,0,0.15)',
            backgroundColor: '#32bd7e',
            paddingRight: '12px',
            paddingLeft: '20px',
            fontWeight: 500,
            fontSize: '13px',
            color: '#1b1b1b',
            clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)',
            borderRadius: '0 4px 4px 0',
            marginLeft: '-10px',
            filter: acceptHover ? 'brightness(1.1)' : 'brightness(1)',
            transition: 'filter 0.15s',
          }}
        >
          Accept
          <kbd
            style={{
              marginLeft: '8px',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '2px 6px',
              fontWeight: 500,
              fontFamily: 'sans-serif',
              fontSize: '10px',
              color: '#1b1b1b',
            }}
          >
            ⇧⌘<span style={{ display: 'inline-block', transform: 'translateY(-1px)' }}>⏎</span>
          </kbd>
        </button>
      </div>
    </div>
  )
}
