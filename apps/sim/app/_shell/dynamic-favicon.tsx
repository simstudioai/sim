'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const DEFAULT_FAVICON = '/icon.svg'

/**
 * Sidebar icon color: --text-icon is #5e5e5e (light) / #939393 (dark).
 * Favicon needs to be visible on any tab bar, so we use a slightly stronger value.
 */
const ICON_COLOR_LIGHT = '%235e5e5e'
const ICON_COLOR_DARK = '%23939393'

function pad(viewBox: string): string {
  const [x, y, w, h] = viewBox.split(' ').map(Number)
  const p = Math.max(w, h) * 0.1
  return `${x - p} ${y - p} ${w + p * 2} ${h + p * 2}`
}

function wrapStrokeIcon(viewBox: string, paths: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${pad(viewBox)}" fill="none"><style>path,circle,ellipse,rect,line{stroke:${ICON_COLOR_LIGHT};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;fill:none}@media(prefers-color-scheme:dark){path,circle,ellipse,rect,line{stroke:${ICON_COLOR_DARK}}}</style>${paths}</svg>`
  return `data:image/svg+xml,${svg}`
}

function wrapFilledIcon(viewBox: string, paths: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${pad(viewBox)}" fill="none"><style>.f{fill:${ICON_COLOR_LIGHT};stroke:${ICON_COLOR_LIGHT};stroke-width:0.5;stroke-linejoin:round}@media(prefers-color-scheme:dark){.f{fill:${ICON_COLOR_DARK};stroke:${ICON_COLOR_DARK}}}</style>${paths}</svg>`
  return `data:image/svg+xml,${svg}`
}

