import { cloneElement, isValidElement } from 'react'

interface LandingFieldProps {
  label: string
  htmlFor: string
  optional?: boolean
  error?: string
  children: React.ReactNode
  /** Replaces the default label className. */
  labelClassName?: string
}

const DEFAULT_LABEL_CLASSNAME =
  'font-[430] font-season text-[13px] text-[var(--text-secondary)] tracking-[0.02em]'

export function LandingField({
  label,
  htmlFor,
  optional,
  error,
  children,
  labelClassName,
}: LandingFieldProps) {
  const errorId = error ? `${htmlFor}-error` : undefined
  const describedChild =
    errorId && isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
      ? cloneElement(children, { 'aria-describedby': errorId, 'aria-invalid': true })
      : children
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex min-h-[18px] items-baseline justify-between gap-3'>
        <label htmlFor={htmlFor} className={labelClassName ?? DEFAULT_LABEL_CLASSNAME}>
          {label}
          {optional ? <span className='ml-1 text-[var(--text-muted)]'>(optional)</span> : null}
        </label>
        {error ? (
          <span
            id={errorId}
            role='alert'
            className='truncate font-season text-[12px] text-[var(--text-error)]'
          >
            {error}
          </span>
        ) : null}
      </div>
      {describedChild}
    </div>
  )
}
