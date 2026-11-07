/**
 * Confines the design system's embedded stylesheet to `[data-platform-ui]`.
 *
 * Next keeps route CSS loaded after client navigation, so one unscoped rule in a flagged page would
 * reach every legacy page afterwards. Each selector gains the scope through `:where()`, which adds
 * no specificity, so the cascade inside the surface stays the one the design system was written for.
 *
 * `data-theme="system"` follows the host app, not the OS: next-themes puts `.dark` on `<html>` before
 * first paint, so the surface needs no JavaScript to match it and cannot flash the wrong theme before
 * hydration. `scripts/check-platform-css.ts` compiles the entry through this plugin and verifies it.
 */
const EMBEDDED_ENTRY = 'emcn-platform/src/styles/platform.css'
const SCOPE = '[data-platform-ui]'
const DARK_THEME = /^\[data-platform-ui\]\[data-theme=["']?dark["']?\]/

function scopeSelector(selector) {
  selector = selector.replaceAll('[data-emcn]', SCOPE)
  if (DARK_THEME.test(selector)) {
    const followsHost = selector.replace(
      DARK_THEME,
      ':where(html.dark) [data-platform-ui][data-theme="system"]'
    )
    return [selector, followsHost]
  }
  if (selector.includes(SCOPE)) return [selector]
  return [`:where(${SCOPE}) ${selector}`]
}

const plugin = () => ({
  postcssPlugin: 'sim-platform-embed',
  OnceExit(root, { result }) {
    if (!result.opts.from?.replaceAll('\\', '/').endsWith(EMBEDDED_ENTRY)) return
    root.walkRules((rule) => {
      rule.selectors = rule.selectors.flatMap(scopeSelector)
    })
  },
})
plugin.postcss = true

module.exports = plugin
