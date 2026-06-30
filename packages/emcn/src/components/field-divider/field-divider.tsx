import { cn } from '../../lib/cn'

const DASHED_DIVIDER_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
} as const

/**
 * The bare dashed hairline used by `FieldDivider` and by inline divider rows
 * (e.g. the "Show additional fields" disclosure flanks in the workflow editor
 * and table sidebars). Single source of truth for the dash pattern and line
 * thickness — consumers pass layout-only classes such as `flex-1`.
 *
 * @example
 * ```tsx
 * <DashedDividerLine className='flex-1' />
 * ```
 */
function DashedDividerLine({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-[1.25px]', className)} style={DASHED_DIVIDER_STYLE} {...props} />
}

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
      <DashedDividerLine />
    </div>
  )
}

export { DashedDividerLine, FieldDivider }
