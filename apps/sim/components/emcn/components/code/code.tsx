import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import './code.css'

/**
 * Code editor configuration and constants.
 * All code editors in the app should use these values for consistency.
 */
export const CODE_LINE_HEIGHT_PX = 21

/**
 * Gutter width values based on the number of digits in line numbers.
 * Provides consistent spacing across all code editors.
 */
const GUTTER_WIDTHS = [20, 24, 30, 38, 46, 54] as const

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
        'group relative min-h-[100px] rounded-[4px] border border-[#303030]',
        'bg-[#1F1F1F] font-medium font-mono text-sm transition-colors',
        'dark:border-[#303030]',
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
}

/**
 * Code editor gutter for line numbers.
 * Provides consistent styling for the line number column.
 */
function Gutter({ children, width, className }: CodeGutterProps) {
  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 left-0',
        'flex select-none flex-col items-end overflow-hidden',
        'rounded-l-[4px] bg-[#1F1F1F]',
        'pr-0.5',
        className
      )}
      style={{ width: `${width}px`, paddingTop: '8.5px' }}
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

export const Code = {
  Container,
  Content,
  Gutter,
  Placeholder,
}
