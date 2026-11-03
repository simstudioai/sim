import type { SVGProps } from 'react'

interface ProviderIconProps extends SVGProps<SVGSVGElement> {}

/** Decorative Google mark; the enclosing provider action supplies its accessible name. */
export function AuthGoogleIcon(props: ProviderIconProps) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' aria-hidden='true' focusable='false' {...props}>
      <path
        d='M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z'
        fill='#4285F4'
      />
      <path
        d='M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.13H3.07v2.59A10 10 0 0 0 12 22Z'
        fill='#34A853'
      />
      <path
        d='M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z'
        fill='#FBBC05'
      />
      <path
        d='M12 5.95c1.47 0 2.79.5 3.83 1.5l2.88-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z'
        fill='#EA4335'
      />
    </svg>
  )
}

/** Decorative Microsoft mark; the enclosing provider action supplies its accessible name. */
export function AuthMicrosoftIcon(props: ProviderIconProps) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 109 109'
      aria-hidden='true'
      focusable='false'
      {...props}
    >
      <polygon points='51.9,51.9 0,51.9 0,0 51.9,0' fill='#F1511B' />
      <polygon points='109.3,51.9 57.3,51.9 57.3,0 109.3,0' fill='#80CC28' />
      <polygon points='51.9,109.3 0,109.3 0,57.4 51.9,57.4' fill='#00ADEF' />
      <polygon points='109.3,109.3 57.3,109.3 57.3,57.4 109.3,57.4' fill='#FBBC09' />
    </svg>
  )
}

/** Decorative GitHub mark; the enclosing provider action supplies its accessible name. */
export function AuthGithubIcon(props: ProviderIconProps) {
  return (
    <svg width='16' height='16' viewBox='0 0 26 26' aria-hidden='true' focusable='false' {...props}>
      <path
        d='M13 0C11.29 0 9.6 0.34 8.03 0.99C6.45 1.64 5.01 2.6 3.81 3.81C1.37 6.25 0 9.55 0 13C0 18.75 3.73 23.62 8.89 25.35C9.54 25.45 9.75 25.05 9.75 24.7V22.5C6.15 23.28 5.38 20.76 5.38 20.76C4.78 19.25 3.94 18.85 3.94 18.85C2.76 18.04 4.03 18.07 4.03 18.07C5.33 18.16 6.02 19.41 6.02 19.41C7.15 21.39 9.06 20.8 9.8 20.49C9.92 19.64 10.26 19.07 10.62 18.75C7.74 18.42 4.71 17.3 4.71 12.35C4.71 10.91 5.2 9.75 6.05 8.83C5.92 8.5 5.46 7.15 6.18 5.4C6.18 5.4 7.27 5.04 9.75 6.72C10.78 6.44 11.9 6.29 13 6.29C14.11 6.29 15.22 6.44 16.25 6.72C18.73 5.04 19.83 5.4 19.83 5.4C20.54 7.15 20.09 8.5 19.95 8.83C20.8 9.75 21.29 10.91 21.29 12.35C21.29 17.32 18.25 18.41 15.35 18.73C15.82 19.14 16.25 19.93 16.25 21.14V24.7C16.25 25.05 16.46 25.47 17.12 25.35C22.28 23.61 26 18.75 26 13C26 5.82 20.18 0 13 0Z'
        fill='currentColor'
      />
    </svg>
  )
}