const FAVICONS: Record<string, string> = {
  home: wrapStrokeIcon(
    '-1 -2 24 24',
    `<path d="M0.75 9.5L10.25 1L19.75 9.5V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V9.5Z"/><path d="M7.25 18.75V13C7.25 12.4477 7.69772 12 8.25 12H12.25C12.8023 12 13.25 12.4477 13.25 13V18.75"/>`
  ),
  blimp: wrapFilledIcon(
    '1.25 4 18 13',
    `<path class="f" d="M18.24 9.18C18.16 8.94 18 8.74 17.83 8.56L17.83 8.56C17.67 8.4 17.49 8.25 17.3 8.11V5.48C17.3 5.32 17.24 5.17 17.14 5.06C17.06 4.95 16.93 4.89 16.79 4.89H15.93C15.61 4.89 15.32 5.11 15.19 5.44L14.68 6.77C14.05 6.51 13.23 6.22 12.15 6C11.04 5.77 9.66 5.61 7.9 5.61C5.97 5.61 4.56 6.13 3.61 6.89C3.14 7.28 2.78 7.72 2.54 8.19C2.29 8.66 2.18 9.15 2.18 9.63C2.18 10.1 2.29 10.59 2.52 11.06C2.87 11.76 3.48 12.41 4.34 12.89C4.91 13.2 5.61 13.44 6.43 13.56L6.8 14.78C6.94 15.27 7.33 15.59 7.78 15.59H10.56C11.06 15.59 11.48 15.18 11.58 14.61L11.81 13.29C12.31 13.2 12.75 13.09 13.14 12.99C13.74 12.82 14.24 12.64 14.67 12.48L15.19 13.82C15.32 14.16 15.61 14.38 15.93 14.38H16.79C16.93 14.38 17.06 14.31 17.14 14.2C17.24 14.1 17.29 13.95 17.3 13.79V11.15C17.33 11.12 17.37 11.09 17.42 11.07L17.4 11.07L17.42 11.07C17.65 10.89 17.87 10.69 18.04 10.46C18.12 10.35 18.19 10.22 18.24 10.08C18.29 9.94 18.32 9.79 18.32 9.63C18.32 9.47 18.29 9.32 18.24 9.18ZM15.69 5.71C15.73 5.6 15.83 5.53 15.93 5.53H16.74V7.89C16.41 7.7 16.06 7.53 15.71 7.37C15.55 7.29 15.37 7.2 15.15 7.1L15.69 5.71ZM11.05 14.48C11 14.76 10.79 14.95 10.56 14.95H7.78C7.56 14.95 7.38 14.79 7.31 14.56L6.99 13.52C7.22 13.54 7.47 13.55 7.73 13.55C7.79 13.55 7.84 13.55 7.9 13.55C9.05 13.53 10.05 13.45 10.9 13.33C11.02 13.31 11.14 13.29 11.26 13.27L11.05 14.48ZM16.74 13.74H15.93C15.83 13.74 15.73 13.66 15.69 13.56L15.15 12.16C15.36 12.06 15.55 11.97 15.71 11.9C16.06 11.73 16.41 11.56 16.74 11.37V13.74ZM17.75 9.83C17.7 9.95 17.61 10.08 17.48 10.22C17.4 10.3 17.3 10.38 17.2 10.46C17.07 10.57 16.91 10.67 16.74 10.77C16.71 10.8 16.67 10.82 16.63 10.84C16.29 11.04 15.91 11.23 15.55 11.4C15.38 11.48 15.18 11.57 14.96 11.67C14.82 11.73 14.68 11.79 14.53 11.85C14.12 12.02 13.62 12.2 13.02 12.36C12.65 12.46 12.24 12.56 11.79 12.64C11.65 12.67 11.51 12.7 11.36 12.72C10.4 12.88 9.26 12.99 7.9 13.01C7.84 13.02 7.79 13.02 7.73 13.02C7.41 13.02 7.11 13 6.82 12.97C6.65 12.95 6.48 12.93 6.32 12.9C5.26 12.71 4.45 12.32 3.88 11.84C3.48 11.5 3.19 11.12 2.99 10.74C2.8 10.36 2.72 9.98 2.72 9.63C2.72 9.28 2.81 8.9 3 8.52C3.3 7.95 3.82 7.38 4.63 6.95C5.44 6.53 6.52 6.25 7.9 6.25C10.2 6.25 11.84 6.53 13.05 6.87C13.64 7.04 14.13 7.22 14.53 7.39L14.54 7.4C14.69 7.46 14.83 7.52 14.96 7.59C15.18 7.69 15.37 7.78 15.55 7.86C15.95 8.06 16.38 8.27 16.74 8.49C16.85 8.56 16.96 8.62 17.06 8.69C17.08 8.71 17.1 8.72 17.12 8.74C17.34 8.9 17.51 9.06 17.62 9.22C17.68 9.29 17.72 9.37 17.75 9.44C17.77 9.5 17.78 9.57 17.78 9.63C17.78 9.7 17.77 9.76 17.75 9.83Z"/>`
  ),
  table: wrapStrokeIcon(
    '-1 -2 24 24',
    `<path d="M0.75 3.25C0.75 1.86929 1.86929 0.75 3.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V3.25Z"/><path d="M0.75 6.75H19.75"/><path d="M0.75 12.75H19.75"/><path d="M10.25 0.75V18.75"/>`
  ),
  files: wrapStrokeIcon(
    '-1 -2 24 24',
    `<path d="M12.25 0.75H5.25C4.14543 0.75 3.25 1.64543 3.25 2.75V16.75C3.25 17.8546 4.14543 18.75 5.25 18.75H15.25C16.3546 18.75 17.25 17.8546 17.25 16.75V5.75L12.25 0.75Z"/><path d="M12.25 0.75V5.75H17.25"/>`
  ),
  knowledge: wrapStrokeIcon(
    '-1 -2 24 24',
    `<ellipse cx="10.25" cy="3.75" rx="8.5" ry="3"/><path d="M1.75 3.75V9.75C1.75 11.41 5.55 12.75 10.25 12.75C14.95 12.75 18.75 11.41 18.75 9.75V3.75"/><path d="M1.75 9.75V15.75C1.75 17.41 5.55 18.75 10.25 18.75C14.95 18.75 18.75 17.41 18.75 15.75V9.75"/>`
  ),
  calendar: wrapStrokeIcon(
    '-1 -2 24 24',
    `<path d="M0.75 5.25C0.75 3.86929 1.86929 2.75 3.25 2.75H17.25C18.6307 2.75 19.75 3.86929 19.75 5.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V5.25Z"/><path d="M0.75 8.25H19.75"/><path d="M6.25 0.25V5.25"/><path d="M14.25 0.25V5.25"/>`
  ),
  library: wrapStrokeIcon(
    '-1 -2 24 24',
    `<path d="M0.75 4.75C0.75 3.34987 0.75 2.6498 1.02248 2.11502C1.26217 1.64462 1.64462 1.26217 2.11502 1.02248C2.6498 0.75 3.34987 0.75 4.75 0.75C6.15013 0.75 6.8502 0.75 7.38498 1.02248C7.85538 1.26217 8.23783 1.64462 8.47752 2.11502C8.75 2.6498 8.75 3.34987 8.75 4.75V14.75C8.75 16.1501 8.75 16.8502 8.47752 17.385C8.23783 17.8554 7.85538 18.2378 7.38498 18.4775C6.8502 18.75 6.15013 18.75 4.75 18.75C3.34987 18.75 2.6498 18.75 2.11502 18.4775C1.64462 18.2378 1.26217 17.8554 1.02248 17.385C0.75 16.8502 0.75 16.1501 0.75 14.75V4.75Z"/><path d="M0.75 6.75H8.75"/><path d="M10.1986 6.01843C9.84373 4.68838 9.66628 4.02336 9.78849 3.44599C9.89599 2.93812 10.1608 2.47747 10.5451 2.13005C10.9819 1.73508 11.6442 1.55689 12.9687 1.2005C14.2932 0.844119 14.9555 0.665926 15.5304 0.788649C16.0362 0.8966 16.4949 1.16256 16.8409 1.54841C17.2342 1.98706 17.4117 2.65209 17.7666 3.98213L20.3014 13.4816C20.6563 14.8116 20.8337 15.4766 20.7115 16.054C20.604 16.5619 20.3392 17.0225 19.9549 17.37C19.5181 17.7649 18.8558 17.9431 17.5313 18.2995C16.2068 18.6559 15.5445 18.8341 14.9696 18.7114C14.4638 18.6034 14.0051 18.3374 13.6591 17.9516C13.2658 17.5129 13.0883 16.8479 12.7334 15.5179L10.1986 6.01843Z"/><path d="M10.75 7.75L17.2501 5.75"/>`
  ),
  settings: wrapStrokeIcon(
    '0 0 24 24',
    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`
  ),
  templates: wrapStrokeIcon(
    '1 1 22 22',
    `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`
  ),
}

function getRouteSection(pathname: string): string | null {
  if (!pathname.includes('/workspace/')) return null
  const parts = pathname.split('/')
  const sectionIndex = parts.indexOf('workspace') + 2
  return parts[sectionIndex] ?? null
}

const SECTION_TO_ICON: Record<string, string> = {
  home: 'home',
  task: 'home',
  w: 'blimp',
  tables: 'table',
  files: 'files',
  knowledge: 'knowledge',
  schedules: 'calendar',
  logs: 'library',
  settings: 'settings',
  templates: 'templates',
}

function setFaviconHrefs(url: string) {
  document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']").forEach((link) => {
    if (link.rel === 'apple-touch-icon') return
    link.href = url
  })
}

export function DynamicFavicon() {
  const pathname = usePathname()

  useEffect(() => {
    const section = getRouteSection(pathname)
    const iconKey = section ? SECTION_TO_ICON[section] : null
    const url = iconKey ? FAVICONS[iconKey] : DEFAULT_FAVICON

    setFaviconHrefs(url)

    // Re-apply whenever Next.js head reconciliation replaces link elements
    const observer = new MutationObserver(() => setFaviconHrefs(url))
    observer.observe(document.head, { childList: true })

    return () => {
      observer.disconnect()
      setFaviconHrefs(DEFAULT_FAVICON)
    }
  }, [pathname])

  return null
}
