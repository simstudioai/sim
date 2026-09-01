# EMCN Components Scope

These rules apply to `packages/emcn/**`.

- Import from `@sim/emcn`, never from subpaths except CSS files.
- Use Radix UI primitives for accessibility where applicable.
- Use CVA when a component has 2+ variants; use direct `className` composition for single-style components.
- Export both the component and its variants helper when using CVA.
- Keep tokens consistent with the chip-pill canonical look: normal font-weight, `--text-body` value text, `--text-icon` icons at `size-[14px]`, `rounded-lg`. Components own their exact geometry tokens (e.g. `Button` uses `rounded-[5px]`), but never their own font-weight — every primitive inherits the document 400, and a weight class is reached for only to step deliberately up. See `.claude/rules/emcn-components.md` for the full chip-chrome reference.
- Prefer `transition-colors` for interactive hover and active states.
- Use TSDoc when documenting public components or APIs.
