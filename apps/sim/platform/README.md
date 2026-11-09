# Sim Platform

The new Platform starts here as a standalone Next.js App Router project inside `apps/sim`. Its root opens the product Home screen. Home, Chat, Settings and organization integrations use the new EMCN library. These routes share installed dependencies with Sim. They have no database of their own: with live data they read the main app's `/api` through the [data seam](AGENTS.md#phase-3-data-seam). The existing Sim app continues to start and build as before.

To start or resume work in a new Sim chat, say “Use `$implement-platform` to [add, change, consolidate, or remove the UI] on [route].” The [implementation skill](../../../.agents/skills/implement-platform/SKILL.md) reads the [contract](AGENTS.md) and [ownership map](docs/component-ownership.md) for the checkout containing that route. Name the Paper section when implementing an existing design. For a code-first change, describe the desired behavior, where it should apply, and what you want to see on the live page.

The shared review URL is **http://localhost:3125**. Use the existing listener and its checkout when another task is active. `next dev` reloads changes from that checkout; a different worktree is a different copy of the code. Reconcile parallel changes there before review. Do not run another review server on a new port. Temporary test servers shut down after verification.

From the agreed review checkout’s repository root:

```sh
bun run --cwd apps/sim dev:platform
SIM_PLATFORM_FIXTURES=1 bun run --cwd apps/sim dev:platform
```

