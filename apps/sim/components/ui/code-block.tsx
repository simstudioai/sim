import type React from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  code: string
  language?: string
}

export function CodeBlock({ code, language, className, ...props }: CodeBlockProps) {
  return (
    <div className={cn('relative rounded-md border bg-muted', className)}>
      <pre className='overflow-x-auto p-4 text-sm' {...props}>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} className='absolute top-2 right-2' />
    </div>
  )
}
