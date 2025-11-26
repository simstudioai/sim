'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

const cache = new Map<string, string>()

interface CopyPageButtonProps {
  markdownUrl: string
}

export function CopyPageButton({ markdownUrl }: CopyPageButtonProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setLoading] = useState(false)

  const handleCopy = async () => {
    const cached = cache.get(markdownUrl)
    if (cached) {
      await navigator.clipboard.writeText(cached)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return
    }

    setLoading(true)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': fetch(markdownUrl).then(async (res) => {
            const content = await res.text()
            cache.set(markdownUrl, content)
            return content
          }),
        }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      disabled={isLoading}
      onClick={handleCopy}
      className='flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-2 text-muted-foreground/60 text-sm leading-none transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
      aria-label={copied ? 'Copied to clipboard' : 'Copy page content'}
    >
      {copied ? (
        <>
          <Check className='h-3.5 w-3.5' />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className='h-3.5 w-3.5' />
          <span>Copy page</span>
        </>
      )}
    </button>
  )
}
