# Docs design system

The shared component library owns documentation geometry, typography, materials, and interaction states. Pages inherit these rules through the shell and reading components.

## Geometry and typography

The desktop shell has a 1280px maximum border-box width and 16px inner gutters. The 56px header uses a 40 × 19.226px wordmark, translated upward 2px; the logo-to-tabs gap is 40px and header-tab gap is 28px. The body starts 40px below the header and has 64px bottom padding. The ordinary reading grid uses 216px navigation, a flexible article column (728px at the full shell width), 208px table of contents, and 48px gaps. The outline’s right edge aligns with the header’s primary action. The TOC has an 8px left inset. The API grid uses 216px navigation, 536px article, 400px samples, and 48px gaps within its wider container.

Three-column reading begins at 1280px. At 1024–1279px the TOC becomes a compact disclosure; at 768–1023px navigation moves into a drawer. Below 768px the content gutters are 20px, with header/taxonomy/utility rows of 56/48/44px. Reading controls have 44px touch targets. The mobile navigation retains the shared compact 30px rows, 14/20 labels, 16px icons, and 6px icon gap.

| Token | Font | Size / line height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Title / h1 | Geist | 32 / 40px | 500 | -0.02em |
| h2 | Geist | 24 / 32px | 500 | -0.02em |
| h3 | Geist | 18 / 28px | 500 | normal |
| Body | Geist | 16 / 26px | 400 | normal |
| Lead | Geist | 18 / 28px | 400 | normal |
| Navigation | Geist | 14 / 20px | 400 | normal |
| Table / field | Geist | 14 / 22px | 400; labels 500 | normal |
| Control | Geist | 13 / 18px | 400 | normal |
| Header | Geist | 13 / 19.5px | 400 | normal |
| Code | Geist Mono | 13 / 22px | 400 | normal |
| Keyboard | Geist | 11 / 14px | 400 | normal |

Marketing calls to action use variable weight 450, matching the landing page. Heading weight remains 500; selection in the sidebar uses a neutral surface and, in dark mode, a 2px inset left edge without changing text color or weight.

The header keeps weight 400 in every navigation state at the user's request, matching the landing navigation and preventing label widths from shifting. Current-section ink changes without changing geometry. The shared wordmark uses the landing's visible SVG overflow and optical offset; header and footer links do not initiate native drag operations. Root vertical overscroll is disabled while normal page and contained reference scrolling remain available.

The root scroll container uses `--docs-sticky-offset` once for every anchor: 80px on desktop and 172px below 1024px, where all three header rows occupy 148px. Individual headings, tabs, and API sections add no second offset. One page-frame active-heading subscription reads the root scroll padding and drives every responsive TOC; selected links retain their accent in light mode; dark-mode links keep secondary ink and use an underline, including on hover. Sidebar rows have one owner for hover and selection surfaces; flex gaps preserve section-label padding and nested group spacing.

## Materials and states

Light heading ink is `#0a0a0a`; body ink is 80% of that color and muted ink is 60%. Neutral panels use ink at 4%, hairlines black at 6%, hover ink at 6%, selected black at 8%, and pressed black at 12%. Glass header is white 80%; floating panels are white 88% with 20px blur; reading surfaces are white 96% without blur. Keyboard focus is a 2px blue outline. Default radius is 8px. Screenshot frames and expanded images use 8px corners; inset detail windows use 6px corners, and the viewer dialog uses 16px corners.

Dark canvas is `#141414`; opaque reading and code surfaces are `#1c1c1c`, and raised surfaces are `#242424`. Primary text is `#e6e6e6`, secondary text `#b0b0b0`, placeholders `#a8a8a8`, and disabled controls `#707070`. Decorative dividers are `#383838`; essential selected-control boundaries use `#8a8a8a`. Hover, selected, and pressed fills are `#2b2b2b`, `#333333`, and `#3a3a3a`.

Dark semantic text uses blue `#8abeff`, green `#8ed5a4`, purple `#c4a6f2`, orange `#edb27b`, and red `#f09a9a`. Their opaque soft backgrounds are `#203047`, `#20382a`, `#332b43`, `#3e3024`, and `#432a2a`. Syntax highlighting consumes these same CSS roles at runtime rather than maintaining a separate dark palette. Inline prose links use primary ink with an underline; table descriptions use secondary ink. Focus is a 2px blue ring with a 2px offset.

Dark primary actions use `#e6e6e6` / `#d4d4d4` / `#c2c2c2` for default, hover, and pressed states, with a `#141414` label. Secondary actions use `#333333` / `#3a3a3a` / `#424242`, with primary ink. Selected segments use the selected fill and a 1px essential boundary; unselected segment labels retain primary ink.

Dark navigation glass is 92% canvas; floating chrome is 92% raised surface with 20px blur and a 10% white inset highlight. Dialog backdrops are 60% black. Menus cast a `0 8px 24px` shadow at 40% black; dialogs use `0 16px 48px` at 40% black with a 1px highlight rim. Reduced transparency and unsupported backdrop filtering replace glass with solid surfaces and remove blur. Theme preference remains system-based until the reader saves a choice; every portal shares the same tokens and native color scheme. Screenshots and provider marks retain their original colors.

