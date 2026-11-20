/**
 * Sim's syntax colors as a TextMate (Shiki) theme, and as a Zed-format theme, for surfaces
 * that highlight with Shiki or Pierre rather than with Prism through `Code`: docs code
 * blocks and the app's diffs and code editor.
 *
 * Prism tokenizes into its own classes, colored by `code.css`. Shiki assigns TextMate
 * scopes, so parity is a scope-to-color mapping, derived by highlighting the same snippets
 * through both engines and comparing output. Two places where the grammars genuinely
 * disagree, and the choice made:
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

/** One color per Prism token role, plus the surface the code sits on. */
export interface SyntaxColors {
  foreground: string
  background: string
  comment: string
  punctuation: string
  variable: string
  constant: string
  string: string
  keyword: string
  function: string
  regex: string
  deleted: string
}

interface SyntaxThemeRule {
  scope?: string[]
  settings: { foreground?: string; background?: string }
}

/** A raw TextMate theme; structurally what Shiki's `ThemeRegistrationRaw` accepts. */
interface SyntaxTheme {
  name: string
  type: 'light' | 'dark'
  settings: SyntaxThemeRule[]
}

/**
 * The token palette `code.css` defines for Prism, as CSS variables. A theme built from it
 * colors Shiki output exactly like `Code` and follows light and dark through the same
 * variables; the caller supplies the background of the surface it renders on.
 */
export const CODE_TOKEN_COLORS: Omit<SyntaxColors, 'background'> = {
  foreground: 'var(--code-foreground)',
  comment: 'var(--code-token-comment)',
  punctuation: 'var(--code-token-punctuation)',
  variable: 'var(--code-token-variable)',
  constant: 'var(--code-token-constant)',
  string: 'var(--code-token-string)',
  keyword: 'var(--code-token-keyword)',
  function: 'var(--code-token-function)',
  regex: 'var(--code-token-regex)',
  deleted: 'var(--code-token-deleted)',
}

/**
 * Builds a Shiki theme from one palette. Scope order matters: TextMate resolves a token by
 * longest matching scope, so the narrower entries below (`string.unquoted.argument`,
 * `keyword.operator`) intentionally follow and override the broader ones.
 */
export function buildSyntaxTheme(
  name: string,
  type: 'light' | 'dark',
  c: SyntaxColors
): SyntaxTheme {
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

/** Every role but the base foreground, which an unmapped token falls back to on its own. */
type TokenRole = Exclude<keyof SyntaxColors, 'background' | 'foreground'>

/**
 * The same roles for tree-sitter token types, which Zed-format themes color. A type with no
 * entry takes its parent's role (`keyword.control` → `keyword`) and an unlisted family takes
 * the foreground, so this mirrors the TextMate mapping above rather than every token type.
 */
const TREE_SITTER_ROLES = new Map<string, TokenRole>([
  ['comment', 'comment'],
  ['keyword', 'keyword'],
  ['keyword.operator', 'punctuation'],
  ['function', 'function'],
  ['constructor', 'function'],
  ['type', 'function'],
  ['enum', 'function'],
  ['property', 'variable'],
  ['attribute', 'variable'],
  ['number', 'constant'],
  ['boolean', 'constant'],
  ['constant', 'constant'],
  ['tag', 'constant'],
  ['variable.special', 'constant'],
  ['string', 'string'],
  ['string.regex', 'regex'],
  ['punctuation', 'punctuation'],
  ['operator', 'punctuation'],
  ['diff.plus', 'string'],
  ['diff.minus', 'deleted'],
])

/** A Zed-format theme; structurally what Pierre's Highlights backend accepts. */
interface ZedSyntaxTheme {
  name: string
  appearance: 'light' | 'dark'
  cssVariables: { prefix: string; defaults: Record<string, string> }
  style: { background: string; foreground: string; syntax: Record<string, string> }
}

/**
 * {@link CODE_TOKEN_COLORS} as a Zed-format theme for highlighters that color tree-sitter
 * tokens instead of TextMate scopes. Its colors name `code.css` variables rather than hold
 * values, so it follows light and dark exactly as the TextMate theme does.
 */
export function buildCodeTokenZedTheme(name: string, background: string): ZedSyntaxTheme {
  return {
    name,
    appearance: 'light',
    cssVariables: { prefix: '--code-', defaults: { background } },
    style: {
      background: 'background',
      foreground: 'foreground',
      syntax: Object.fromEntries(
        [...TREE_SITTER_ROLES].map(([type, role]) => [type, `token-${role}`])
      ),
    },
  }
}
