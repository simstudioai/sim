'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/emcn'

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const FEATURE_TABS = [
  {
    label: 'Integrations',
    color: '#FA4EDF',
    segments: [
      [0.3, 8],
      [0.25, 10],
      [0.45, 12],
      [0.5, 8],
      [0.65, 10],
      [0.8, 12],
      [0.75, 8],
      [0.95, 10],
      [1, 12],
      [0.85, 10],
    ],
  },
  {
    label: 'Copilot',
    color: '#2ABBF8',
    segments: [
      [0.25, 12],
      [0.4, 10],
      [0.35, 8],
      [0.55, 12],
      [0.7, 10],
      [0.85, 8],
      [1, 14],
      [0.9, 12],
      [1, 14],
    ],
  },
  {
    label: 'Models',
    color: '#00F701',
    badgeColor: '#22C55E',
    segments: [
      [0.2, 6],
      [0.35, 10],
      [0.3, 8],
      [0.5, 10],
      [0.6, 8],
      [0.75, 12],
      [0.85, 10],
      [1, 8],
      [0.9, 12],
      [1, 10],
      [0.95, 6],
    ],
  },
  {
    label: 'Deploy',
    color: '#FFCC02',
    badgeColor: '#EAB308',
    segments: [
      [0.3, 12],
      [0.25, 8],
      [0.4, 10],
      [0.55, 10],
      [0.7, 8],
      [0.6, 10],
      [0.85, 12],
      [1, 10],
      [0.9, 10],
      [1, 10],
    ],
  },
  {
    label: 'Logs',
    color: '#FF6B35',
    segments: [
      [0.25, 10],
      [0.35, 8],
      [0.3, 10],
      [0.5, 10],
      [0.65, 8],
      [0.8, 12],
      [0.9, 10],
      [1, 10],
      [0.85, 12],
      [1, 10],
    ],
  },
  {
    label: 'Knowledge Base',
    color: '#8B5CF6',
    segments: [
      [0.3, 10],
      [0.25, 8],
      [0.4, 10],
      [0.5, 10],
      [0.65, 10],
      [0.8, 10],
      [0.9, 12],
      [1, 10],
      [0.95, 10],
      [1, 10],
    ],
  },
]

function DotGrid({
  cols,
  rows,
  width,
  borderLeft,
}: {
  cols: number
  rows: number
  width?: number
  borderLeft?: boolean
}) {
  return (
    <div
      aria-hidden='true'
      className={`shrink-0 bg-[#FDFDFD] p-[6px] ${borderLeft ? 'border-[#E9E9E9] border-l' : ''}`}
      style={{
        width: width ? `${width}px` : undefined,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 4,
        placeItems: 'center',
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <div key={i} className='h-[2px] w-[2px] rounded-full bg-[#DEDEDE]' />
      ))}
    </div>
  )
}

export default function Features() {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='relative overflow-hidden bg-[#F6F6F6] pb-[144px]'
    >
      <div aria-hidden='true' className='absolute top-0 left-0 w-full'>
        <Image
          src='/landing/features-transition.svg'
          alt=''
          width={1440}
          height={366}
          className='h-auto w-full'
          priority
        />
      </div>

      <div className='relative z-10 pt-[100px]'>
        <div className='flex flex-col items-start gap-[20px] px-[80px]'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='font-season uppercase tracking-[0.02em] transition-colors duration-200'
            style={{
              color: FEATURE_TABS[activeTab].badgeColor ?? FEATURE_TABS[activeTab].color,
              backgroundColor: hexToRgba(
                FEATURE_TABS[activeTab].badgeColor ?? FEATURE_TABS[activeTab].color,
                0.1
              ),
            }}
          >
            Features
          </Badge>
          <h2
            id='features-heading'
            className='font-[430] font-season text-[#1C1C1C] text-[40px] leading-[100%] tracking-[-0.02em]'
          >
            Power your AI workforce
          </h2>
        </div>

        <div className='mt-[73px] flex h-[68px] overflow-hidden border border-[#E9E9E9]'>
          <DotGrid cols={10} rows={8} width={80} />

          <div role='tablist' aria-label='Feature categories' className='flex flex-1'>
            {FEATURE_TABS.map((tab, index) => (
              <button
                key={tab.label}
                type='button'
                role='tab'
                aria-selected={index === activeTab}
                onClick={() => setActiveTab(index)}
                className='relative flex h-full flex-1 items-center justify-center border-[#E9E9E9] border-l font-medium font-season text-[#212121] text-[14px] uppercase'
                style={{ backgroundColor: index === activeTab ? '#FDFDFD' : '#F6F6F6' }}
              >
                {tab.label}
                {index === activeTab && (
                  <div className='absolute right-0 bottom-0 left-0 flex h-[6px]'>
                    {tab.segments.map(([opacity, width], i) => (
                      <div
                        key={i}
                        className='h-full shrink-0'
                        style={{
                          width: `${width}%`,
                          backgroundColor: tab.color,
                          opacity,
                        }}
                      />
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          <DotGrid cols={10} rows={8} width={80} borderLeft />
        </div>
      </div>
    </section>
  )
}
