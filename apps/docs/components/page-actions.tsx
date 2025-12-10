'use client'

import { useState } from 'react'
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button'
import { Check, Copy } from 'lucide-react'

const cache = new Map<string, string>()

export function LLMCopyButton({
  markdownUrl,
}: {
  /**
   * A URL to fetch the raw Markdown/MDX content of page
   */
  markdownUrl: string
}) {
  const [isLoading, setLoading] = useState(false)
  const [checked, onClick] = useCopyButton(async () => {
    const cached = cache.get(markdownUrl)
    if (cached) return navigator.clipboard.writeText(cached)

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
    } finally {
      setLoading(false)
    }
  })

  return (
    <button
      disabled={isLoading}
      onClick={onClick}
      className='flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-2 text-muted-foreground/60 text-sm leading-none transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
      aria-label={checked ? 'Copied to clipboard' : 'Copy page content'}
    >
      {checked ? (
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
