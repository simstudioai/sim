'use client'

import { useCallback, useState } from 'react'
import { Check, Clipboard } from 'lucide-react'
import { Button, Code, Label, Tooltip } from '@/components/emcn'

interface EmbedCodeGeneratorProps {
  formUrl: string
  identifier: string
}

export function EmbedCodeGenerator({ formUrl }: EmbedCodeGeneratorProps) {
  const [copied, setCopied] = useState(false)

  const iframeCode = `<iframe
  src="${formUrl}"
  width="100%"
  height="600"
  frameborder="0"
  style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
></iframe>`

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(iframeCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [iframeCode])

  return (
    <div className='pb-3'>
      <div className='mb-[6.5px] flex items-center justify-between'>
        <Label className='block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          Embed Code
        </Label>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='ghost'
              onClick={handleCopy}
              aria-label='Copy code'
              className='!p-1.5 -my-1.5'
            >
              {copied ? <Check className='h-3 w-3' /> : <Clipboard className='h-3 w-3' />}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </Tooltip.Content>
        </Tooltip.Root>
      </div>

      <Code.Viewer
        code={iframeCode}
        language='javascript'
        wrapText
        className='!min-h-0 rounded-sm border border-[var(--border-1)]'
      />
    </div>
  )
}
