import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'

/**
 * Prism.js highlighting utilities isolated in a dedicated module.
 *
 * The grammar imports above are side-effectful (they register languages on the
 * shared `Prism.languages` registry), which marks any module that statically
 * imports them as having side effects and therefore non-tree-shakeable. Keeping
 * them here — rather than in `code.tsx` — ensures Prism only enters bundles that
 * actually import `highlight`/`languages`, instead of every consumer of the
 * shared `@/components/emcn` barrel (which re-exports `Code`).
 *
 * `code.tsx` itself never imports this module statically; it loads it lazily via
 * dynamic `import()` on first highlight.
 */
export { highlight, languages }