Open [Home](http://localhost:3125/home), [Chat](http://localhost:3125/chat/weekly-review?state=full), [Settings](http://localhost:3125/settings), [Integrations](http://localhost:3125/integrations?state=full), or the separate [component workbench](http://localhost:3125/workbench). With the flag on, `?state=empty|full|stress` selects the fixture on any of them. `?theme=light|dark|system` selects the product appearance. Product navigation preserves these choices; nothing writes examples to storage. The URL cannot activate the server flag. Old catalog links with a recipe still open the workbench.

Settings uses the same organization catalog and section components in fixture and live routes. [General](http://localhost:3125/settings/general?state=full) includes Privacy and Account details; [Sources](http://localhost:3125/settings/integrations?state=full) is the administrator's Search source inventory. The [integration center](docs/integration-center.md) is the member-facing management surface for Apps, Skills, MCPs and Credentials. Settings examples are loaded only by the server's fixture flag. Their edits belong to the browser session; no account, credential, organization policy or subscription is changed by preview interactions.

Integration fixtures cover the full workspace app catalog, multiple credentials, OAuth and provider-specific service-account forms, access management, suggested skills and templates. App-level actions use the control bar; credential rows open their own details. Family credentials share a canonical ID across apps. New enrollment and sharing remain UI-only, with secrets confined to the open form. The existing live Search adapter keeps its own authorized inventory and actions until the broader credential seam is connected.

Settings fixtures default to Enterprise at every density. The [Team subscription](http://localhost:3125/settings/billing?state=stress&plan=team) and [Free subscription](http://localhost:3125/settings/billing?state=empty&plan=free) previews apply the selected plan to Billing, Members and the available Settings sections. The [Knowledge graphs preview](http://localhost:3125/settings/knowledge-graphs?state=stress) uses the stress viewer’s platform-admin role, benchmark access and enabled superuser mode.

The product routes live under `app/(shell)/`. Their shared App Router layout owns the shell, sidebar scroll viewport, interface preferences and chat edits. Home, Chat, Settings and Integrations pages render their own bodies inside that layout. Navigating between them keeps the sidebar reading position, including when returning from Settings. The shell selects its gated fixture and appearance from the current URL. Each route owns its components and CSS Modules in a private `_components/<component>/` folder: the [Home chart](app/%28shell%29/home/_components/activity-chart/activity-chart.tsx) sits beside its styles; the [dialog](../../../packages/emcn/src/components/modal/modal.tsx) belongs to EMCN. Shared shell UI lives in `app/(shell)/_components/`. [Shared rhythm](../../../packages/emcn/src/styles/component-roles.css) and the [ownership and interaction contract](AGENTS.md) apply throughout the product. The [Paper state inventory](docs/core-chat-states.md) enumerates the source rows in scope. The [organization integrations guide](docs/organization-integrations.md) maps the member inventory, credential actions and tool permissions to their data operations. The integration center lives at the organization root; Home and eligible workspace links open that same destination. Standalone workspaces and viewers without organization Search access retain their existing credential route. Skills, MCPs and new sharing/editor interactions currently use only server-gated fixtures. Paper workspace tabs and the control bar inform the center's anatomy. Wiki is deferred.

A workspace row, a command-search result or a workspace in the chat panel opens that workspace’s [Dashboard](http://localhost:3125/workspace/it/dashboards?state=full) in fixture mode. The organization sidebar stays as it is and marks the workspace current, as it does Integrations. See [workspace UI](docs/workspace-ui.md) for the workspace’s four pages and their verification.

## Live data and the zone

The same app serves three modes, resolved on the server:

| Mode | Environment | Data |
| --- | --- | --- |
| `fixture` | `SIM_PLATFORM_FIXTURES=1` | Example scenarios |
| `live` | `DATABASE_URL` and the main app's server environment, `NEXT_PUBLIC_APP_URL` | The viewer's real organization, read in process through the main app's use cases |
| `none` | Neither | Empty routes |

Deployed, the Platform is a zone at `/org` on the main app's origin, so it shares the session cookie, `/api` and security headers:

| Variable | Set on | Purpose |
| --- | --- | --- |
| `SIM_PLATFORM_BASE_PATH=/org` | Platform, at build and at `next start` | Prefixes routes and assets; `next start` re-reads the config, so without it every route answers 404 |
| `SIM_PLATFORM_API_ORIGIN` | Platform, at runtime, standalone only | Where the browser's `/api` requests are proxied when there is no base path |
| `NEXT_PUBLIC_APP_URL` | Platform, at runtime | The main app's public origin, for login and legacy links |

To run live locally without the zone, start the main app, sign in at its origin, then start this app with the main app's environment, `SIM_PLATFORM_API_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_APP_URL=http://localhost:3000`; with no base path it proxies the browser's `/api` itself.

## Desktop

Sim Desktop loads **the same routes and styles** in its Electron window. [The shell](../../desktop/README.md) owns preload, window buttons, fullscreen and native capabilities. The isolated renderer detects the existing bridge in `app/(shell)/_components/desktop/desktop-host.tsx`. Its shared titlebar observer synchronizes native insets and fullscreen. Local preview interactions never run a terminal, drive a browser or change native settings. Do not copy the UI into Electron or use a viewport width as a desktop detector.

Start the Platform above, then launch the existing desktop shell using a disposable profile:

```sh
SIM_DESKTOP_ORIGIN=http://localhost:3125 SIM_DESKTOP_USER_DATA="$(mktemp -d)" bun run --cwd apps/desktop dev
```

## Using EMCN

Select a theme once with `PlatformSurface`. Editors, menus, selections, links and dialogs own their keyboard behavior. `MetricGroup` and `DataTable` accept records of any length. Import shared controls from `@sim/emcn/<family>` and Platform-specific compositions from `@sim/emcn-platform/<family>`. Provide content and named states, never styles. Unique feature compositions live beside their route and use these controls. Paper structural recipes remain workbench specimens and do not substitute for interactive product components.

```tsx
import { Button } from '@sim/emcn/button'

<Button variant="secondary">Rename</Button>
```

Shared and Platform still own different recipes; `catalog/evidence.json` preserves that ownership and a path from the Base to a Platform product use. Registered states without a Platform use, canvas organizers and the other products are outside this library. Keep feature-specific compositions in their feature owner. Real data adapters live in `lib/data/`.

Workspace lists, sidebar items, recents and attachment batches accept typed arrays with stable item IDs. Use the named components for these collection masters: a Paper specimen's item count is sample data. An empty array renders zero items, and adding items preserves their registered row/card appearance. Each scroll viewport determines fades and controls from its actual contents. Chart labels, marks, inspected values and legends come from the same series. Supply raw numeric values and their units to data tables. The column schema determines alignment and which columns remain visible as the table narrows.

The full fixture includes twenty sidebar workspaces, sixteen conversations, a twelve-message inbox and a calendar that scrolls from midnight to midnight even on empty days. All Platform reading pages share PageColumn width and gutters; PageOverflow supplies the common 8px surface overhang. Editor and preview canvases retain their working area. Home and Integrations share the same heading inset; the shell reserves sidebar opener and native titlebar clearance separately. The shell uses one 12px inset above the organization and on both sides of the profile row. The Home content scrolls through its viewport edge fade. The shell keeps the collapsed sidebar button aligned with the expanded toolbar even as the page scrolls. Platform and Settings navigation scroll independently, with edge fades instead of a visible scrollbar. Calendar events use the muted surface. An event with a provider URL opens in a new tab. Attendees and integration usage share Stack: up to three photos with names on hover and a passive +N count, compacted for large totals. Now appears when the calendar scrolls away from its resting position or another day is selected. It restores today’s schedule and centers the current time. Scrolling back to that position also hides Now.

Start with the [component ownership map](docs/component-ownership.md) when choosing a primitive. Sidebar, recents and panel tabs use one row; form and command dialogs use one borderless surface. Copy confirmations and transient notifications last four seconds. The notification count uses the compact Invite button. Expanded notices share one subtle shadow around the list. A new notice pauses its expiry on hover or keyboard focus. Icon color transitions take 120ms and respect reduced motion. The [design contract](AGENTS.md) defines these rules.

### Time and Home activity

Home switches between **Tasks run** in Build and **Searches** in Search, using the same selected 7-, 30- or 90-day window and visibility setting. Customize Home follows the mode. Hover and keyboard inspection show the date and that day’s actual metric. The fixture snapshot provides dated observations and a fixed reference time; fixture-off routes show no example activity.

Import [Platform time formatting](lib/time.ts) for dates, relative ages and clock ranges. Mail, attention rows and file updates display `12m ago`, `1hr ago`, `17hrs ago`, `1d ago`, then dates such as `Nov 2nd` after 48 hours. The formatter includes the year for older years. Axes use short month/day labels; a calendar date never shifts because of the browser’s timezone.

### Keyboard and dropdown behavior

Focus places the caret or keyboard target without changing ordinary field paint. SearchField has one explicit exception: its underline appears on hover or focus. Keyboard focus remains visible on actions. Selection, validation and the highlighted list item retain their Paper treatments. Use the same EMCN value picker and floating surface on the workbench and in a modal. Select handles a fixed set of values, a searchable combobox supports longer lists, and an action menu supports commands and nested menus. The Help menu in the workbench exercises the cascade.

Import the styled EMCN owner from product UI. Its Base UI primitive handles pointer and keyboard interaction, dismissal and collision placement. Nested menus support hovering into the child, arrow-key navigation, and Escape back to the parent. The tests also check form submission, dialog-local placement and focus restoration. [Base UI Select](https://base-ui.com/react/components/select) · [Combobox](https://base-ui.com/react/components/combobox) · [Menu](https://base-ui.com/react/components/menu)

## Maintaining the source

The [Platform design contract](AGENTS.md) is authoritative. Use the repository's [implementation skill](../../../.agents/skills/implement-platform/SKILL.md) and its Paper companion. Start with the running product route and its approved behavior. Consult Paper for existing anatomy, roles and states. Keep verified raw Paper exports locally: they may contain private example content. Only code, design geometry, safe slots and source references enter this repo.

- **Styles:** obtain Shared Light `get_tokens` (the token array) and `get_computed_styles` for the type masters (the node-to-style map); confirm theme file hashes match before assuming identical vocabulary. Run `bun scripts/sync-platform-foundations.ts <tokens.json> <registry.json> <styles.json>`, or append `--check` to compare without writing. This preserves aliases and converts scalable Paper px to rem at the 16px reference scale. Shared generated tokens and typography live in `packages/emcn/src/styles/generated`; shared roles enter through `@sim/emcn/styles/global.css`, and Platform layout roles through `@sim/emcn-platform/styles/platform.css`. The standalone app bootstrap owns Tailwind preflight and scans only component owners; product pages do not receive a styling API.
- **Structure:** capture current Shared/Platform master JSX locally with node IDs for the compiler's anatomy check in `<exports>/<key>.jsx` and reconcile the registry and recipe contracts. Run `bun scripts/sync-platform-recipes.ts <paper-references-directory> <exports-directory>` from the repository root. Review changed keys, token aliases, CSS and nested slot geometry in the rendered workbench. Do not edit generated selectors to fix a product use.
- **Assets:** retain canonical glyph geometry and brand paints. Media belongs in named slots; do not fetch private Paper artwork at runtime. Fixture content is removable from `fixtures/`. Remove its loader, preview calls and synthetic data together when real resource reads arrive.
- **Integration catalog:** run `bun scripts/sync-platform-integration-metadata.ts` after changing public provider metadata, connection definitions, skills, templates or registry icons. The generated server-only catalog supplies selected detail content; the directory receives compact summaries. `bun run check:platform-integration-metadata` detects drift. Runtime product code never imports the executable block/tool registry.

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

`bun run --cwd apps/sim test:platform:live` runs `checks/live/` against an app and database you have started, using `PLATFORM_LIVE_ORIGIN`, `PLATFORM_LIVE_EMAIL`, `PLATFORM_LIVE_PASSWORD` and `PLATFORM_LIVE_ORGANIZATION_NAME`. The member needs build access: anyone else lands on a legacy route. Supply `PLATFORM_LIVE_REPORT_PATH` to save its JSON report.

The default browser suite starts production servers with fixtures enabled and disabled. For the already-running shared preview, use the explicit existing-server mode; it starts no server and leaves the preview process unchanged:

```sh
PLATFORM_E2E_ORIGIN=http://localhost:3125 PLATFORM_REPORT_PATH=<report-path> bun run --cwd apps/sim test:platform:e2e
PLATFORM_E2E_ORIGIN=http://localhost:3125 PLATFORM_DESKTOP_REPORT_PATH=<report-path> bun run --cwd apps/sim test:platform:desktop
```

That local mode runs fixture-enabled browser and Electron coverage. It excludes only `fixtures-off.spec.ts`, whose server gate requires a fixture-disabled process. The default production suite retains those checks; complete them on the exact final commit before shipping. `?state=empty` does not turn fixtures off. Supply `PLATFORM_REPORT_PATH` to save JSON, failure screenshots and traces. Next uses webpack for this nested app: the installed Turbopack also discovers the parent Sim project's proxy and instrumentation. Watch for that boundary when upgrading Next.

The static check covers ownership, styling props, component folders, evidence, tokens, unused variants and dependency direction. It rejects a route CSS Module directly under `_components/`; put it with its component. If it flags a variant used on a real route, verify the call path and add that case to the checker. Review new shared visual variants against at least two independent consumers; semantic independence is a design review, not a count of repeated JSX rows. A workbench example cannot establish product usage. Use the rendered route to verify visual alignment. Compare both themes, keyboard and pointer states, actual overflow, text scaling and widths between approved artboards. Build the standalone app before running the browser suite to test the current sources.

References: [Next project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Next styling](https://nextjs.org/docs/app/getting-started/css), [Tailwind theme variables](https://tailwindcss.com/docs/theme), [shadcn/ui composition](https://ui.shadcn.com/docs), [Playwright assertions](https://playwright.dev/docs/test-assertions).
