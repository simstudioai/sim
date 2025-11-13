import { Fragment, type ReactNode } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import { cn } from '@/lib/utils'
import './code.css'

/**
 * Re-export Prism.js highlighting utilities for use across the app.
 * Components can import these instead of importing from prismjs directly.
 */
export { highlight, languages }

/**
 * Code editor configuration and constants.
 * All code editors in the app should use these values for consistency.
 */
export const CODE_LINE_HEIGHT_PX = 21

/**
 * Gutter width values based on the number of digits in line numbers.
 * Provides consistent spacing across all code editors.
 */
const GUTTER_WIDTHS = [20, 20, 30, 38, 46, 54] as const

/**
 * Calculates the dynamic gutter width based on the number of lines.
 * @param lineCount - The total number of lines in the code
 * @returns The gutter width in pixels
 */
export function calculateGutterWidth(lineCount: number): number {
  const digits = String(lineCount).length
  return GUTTER_WIDTHS[Math.min(digits - 1, GUTTER_WIDTHS.length - 1)]
}

/**
 * Props for the Code.Container component.
 */
interface CodeContainerProps {
  /** Editor content wrapped by this container */
  children: ReactNode
  /** Additional CSS classes for the container */
  className?: string
  /** Inline styles for the container */
  style?: React.CSSProperties
  /** Whether editor is in streaming/AI generation state */
  isStreaming?: boolean
  /** Drag and drop handler */
  onDragOver?: (e: React.DragEvent) => void
  /** Drop handler */
  onDrop?: (e: React.DragEvent) => void
}

/**
 * Code editor container that provides consistent styling across all editors.
 * Handles container chrome (border, radius, bg, font) with Tailwind.
 *
 * @example
 * ```tsx
 * <Code.Container>
 *   <Code.Content>
 *     <Editor {...props} />
 *   </Code.Content>
 * </Code.Container>
 * ```
 */
function Container({
  children,
  className,
  style,
  isStreaming = false,
  onDragOver,
  onDrop,
}: CodeContainerProps) {
  return (
    <div
      className={cn(
        // Base container styling
        'group relative min-h-[100px] rounded-[4px] border border-[var(--border-strong)]',
        'bg-[#1F1F1F] font-medium font-mono text-sm transition-colors',
        'dark:border-[var(--border-strong)]',
        // Overflow handling for long content
        'overflow-x-auto',
        // Vertical resize handle
        'resize-y overflow-y-auto',
        // Streaming state
        isStreaming && 'streaming-effect',
        className
      )}
      style={style}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}

/**
 * Props for Code.Content wrapper.
 */
interface CodeContentProps {
  /** Editor and related elements */
  children: ReactNode
  /** Padding left (e.g., for gutter offset) */
  paddingLeft?: string | number
  /** Additional CSS classes */
  className?: string
  /** Ref for the wrapper element */
  editorRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Wrapper for the editor content area that applies the code theme.
 * This enables VSCode-like token syntax highlighting via CSS.
 */
function Content({ children, paddingLeft, className, editorRef }: CodeContentProps) {
  return (
    <div
      ref={editorRef}
      className={cn('code-editor-theme relative mt-0 pt-0', className)}
      style={paddingLeft ? { paddingLeft } : undefined}
    >
      {children}
    </div>
  )
}

/**
 * Get standard Editor component props for react-simple-code-editor.
 * Returns the className and textareaClassName props (no style prop).
 *
 * @param options - Optional overrides
 * @returns Props object to spread onto Editor component
 */
export function getCodeEditorProps(options?: {
  isStreaming?: boolean
  isPreview?: boolean
  disabled?: boolean
}) {
  const { isStreaming = false, isPreview = false, disabled = false } = options || {}

  return {
    padding: 8,
    className: cn(
      // Base editor classes
      'bg-transparent font-[inherit] text-[inherit] font-medium text-[#eeeeee]',
      'leading-[21px] outline-none focus:outline-none',
      'min-h-[106px]',
      // Streaming/disabled states
      (isStreaming || disabled) && 'cursor-not-allowed opacity-50'
    ),
    textareaClassName: cn(
      // Reset browser defaults
      'border-none bg-transparent outline-none resize-none',
      'focus:outline-none focus:ring-0',
      // Selection styling
      'selection:bg-[#264f78] selection:text-white',
      // Caret color
      'caret-white',
      // Font smoothing
      '[-webkit-font-smoothing:antialiased] [-moz-osx-font-smoothing:grayscale]',
      // Disable interaction for streaming/preview
      (isStreaming || isPreview) && 'pointer-events-none'
    ),
  }
}

/**
 * Props for the Code.Gutter (line numbers) component.
 */
interface CodeGutterProps {
  /** Line number elements to render */
  children: ReactNode
  /** Width of the gutter in pixels */
  width: number
  /** Additional CSS classes */
  className?: string
  /** Inline styles */
  style?: React.CSSProperties
}

/**
 * Code editor gutter for line numbers.
 * Provides consistent styling for the line number column.
 */
function Gutter({ children, width, className, style }: CodeGutterProps) {
  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 left-0',
        'flex select-none flex-col items-end overflow-hidden',
        'rounded-l-[4px] bg-[#1F1F1F]',
        'pr-0.5',
        className
      )}
      style={{ width: `${width}px`, paddingTop: '8.5px', ...style }}
      aria-hidden='true'
    >
      {children}
    </div>
  )
}

/**
 * Props for the Code.Placeholder component.
 */
