// Assuming custom icons exist for Sim specific things, otherwise use Lucide

import type React from 'react'
import { memo } from 'react'
import {
  // For header icon
  ChevronDown,
  CodeXml,
  // For Add Tool button
  PlusIcon,
} from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { AgentIcon, ConnectIcon, SlackIcon, StartIcon } from '@/components/icons'
import { CodeBlock } from '@/components/ui/code-block'
import { cn } from '@/lib/utils'

// Removed DotPattern import

// Configuration for the new block types based on the image
const blockConfig = {
  start: {
    icon: StartIcon, // Assuming a custom StartIcon
    color: '#2563eb', // Blue
    name: 'Start',
  },
  function: {
    icon: CodeXml,
    color: '#e11d48', // Red
    name: 'Function 1',
  },
  agent: {
    icon: AgentIcon, // Assuming custom AgentIcon
    color: '#9333ea', // Purple
    name: 'Agent 1',
  },
  router: {
    icon: ConnectIcon, // Assuming custom ConnectIcon
    color: '#16a34a', // Green
    name: 'Router 1',
  },
  slack: {
    icon: SlackIcon, // Assuming custom SlackIcon
    color: '#611F69', // Slack-like color (adjust if needed)
    name: 'Slack 1',
  },
}

export const HeroBlock = memo(({ id, data }: NodeProps) => {
  const type = data.type as keyof typeof blockConfig
  const config = blockConfig[type] || blockConfig.function
  const Icon = config.icon
  const nodeName = config.name
  const iconBgColor = config.color // Get color from config
  const _horizontalHandles = true // Default to horizontal handles like in workflow-block

  // Determine if we should show the input handle
  // Don't show for start blocks, function1 in hero section, or id=function1
  const showInputHandle =
    type !== 'start' && !(type === 'function' && id === 'function1' && data.isHeroSection)

  return (
    // Apply group relative here for handles
    <div className='group relative flex flex-col items-center opacity-90'>
      {/* Don't show input handle for starter blocks or function1 */}
      {showInputHandle && (
        <Handle
          type='target'
          position={Position.Left}
          id='target'
          className={cn(
            '!w-[7px] !h-5',
            '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
            '!z-[1000]',
            '!opacity-100',
            '!left-[-7px]'
          )}
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
          }}
          data-nodeid={id}
          data-handleid='target'
          isConnectable={true}
        />
      )}

      {/* Use BlockCard, passing Icon, title, and iconBgColor */}
      <BlockCard Icon={Icon} iconBgColor={iconBgColor} title={nodeName}>
        {/* Render type-specific content as children */}
        <div className='space-y-3 pt-3 text-sm'>
          {/* --- Start Block Content --- */}
          {type === 'start' && (
            <>
              <div className='font-medium text-[#7D7D7D] text-base'>Start workflow</div>
              <Container>
                <p>Run Manually</p>
                <ChevronDown size={14} />
              </Container>
            </>
          )}

          {/* --- Function Block Content --- */}
          {type === 'function' && (
            <div className='flex items-center gap-1 font-medium text-neutral-400 text-xs'>
              <CodeBlock
                code='Write javascript..'
                className='min-h-32 w-full border-[#282828] bg-[#212121] p-0 font-geist-mono text-[#7C7C7C]'
              />
            </div>
          )}

          {/* --- Agent Block Content --- */}
          {type === 'agent' && (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>Agent</p>
                <Container>Enter System Prompt</Container>
              </div>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>User Prompts</p>
                <Container>Enter Context</Container>
              </div>
              <div className='flex w-full gap-3'>
                <div className='flex w-full flex-col gap-2'>
                  <p className='font-medium text-[#7D7D7D] text-base'>Model</p>
                  <Container>
                    <p>GPT-4o</p>
                    <ChevronDown size={14} />
                  </Container>
                </div>
                <div className='flex w-full flex-col gap-2'>
                  <p className='font-medium text-[#7D7D7D] text-base'>Tools</p>
                  <Container className='justify-center gap-1'>
                    <PlusIcon size={14} />
                    Add Tools
                  </Container>
                </div>
              </div>
            </div>
          )}

          {/* --- Router Block Content --- */}
          {type === 'router' && (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>Prompt</p>
                <Container className='min-h-32 items-start'>Enter Prompt</Container>
              </div>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>Model</p>
                <Container>
                  <p>GPT-4o</p>
                  <ChevronDown size={14} />
                </Container>
              </div>
            </div>
          )}

          {/* --- Slack Block Content --- */}
          {type === 'slack' && (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>Channel</p>
                <Container>Enter Slack channel (#general)</Container>
              </div>
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[#7D7D7D] text-base'>Message</p>
                <Container className='min-h-32 items-start'>
                  <p>Enter your alert message</p>
                </Container>
              </div>
            </div>
          )}
        </div>
      </BlockCard>

      {/* Output Handle - Don't show for slack1 */}
      {id !== 'slack1' && (
        <Handle
          type='source'
          position={Position.Right}
          id='source'
          className={cn(
            '!w-[7px] !h-5',
            '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
            '!z-[1000]',
            '!opacity-100',
            '!right-[-7px]'
          )}
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
          }}
          data-nodeid={id}
          data-handleid='source'
          isConnectable={true}
        />
      )}
    </div>
  )
})

const Container = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl border border-[#282828] bg-[#212121] px-3 py-2 font-normal text-[#7C7C7C] text-sm',
        className
      )}
    >
      {children}
    </div>
  )
}

// Modify BlockCard to accept and use iconBgColor prop
const BlockCard = ({
  Icon,
  iconBgColor,
  title,
  children,
}: {
  Icon: any
  iconBgColor: string
  title: string
  children: React.ReactNode
}) => {
  return (
    <div className='flex min-h-[100px] w-[280px] flex-col rounded-xl border border-[#333333] bg-[#131313] shadow-[0px_0px_6px_3px_rgba(255,_255,_255,_0.05)]'>
      <div className='flex items-center gap-2 border-[#262626] border-b px-4 pt-4 pb-3'>
        {/* Apply background color using inline style */}
        <div
          className={'flex h-6 w-6 items-center justify-center rounded'}
          style={{ backgroundColor: iconBgColor }} // Use inline style
        >
          <Icon className='h-4 w-4 text-white' />
        </div>
        <p className='font-semibold text-base text-neutral-200'>{title}</p>
      </div>
      <div className='flex-grow p-4 pt-0'>{children}</div>
    </div>
  )
}

HeroBlock.displayName = 'HeroBlock'
