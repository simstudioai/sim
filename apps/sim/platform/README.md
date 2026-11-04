# Sim Platform

The new Platform starts here as a standalone Next.js App Router project inside `apps/sim`. Its root route is a component workbench. It shares the repository's installed dependencies, but has no production routes, database, API, authentication, legacy EMCN or app providers. The existing Sim app continues to start and build as before.

From the repository root:

```sh
bun run --cwd apps/sim dev:platform
SIM_PLATFORM_FIXTURES=1 bun run --cwd apps/sim dev:platform
```

Run one of those commands and open [localhost:3100](http://localhost:3100). With the flag on, select Empty, Populated or Long content; links retain state and theme. For example, [dark, long content](http://localhost:3100/?theme=dark&state=stress) exercises wrapping and overflow. Without the flag, no simulated organization is loaded, including on a URL requesting populated data. The data module is server-only. The picker and specimen labels are available either way.

## Using EMCN

Select a theme once with `PlatformSurface`. Editors, menus, selections, links and dialogs own their keyboard behavior. `MetricGroup` and `DataTable` accept records of any length. Import controls and compositions from `@/platform/design-system/components`. Provide content and named states, never styles. For a structural master such as an Issue group, supply its Paper key and named slots. The key determines the allowed slot names and the compiler enforces missing slots. A nested button slot accepts the semantic button, not an image of it. The Paper catalog in the workbench resolves the actual example.

```tsx
import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import { Button } from '@/platform/design-system/components'

<Button variant="secondary">Rename</Button>
<ComponentRecipe recipe="C1332" slots={{ title: 'Needs review', column: 'Created' }} />
```

Shared and Platform still own different recipes; `catalog/evidence.json` preserves that ownership and a path from the Base to a Platform product use. Registered states without a Platform use, canvas organizers and the other products are outside this library. Product-specific compositions and real data adapters belong to later phases.

Workspace lists, sidebar items, recents and attachment batches accept typed arrays with stable item IDs. Use the named components for these collection masters: a Paper specimen's item count is sample data. An empty array renders zero items, and adding items preserves their registered row/card appearance. Each scroll viewport determines fades and controls from its actual contents. Chart labels, marks, inspected values and legends come from the same series. Supply raw numeric values and their units to data tables. The column schema determines alignment and which columns remain visible as the table narrows.

## Maintaining the source

The [Platform design contract](AGENTS.md) is authoritative. Use the repository's [implementation skill](../../../.agents/skills/implement-platform/SKILL.md) and its Paper companion. A change starts from the current master and representative product uses. Keep verified raw Paper exports locally: they may contain private example content. Only code, design geometry, safe slots and source references enter this repo.

- **Styles:** obtain Shared Light `get_tokens` (the token array) and `get_computed_styles` for the type masters (the node-to-style map); confirm theme file hashes match before assuming identical vocabulary. Run `bun scripts/sync-platform-foundations.ts <tokens.json> <registry.json> <styles.json>`, or append `--check` to compare without writing. This preserves aliases and converts scalable Paper px to rem at the 16px reference scale. Roles, native focus and material composites live in `design-system/styles`. The Tailwind entry scans only component owners; product pages do not receive a styling API.
- **Structure:** capture current Shared/Platform master JSX locally with node IDs for the compiler's anatomy check in `<exports>/<key>.jsx` and reconcile the registry and recipe contracts. Run `bun scripts/sync-platform-recipes.ts <paper-references-directory> <exports-directory>` from the repository root. Review changed keys, token aliases, CSS and nested slot geometry in the rendered workbench. Do not edit generated selectors to fix a product use.
- **Assets:** retain canonical glyph geometry and brand paints. Media belongs in named slots; do not fetch private Paper artwork at runtime. Fixture content is removable from `fixtures/`. Remove its loader, preview calls and synthetic data together when real resource reads arrive.

## Verification

```sh
bun run check:platform-design
bun run --cwd apps/sim build:platform
bunx --no-install playwright install chromium
bun run --cwd apps/sim test:platform:e2e
```

The browser suite starts separate production servers with fixtures enabled and disabled. Supply `PLATFORM_REPORT_PATH` to save JSON, failure screenshots and traces. Next uses webpack for this nested app: the installed Turbopack also discovers the parent Sim project's proxy and instrumentation. Watch for that boundary when upgrading Next.

The static check covers ownership, styling props, evidence, tokens, code usage and dependency direction. It cannot establish that a browser rendering matches Paper. Compare both themes, keyboard and pointer states, actual overflow, text scaling and widths between approved artboards. Build the standalone app before running the browser suite to test the current sources.

References: [Next project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Next styling](https://nextjs.org/docs/app/getting-started/css), [Tailwind theme variables](https://tailwindcss.com/docs/theme), [shadcn/ui composition](https://ui.shadcn.com/docs), [Playwright assertions](https://playwright.dev/docs/test-assertions).
