'use client'

import { History, Plus } from 'lucide-react'
import { Button } from '@/components/emcn'

/**
 * Copilot panel component.
 * Provides AI-powered assistance and suggestions for workflow development.
 *
 * @returns Copilot panel content
 */
export function Copilot() {
  return (
    <div className='flex h-full flex-col bg-[#232323] dark:bg-[#232323]'>
      {/* Header */}
      <div className='flex items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'>
        <h2 className='font-medium text-[#FFFFFF] text-[14px] dark:text-[#FFFFFF]'>Copilot</h2>
        <div className='flex items-center gap-[8px]'>
          <Button variant='ghost' className='p-0'>
            <Plus className='h-[14px] w-[14px]' />
          </Button>
          <Button variant='ghost' className='p-0'>
            <History className='h-[14px] w-[14px]' />
          </Button>
        </div>
      </div>
    </div>
  )
}
