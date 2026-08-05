/**
 * @vitest-environment jsdom
 *
 * Guards against drift between the code-block language picker and the Prism grammars actually
 * registered by CodeBlockHighlight: every selectable language must have a registered grammar, or it
 * would silently fall back to no highlighting.
 */
import Prism from 'prismjs'
import { describe, expect, it } from 'vitest'
import { LANGUAGE_OPTIONS } from './code-block'
// Importing the highlighter registers all the prism-* grammars as a side effect.
import './code-highlight'

describe('code-block languages', () => {
  it('every selectable language has a registered Prism grammar', () => {
    for (const { value } of LANGUAGE_OPTIONS) {
      if (value === 'plain') continue
      expect(Prism.languages[value], `no Prism grammar registered for "${value}"`).toBeDefined()
    }
  })
})
