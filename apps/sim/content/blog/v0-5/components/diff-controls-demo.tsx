'use client'

import { useState } from 'react'

export function DiffControlsDemo() {
  const [rejectHover, setRejectHover] = useState(false)
  const [acceptHover, setAcceptHover] = useState(false)

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
            alignItems: 'center',
            border: '1px solid #e0e0e0',
            backgroundColor: rejectHover ? '#f0f0f0' : '#f5f5f5',
            paddingRight: '20px',
            paddingLeft: '12px',
            fontWeight: 500,
            fontSize: '13px',
            color: rejectHover ? '#2d2d2d' : '#404040',
            clipPath: 'polygon(0 0, calc(100% + 10px) 0, 100% 100%, 0 100%)',
            borderRadius: '4px 0 0 4px',
            cursor: 'default',
            transition: 'color 150ms, background-color 150ms, border-color 150ms',
          }}
        >
          Reject
        </button>
        {/* Slanted divider - split gray/green */}
        <div
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '66px',
            width: '2px',
            transform: 'skewX(-18.4deg)',
            background: 'linear-gradient(to right, #e0e0e0 50%, #238458 50%)',
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
            alignItems: 'center',
            border: '1px solid rgba(0, 0, 0, 0.15)',
            backgroundColor: '#32bd7e',
            paddingRight: '12px',
            paddingLeft: '20px',
            fontWeight: 500,
            fontSize: '13px',
            color: '#ffffff',
            clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)',
            borderRadius: '0 4px 4px 0',
            marginLeft: '-10px',
            cursor: 'default',
            filter: acceptHover ? 'brightness(1.1)' : undefined,
            transition: 'background-color 150ms, border-color 150ms',
          }}
        >
          Accept
          <kbd
            style={{
              marginLeft: '8px',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              paddingLeft: '6px',
              paddingRight: '6px',
              paddingTop: '2px',
              paddingBottom: '2px',
              fontWeight: 500,
              fontFamily:
                'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
              fontSize: '10px',
              color: '#ffffff',
            }}
          >
            ⇧⌘<span style={{ display: 'inline-block', transform: 'translateY(-1px)' }}>⏎</span>
          </kbd>
        </button>
      </div>
    </div>
  )
}