interface CodePlaceholderProps {
  /** Placeholder text to display */
  children: ReactNode
  /** Width of the gutter (for proper left positioning) */
  gutterWidth: string | number
  /** Whether code editor has content */
  show: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Code editor placeholder that appears when the editor is empty.
 * Automatically positioned to match the editor's text position.
 *
 * @example
 * ```tsx
 * <Code.Content paddingLeft={gutterWidth}>
 *   <Code.Placeholder gutterWidth={gutterWidth} show={code.length === 0}>
 *     Write your code here...
 *   </Code.Placeholder>
 *   <Editor {...props} />
 * </Code.Content>
 * ```
 */
function Placeholder({ children, gutterWidth, show, className }: CodePlaceholderProps) {
  if (!show) return null

  return (
    <pre
      className={cn(
        'pointer-events-none absolute select-none overflow-visible',
        'whitespace-pre-wrap text-muted-foreground/50',
        className
      )}
      style={{
        top: '8.5px',
        left: `calc(${typeof gutterWidth === 'number' ? `${gutterWidth}px` : gutterWidth} + 8px)`,
        fontFamily: 'inherit',
        margin: 0,
        lineHeight: `${CODE_LINE_HEIGHT_PX}px`,
      }}
    >
      {children}
    </pre>
  )
}

/**
 * Props for the Code.Viewer component (readonly code display).
 */
interface CodeViewerProps {
  /** Code content to display */
  code: string
  /** Whether to show line numbers gutter */
  showGutter?: boolean
  /** Language for syntax highlighting (default: 'json') */
  language?: 'javascript' | 'json' | 'python'
  /** Additional CSS classes for the container */
  className?: string
  /** Left padding offset (useful for terminal alignment) */
  paddingLeft?: number
  /** Inline styles for the gutter (e.g., to override background) */
  gutterStyle?: React.CSSProperties
  /** Whether to wrap text instead of using horizontal scroll */
  wrapText?: boolean
}

/**
 * Readonly code viewer with optional gutter and syntax highlighting.
 * Handles all complexity internally - line numbers, gutter width calculation, and highlighting.
 *
 * @example
 * ```tsx
 * <Code.Viewer
 *   code={JSON.stringify(data, null, 2)}
 *   showGutter
 *   language="json"
 * />
 * ```
 */
function Viewer({
  code,
  showGutter = false,
  language = 'json',
  className,
  paddingLeft = 0,
  gutterStyle,
  wrapText = false,
}: CodeViewerProps) {
  // Apply syntax highlighting using the specified language
  const highlightedCode = highlight(code, languages[language] || languages.javascript, language)

  // Determine whitespace class based on wrap setting
  const whitespaceClass = wrapText ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

  // Special rendering path: when wrapping with gutter, render per-line rows so gutter stays aligned.
  // This mimics editors that show a single line number for a logical line and "empty" gutter area for wrapped lines.
  if (showGutter && wrapText) {
    const lines = code.split('\n')
    const gutterWidth = calculateGutterWidth(lines.length)

    return (
      <Container className={className}>
        <Content className='code-editor-theme'>
          <div
            style={{
              paddingLeft,
              paddingTop: '8px',
              paddingBottom: '8px',
              display: 'grid',
              gridTemplateColumns: `${gutterWidth}px 1fr`,
            }}
          >
            {lines.map((line, idx) => {
              const perLineHighlighted = highlight(
                line,
                languages[language] || languages.javascript,
                language
              )
              return (
                <Fragment key={idx}>
                  <div
                    className='select-none pr-0.5 text-right text-[#a8a8a8] text-xs tabular-nums leading-[21px]'
                    style={{ transform: 'translateY(0.25px)', ...gutterStyle }}
                  >
                    {idx + 1}
                  </div>
                  <pre
                    className='m-0 min-w-0 whitespace-pre-wrap pr-2 pl-2 font-mono text-[#eeeeee] text-[13px] leading-[21px]'
                    // Using per-line highlighting keeps the gutter height in sync with wrapped content
                    dangerouslySetInnerHTML={{ __html: perLineHighlighted || '&nbsp;' }}
                  />
                </Fragment>
              )
            })}
          </div>
        </Content>
      </Container>
    )
  }

  if (!showGutter) {
    // Simple display without gutter
    return (
      <Container className={className}>
        <Content className='code-editor-theme'>
          <pre
            className={cn(
              whitespaceClass,
              'p-2 font-mono text-[#eeeeee] text-[13px] leading-[21px]'
            )}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </Content>
      </Container>
    )
  }

  // Calculate line numbers
  const lineCount = code.split('\n').length
  const gutterWidth = calculateGutterWidth(lineCount)

  // Render line numbers
  const lineNumbers = []
  for (let i = 1; i <= lineCount; i++) {
    lineNumbers.push(
      <div key={i} className='text-right text-[#a8a8a8] text-xs tabular-nums leading-[21px]'>
        {i}
      </div>
    )
  }

  return (
    <Container className={className}>
      <Gutter width={gutterWidth} style={{ left: `${paddingLeft}px`, ...gutterStyle }}>
        {lineNumbers}
      </Gutter>
      <Content className='code-editor-theme' paddingLeft={`${gutterWidth + paddingLeft}px`}>
        <pre
          className={cn(whitespaceClass, 'p-2 font-mono text-[#eeeeee] text-[13px] leading-[21px]')}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </Content>
    </Container>
  )
}

export const Code = {
  Container,
  Content,
  Gutter,
  Placeholder,
  Viewer,
}
