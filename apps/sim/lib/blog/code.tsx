'use client'

import { Code } from '@/components/emcn/components/code/code'

interface CodeBlockProps {
  code: string
  language: 'javascript' | 'json' | 'python'
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return <Code.Viewer code={code} showGutter={true} language={language} />
}
