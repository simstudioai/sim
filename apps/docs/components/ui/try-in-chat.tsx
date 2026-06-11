'use client'

import { useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TryInChatProps {
  prompts: string[]
  /** Heading above the prompt list. Defaults to "Try in Chat". */
  title?: string
}

function PromptRow({ prompt, isLast }: { prompt: string; isLast: boolean }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the text is still selectable.
    }
  }

  return (
    <button
      type='button'
      onClick={copy}
      title='Copy prompt'
      className={cn(
        'group flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.03)]',
        !isLast && 'border-[rgba(0,0,0,0.08)] border-b dark:border-[rgba(255,255,255,0.08)]'
      )}
    >
      <span className='flex-1 text-[0.875rem] text-[rgba(0,0,0,0.7)] leading-relaxed dark:text-[rgba(255,255,255,0.7)]'>
        &ldquo;{prompt}&rdquo;
      </span>
      {copied ? (
        <Check className='mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400' />
      ) : (
        <Copy className='mt-1 h-3.5 w-3.5 shrink-0 text-[rgba(0,0,0,0.25)] opacity-0 transition-opacity group-hover:opacity-100 dark:text-[rgba(255,255,255,0.3)]' />
      )}
    </button>
  )
}

/**
 * A list of copyable prompts the reader can paste into Chat, teaching the
 * prompting patterns for the surrounding page's topic. Click a row to copy.
 *
 * @example
 * <TryInChat prompts={[
 *   "Create a leads table with columns for name, email, company, and status",
 * ]} />
 */
export function TryInChat({ prompts, title = 'Try in Chat' }: TryInChatProps) {
  return (
    <div className='my-6 overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]'>
      <div className='flex items-center gap-2 border-[rgba(0,0,0,0.08)] border-b bg-[rgba(0,0,0,0.02)] px-4 py-2 dark:border-[rgba(255,255,255,0.08)] dark:bg-[rgba(255,255,255,0.03)]'>
        <MessageCircle className='h-3.5 w-3.5 text-[rgba(0,0,0,0.4)] dark:text-[rgba(255,255,255,0.4)]' />
        <span className='font-[470] text-[0.8125rem] text-[rgba(0,0,0,0.6)] dark:text-[rgba(255,255,255,0.6)]'>
          {title}
        </span>
      </div>
      <div>
        {prompts.map((prompt, index) => (
          <PromptRow key={prompt} prompt={prompt} isLast={index === prompts.length - 1} />
        ))}
      </div>
    </div>
  )
}
