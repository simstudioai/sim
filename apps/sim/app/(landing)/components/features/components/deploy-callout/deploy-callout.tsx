import type { ComponentType, SVGProps } from 'react'
import { Calendar } from '@/components/emcn'
import { ApiIcon, SlackIcon } from '@/components/icons'
import { CalloutFrame } from '@/app/(landing)/components/features/components/feature-stage/feature-stage'

/**
 * The Dispatch beat's callout — a static recreation of Sim's deploy surface: one
 * agent, shipped three ways. Each row is a live target (an API endpoint, a Slack
 * bot, a scheduled run) with its current state, the way the real product lists
 * deployments. Decorative.
 */
interface DeployTarget {
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  state: string
}

const TARGETS: DeployTarget[] = [
  { Icon: ApiIcon, label: 'API endpoint', state: 'Live' },
  { Icon: SlackIcon, label: 'Slack bot', state: 'Connected' },
  { Icon: Calendar, label: 'Scheduled run', state: 'Daily · 9:00 AM' },
]

export function DeployCallout() {
  return (
    <CalloutFrame className='w-[340px]'>
      <div className='border-[#e6e6e6] border-b px-4 py-3'>
        <p className='font-medium text-[#121212] text-[14px]'>Deploy</p>
        <p className='text-[#5f5f5f] text-[12px]'>Self-healing CRM</p>
      </div>
      <div className='flex flex-col p-2'>
        {TARGETS.map(({ Icon, label, state }) => (
          <div key={label} className='flex items-center gap-2.5 rounded-lg px-2 py-2.5'>
            <Icon className='size-[16px] flex-shrink-0 text-[#121212]' />
            <span className='flex-1 text-[#121212] text-[14px]'>{label}</span>
            <span className='text-[#5f5f5f] text-[12px]'>{state}</span>
          </div>
        ))}
      </div>
    </CalloutFrame>
  )
}
