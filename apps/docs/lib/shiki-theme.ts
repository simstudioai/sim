import type { ThemeRegistrationRaw } from 'shiki'

/**
 * Sim's syntax theme for docs code blocks.
 *
 * The platform highlights code with PrismJS through `@sim/emcn`'s `Code` component, whose
 * token colors live in `packages/emcn/src/components/code/code.css`. Docs highlight with
 * Shiki, which is TextMate-scoped rather than Prism-tokenized, so parity has to be
 * expressed as a scope-to-color mapping rather than a shared stylesheet. The palette follows
 * `code.css`, with darker light-mode hues where needed for readable contrast on the code surface.
 *
 * The mapping was derived by highlighting the same snippets through both engines and
 * comparing output. Two places where the grammars genuinely disagree, and the choice made:
 *
 * - Prism only colors a shell command when it recognises the binary, so `npm` highlights
 *   but `sim` does not. TextMate scopes the first word of a statement as the command
 *   regardless, so `sim` highlights too. Shiki's reading is the correct one and is kept.
 * - TextMate scopes every bare shell argument as `string.unquoted.argument`, which would
 *   paint most of a command line in the string color. Prism leaves those plain, so the
 *   scope is pinned back to the base foreground and only genuinely quoted strings carry
 *   the string color.
 *
 * Bare `variable` is deliberately unmapped. TextMate scopes declared JavaScript
 * identifiers as `variable.other.*`, and coloring those would make JS and TS far busier
 * than the platform editor, which leaves them at the base foreground. Only the things
 * Prism actually calls out — object and config keys, shell flags and shell expansions —
 * are mapped to the variable color.
 */

/** Light-mode platform hues adjusted to meet WCAG AA text contrast on the code surface. */
const LIGHT = {
  /** `--text-primary` — the platform's base code foreground. */
  foreground: '#1a1a1a',
  /** `--surface-5` — the fill `chipFieldSurfaceClass` puts under a code surface. */
  background: '#f3f3f3',
  comment: '#15803d',
  punctuation: '#383838',
  variable: '#0e7490',
  constant: '#15803d',
  string: '#b45309',
  keyword: '#2f55ff',
  function: '#854d0e',
  regex: '#be123c',
  deleted: '#b91c1c',
} as const

/** Dark-mode token colors, from the `.dark .code-editor-theme` rules in emcn's `code.css`. */
const DARK = {
  /** `--code-foreground`. */
  foreground: '#eeeeee',
  /** `--code-bg`. */
  background: '#1f1f1f',
  comment: '#6ec97d',
  punctuation: '#d4d4d4',
  variable: '#4fc3f7',
  constant: '#a5d6a7',
  string: '#f39c6b',
  keyword: '#2fa1ff',
  function: '#fbbf24',
  regex: '#f87171',
  deleted: '#f87171',
} as const

type TokenColors = typeof LIGHT | typeof DARK

/**
 * Builds a Shiki theme from one palette. Scope order matters: TextMate resolves a token by
 * longest matching scope, so the narrower entries below (`string.unquoted.argument`,
 * `keyword.operator`) intentionally follow and override the broader ones.
 */
function buildTheme(name: string, type: 'light' | 'dark', c: TokenColors): ThemeRegistrationRaw {
  return {
    name,
    type,
    settings: [
      { settings: { background: c.background, foreground: c.foreground } },

      /** Prism `comment` / `block-comment` / `prolog` / `doctype` / `cdata`. */
      {
        scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
        settings: { foreground: c.comment },
      },

      /** Prism `keyword` / `atrule` — plus TextMate's storage scopes, which Prism folds into keywords. */
      {
        scope: [
          'keyword',
          'keyword.control',
          'keyword.other',
          'storage',
          'storage.type',
          'storage.modifier',
          'meta.import keyword',
          'meta.export keyword',
        ],
        settings: { foreground: c.keyword },
      },

      /** Prism `function` and `class-name`. */
      {
        scope: [
          'entity.name.function',
          'entity.name.command',
          'support.function',
          'meta.function-call.generic',
          'entity.name.class',
          'entity.name.type',
          'support.class',
          'support.type',
        ],
        settings: { foreground: c.function },
      },

      /**
       * Prism `property` / `attr-name` / `variable` — object and config keys, markup
       * attributes, shell flags and shell expansions. Bare `variable` is excluded on
       * purpose; see the module docblock.
       */
      {
        scope: [
          'support.type.property-name',
          'meta.object-literal.key',
          'entity.name.tag.yaml',
          'entity.other.attribute-name',
          'constant.other.option',
          'variable.other.normal',
          'variable.other.special',
          'punctuation.definition.variable',
        ],
        settings: { foreground: c.variable },
      },

      /** Prism `number` / `boolean` / `constant` / `tag`. */
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.character',
          'support.constant',
          'entity.name.tag',
          'variable.language',
        ],
        settings: { foreground: c.constant },
      },

      /** Prism `string` / `char` / `inserted`. */
      {
        scope: [
          'string',
          'string.quoted',
          'string.template',
          'punctuation.definition.string',
          'markup.inserted',
        ],
        settings: { foreground: c.string },
      },

      /**
       * Bare shell arguments. TextMate calls these strings; Prism leaves them plain, and
       * plain is what keeps a command line readable. Declared after `string` so it wins.
       */
      { scope: ['string.unquoted.argument'], settings: { foreground: c.foreground } },

      /** Prism `punctuation` / `operator` / `entity` / `symbol`. */
      {
        scope: [
          'punctuation',
          'meta.brace',
          'keyword.operator',
          'punctuation.separator',
          'punctuation.terminator',
          'punctuation.accessor',
        ],
        settings: { foreground: c.punctuation },
      },

      /** Prism `regex` / `important`. */
      {
        scope: ['string.regexp', 'constant.regexp', 'keyword.other.important'],
        settings: { foreground: c.regex },
      },

      /** Prism `deleted`, plus TextMate's invalid scopes. */
      {
        scope: ['markup.deleted', 'invalid', 'invalid.illegal'],
        settings: { foreground: c.deleted },
      },
    ],
  }
}

const simShikiLight = buildTheme('sim-light', 'light', LIGHT)
const simShikiDark = buildTheme('sim-dark', 'dark', DARK)

/**
 * The Shiki configuration shared by both highlighting pipelines — the MDX one in
 * `source.config.ts` and fumadocs-openapi's separate instance in the docs page. They must
 * agree or the API reference renders in a different palette from the rest of the site, so the
 * options object is defined once here rather than written out at each call site.
 *
 * `defaultColor: false` is fumadocs' own default and has to be restated, because supplying
 * `themes` replaces that default block wholesale. It is what emits the paired
 * `--shiki-light` / `--shiki-dark` custom properties that let the theme toggle recolor code
 * without re-highlighting.
 */
export const simShikiOptions = {
  themes: { light: simShikiLight, dark: simShikiDark },
  defaultColor: false,
} as const