GET is blue `#0066cc`, POST green `#15803d`, PUT purple `#7c3aed`, PATCH orange `#c2410c`, DELETE red `#c83232`. Their light badge backgrounds are respectively `#bfdbfe`, `#bbf7d0`, `#e9d5ff`, `#fed7aa`, and `#fecaca` at 35%. Full method badges are 24px high, 8px horizontal padding, 6px radius, and centered mono labels. MCP capabilities use neutral badges rather than invented semantic colors.

Compact controls are 28px high with 10px horizontal padding, 6px gap, 8px radius, and 13/18 labels. They have separate hover, pressed, focused, disabled, and loading behavior. Copy replaces the glyph for two seconds without moving surrounding content and reports actual clipboard failures. Code is a neutral 4% surface with an 8px radius, 44px toolbar, and 16px content inset. Provider tabs use a 28px segmented pill and 12px horizontal label inset; the light selected surface is white with a hairline and small shadow.

Selected segments share a shadow token and retain scroll-container clearance for their shadows and focus outlines. Compact API sample toolbars use 12px horizontal insets and 8px gaps; ordinary code toolbars use 16px and 12px. The Copy page trigger is 32px high. Floating menus share a 10px outer radius, 6px item radius, 30px rows, inset highlight, and floating shadow. Route collections own straight separators; their rows use square edges and 16px padding. The search dialog has a 680px maximum width and 16px radius. Empty search derives quick links from the current section's canonical navigation, with a bounded scrolling result area and one close control.

Disclosures use a 16px chevron, 8px label gap, a 38px desktop summary (44px touch), and content inset 24px left / 4px top / 12px bottom. Most callouts are open icon/text rows: 16px glyph in a 22px lane, 12px gap, 4px vertical padding, and 14/22 medium title. “Before you begin” alone uses the neutral inset with 16px padding and 8px radius.

## Shared component map

| Source concern | Single implementation |
| --- | --- |
| Docs tokens, dark palette, named typography | `components/docs/tokens.css` |
| Docs-aware class merging | `components/docs/classnames.ts` |
| Buttons and method/capability labels | `components/docs/primitives.tsx` |
| Authored and generated prose | `components/docs/mdx.tsx` |
| OpenAPI Markdown and highlighting | `components/docs/markdown.tsx` |
| Request/response toolbar and all sample panels | `components/docs/sample-panels.tsx` |
| Code surface and copy feedback | `components/ui/code-block.tsx`, `copy-button.tsx` |
| Provider tabs and deep-link reveal | `components/ui/tabs.tsx` |
| Browser keyboard overflow | `components/ui/scroll-region.tsx` |
| Prerequisites and callouts | `components/ui/callout.tsx` |
| Sequential instructions | `components/ui/steps.tsx` |
| Nested reference disclosure | `components/ui/reference-details.tsx` |
| Headings and native anchors | `components/ui/heading.tsx` |
| Original screenshots and full-size viewer | `components/ui/image.tsx`, `screenshot-frame.tsx`, `media-viewer.tsx` |
| Open navigation rows | `components/ui/cards.tsx` |
| CLI command grids | `components/ui/command-table.tsx` |
| Canonical provider marks | `components/ui/integration-icon.tsx` |
| Original workflow graph/configuration | `components/workflow-preview/workflow-preview.tsx`, `block-inspector.tsx` |
| Complete nested workflow results, copy, download | `components/workflow-preview/output-bundle.tsx` |
| Real component/state gallery | `components/docs/gallery.tsx` |

Docs class merging extends the shared Tailwind merging utility with the named docs font-size tokens. Without that scoped extension, `text-docs-nav` was incorrectly treated as a text color and discarded next to a color token. This adaptation preserves platform merging behavior while preventing browser fallback to 16/24 text for 14/20 navigation.

Icons reuse EMCN's canonical SVGs. Provider marks reuse the original generated integration icon registry, without new decorative backgrounds. Product screenshots reuse the original source assets and optimized screenshot mapping; full-size dialogs open the original image. Workflow previews retain original graph fixtures, field configuration, branch values, and output trees. The shared screenshot frame preserves the original landscape backgrounds, proportional insets, and responsive hero crop. The full-size viewer sizes the original image to its intrinsic aspect ratio and applies rounded corners directly to its visible bounds. Platform screenshots omit the UI border in dark mode, both inline and expanded, so a dark outline is not added to the source asset.

Every tab panel remains in server-rendered HTML. Hydration enhances inactive panels with `hidden=until-found`, so browser find and hash navigation reveal them. Native disclosures retain their contents in HTML; hash navigation opens their ancestors. Overflow regions gain a keyboard tab stop only when their content exceeds their width. Images and workflows have keyboard-operable dialogs, Escape dismissal, and focus restoration. Reduced-motion settings suppress preview animation and control transitions.

The noindex component gallery is a verification surface, not a competing rendering system. It imports the same components as documentation pages. Browser verification and build status are recorded in the verification report separately.
