'use client'

import { CheckCircle2, Circle } from 'lucide-react'
import type { ValidationRuleResult } from '@/lib/academy/types'
import { cn } from '@/lib/core/utils/cn'

interface ValidationChecklistProps {
  results: ValidationRuleResult[]
  allPassed: boolean
}

/**
 * Checklist showing exercise validation rules and their current pass/fail state.
 * Rendered inside the exercise sidebar, not as a canvas overlay.
 */
export function ValidationChecklist({ results, allPassed }: ValidationChecklistProps) {
  if (results.length === 0) return null

  return (
    <div>
      <div className='mb-2.5 flex items-center gap-1.5'>
        <span className='font-[430] text-[#ECECEC] text-[12px]'>Checklist</span>
        {allPassed && (
          <span className='ml-auto rounded-full bg-[#4CAF50]/15 px-2 py-0.5 font-[430] text-[#4CAF50] text-[10px]'>
            Complete
          </span>
        )}
      </div>
      <ul className='space-y-1.5'>
        {results.map((result, i) => (
          <li key={i} className='flex items-start gap-2'>
            {result.passed ? (
              <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#4CAF50]' />
            ) : (
              <Circle className='mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#444]' />
            )}
            <span
              className={cn(
                'text-[11px] leading-tight',
                result.passed ? 'text-[#555] line-through' : 'text-[#ECECEC]'
              )}
            >
              {result.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
