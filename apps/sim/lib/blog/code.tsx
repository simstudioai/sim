'use client'

import { Code } from '@/components/emcn'

interface CodeBlockProps {
  code: string
  language: 'javascript' | 'json' | 'python'
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div className='dark w-full overflow-hidden rounded-md border border-[#2a2a2a] bg-[#1F1F1F] text-sm'>
      <Code.Viewer
        code={code}
        showGutter
        language={language}
        className='[&_pre]:!pb-0 m-0 rounded-none border-0 bg-transparent'
      />
    </div>
  )
}
