/**
 * Routes Tailwind's border-width utilities through `--border-width`.
 *
 * v3 set `borderWidth.DEFAULT`, so `border`, `border-x`, `border-t`… and
 * `divide-*` all resolved through the hairline token (1px, or 0.5px on a 2dppx
 * display). v4 hardcodes `1px` into those utilities and exposes no theme key
 * for it.
 *
 * Re-declaring the utilities in a trailing `@layer utilities` block does not
 * work: the copy would sit after everything Tailwind emitted, at the same
 * specificity, so `.border` would beat `.border-2` and `.border-t-0` — the
 * opposite of Tailwind's own ordering. `@utility border {…}` does not work
 * either; Tailwind appends its own declaration inside the same rule and wins.
 *
 * Rewriting Tailwind's own declarations in place is the only form that keeps
 * source order, specificity, and variant coverage exactly as Tailwind emits
 * them. Runs after `@tailwindcss/postcss`.
 */

/** Utilities whose 1px width is the hairline, keyed by bare class name. */
const HAIRLINE_UTILITIES = new Set([
  'border',
  'border-x',
  'border-y',
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'border-s',
  'border-e',
  'divide-x',
  'divide-y',
])

/**
 * Only border-width longhands. A looser `/-width$/` would also catch
 * `outline-width`, `stroke-width`, `column-rule-width` and friends if one ever
 * shared a rule with a border utility — reachable through `@apply`.
 */
const BORDER_WIDTH_PROPERTIES = new Set([
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-inline-width',
  'border-inline-start-width',
  'border-inline-end-width',
  'border-block-width',
  'border-block-start-width',
  'border-block-end-width',
])

/**
 * Bare `1px` only. `\b1px\b` would also match the `1px` inside `0.1px` and
 * splice the variable into the middle of the number, producing CSS that is
 * silently invalid rather than failing the build.
 */
const ONE_PIXEL = /(?<![\w.])1px\b/g

/**
 * Every class name a selector references, unescaped. The escape alternative
 * must come first, or the negated set consumes a lone backslash and the
 * character it escapes then terminates the match.
 */
function classNames(selector) {
  const names = []
  for (const match of selector.matchAll(/\.((?:\\.|[^\s.,:>+~()[\]#])+)/g)) {
    names.push(match[1].replace(/\\(.)/g, '$1'))
  }
  return names
}

/** Strips Tailwind's variant prefixes: `dark:hover:border-t` -> `border-t`. */
function baseUtility(className) {
  const separator = className.lastIndexOf(':')
  const base = separator === -1 ? className : className.slice(separator + 1)
  return base.endsWith('!') ? base.slice(0, -1) : base
}

function isHairlineRule(rule) {
  return rule.selectors.some((selector) =>
    classNames(selector).some((name) => HAIRLINE_UTILITIES.has(baseUtility(name)))
  )
}

const plugin = () => ({
  postcssPlugin: 'sim-hairline-border-width',
  OnceExit(root, { result }) {
    // Third-party stylesheets travel through the same pipeline. Several are
    // themselves Tailwind output, so a dependency bump could ship a `.border`
    // rule that has no idea what `--border-width` is.
    if (result.opts.from?.includes('node_modules')) return

    root.walkRules((rule) => {
      if (!isHairlineRule(rule)) return
      rule.walkDecls((decl) => {
        if (!BORDER_WIDTH_PROPERTIES.has(decl.prop)) return
        // An arbitrary `border-[2px]` keeps its own value; the divide utilities'
        // `calc(1px * var(--tw-divide-*-reverse))` form is rewritten in place.
        decl.value = decl.value.replace(ONE_PIXEL, 'var(--border-width)')
      })
    })
  },
})
plugin.postcss = true

export default plugin
