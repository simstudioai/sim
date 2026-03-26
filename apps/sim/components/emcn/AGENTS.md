# EMCN Components Scope

These rules apply to `apps/sim/components/emcn/**`.

- Import from `@/components/emcn`, never from subpaths except CSS files.
- Use Radix UI primitives for accessibility where applicable.
- Use CVA when a component has 2+ variants; use direct `className` composition for single-style components.
- Export both the component and its variants helper when using CVA.
- Keep tokens consistent with the existing library style such as `font-medium`, `text-[12px]`, and `rounded-[4px]`.
- Prefer `transition-colors` for interactive hover and active states.
- Use TSDoc when documenting public components or APIs.
