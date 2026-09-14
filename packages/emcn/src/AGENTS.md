# EMCN Components Scope

Applies to `packages/emcn/**`. Read `.claude/rules/emcn-components.md` before changing a component (chip chrome sources, component catalogue, modal keyboard defaults, authoring principles); tokens, font weight, and color conventions are in `.claude/rules/sim-styling.md`.

- Consumers import components, `cn`, and tokens from the `@sim/emcn` barrel, icons from `@sim/emcn/icons`, and CSS modules by file path — keep every new export reachable that way.
- Components own their exact geometry tokens (e.g. `Button` uses `rounded-[5px]`) but never their own font-weight: every primitive inherits the document 400 and steps up only deliberately.
- TSDoc for public components and APIs.

Central component, recipe and icon changes are design-system decisions. Run `bun run check:design --base origin/staging --working-tree` and explain intended shared changes in the PR. Review warnings remain visible. See `scripts/design-conformance/README.md`.
