/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFormFieldState } from '@/main/browser-agent/page-functions'

describe('readFormFieldState', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.__simAgentResolveElement = undefined
    window.__simAgentElements = []
  })

  function register(markup: string): HTMLInputElement {
    document.body.innerHTML = markup
    const element = document.body.firstElementChild as HTMLInputElement
    window.__simAgentElements = [element]
    return element
  }

  it('compares the complete actual value even when previews and lengths match', () => {
    const input = register('<input>')
    input.value = `${'x'.repeat(120)}actual`
    expect(readFormFieldState(0, 'text', `${'x'.repeat(120)}wanted`)).toMatchObject({
      matchesRequested: false,
      valueLength: 126,
      valuePreview: 'x'.repeat(120),
    })
    expect(readFormFieldState(0, 'text', input.value)).toMatchObject({ matchesRequested: true })
  })

  it.each([
    'type="password"',
    'autocomplete="section-login current-password"',
    'autocomplete="new-password"',
  ])('refuses credentials without a value readback (%s)', (attributes) => {
    register(`<input ${attributes} value="secret">`)
    expect(readFormFieldState(0, 'text', 'secret')).toEqual({ error: 'password' })
  })

  it.each(['one-time-code', 'cc-number', 'cc-csc', 'cc-exp'])(
    'verifies %s without previewing it',
    (hint) => {
      register(`<input autocomplete="${hint}" value="123456">`)
      expect(readFormFieldState(0, 'text', '123456')).toMatchObject({
        matchesRequested: true,
        redacted: true,
        valueLength: 6,
        valuePreview: '',
      })
    }
  )

  it.each(['<input type="file">', '<div contenteditable="true">editor</div>'])(
    'refuses nonordinary text fields',
    (markup) => {
      register(markup)
      expect(readFormFieldState(0, 'text', '')).toEqual({
        error: 'Form batches require ordinary text inputs or textareas.',
      })
    }
  )

  it('rejects a same-origin framed field', () => {
    document.body.innerHTML = '<iframe></iframe>'
    const inner = document.querySelector('iframe')?.contentDocument
    if (!inner) throw new Error('Missing test frame')
    inner.body.innerHTML = '<input>'
    window.__simAgentElements = [inner.body.firstElementChild as Element]
    expect(readFormFieldState(0, 'text', '')).toEqual({
      error: 'Form batches require top-page fields.',
    })
  })

  it('verifies native selection by the existing case-insensitive value or label match', () => {
    register(
      '<select><option value="us">United States</option><option value="ca">Canada</option></select>'
    )
    expect(readFormFieldState(0, 'select', 'UNITED STATES')).toMatchObject({
      matchesRequested: true,
      valuePreview: 'us',
    })
    expect(readFormFieldState(0, 'select', 'Canada')).toMatchObject({ matchesRequested: false })
  })

  it('rejects disabled options and multi-select controls', () => {
    register('<select><option disabled value="us">United States</option></select>')
    expect(readFormFieldState(0, 'select', 'us')).toMatchObject({ error: expect.any(String) })
    register('<select multiple><option value="us">United States</option></select>')
    expect(readFormFieldState(0, 'select', 'us')).toMatchObject({ error: expect.any(String) })
  })

  it('verifies native checkbox state while refusing direct radio unchecks', () => {
    register('<input type="checkbox" checked>')
    expect(readFormFieldState(0, 'checked', true)).toEqual({
      matchesRequested: true,
      checked: true,
    })
    register('<input type="radio" checked>')
    expect(readFormFieldState(0, 'checked', false)).toMatchObject({ error: expect.any(String) })
  })
})
