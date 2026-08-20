/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { SIM_ARTIFACT_SHELL, simTokenOverrides } from '@/lib/workspace-files/artifact-stylesheet'
import { compileSimPage } from '@/lib/workspace-files/page-compile'

function runShell(source: string) {
  window.matchMedia ??= (() =>
    ({ matches: false, addEventListener() {}, removeEventListener() {} }) as never) as never
  ;(globalThis as { matchMedia?: unknown }).matchMedia = window.matchMedia
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const compiled = compileSimPage(source)
  document.documentElement.innerHTML = compiled
    .replace(/^<!DOCTYPE html>\n<html lang="en">/, '')
    .replace(/<\/html>$/, '')
  const script = SIM_ARTIFACT_SHELL.replace(/^<script>/, '').replace(/<\/script>$/, '')
  // biome-ignore lint: test harness executes the shell inline
  new Function(script)()
}

describe('shell layout decisions', () => {
  it('renders only the right TOC rail, however many sections', () => {
    runShell('---\ntitle: T\n---\n## A\n\nx\n\n## B\n\ny\n\n## C\n\nz')
    expect(document.querySelector('.rail[data-rail="nav"]')).toBeNull()
    expect(document.querySelector('.art-search')).toBeNull()
    const toc = [...document.querySelectorAll('.rail[data-rail="toc"] .toc-items a')]
    expect(toc.map((a) => a.textContent)).toEqual(['A', 'B', 'C'])
  })

  it('keeps prev/next arrows wired from frontmatter', () => {
    runShell('---\ntitle: T\nnext: "[Reference](sim:file/b)"\n---\n## Only\n\nx')
    const next = document.querySelector('.page-actions .pa-nav[aria-label="Next page"]')
    expect(next?.getAttribute('href')).toBe('sim:file/b')
    expect(
      document.querySelector('.page-actions .pa-nav[aria-label="Previous page"]')?.classList
    ).toContain('is-disabled')
  })
})

describe('simTokenOverrides', () => {
  // The overrides pin the app's LIVE token values — which are one theme's
  // palette. Scoping them to the app's current theme is what keeps the
  // page's own light/dark toggle alive: pinning both `[data-theme]` states
  // (the pre-fix behavior) froze the preview on the app's palette no matter
  // what the toggle set.
  it('pins the live tokens only under the current app theme', () => {
    document.documentElement.style.setProperty('--bg', '#123456')
    const block = simTokenOverrides('light')
    expect(block).toContain(':root[data-theme="light"]')
    expect(block).toContain('--bg:#123456')
    expect(block).not.toContain('[data-theme="dark"]')
    expect(block).not.toMatch(/(^|\{|,):root[,{]/)
    document.documentElement.style.removeProperty('--bg')
  })
})
