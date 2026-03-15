'use client'

import { type SVGProps, useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { ChevronDown } from '@/components/emcn'
import { Database, File, Library, Table } from '@/components/emcn/icons'
import {
  AnthropicIcon,
  GeminiIcon,
  GmailIcon,
  GroqIcon,
  HubspotIcon,
  OpenAIIcon,
  SalesforceIcon,
  SlackIcon,
  xAIIcon,
} from '@/components/icons'

interface IconEntry {
  key: string
  icon: React.ComponentType<SVGProps<SVGSVGElement>>
  label: string
  top: string
  left: string
  color?: string
}

const SCATTERED_ICONS: IconEntry[] = [
  { key: 'slack', icon: SlackIcon, label: 'Slack', top: '8%', left: '14%' },
  { key: 'openai', icon: OpenAIIcon, label: 'OpenAI', top: '8%', left: '44%' },
  { key: 'anthropic', icon: AnthropicIcon, label: 'Anthropic', top: '10%', left: '78%' },
  { key: 'gmail', icon: GmailIcon, label: 'Gmail', top: '24%', left: '90%' },
  { key: 'salesforce', icon: SalesforceIcon, label: 'Salesforce', top: '28%', left: '6%' },
  { key: 'table', icon: Table, label: 'Tables', top: '22%', left: '30%' },
  { key: 'xai', icon: xAIIcon, label: 'xAI', top: '26%', left: '66%' },
  { key: 'hubspot', icon: HubspotIcon, label: 'HubSpot', top: '55%', left: '4%', color: '#FF7A59' },
  { key: 'database', icon: Database, label: 'Database', top: '74%', left: '68%' },
  { key: 'file', icon: File, label: 'Files', top: '70%', left: '18%' },
  { key: 'gemini', icon: GeminiIcon, label: 'Gemini', top: '58%', left: '86%' },
  { key: 'logs', icon: Library, label: 'Logs', top: '86%', left: '44%' },
  { key: 'groq', icon: GroqIcon, label: 'Groq', top: '90%', left: '82%' },
]

const EXPLODE_STAGGER = 0.04
const EXPLODE_BASE_DELAY = 0.1

export function FeaturesPreview() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, margin: '-80px' })

  return (
    <div ref={containerRef} className='relative h-[560px] w-full overflow-hidden'>
      <div
        aria-hidden='true'
        className='absolute inset-0'
        style={{
          backgroundImage: 'radial-gradient(circle, #D4D4D4 0.75px, transparent 0.75px)',
          backgroundSize: '12px 12px',
          maskImage: 'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
        }}
      />

      {SCATTERED_ICONS.map(({ key, icon: Icon, label, top, left, color }, index) => {
        const explodeDelay = EXPLODE_BASE_DELAY + index * EXPLODE_STAGGER

        return (
          <motion.div
            key={key}
            className='absolute flex items-center justify-center rounded-xl border border-[#E5E5E5] bg-white p-[10px] shadow-[0_2px_4px_0_rgba(0,0,0,0.06)]'
            initial={{ top: '50%', left: '50%', opacity: 0, scale: 0, x: '-50%', y: '-50%' }}
            animate={inView ? { top, left, opacity: 1, scale: 1, x: '-50%', y: '-50%' } : undefined}
            transition={{
              type: 'spring',
              stiffness: 50,
              damping: 12,
              delay: explodeDelay,
            }}
            style={{ color }}
            aria-label={label}
          >
            <Icon className='h-6 w-6' />
          </motion.div>
        )
      })}

      <motion.div
        className='absolute top-1/2 left-[48%]'
        initial={{ opacity: 0, x: '-50%', y: '-50%' }}
        animate={inView ? { opacity: 1, x: '-50%', y: '-50%' } : undefined}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0 }}
      >
        <div className='flex h-[36px] items-center gap-[8px] rounded-[8px] border border-[#E5E5E5] bg-white px-[10px] shadow-[0_2px_6px_0_rgba(0,0,0,0.08)]'>
          <div className='flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[#1e1e1e]'>
            <svg width='11' height='11' viewBox='0 0 10 10' fill='none'>
              <path
                d='M1 9C1 4.58 4.58 1 9 1'
                stroke='white'
                strokeWidth='1.8'
                strokeLinecap='round'
              />
            </svg>
          </div>
          <span className='whitespace-nowrap font-medium font-season text-[#1C1C1C] text-[13px] tracking-[0.02em]'>
            My Workspace
          </span>
          <ChevronDown className='h-[8px] w-[10px] flex-shrink-0 text-[#999]' />
        </div>
      </motion.div>
    </div>
  )
}
