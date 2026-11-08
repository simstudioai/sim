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
  'type-text': {
    label: 'Type text',
    viewBox: '-1.75 -1.5 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M3.25 2.25H17.25' />
        <path d='M10.25 2.25V18.75' />
        <path d='M7.25 18.75H13.25' />
      </>
    ),
  },
  'type-number': {
    label: 'Type number',
    viewBox: '-1.75 -1.5 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M3.25 7.25H17.75' />
        <path d='M2.75 13.75H17.25' />
        <path d='M8.25 1.25L6.25 19.75' />
        <path d='M14.25 1.25L12.25 19.75' />
      </>
    ),
  },
  'type-currency': {
    label: 'Type currency',
    viewBox: '-1.75 -1.5 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M10.25 2V19' />
        <path d='M15.25 6.5C15.25 4.55 13.01 3.5 10.25 3.5C7.49 3.5 5.25 4.55 5.25 7C5.25 9.45 7.49 10.5 10.25 10.5C13.01 10.5 15.25 11.55 15.25 14C15.25 16.45 13.01 17.5 10.25 17.5C7.49 17.5 5.25 16.45 5.25 14.5' />
      </>
    ),
  },
  'type-boolean': {
    label: 'Type boolean',
    viewBox: '-1.75 -1.5 24 24',
    draw: (): ReactNode => (
      <>
        <rect x='2.5' y='2.75' width='15.5' height='15.5' rx='2.5' />
        <path d='M6.25 10.75L9.25 13.75L14.25 7.25' />
      </>
    ),
  },
  calendar: {
    label: 'Calendar',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <rect x='0.75' y='2.75' width='19' height='16' rx='2.5' />
        <path d='M0.75 7.75H19.75' />
        <path d='M6.25 0.75V4.75' />
        <path d='M14.25 0.75V4.75' />
      </>
    ),
  },
  'type-json': {
    label: 'Type JSON',
    viewBox: '-1.75 -1.75 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M5.75 1.25C3.54 1.25 1.75 3.04 1.75 5.25V7.75C1.75 9.13 0.63 10.25 -0.75 10.25C0.63 10.25 1.75 11.37 1.75 12.75V15.25C1.75 17.46 3.54 19.25 5.75 19.25' />
        <path d='M14.75 1.25C16.96 1.25 18.75 3.04 18.75 5.25V7.75C18.75 9.13 19.87 10.25 21.25 10.25C19.87 10.25 18.75 11.37 18.75 12.75V15.25C18.75 17.46 16.96 19.25 14.75 19.25' />
      </>
    ),
  },
  tag: {
    label: 'Tag',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M0.75 9.75V3.25C0.75 1.87 1.87 0.75 3.25 0.75H9.75L19.25 10.25L10.25 19.25L0.75 9.75Z' />
        <circle cx='5.75' cy='5.75' r='1.25' />
      </>
    ),
  },
  'type-ttl': {
    label: 'Type expiration',
    viewBox: '-1.75 -1.5 24 24',
    draw: (): ReactNode => (
      <>
        <circle cx='10.25' cy='10.5' r='7.75' />
        <path d='M10.25 6V10.5L13.5 12.5' />
      </>
    ),
  },
  play: {
    label: 'Play',
    viewBox: '0 0 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M14.26 5.39C16.17 6.48 17.67 7.33 18.73 8.11C19.81 8.89 20.6 9.71 20.89 10.79C21.09 11.58 21.09 12.42 20.89 13.21C20.6 14.29 19.81 15.11 18.73 15.89C17.67 16.67 16.17 17.52 14.26 18.61C12.42 19.65 10.87 20.53 9.69 21.04C8.51 21.54 7.42 21.8 6.37 21.5C5.6 21.28 4.89 20.86 4.33 20.29C3.56 19.51 3.25 18.44 3.1 17.15C2.96 15.87 2.96 14.19 2.96 12.06V11.94C2.96 9.81 2.96 8.13 3.1 6.85C3.25 5.56 3.56 4.49 4.33 3.71C4.89 3.14 5.6 2.72 6.37 2.5C7.42 2.2 8.51 2.46 9.69 2.96C10.87 3.47 12.42 4.35 14.26 5.39Z' />
      </>
    ),
  },
  trash: {
    label: 'Trash',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M0.75 4.75H19.75' />
        <path d='M3.25 4.75V16.25C3.25 17.63 4.37 18.75 5.75 18.75H14.75C16.13 18.75 17.25 17.63 17.25 16.25V4.75' />
        <path d='M7.25 4.75V3.25C7.25 2.15 8.15 1.25 9.25 1.25H11.25C12.35 1.25 13.25 2.15 13.25 3.25V4.75' />
      </>
    ),
  },
  filter: {
    label: 'Filter',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M1.5 4.5H19' />
        <path d='M5 10.25H15.5' />
        <path d='M8.25 16H12.25' />
      </>
    ),
  },
  columns: {
    label: 'Columns',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M0.75 3.25C0.75 1.87 1.87 0.75 3.25 0.75H17.25C18.63 0.75 19.75 1.87 19.75 3.25V16.25C19.75 17.63 18.63 18.75 17.25 18.75H3.25C1.87 18.75 0.75 17.63 0.75 16.25V3.25Z' />
        <path d='M7.25 0.75V18.75' />
        <path d='M13.25 0.75V18.75' />
      </>
    ),
  },
  duplicate: {
    label: 'Duplicate',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M14.25 0.75H2.75C1.65 0.75 0.75 1.65 0.75 2.75V14.25' />
        <rect x='5.25' y='5.25' width='14' height='14' rx='2' />
      </>
    ),
  },
  sparkles: {
    label: 'Sparkles',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <path d='M9.6 3.8C9.6 8.12 11.28 9.8 15.6 9.8C11.28 9.8 9.6 11.48 9.6 15.8C9.6 11.48 7.92 9.8 3.6 9.8C7.92 9.8 9.6 8.12 9.6 3.8Z' />
        <path d='M16.6 1.1C16.6 2.96 17.64 4 19.5 4C17.64 4 16.6 5.04 16.6 6.9C16.6 5.04 15.56 4 13.7 4C15.56 4 16.6 2.96 16.6 1.1Z' />
        <path d='M3.7 13.1C3.7 14.76 4.64 15.7 6.3 15.7C4.64 15.7 3.7 16.64 3.7 18.3C3.7 16.64 2.76 15.7 1.1 15.7C2.76 15.7 3.7 14.76 3.7 13.1Z' />
      </>
    ),
  },
  'workflow-x': {
    label: 'Workflow error',
    viewBox: '-1 -2 24 24',
    draw: (): ReactNode => (
      <>
        <circle cx='10.25' cy='3.5' r='2.75' />
        <path d='M10.25 6.25V10' />
        <path d='M5 12a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2v2' />
        <rect x='11.5' y='14' width='7.5' height='4.75' rx='1.75' />
        <path d='M1.25 15L5.25 19' />
        <path d='M5.25 15L1.25 19' />
      </>
    ),
  },
} as const
