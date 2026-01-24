'use client'

import { useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'

interface ContactButtonProps {
  href: string
  children: React.ReactNode
}

export function ContactButton({ href, children }: ContactButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '10px',
        background: 'linear-gradient(to bottom, #8357ff, #6f3dfa)',
        border: '1px solid #6f3dfa',
        boxShadow: 'inset 0 2px 4px 0 #9b77ff',
        paddingTop: '6px',
        paddingBottom: '6px',
        paddingLeft: '12px',
        paddingRight: '10px',
        fontSize: '15px',
        fontWeight: 500,
        color: '#ffffff',
        textDecoration: 'none',
        opacity: isHovered ? 0.9 : 1,
        transition: 'opacity 200ms',
      }}
    >
      {children}
      <span style={{ display: 'inline-flex' }}>
        {isHovered ? (
          <ArrowRight style={{ height: '16px', width: '16px' }} aria-hidden='true' />
        ) : (
          <ChevronRight style={{ height: '16px', width: '16px' }} aria-hidden='true' />
        )}
      </span>
    </a>
  )
}
