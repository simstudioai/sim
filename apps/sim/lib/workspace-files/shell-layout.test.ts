/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { SIM_ARTIFACT_SHELL } from '@/lib/workspace-files/artifact-stylesheet'
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
