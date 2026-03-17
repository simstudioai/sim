'use client'

import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'

interface CodeBlockProps {
  code: string
  language: string
  filename?: string
}

const LANG_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  javascript: 'javascript',
  json: 'json',
  python: 'python',
  py: 'python',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  css: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  markup: 'markup',
  html: 'markup',
  xml: 'markup',
  php: 'php',
  rust: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'kotlin',
  scala: 'scala',
  swift: 'swift',
  dart: 'dart',
}

const LANG_LABEL: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  python: 'Python',
  bash: 'Bash',
  css: 'CSS',
  yaml: 'YAML',
  markdown: 'Markdown',
}

export function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const lang = LANG_MAP[language.toLowerCase()] || 'javascript'
  const grammar = languages[lang] || languages.javascript
  const highlighted = highlight(code, grammar, lang)
  const label = filename || LANG_LABEL[lang] || language

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }, [code])

  return (
    <div
      className='my-8 overflow-hidden border border-[#2A2A2A] bg-[#111111]'
      style={{ borderRadius: '5px' }}
    >
      <div className='flex items-center justify-between border-b border-[#2A2A2A] bg-[#232323] px-4 py-2'>
        <div className='flex items-center gap-2'>
          <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
          <span className='inline-block h-2 w-2 bg-[#2ABBF8]' aria-hidden='true' />
          <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
        </div>
        <span className='font-mono text-[10px] uppercase tracking-widest text-[#ECECEC]'>
          {label}
        </span>
        <button
          type='button'
          onClick={handleCopy}
          className='flex items-center text-[#666] transition-colors hover:text-[#ECECEC]'
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <Check className='h-3.5 w-3.5 text-[#00F701]' aria-hidden='true' />
          ) : (
            <Copy className='h-3.5 w-3.5' aria-hidden='true' />
          )}
        </button>
      </div>
      <div className='overflow-x-auto p-4'>
        <pre className='m-0 border-0 bg-transparent p-0 text-[13px] leading-relaxed'>
          <code
            className='font-mono text-[#d4d4d8]'
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  )
}
