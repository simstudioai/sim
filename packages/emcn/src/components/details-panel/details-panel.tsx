import { type CSSProperties, forwardRef, type HTMLAttributes, type MouseEventHandler } from 'react'
import { cn } from '../../lib/cn'

export interface DetailsPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Slide the panel into view; closed content stays mounted but inert. */
  open: boolean
  /** Controlled width, including responsive CSS expressions such as clamp(). */
  width: NonNullable<CSSProperties['width']>
  /** Existing product resize handler; width state stays with the caller. */
  onResizeStart: MouseEventHandler<HTMLDivElement>
  /** Accessible name for the external resize handle. */
  resizeLabel: string
}

/**
 * Non-modal details sidebar with a right-edge slide and an external resize handle.
 * Its parent supplies the positioned containing block. Content, keyboard commands,
 * and persisted width remain owned by the caller.
 *
 * @example
 * <DetailsPanel open={open} width={width} onResizeStart={handleMouseDown}
 *   resizeLabel='Resize log details panel' aria-label='Log details sidebar'>
 *   {content}
 * </DetailsPanel>
 */
export const DetailsPanel = forwardRef<HTMLDivElement, DetailsPanelProps>(
  ({ open, width, onResizeStart, resizeLabel, className, style, children, ...props }, ref) => {
    const cssWidth = typeof width === 'number' ? `${width}px` : width
    const widthStyle = { '--details-panel-width': cssWidth } as CSSProperties
    const { width: _styleWidth, ...panelStyle } = style ?? {}

    return (
      <>
        {open && (
          <div
            className='absolute top-0 right-[calc(var(--details-panel-width)-4px)] bottom-0 z-[var(--z-dropdown)] w-[8px] cursor-ew-resize'
            style={widthStyle}
            onMouseDown={onResizeStart}
            role='separator'
            aria-label={resizeLabel}
            aria-orientation='vertical'
          />
        )}
        <div
          {...props}
          ref={ref}
          inert={!open || props.inert}
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[var(--z-dropdown)] w-[var(--details-panel-width)] overflow-hidden border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : 'translate-x-full',
            className
          )}
          style={{ ...panelStyle, ...widthStyle }}
        >
          {children}
        </div>
      </>
    )
  }
)

DetailsPanel.displayName = 'DetailsPanel'
