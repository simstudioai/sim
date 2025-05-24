'use client'

import { useEffect, useRef, useState } from 'react'

interface ToolbarTabsProps {
  activeTab: 'blocks' | 'tools'
  onTabChange: (tab: 'blocks' | 'tools') => void
}

export function ToolbarTabs({ activeTab, onTabChange }: ToolbarTabsProps) {
  const blocksRef = useRef<HTMLButtonElement>(null)
  const toolsRef = useRef<HTMLButtonElement>(null)
  const [underlineStyle, setUnderlineStyle] = useState({
    width: 0,
    transform: '',
  })

  useEffect(() => {
    const activeRef = activeTab === 'blocks' ? blocksRef : toolsRef
    if (activeRef.current) {
      const rect = activeRef.current.getBoundingClientRect()
      const parentRect = activeRef.current.parentElement?.getBoundingClientRect()
      const offsetLeft = parentRect ? rect.left - parentRect.left : 0

      setUnderlineStyle({
        width: rect.width,
        transform: `translateX(${offsetLeft}px)`,
      })
    }
  }, [activeTab])

  return (
    <div className='relative pt-5'>
      <div className='flex gap-8 px-6'>
        <button
          ref={blocksRef}
          onClick={() => onTabChange('blocks')}
          className={`font-medium text-sm transition-colors hover:text-foreground ${
            activeTab === 'blocks' ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          Blocks
        </button>
        <button
          ref={toolsRef}
          onClick={() => onTabChange('tools')}
          className={`font-medium text-sm transition-colors hover:text-foreground ${
            activeTab === 'tools' ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          Tools
        </button>
      </div>

      <div className='relative mt-2'>
        <div className='absolute bottom-0 h-[1px] w-full border-b' />
        <div
          className='absolute bottom-0 h-[1.5px] bg-foreground transition-transform duration-200'
          style={{
            width: `${underlineStyle.width}px`,
            transform: underlineStyle.transform,
          }}
        />
      </div>
    </div>
  )
}
