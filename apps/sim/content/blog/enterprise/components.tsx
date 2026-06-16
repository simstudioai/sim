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
        gap: '7px',
        borderRadius: '5px',
        background: isHovered ? '#E0E0E0' : '#FFFFFF',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isHovered ? '#E0E0E0' : '#FFFFFF',
        paddingTop: '5px',
        paddingBottom: '5px',
        paddingLeft: '9px',
        paddingRight: '9px',
        fontSize: '13.5px',
        fontWeight: 430,
        color: '#000000',
        textDecoration: 'none',
        transition: 'background 200ms, border-color 200ms',
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
