# EMCN Components Scope

These rules apply to `packages/emcn/**`.

- Import components and tokens from `@sim/emcn`; icons use `@sim/emcn/icons`, and CSS files may use their file paths.
- Use Radix UI primitives for accessibility where applicable.
- Use CVA when a component has 2+ variants; use direct `className` composition for single-style components.
- Export both the component and its variants helper when using CVA.
- Keep tokens consistent with the chip-pill canonical look: normal font-weight, `--text-body` value text, `--text-icon` icons at `size-[14px]`, `rounded-lg`. Components own their exact geometry tokens (e.g. `Button` uses `rounded-[5px]`), but never their own font-weight — every primitive inherits the document 400, and a weight class is reached for only to step deliberately up. See `.claude/rules/emcn-components.md` for the full chip-chrome reference.
- Prefer `transition-colors` for interactive hover and active states.
- Use TSDoc when documenting public components or APIs.

Central component, recipe and icon changes are design-system changes, including intentional improvements. Run `bun run check:design --base <target-branch-ref> --head HEAD` from the repository root after committing. Explain intended shared changes in the PR. Agents may fix straightforward consumer token mistakes; ask the engineer when shared impact or intent is ambiguous, and involve the designer for new standards. Keep resulting review warnings visible. See `scripts/design-conformance/README.md`.
