import { createShikiFactory } from 'fumadocs-core/highlight/shiki'
import { curlJsonBodyGrammar } from '@/lib/shiki-curl-json'

/**
 * Shiki factory for the API reference, mirroring fumadocs' `defaultShikiFactory` but preloading
 * {@link curlJsonBodyGrammar}.
 *
 * An injection grammar has to be registered on the highlighter itself — it is not a per-call
 * option — so the highlighter has to be one we construct. The same factory backs both sides of
 * the API page: `createAPIPage` uses it on the server, and `ApiShikiProvider` hands it to
 * fumadocs' client code blocks, which highlight the request tabs in the browser.
 *
 * It must stay importable from a client module, which is why the grammar is plain data and the
 * `shiki` import is dynamic.
 */
export const simShikiFactory = createShikiFactory({
  async init(options) {
    const { createHighlighter, createJavaScriptRegexEngine } = await import('shiki')
    return createHighlighter({
      langs: [curlJsonBodyGrammar],
      themes: [],
      langAlias: options?.langAlias,
      engine: createJavaScriptRegexEngine(),
    })
  },
})
