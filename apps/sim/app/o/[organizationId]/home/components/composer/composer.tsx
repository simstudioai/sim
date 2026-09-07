'use client'

import { useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { ArrowUp, Mic, Paperclip, Plus, Slash } from '@sim/emcn/icons'

const TOOL_BUTTON_CLASS = 'size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
const TOOL_ICON_CLASS = 'size-[16px] text-[var(--text-icon)]'

const SEND_BUTTON_BASE = 'size-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
const SEND_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

/**
 * The organization home composer. Mirrors the workspace chat input's chrome:
 * the framed field, the resource, attachment, and skill triggers on the left,
 * and voice input plus send on the right.
 */
export function Composer() {
  const [draft, setDraft] = useState('')
  const canSubmit = draft.trim().length > 0

  return (
    <div className='relative z-10 mx-auto w-full max-w-chat cursor-text rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 shadow-ambient dark:bg-[var(--surface-4)]'>
      <div className='relative max-h-[200px] min-h-[56px] overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder='Ask Sim to...'
          aria-label='Message'
          rows={1}
          className='field-sizing-content m-0 box-border min-h-[24px] w-full resize-none border-0 bg-transparent px-1 py-1 font-body text-[14px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em] outline-hidden [overflow-wrap:anywhere] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                aria-label='Add resources'
                className={TOOL_BUTTON_CLASS}
              >
                <Plus className={TOOL_ICON_CLASS} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Add resources</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                aria-label='Attach file'
                className={TOOL_BUTTON_CLASS}
              >
                <Paperclip className={TOOL_ICON_CLASS} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Attach file</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                aria-label='Skills'
                className={TOOL_BUTTON_CLASS}
              >
                <Slash className={TOOL_ICON_CLASS} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Skills</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <div className='flex items-center gap-1.5'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                aria-label='Voice input'
                className={TOOL_BUTTON_CLASS}
              >
                <Mic className={TOOL_ICON_CLASS} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Voice input</Tooltip.Content>
          </Tooltip.Root>
          <Button
            type='button'
            variant='ghost'
            disabled={!canSubmit}
            aria-label='Send'
            className={cn(SEND_BUTTON_BASE, canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED)}
          >
            <ArrowUp className='block size-[16px] text-white dark:text-black' />
          </Button>
        </div>
      </div>
    </div>
  )
}
