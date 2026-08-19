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
  it('keeps both rails on a many-section page', () => {
    runShell('---\ntitle: T\n---\n## A\n\nx\n\n## B\n\ny\n\n## C\n\nz')
    const cols = document.querySelector('.art-cols')
    expect(cols).toBeTruthy()
    expect(cols?.classList.contains('no-side-nav')).toBe(false)
    expect(document.querySelector('.rail[data-rail="nav"] a')).toBeTruthy()
    expect(document.querySelector('.rail[data-rail="toc"] .toc-items a')).toBeTruthy()
  })

  it('drops only the LEFT rail on a one-section page', () => {
    runShell('---\ntitle: T\n---\n## Only\n\nx')
    const cols = document.querySelector('.art-cols')
    expect(cols?.classList.contains('no-side-nav')).toBe(true)
    expect(document.querySelector('.rail[data-rail="toc"] .toc-items a')).toBeTruthy()
  })
})
