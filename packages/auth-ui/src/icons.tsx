import type { SVGProps } from 'react'

interface AuthIconProps extends SVGProps<SVGSVGElement> {
  name: 'eye' | 'eye-off' | 'copy' | 'check' | 'chevron' | 'lock' | 'error'
}

/** Paper Auth glyphs; Auth owns their outlines, dimensions, and treatment. */
export function AuthIcon({ name, ...props }: AuthIconProps) {
  const views = {
    eye: '0 0 24 24',
    'eye-off': '0 0 24 24',
    copy: '-1 -2 24 24',
    check: '-2 -2.75 24 24',
    chevron: '-1.75 -2.25 24 24',
    lock: '-1.75 -2 24 24',
    error: '0 0 24 24',
  } as const
  return (
    <svg
      width='16'
      height='16'
      viewBox={views[name]}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      {name === 'eye' && (
        <>
          <path d='M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z' />
          <circle cx='12' cy='12' r='2.5' />
        </>
      )}
      {name === 'eye-off' && (
        <>
          <path d='M9.88 9.88a3 3 0 1 0 4.24 4.24' />
          <path d='M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' />
          <path d='M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' />
          <line x1='2' y1='2' x2='22' y2='22' />
        </>
      )}
      {name === 'copy' && (
        <>
          <path d='M14.25 0.75H2.75C1.65 0.75 0.75 1.65 0.75 2.75V14.25' />
          <rect x='5.25' y='5.25' width='14' height='14' rx='2' />
        </>
      )}
      {name === 'check' && (
        <>
          <path d='M18.25 2.75L7.25 15.75L1.75 10.25' />
        </>
      )}
      {name === 'chevron' && (
        <>
          <path d='M3 6.25L10.25 13.25L17.5 6.25' />
        </>
      )}
      {name === 'lock' && (
        <>
          <rect x='2.75' y='8.75' width='15' height='10' rx='2' />
          <path d='M5.75 8.75V5.75C5.75 3.26 7.76 1.25 10.25 1.25C12.74 1.25 14.75 3.26 14.75 5.75V8.75' />
        </>
      )}
      {name === 'error' && (
        <>
          <circle cx='12' cy='12' r='10' />
          <path d='M12 8v4' />
          <path d='M12 16h.01' />
        </>
      )}
    </svg>
  )
}
