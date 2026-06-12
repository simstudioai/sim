import { cn } from '@/lib/core/utils/cn'

const DASHED_DIVIDER_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
} as const

interface FieldDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Adds the `subblock-divider` marker class so the workflow editor's CSS
   * (`globals.css` `:has()` rule) can hide the divider when adjacent subblocks
   * render empty content. Default `false` — only the workflow editor needs it.
   */
  subblockMarker?: boolean
}

/**
 * Dashed horizontal divider used between fields in form-style panels (the
 * workflow editor's subblock list, the table column/workflow sidebars). Same
 * visual as the existing `subblock-divider` pattern in `editor.tsx`,
 * promoted here so consumers don't keep redefining the gradient style.
 *
 * @example
 * ```tsx
 * <Field>...</Field>
 * <FieldDivider />
 * <Field>...</Field>
 * ```
 */
function FieldDivider({ className, subblockMarker = false, ...props }: FieldDividerProps) {
  return (
    <div
      role='separator'
      className={cn('px-0.5 pt-4 pb-[13px]', subblockMarker && 'subblock-divider', className)}
      {...props}
    >
      <div className='h-[1.25px]' style={DASHED_DIVIDER_STYLE} />
    </div>
  )
}

export { FieldDivider }
