import type { ReactNode } from 'react'

/** Interface geometry without a Paper registration uses a semantic name. */
export const interfaceGlyphs = {
  eye: {
    label: 'Eye',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M3 12C5.25 8.5 8.25 6.75 12 6.75S18.75 8.5 21 12C18.75 15.5 15.75 17.25 12 17.25S5.25 15.5 3 12Z' />
        <circle cx='12' cy='12' r='2.25' fill='currentColor' stroke='none' />
      </>
    ),
  },
  'eye-off': {
    label: 'Eye off',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M3 9.75C5.25 13.25 8.25 15 12 15S18.75 13.25 21 9.75' />
        <path d='M6.25 13 4.75 15M12 15v2.5M17.75 13l1.5 2' />
      </>
    ),
  },
  sun: {
    label: 'Sun',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <circle cx='12' cy='12' r='4' />
        <path d='M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42' />
      </>
    ),
  },
  moon: {
    label: 'Moon',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => <path d='M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z' />,
  },
  lock: {
    label: 'Lock',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <rect x='4' y='10' width='16' height='11' rx='2' />
        <path d='M8 10V7a4 4 0 0 1 8 0v3m-4 5v2' />
      </>
    ),
  },
  'warning-circle': {
    label: 'Warning',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <circle cx='12' cy='12' r='9' />
        <path d='M12 7v6m0 4h.01' />
      </>
    ),
  },
  'warning-triangle': {
    label: 'Warning',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <path d='m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01' />
      </>
    ),
  },
  link: {
    label: 'Link',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <path
          d='m10 13 4-4m-6 7-1 1a4.24 4.24 0 0 1-6-6l4-4a4.24 4.24 0 0 1 6 0m2 1 1-1a4.24 4.24 0 0 1 6 6l-4 4a4.24 4.24 0 0 1-6 0'
          transform='translate(1 1)'
        />
      </>
    ),
  },
  menu: {
    label: 'Menu',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => <path d='M4 6h16M4 12h16M4 18h16' />,
  },
  'arrow-right': {
    label: 'Arrow right',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => <path d='M4 12h16m-6-6 6 6-6 6' />,
  },
} as const
