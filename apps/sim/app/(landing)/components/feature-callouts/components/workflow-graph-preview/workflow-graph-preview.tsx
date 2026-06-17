import type { ComponentType, SVGProps } from 'react'
import {
  AgentIcon,
  AnthropicIcon,
  GmailIcon,
  HubspotIcon,
  SalesforceIcon,
  SlackIcon,
} from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'

/**
 * WorkflowGraphPreview — a static close-up of the Sim workflow canvas, used as
 * the Graph card's graphic. Unlike the other cards it has no white block: the
 * real block cards sit directly on the canvas, wired together with bezier edges,
 * exactly as they read in the visual builder.
 *
 * It recreates the block chrome part-for-part (a `#2C2C2C` icon tile + name
 * header, sub-block rows, and `#f0f0f0` tool chips, all on a `#e6e6e6` hairline
 * card) and the `#c9c9c9` connector edges — no ReactFlow, no animation, just
 * positioned divs and an SVG edge layer. An Agent ("Lead Router") branches to a
 * Slack and a Gmail action, so the shape reads as real agent logic.
 *
 * A corner gradient mask keeps the detailed Agent block (top-left) crisp while
 * the simpler action blocks dissolve toward the bottom-right — the canvas
 * "continuing" past the card. Decorative (`aria-hidden`).
 */
type IconType = ComponentType<SVGProps<SVGSVGElement>>

const ICON_TILE =
  'flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px] bg-[#2C2C2C]'
const CARD = 'relative w-[240px] rounded-[8px] border border-[#e6e6e6] bg-[#ffffff]'
const HANDLE = 'absolute top-[20px] h-5 w-[7px] -translate-y-1/2 bg-[#c9c9c9]'

interface ToolChip {
  name: string
  Icon: IconType
}

interface BlockCardProps {
  /** Static position classes (e.g. `left-[18px] top-[112px]`). */
  className: string
  name: string
  Icon: IconType
  model?: { value: string; Icon: IconType }
  tools?: ToolChip[]
  leftHandle?: boolean
  rightHandle?: boolean
}

function BlockCard({
  className,
  name,
  Icon,
  model,
  tools,
  leftHandle,
  rightHandle,
}: BlockCardProps) {
  const hasContent = Boolean(model || tools?.length)
  return (
    <div className={cn('absolute select-none', className)}>
      <div className={CARD}>
        {leftHandle && <span className={cn(HANDLE, 'left-[-7px] rounded-l-[2px]')} />}

        <div
          className={cn('flex items-center gap-2.5 p-2', hasContent && 'border-[#e6e6e6] border-b')}
        >
          <div className={ICON_TILE}>
            <Icon className='size-[16px] text-white' />
          </div>
          <span className='truncate font-medium text-[#121212] text-[16px]'>{name}</span>
        </div>

        {hasContent && (
          <div className='flex flex-col gap-2 p-2'>
            {model && (
              <div className='flex items-center gap-2'>
                <span className='flex-shrink-0 text-[#5f5f5f] text-[14px]'>Model</span>
                <span className='flex min-w-0 flex-1 items-center justify-end gap-2 text-[#121212] text-[14px]'>
                  <model.Icon className='inline-block size-[14px] flex-shrink-0 text-[#121212]' />
                  <span className='truncate'>{model.value}</span>
                </span>
              </div>
            )}
            {tools && tools.length > 0 && (
              <div className='flex items-center gap-2'>
                <span className='flex-shrink-0 text-[#5f5f5f] text-[14px]'>Tools</span>
                <div className='flex flex-1 flex-wrap items-center justify-end gap-[5px]'>
                  {tools.map((tool) => (
                    <div
                      key={tool.name}
                      className='flex items-center gap-[5px] rounded-[5px] border border-[#e6e6e6] bg-[#f0f0f0] px-[6px] py-[3px]'
                    >
                      <div className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-[4px] bg-[#2C2C2C]'>
                        <tool.Icon className='size-[10px] text-white' />
                      </div>
                      <span className='text-[#121212] text-[12px]'>{tool.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {rightHandle && <span className={cn(HANDLE, 'right-[-7px] rounded-r-[2px]')} />}
      </div>
    </div>
  )
}

interface WorkflowGraphPreviewProps {
  className?: string
}

export function WorkflowGraphPreview({ className }: WorkflowGraphPreviewProps) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'relative overflow-hidden',
        '[-webkit-mask-image:linear-gradient(to_right,#000_56%,transparent_96%),linear-gradient(to_bottom,#000_60%,transparent_96%)] [mask-image:linear-gradient(to_right,#000_56%,transparent_96%),linear-gradient(to_bottom,#000_60%,transparent_96%)]',
        '[-webkit-mask-composite:source-in] [mask-composite:intersect]',
        className
      )}
    >
      {/* Edge layer — bezier connectors from the Agent's source handle to each
          action block's target handle. Coords are in px and map 1:1 to the box. */}
      <svg className='absolute inset-0 h-full w-full' fill='none' aria-hidden='true'>
        <path d='M258,132 C300,132 290,58 332,58' stroke='#c9c9c9' strokeWidth='1.5' />
        <path d='M258,132 C300,132 290,278 332,278' stroke='#c9c9c9' strokeWidth='1.5' />
      </svg>

      <BlockCard
        className='top-[112px] left-[18px]'
        name='Lead Router'
        Icon={AgentIcon}
        model={{ value: 'claude-opus-4.8', Icon: AnthropicIcon }}
        tools={[
          { name: 'HubSpot', Icon: HubspotIcon },
          { name: 'Salesforce', Icon: SalesforceIcon },
        ]}
        leftHandle
        rightHandle
      />
      <BlockCard className='top-[38px] left-[332px]' name='Slack' Icon={SlackIcon} leftHandle />
      <BlockCard className='top-[258px] left-[332px]' name='Gmail' Icon={GmailIcon} leftHandle />
    </div>
  )
}
