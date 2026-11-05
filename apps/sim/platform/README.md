# Sim Platform

The new Platform starts here as a standalone Next.js App Router project inside `apps/sim`. Its root opens the product Home screen. Home, Chat and Settings use the new EMCN library. These routes share installed dependencies with Sim and have no database, API, authentication or legacy app providers. The existing Sim app continues to start and build as before.

To start or resume work in a new Sim chat, say “Use `$implement-platform` to [add, change, consolidate, or remove the UI] on [route].” The [implementation skill](../../../.agents/skills/implement-platform/SKILL.md) reads the [contract](AGENTS.md) and [ownership map](docs/component-ownership.md) for the checkout containing that route. Name the Paper section when implementing an existing design. For a code-first change, describe the desired behavior, where it should apply, and what you want to see on the live page.

From the repository root:

```sh
bun run --cwd apps/sim dev:platform
SIM_PLATFORM_FIXTURES=1 bun run --cwd apps/sim dev:platform
```

Open [Home](http://localhost:3100/home), [Chat](http://localhost:3100/chat/weekly-review?state=full), [Settings](http://localhost:3100/settings), or the separate [component workbench](http://localhost:3100/workbench). With the flag on, `?state=empty|full|stress` selects the fixture on any of them. `?theme=light|dark|system` selects the product appearance. Product navigation preserves these choices; nothing writes examples to storage. The URL cannot activate the server flag. Old catalog links with a recipe still open the workbench.

The product routes live under `app/(shell)/`. A persistent layout holds transient interface preferences, sidebar state and chat edits. Pages choose the server fixture and compose a few owners. Each route owns its components and CSS Modules in a private `_components/<component>/` folder: the [Home chart](app/%28shell%29/home/_components/activity-chart/activity-chart.tsx) sits beside its styles; the [dialog](design-system/components/modal/modal.tsx) belongs to EMCN. Shared shell UI lives in `app/(shell)/_components/`. [Rhythm tokens](design-system/styles/rhythm.css) and the [ownership and interaction contract](AGENTS.md) apply across all three routes. The [Paper state inventory](docs/core-chat-states.md) enumerates the source rows in scope. Integrations, workspace destinations and workspace create/sort return to Home; Wiki is deferred.

## Desktop

Sim Desktop loads **the same routes and styles** in its Electron window. [The shell](../../desktop/README.md) owns preload, window buttons, fullscreen and native capabilities. The isolated renderer detects the existing bridge in `app/(shell)/_components/desktop/desktop-host.tsx`. Its shared titlebar observer synchronizes native insets and fullscreen. Local preview interactions never run a terminal, drive a browser or change native settings. Do not copy the UI into Electron or use a viewport width as a desktop detector.

Start the Platform above, then launch the existing desktop shell using a disposable profile:

```sh
SIM_DESKTOP_ORIGIN=http://127.0.0.1:3100 SIM_DESKTOP_USER_DATA="$(mktemp -d)" bun run --cwd apps/desktop dev
```

## Using EMCN

Select a theme once with `PlatformSurface`. Editors, menus, selections, links and dialogs own their keyboard behavior. `MetricGroup` and `DataTable` accept records of any length. Import controls and compositions from `@/platform/design-system/components`. Provide content and named states, never styles. For a structural master such as an Issue group, supply its Paper key and named slots. The key determines the allowed slot names and the compiler enforces missing slots. A nested button slot accepts the semantic button, not an image of it. The Paper catalog in the workbench resolves the actual example.

```tsx
import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import { Button } from '@/platform/design-system/components'

<Button variant="secondary">Rename</Button>
<ComponentRecipe recipe="C1332" slots={{ title: 'Needs review', column: 'Created' }} />
```

Shared and Platform still own different recipes; `catalog/evidence.json` preserves that ownership and a path from the Base to a Platform product use. Registered states without a Platform use, canvas organizers and the other products are outside this library. Keep feature-specific compositions in their feature owner. Real data adapters belong to Phase 3.

Workspace lists, sidebar items, recents and attachment batches accept typed arrays with stable item IDs. Use the named components for these collection masters: a Paper specimen's item count is sample data. An empty array renders zero items, and adding items preserves their registered row/card appearance. Each scroll viewport determines fades and controls from its actual contents. Chart labels, marks, inspected values and legends come from the same series. Supply raw numeric values and their units to data tables. The column schema determines alignment and which columns remain visible as the table narrows.

The full fixture includes twenty sidebar workspaces, sixteen conversations, a twelve-message inbox and a calendar that scrolls from midnight to midnight even on empty days. Home and Chat share a reading width. The resting Home greeting aligns with the sidebar Home row. The shell uses one 12px inset above the organization and on both sides of the profile row. The Home inset scrolls away through the viewport edge fade. The collapsed sidebar control aligns with the expanded toolbar. Calendar events share the muted button’s solid, borderless rest, hover and pressed fills; the event opens local details and attendees have a separate control. Provider navigation awaits real event URLs.

Start with the [component ownership map](docs/component-ownership.md) when choosing a primitive. Sidebar, recents and panel tabs use one row; form and command dialogs use one borderless surface. Copy confirmations and transient notifications last four seconds. The notification count uses the compact Invite button. Expanded notices share one subtle shadow around the list. A new notice pauses its expiry on hover or keyboard focus. Icon color transitions take 120ms and respect reduced motion. The [design contract](AGENTS.md) defines these rules.

### Time and Home activity

Home switches between **Tasks run** in Build and **Searches made** in Search, using the same selected 7-, 30- or 90-day window and visibility setting. Customize Home follows the mode. Hover and keyboard inspection show the date and that day’s actual metric. The fixture snapshot provides dated observations and a fixed reference time; fixture-off routes show no example activity.

Import [Platform time formatting](lib/time.ts) for dates, relative ages and clock ranges. Mail, attention rows and file updates display `12m ago`, `1hr ago`, `17hrs ago`, `1d ago`, then dates such as `Nov 2nd` after 48 hours. The formatter includes the year for older years. Axes use short month/day labels; a calendar date never shifts because of the browser’s timezone.

### Keyboard and dropdown behavior

Focus places the caret or keyboard target without changing the control’s border, outline, background or shadow. Selection, validation and the highlighted list item retain their Paper treatments. Use the same EMCN value picker and floating surface on the workbench and in a modal. Select handles a fixed set of values, a searchable combobox supports longer lists, and an action menu supports commands and nested menus. The Help menu in the workbench exercises the cascade.

Import the styled EMCN owner from product UI. Its Base UI primitive handles pointer and keyboard interaction, dismissal and collision placement. Nested menus support hovering into the child, arrow-key navigation, and Escape back to the parent. The tests also check form submission, dialog-local placement and focus restoration. [Base UI Select](https://base-ui.com/react/components/select) · [Combobox](https://base-ui.com/react/components/combobox) · [Menu](https://base-ui.com/react/components/menu)

## Maintaining the source

The [Platform design contract](AGENTS.md) is authoritative. Use the repository's [implementation skill](../../../.agents/skills/implement-platform/SKILL.md) and its Paper companion. Start with the running product route and its approved behavior. Consult Paper for existing anatomy, roles and states. Keep verified raw Paper exports locally: they may contain private example content. Only code, design geometry, safe slots and source references enter this repo.

- **Styles:** obtain Shared Light `get_tokens` (the token array) and `get_computed_styles` for the type masters (the node-to-style map); confirm theme file hashes match before assuming identical vocabulary. Run `bun scripts/sync-platform-foundations.ts <tokens.json> <registry.json> <styles.json>`, or append `--check` to compare without writing. This preserves aliases and converts scalable Paper px to rem at the 16px reference scale. Roles and material composites live in `design-system/styles`. The Tailwind entry scans only component owners; product pages do not receive a styling API.
- **Structure:** capture current Shared/Platform master JSX locally with node IDs for the compiler's anatomy check in `<exports>/<key>.jsx` and reconcile the registry and recipe contracts. Run `bun scripts/sync-platform-recipes.ts <paper-references-directory> <exports-directory>` from the repository root. Review changed keys, token aliases, CSS and nested slot geometry in the rendered workbench. Do not edit generated selectors to fix a product use.
- **Assets:** retain canonical glyph geometry and brand paints. Media belongs in named slots; do not fetch private Paper artwork at runtime. Fixture content is removable from `fixtures/`. Remove its loader, preview calls and synthetic data together when real resource reads arrive.

## Verification

```sh
bun run check:platform-design
bun run --cwd apps/sim type-check:platform
bun run --cwd apps/sim build:platform
bunx --no-install playwright install chromium
bun run --cwd apps/sim test:platform:e2e
# On macOS, also exercise the real shell and preload:
bun run --cwd apps/desktop build
bun run --cwd apps/sim test:platform:desktop
```

The Platform type check generates Next.js route types and checks the isolated project. The repository type check runs it alongside the existing app’s TypeScript project.

The browser suite starts separate production servers with fixtures enabled and disabled. Supply `PLATFORM_REPORT_PATH` to save JSON, failure screenshots and traces. Next uses webpack for this nested app: the installed Turbopack also discovers the parent Sim project's proxy and instrumentation. Watch for that boundary when upgrading Next.

The static check covers ownership, styling props, evidence, tokens, variant use and dependency direction. If it flags a variant used on a real route, verify the call path and add that case to the checker. A workbench example cannot establish product usage. Use the rendered route to verify visual alignment. Compare both themes, keyboard and pointer states, actual overflow, text scaling and widths between approved artboards. Build the standalone app before running the browser suite to test the current sources.

References: [Next project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Next styling](https://nextjs.org/docs/app/getting-started/css), [Tailwind theme variables](https://tailwindcss.com/docs/theme), [shadcn/ui composition](https://ui.shadcn.com/docs), [Playwright assertions](https://playwright.dev/docs/test-assertions).
