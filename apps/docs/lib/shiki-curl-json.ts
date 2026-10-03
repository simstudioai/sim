import type { LanguageRegistration } from 'shiki'

/**
 * TextMate injection that highlights a `curl` JSON request body as JSON.
 *
 * To a shell, `curl -d '{...}'` is a single-quoted string — one token spanning the whole body.
 * So the same JSON that renders with colored keys in a response sample rendered as one flat
 * block of string color in the request sample directly above it.
 *
 * Two things this is deliberately NOT:
 *
 * - **`{ include: 'source.json' }`.** Injecting the real JSON grammar attaches it, but its
 *   object pattern only assigns `support.type.property-name.json` — the scope that colors keys —
 *   when it owns the opening brace. Entering mid-string, keys keep `string.quoted.double.json`
 *   and stay string-colored, which is the entire difference this exists to remove. Hence the
 *   hand-written patterns below, which name that scope directly.
 * - **A Shiki transformer.** A transformer re-tokenizes the body correctly, but it is a function,
 *   and `shikiOptions` is forwarded into a client component — "Functions cannot be passed
 *   directly to Client Components" takes down every API reference page. A grammar is plain data,
 *   so it survives that boundary.
 *
 * Applies to prose fences only, via `langs` on the MDX pipeline. Not the API reference:
 * fumadocs-openapi calls `renderCodeBlock` with a hard-coded `"json"` for request and response
 * samples, so a shell injection can never fire there, and its cURL usage tabs highlight in the
 * browser off fumadocs' own factory — `ClientCodeBlockProvider` sits in a `"use client"` module
 * the package does not expose through its `exports` map, so reaching it means importing
 * `fumadocs-openapi/ui/base` from client code and dragging `remark` and
 * `@fumari/json-schema-ts` into the browser bundle. That broke the deployment once.
 *
 * The opening brace requires a `}`, a quoted key, or end-of-line after it. That is what keeps
 * `awk '{print $1}'` out, while still matching a body whose brace ends the line — Oniguruma
 * matches line by line, so without the `$` alternative the outer brace of a formatted body never
 * begins a match.
 *
 * Verified against `jq '.[0]'`, `awk '{print $1}'`, `grep -o 'foo'` and `echo '{}'`: none are
 * re-colored.
 */
export const curlJsonBodyGrammar: LanguageRegistration = {
  name: 'curl-json-body',
  scopeName: 'inject.curl-json-body',
  injectionSelector: 'L:string.quoted.single.shell',
  injectTo: ['source.shell'],
  patterns: [{ include: '#object' }],
  repository: {
    object: {
      begin: '\\{(?=\\s*(?:\\}|"|$))',
      end: '\\}',
      beginCaptures: { 0: { name: 'punctuation.definition.dictionary.begin.json' } },
      endCaptures: { 0: { name: 'punctuation.definition.dictionary.end.json' } },
      patterns: [
        { include: '#key' },
        { match: ':', name: 'punctuation.separator.dictionary.key-value.json' },
        { match: ',', name: 'punctuation.separator.dictionary.pair.json' },
        { include: '#value' },
      ],
    },
    /** Matched before `#value` so a `"foo":` reads as a key rather than a string. */
    key: { match: '"[^"]*"(?=\\s*:)', name: 'support.type.property-name.json' },
    array: {
      begin: '\\[',
      end: '\\]',
      beginCaptures: { 0: { name: 'punctuation.definition.array.begin.json' } },
      endCaptures: { 0: { name: 'punctuation.definition.array.end.json' } },
      patterns: [{ include: '#value' }, { match: ',', name: 'punctuation.separator.array.json' }],
    },
    value: {
      patterns: [
        { include: '#object' },
        { include: '#array' },
        { match: '"[^"]*"', name: 'string.quoted.double.json' },
        { match: '\\b(?:true|false|null)\\b', name: 'constant.language.json' },
        { match: '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?', name: 'constant.numeric.json' },
      ],
    },
  },
}
