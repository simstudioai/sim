# Platform design contract

Applies to this independent Next.js application. In this tree “EMCN” means the Sim Platform design system in `design-system/`. The existing app and `packages/emcn` remain isolated. For new work or design drift, run the repository's `$implement-platform` skill. Its Paper companion is `$sim-paper-design`. Never import the legacy app, styles, chrome, business logic or providers across this boundary.

## Ownership

| Paper authority | Code owner | Consumer |
| --- | --- | --- |
| Shared: Styles, type, icons and media | `design-system/styles`, `fonts`, registered geometry/assets | Component recipes |
| Shared and Platform component masters | `design-system/components` (semantic primitives) and `design-system/catalog` (structural recipes and evidence) | Other components and product compositions |
| Product: Platform Core, Chat, Workspaces | A matching `app/<segment>/page.tsx` and style-free private `_components/`; page-only recipes in `design-system/features/<feature>/` | Route composition |
| Engineering workbench, outside Product | `preview/` | The separate /workbench route |
| Temporary example data | `fixtures/` | Server-only, default-off loader |

Search Shared → Platform → Product before adding anything. Use the stable Paper key, live Base and an actual product Use (or a nested use rooted in one). Reference artwork, archive files, guides and specimen-only variants are not product uses. Do not use Marcus's files. Two systems that can share a recipe use Shared. If a second feature needs a page-owned component, promote the existing implementation, register it centrally and replace the original import in the same change. Do not copy it or import directly from another feature. Once product routes exist, remove unreached public variants from code and keep deferred states in Paper until a product or nested component needs them.

## Public API

- A page supplies data, semantic slots, supported variants and callbacks. It owns no CSS, inline styles, Tailwind classes or visual overrides, including layout around a component. A composition with its own spacing is itself a recipe with an owner. No `className`, `style`, utility pass-through, arbitrary JSX prop spread or per-screen colors/geometry.
- Repeated data takes a typed array with stable item IDs. A specimen's row count is an example; render zero, two or more than the reference count without numbered props. Preserve genuinely distinct fixed slots.
- Keep the smallest API that describes the behavior. Use semantic HTML and import unstyled Base UI primitives inside EMCN for complex behavior. EMCN owns appearance. Base UI can own keyboard navigation, typeahead, focus management, dismissal and floating placement. Use named native controls for interactive masters and typed record arrays for repeated data. A static structural recipe does not provide those behaviors. A different label, icon, item count or viewport width does not create another variant.
- DOM focus changes where typing, Tab and arrow keys go. It adds no ring, outline, border change, shadow or background treatment to the control or its wrappers. Keep the caret, validation, hover, selection, open state and the active row during list navigation distinct. Exercise Tab, Escape, focus restoration and typing in both themes.
- Every value picker, including workbench fields and modal fields, uses the shared dropdown surfaces and row recipes. Use Select for choices, Combobox for search, and Menu for commands. Use Base UI's portalled positioner for root and nested popups, inside the active theme and modal layer. Submenus open on hover and by keyboard, preserve pointer travel into the child, and flip or shift within the available space. The parent and child close one level at a time with Escape.
- Keep tokens and composite recipes central. The Tailwind theme maps to semantic variables. An owner module may apply structural Tailwind utilities and registered theme roles; callers only use its public API. `PlatformSurface` selects the theme for the tree. Modules in an owner can express grid/flex, intrinsic sizing, focus, wrapping and overflow. Do not bake a screenshot into a component. At the default root size the result must match Paper; use scalable type and spacing, bounded widths, flexible tracks, logical insets and natural height. Breakpoints follow a change in composition, not the number of Paper examples. Fixed stroke widths, icon geometry, touch targets and aligned data lanes are deliberate. Test intermediate widths, long content and zoom.
- Preserve theme roles, Geist and Geist Mono recipes, 16px directional overflow fades, shell/floating glass and quiet reading surfaces. Compare real semantic parts and nested controls, not just matching names. A gallery or a token declaration is not evidence that a variant is needed. Remove unused variants, their styles and documentation. If Paper and code disagree, reconcile with the live authority.
- Default to Server Components. Keep browser event handling, focus, measurement and transient UI state at the leaf. Phase 1 supplies foundations; Phase 2 composes product routes and their unique parts; Phase 3 connects existing operations and real resources. No DB, API, global user state, auth or new schema in the design phases.
- The isolated project root owns its globals, fonts and PostCSS entry. Keep the legacy root layout, proxy, globals and routes intact. Do not add a new provider or styling package just to define a variant.
- Only the server loader may import example data, and only when `SIM_PLATFORM_FIXTURES=1`. No fallbacks in components. Delete the fixture module/gate and workbench consumers together once real data takes over. Never write examples to storage, send an invite or imply successful backend work.

## Product UI and desktop

- The same product entry under `app/(shell)/` serves the web browser and the existing `apps/desktop` Electron shell. Feature-detect `window.simDesktop` in the typed desktop adapter only. Consult the shared `@sim/desktop-bridge` contract and native titlebar observer. Electron owns real window controls and privileged operations. Reserve their inset only in a native window; keep interactive areas outside drag regions. Do not draw traffic lights, mock the bridge in product code, or fork pages by viewport or user agent.
- On every shell or panel change, test the real Electron window as well as web, keyboard, narrow and intermediate layouts. Exercise inset/fullscreen, sidebar expand/collapse, panel takeover, tabs and focus return. Browser-only views must remain usable without the preload. Native capability integration remains Phase 3.
- Keep unique content in its feature owner. A calendar event, attention row or two-line workspace summary can have its own anatomy. Reuse semantic ink, type, icon size, first-line alignment, row insets and spacing. Its overflow trigger still uses EMCN's icon button/menu; do not extract a generic row on resemblance alone. When a second feature needs the same semantic recipe, promote the original implementation and migrate both consumers.

## Verification

Run `bun run check:platform-design`, build the isolated Next app, and run its browser checks (commands in README.md). Review actual Paper and browser rendering, wrapping, interactive states, keyboard and focus, both themes, content overflow and intermediate widths. Check disabled fixture output independently. A passing static audit is not a visual comparison. Record the affected keys, readback, rendered verdict, uncertainty and next action in the task checkpoint. Run the repository gates before shipping.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
