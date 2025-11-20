import { Code } from '@/components/emcn'

interface CodeDisplayProps {
  code: string
  language?: string
}

export const CodeDisplay = ({ code, language = 'javascript' }: CodeDisplayProps) => {
  return <Code.Viewer code={code} showGutter language={language as 'javascript' | 'json'} />
}
