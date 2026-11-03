import 'server-only'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { codeToHtml } from 'shiki'
import { unified } from 'unified'
import { getMDXComponents } from '@/components/docs/mdx'
import { CodeBlock } from '@/components/ui/code-block'
import { simShikiOptions } from '@/lib/shiki-theme'

interface MarkdownProps {
  children: string
}
interface CodeSampleProps {
  code: string
  language?: string
  title?: string
  frameless?: boolean
}

/** Renders specification prose with the same typography as authored MDX. */
export async function Markdown({ children }: MarkdownProps) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  const tree = await processor.run(processor.parse(children))
  return toJsxRuntime(tree, { Fragment, jsx, jsxs, components: getMDXComponents() })
}

export async function CodeSample({ code, language = 'json', title, frameless }: CodeSampleProps) {
  const html = await codeToHtml(code, { ...simShikiOptions, lang: language })
  if (frameless) return <div dangerouslySetInnerHTML={{ __html: html }} />
  return (
    <CodeBlock data-code={code} lang={language} title={title}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </CodeBlock>
  )
}
