import { useEffect, useRef, useState } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

// Add dark mode fix for Prism.js
if (typeof document !== 'undefined') {
  const styleId = 'console-code-dark-mode-fix'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .dark .token.operator {
        color: #9cdcfe !important;
        background: transparent !important;
      }
      .dark .token.punctuation {
        color: #d4d4d4 !important;
      }
    `
    document.head.appendChild(style)
  }
}

interface CodeDisplayProps {
  code: string
  language?: string
}

export const CodeDisplay = ({ code, language = 'javascript' }: CodeDisplayProps) => {
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Calculate sidebar width based on number of lines
  const lineCount = code.split('\n').length
  const sidebarWidth = Math.max(30, lineCount.toString().length * 8 + 16) // 8px per digit + 16px padding

  // Calculate visual line heights similar to code.tsx
  useEffect(() => {
    if (!containerRef.current) return

    const calculateVisualLines = () => {
      const preElement = containerRef.current?.querySelector('pre')
      if (!preElement) return

      const lines = code.split('\n')
      const newVisualLineHeights: number[] = []

      const tempContainer = document.createElement('div')
      tempContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        height: auto;
        width: ${preElement.clientWidth}px;
        font-family: ${window.getComputedStyle(preElement).fontFamily};
        font-size: ${window.getComputedStyle(preElement).fontSize};
        line-height: 21px;
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        box-sizing: border-box;
      `
      document.body.appendChild(tempContainer)

      lines.forEach((line) => {
        const lineDiv = document.createElement('div')
        lineDiv.textContent = line || ' '

        tempContainer.appendChild(lineDiv)
        const actualHeight = lineDiv.getBoundingClientRect().height
        const lineUnits = Math.max(1, Math.ceil(actualHeight / 21))
        newVisualLineHeights.push(lineUnits)
        tempContainer.removeChild(lineDiv)
      })

      document.body.removeChild(tempContainer)
      setVisualLineHeights(newVisualLineHeights)
    }

    const timeoutId = setTimeout(calculateVisualLines, 50)

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [code, sidebarWidth])

  // Render line numbers with proper visual line handling
  const renderLineNumbers = () => {
    const numbers: React.ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height, index) => {
      numbers.push(
        <div key={`${lineNumber}-0`} className='text-muted-foreground text-xs leading-[21px]'>
          {lineNumber}
        </div>
      )
      for (let i = 1; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className='invisible text-muted-foreground text-xs leading-[21px]'
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    if (numbers.length === 0) {
      const lines = code.split('\n')
      return lines.map((_, index) => (
        <div key={index} className='text-muted-foreground text-xs leading-[21px]'>
          {index + 1}
        </div>
      ))
    }

    return numbers
  }

  return (
    <div
      className='relative overflow-hidden rounded-md border bg-background font-mono text-sm'
      ref={containerRef}
    >
      {/* Line numbers */}
      <div
        className='absolute top-0 bottom-0 left-0 flex select-none flex-col items-end overflow-hidden bg-secondary pt-2 pr-3'
        style={{ width: `${sidebarWidth}px` }}
        aria-hidden='true'
      >
        {renderLineNumbers()}
      </div>

      {/* Code content */}
      <div className='relative' style={{ paddingLeft: `${sidebarWidth}px` }}>
        <pre
          className='max-w-full overflow-hidden px-3 py-2 text-sm leading-[21px]'
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          <code
            dangerouslySetInnerHTML={{
              __html: highlight(code, languages[language], language),
            }}
          />
        </pre>
      </div>
    </div>
  )
}
