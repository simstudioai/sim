import { cloneElement, isValidElement } from 'react'

interface LandingFieldProps {
  label: string
  htmlFor: string
  optional?: boolean
  error?: string
  children: React.ReactNode
}

export function LandingField({ label, htmlFor, optional, error, children }: LandingFieldProps) {
  const errorId = error ? `${htmlFor}-error` : undefined
  const describedChild =
    errorId && isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
      ? cloneElement(children, { 'aria-describedby': errorId, 'aria-invalid': true })
      : children
  return (
    <div className='flex flex-col gap-1.5'>
      <label
        htmlFor={htmlFor}
        className='font-[430] font-season text-[13px] text-[var(--text-secondary)] tracking-[0.02em]'
      >
        {label}
        {optional ? <span className='ml-1 text-[var(--text-muted)]'>(optional)</span> : null}
      </label>
      {describedChild}
      {error ? (
        <p id={errorId} role='alert' className='text-[12px] text-[var(--text-error)]'>
          {error}
        </p>
      ) : null}
    </div>
  )
}
