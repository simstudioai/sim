'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Code } from '@/components/emcn'

interface CodeBlockProps {
  code: string
  language: 'javascript' | 'json' | 'python'
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className='dark w-full overflow-hidden rounded-md border border-[#2a2a2a] bg-[#1F1F1F] text-sm'>
      <div className='flex items-center justify-between border-[#2a2a2a] border-b px-4 py-1.5'>
        <span className='text-[#A3A3A3] text-xs'>{language}</span>
        <button
          onClick={handleCopy}
          className='text-[#A3A3A3] transition-colors hover:text-gray-300'
          title='Copy code'
        >
          {copied ? (
            <Check className='h-3 w-3' strokeWidth={2} />
          ) : (
            <Copy className='h-3 w-3' strokeWidth={2} />
          )}
        </button>
      </div>
      <Code.Viewer
        code={code}
        showGutter
        language={language}
        className='[&_pre]:!pb-0 m-0 rounded-none border-0 bg-transparent'
      />
    </div>
  )
}
