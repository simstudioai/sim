/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'

const SOURCE = `---
title: Elder Architecture
---

# Skills & Connections

## Evidence

alpha

## Delegation

beta

# Slack Gateway

## Transport

gamma
`

const domOptions = {
  runScripts: 'dangerously' as const,
  pretendToBeVisual: true,
  beforeParse(window: any) {
    // jsdom gaps, present in every real browser the page renders in.
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  },
}

const tick = () => sleep(60)

describe('in-document tabs drive the on-this-page rail', () => {
  it('scopes the rail to the active tab and rebuilds it on switch', async () => {
    const dom = new JSDOM(renderSimPageDocument(SOURCE), domOptions)
    const { document } = dom.window
    await tick()

    const railLinks = () =>
      [...document.querySelectorAll('.rail[data-rail="toc"] a')].map((a) => a.textContent)
    const buttons = [...document.querySelectorAll('[data-doc-tabs] .page-tab')]

    expect(buttons.map((b) => b.textContent)).toEqual(['Skills & Connections', 'Slack Gateway'])
    expect(railLinks()).toEqual(['Evidence', 'Delegation'])

    buttons[1].dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await tick()
    expect(document.querySelector('[data-tab-panel].is-active')?.id).toBe('doc-tab-1')
    expect(railLinks()).toEqual(['Transport'])

    buttons[0].dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await tick()
    expect(railLinks()).toEqual(['Evidence', 'Delegation'])
  })

  it('repositions the tab row as chrome between the bar and the columns', async () => {
    const dom = new JSDOM(renderSimPageDocument(SOURCE), domOptions)
    const { document } = dom.window
    await tick()

    const nav = document.querySelector('.page-tabs')
    expect(nav?.parentElement?.classList.contains('page')).toBe(true)
    expect(nav?.previousElementSibling?.classList.contains('art-bar')).toBe(true)
    expect(nav?.nextElementSibling?.classList.contains('art-cols')).toBe(true)
  })
})

describe('markdown table wrapping', () => {
  // A bare table is what drags the page sideways on a phone — the shell puts
  // every markdown table in the same .scroll container sim:table fences get.
  it('wraps bare tables in a scroll container', async () => {
    const dom = new JSDOM(
      renderSimPageDocument(`---
title: Table Doc
---

## Reference

| Connection | Endpoint |
|---|---|
| shell | api.planetscale.com/v1 |
`),
      domOptions
    )
    await tick()
    const table = dom.window.document.querySelector('table')
    expect(table?.parentElement?.classList.contains('scroll')).toBe(true)
  })
})

describe('code block copy', () => {
  // The sandboxed in-app preview denies the async clipboard API (opaque
  // origin), so the shell falls back to the selection command; jsdom has no
  // navigator.clipboard, which exercises exactly that path.
  it('copies through the selection-command fallback and flips the button', async () => {
    const dom = new JSDOM(
      renderSimPageDocument(`---
title: Copy Doc
---

## Snippet

\`\`\`bash
echo hi
\`\`\`
`),
      domOptions
    )
    const { document } = dom.window
    await tick()

    let copiedText: string | null = null
    document.execCommand = (command: string) => {
      copiedText = document.querySelector('textarea')?.value ?? null
      return command === 'copy'
    }

    const copy = document.querySelector('.codeblock-copy')
    expect(copy).not.toBeNull()
    copy?.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await tick()

    expect(copiedText?.trim()).toBe('echo hi')
    expect(copy?.classList.contains('is-copied')).toBe(true)
    // The scratch textarea is removed after the copy.
    expect(document.querySelector('textarea')).toBeNull()
  })
})

describe('older page shapes keep their rail', () => {
  it('builds the rail for a plain untabbed page', async () => {
    const dom = new JSDOM(
      renderSimPageDocument(`---
title: Plain Doc
---

## First

a

## Second

b
`),
      domOptions
    )
    await tick()
    const links = [...dom.window.document.querySelectorAll('.rail[data-rail="toc"] a')].map(
      (a) => a.textContent
    )
    expect(links).toEqual(['First', 'Second'])
  })

  it('builds the whole-page rail for a legacy cross-file tabs page', async () => {
    const dom = new JSDOM(
      renderSimPageDocument(`---
title: Overview
tabs:
  - "Overview"
  - "[API](sim:file/abc)"
---

## Intro

x
`),
      domOptions
    )
    await tick()
    const { document } = dom.window
    const links = [...document.querySelectorAll('.rail[data-rail="toc"] a')].map(
      (a) => a.textContent
    )
    expect(links).toEqual(['Intro'])
    const nav = document.querySelector('.page-tabs')
    expect(nav?.previousElementSibling?.classList.contains('art-bar')).toBe(true)
  })
})
