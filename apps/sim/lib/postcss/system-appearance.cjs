/** Reuse explicit Platform theme rules for system appearance before React hydrates. */
const plugin = () => ({
  postcssPlugin: 'sim-system-appearance',
  OnceExit(root, { postcss }) {
    root.walkRules(/\[data-(?:platform-ui|emcn)\]\[data-theme=/, (rule) => {
      for (const scheme of ['dark', 'light']) {
        const explicit = new RegExp(
          `^\\[data-(?:platform-ui|emcn)\\]\\[data-theme=["']?${scheme}["']?\\]`
        )
        const selectors = rule.selectors
          .filter((selector) => explicit.test(selector))
          .map((selector) => selector.replace(explicit, '[data-platform-ui][data-theme="system"]'))
        if (selectors.length) {
          const media = postcss.atRule({
            name: 'media',
            params: `(prefers-color-scheme: ${scheme})`,
          })
          rule.after(media.append(rule.clone({ selectors })))
        }
      }
    })
  },
})

plugin.postcss = true

module.exports = plugin
