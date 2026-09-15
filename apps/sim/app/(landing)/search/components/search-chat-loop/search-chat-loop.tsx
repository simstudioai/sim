'use client'

import { useEffect, useState } from 'react'
import { Chip, cn, Tooltip, usePrefersReducedMotion } from '@sim/emcn'
import { FileText, Mic, Paperclip, Plus, Slash } from '@sim/emcn/icons'
import { SEARCH_SCENARIOS } from '@/app/(landing)/search/components/search-chat-loop/scenarios'
import { SearchResultTable } from '@/app/(landing)/search/components/search-result-table/search-result-table'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'
import { PendingTagIndicator } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/pending-tag-indicator'
import { PromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/prompt-editor'
import { usePromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import { SendButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/send-button/send-button'

interface SearchChatLoopProps {
  initialScenario?: number
  presentation?: 'search' | 'conversation'
}

const CYCLE_MS = 12000
const noop = () => undefined

/** Production Chat editor, send control, activity indicator, and resource mentions with local scripted turns. */
export function SearchChatLoop({
  initialScenario = 0,
  presentation = 'search',
}: SearchChatLoopProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [elapsed, setElapsed] = useState(0)
  const editor = usePromptEditor({ workspaceId: '', contextsEnabled: false })
  const { setValue } = editor
  const conversation = presentation === 'conversation'
  const scenarioIndex = conversation
    ? initialScenario
    : (initialScenario + Math.floor(elapsed / CYCLE_MS)) % SEARCH_SCENARIOS.length
  const scenario = SEARCH_SCENARIOS[scenarioIndex]
  const beat = reducedMotion ? 9000 : conversation ? 3650 + (elapsed % 8350) : elapsed % CYCLE_MS
  const sent = beat >= 3200
  const answering = beat >= 4800
  const fading = beat >= 11500
  const prompt = sent ? '' : scenario.prompt.slice(0, Math.max(0, Math.floor((beat - 600) / 32)))
  const words = scenario.kind === 'chat' ? (scenario.reply.match(/\S+\s*/g) ?? []) : []
  const reply = words.slice(0, Math.max(0, Math.floor((beat - 4800) / 60))).join('')
  const sending = sent && beat < 8000

  useEffect(() => {
    if (reducedMotion) return
    let previous = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      const delta = now - previous
      previous = now
      if (!document.hidden) setElapsed((value) => value + delta)
    }, 40)
    return () => clearInterval(interval)
  }, [reducedMotion])

  useEffect(() => {
    setValue(prompt, { chipify: false })
  }, [prompt, setValue])

  return (
    <div
      data-search-scenario={scenarioIndex}
      data-search-phase={
        sent
          ? answering
            ? scenario.kind === 'files'
              ? 'table'
              : 'reply'
            : 'searching'
          : 'typing'
      }
      data-search-result={scenario.kind}
      className='relative mx-auto flex h-full w-full max-w-chat flex-col px-6 pt-5 pb-9 max-sm:px-4'
    >
      <div
        className={cn(
          'relative mb-[112px] min-h-0 flex-1 transition-[opacity,filter] duration-500 motion-reduce:transition-none',
          fading || beat < 3650 ? 'opacity-0 blur-sm' : 'opacity-100 blur-none',
          answering && scenario.kind === 'files' && 'flex flex-col justify-end'
        )}
      >
        {answering && scenario.kind === 'files' ? (
          <SearchResultTable
            key={scenarioIndex}
            query={scenario.query}
            files={scenario.files}
            elapsed={beat - 4800}
            reducedMotion={reducedMotion}
          />
        ) : !sent ? null : (
          <div className='flex h-full flex-col gap-4 overflow-hidden pb-5'>
            <div className='max-w-[80%] shrink-0 self-end rounded-2xl bg-[var(--surface-5)] px-3.5 py-2 text-[var(--text-primary)] text-sm leading-5'>
              {scenario.prompt}
            </div>
            {!answering ? (
              <PendingTagIndicator label={scenario.activity} />
            ) : scenario.kind === 'chat' ? (
              <div className='flex flex-col gap-3 font-body text-[14px] text-[var(--text-primary)] leading-6'>
                <div className='flex flex-wrap gap-2 text-[13px]'>
                  {scenario.sources.map((source) => (
                    <ResourceMention
                      key={source}
                      title={source}
                      icon={
                        <FileText className='relative top-0.5 size-3 shrink-0 text-[var(--text-icon)]' />
                      }
                    />
                  ))}
                </div>
                <p>{reply}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div
        data-search-composer
        className={cn(
          'absolute inset-x-6 z-10 rounded-2xl border border-[var(--border)] bg-[var(--white)] px-2.5 py-2 transition-[bottom,translate] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none max-sm:inset-x-4 dark:bg-[var(--surface-4)]',
          sent ? 'bottom-9 translate-y-0' : 'bottom-1/2 translate-y-1/2 shadow-ambient'
        )}
      >
        <div inert>
          <PromptEditor
            editor={editor}
            readOnly
            placeholder={sent ? 'Send message to Sim' : 'Ask Sim to '}
            aria-label='Search prompt preview'
            className='max-h-[80px] min-h-[56px]'
          />
        </div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-1'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className='pointer-events-auto inline-flex'>
                  <Chip shape='round' leftIcon={Plus} aria-label='Add resources' tabIndex={-1} />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Add resources</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className='pointer-events-auto inline-flex'>
                  <Chip shape='round' leftIcon={Paperclip} aria-label='Attach file' tabIndex={-1} />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Attach file</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className='pointer-events-auto inline-flex'>
                  <Chip shape='round' leftIcon={Slash} aria-label='Skills' tabIndex={-1} />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Skills</Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div inert className='flex items-center gap-1.5'>
            <Chip shape='round' leftIcon={Mic} aria-label='Voice input' />
            <SendButton
              isSending={sending}
              canSubmit={prompt.length > 0}
              onSubmit={noop}
              onStopGeneration={noop}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
