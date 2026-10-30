# Paper design implementation evidence

Source: [Sim design file, Docs page](https://app.paper.design/file/01M4HT6VGW45G238N4V86KKMG7/p-A-0), inspected 2026-10-29. Initial token revision: `4cfc2e32`; final revision: `ebe83397`. All 129 docs-relevant token values were unchanged on the final read. Values below came from Paper tokens, computed styles, and exported JSX. Screenshots were used to check composition, not to guess dimensions. Landing (`p-C-0`), Brand assets (`p-E-0`), and App: Design System (`p-9-0`) were also inspected for the shared fonts, logo, and component conventions.

## Source coverage

| Board | Paper node | Implementation concern |
| --- | --- | --- |
| 01 Typography | `14E-0` | Geist and Geist Mono, named type scale |
| 02 Materials | `14I-0` | Neutral surfaces, glass, shadows, borders |
| 03 Components | `14M-0` | Controls, labels, code, disclosure, reading components |
| 04 Introduction | `1TU5-0` | Desktop shell and reading page |
| 05 Guide | `1U7A-0` | Prose, prerequisites, steps, navigation |
| 06 API | `1VAQ-0` | Wider reference shell and sample rail |
| 07 CLI | `1VK0-0` | Commands, flags, code |
| 08 MCP | `1VP9-0` | Tool signatures and neutral capability badges |
| 09 Slack | `1VYT-0` | Original provider icon and screenshot treatment |
| 10 Search | `1WEK-0` | Search dialog composition |
| 11 Mobile | `1WUT-0` | Mobile header rows and reading gutters |
| 12 Drawer | `1WWW-0` | Navigation overlay and selected rows |
| 13 Tablet | `1WZV-0` | Compact table of contents |
| 14 Workflow | `1YJE-0` | Canvas, inspector, output presentation |
| 15 Contract | `1YS4-0` | Cross-component implementation requirements |
| 16 Semantic states | `1ZX5-0` | Status and method colors |
| 17 Dropdown | `200N-0` | Menu geometry and focus |
| 18 Feedback | `207S-0` | Loading, copied, error, disabled states |
| 19 MCP | `20HL-0` | Reference rows and disclosures |
| 20 API | `20NP-0` | Request/response samples and schemas |
| 21 Dark | `20T4-0` | Dark neutral and semantic palette |
| 22 Tables | `22FY-0` | Contained horizontal scrolling |
| 23 Shortcuts | `22PT-0` | Keyboard indicators and focus |
| 24 Data flow | `239B-0` | Detailed interactive workflow treatment |
| 25 Troubleshooting | `23OD-0` | Failure and recovery content |
| 26 Docker | `243D-0` | Long installation examples |
| 27 SCIM | `24OP-0` | Reference density and nested schemas |
| 28 Provider tabs | `257X-0` | Provider links and hidden-panel behavior |
| 29 Navigation | `25CV-0` | Sidebar groups, active route, compact controls |
| 30 Footer | `25LA-0` | Footer spacing and theme switch |
| 31 Coverage | `263G-0` | Component completeness |
| 32 Overflow | `25YV-0` | Long identifiers, code, tables, mobile containment |

## Geometry and typography

The desktop shell has a 1280px maximum border-box width and 16px inner gutters. The 56px header uses a 40 × 19.226px wordmark, translated upward 2px; the logo-to-tabs gap is 40px and header-tab gap is 28px. The body starts 40px below the header and has 64px bottom padding. The ordinary reading grid uses 216px navigation, 680px article, 208px table of contents, and 48px gaps. The TOC has an 8px left inset. The API grid uses 216px navigation, 536px article, 400px samples, and 48px gaps within its wider container.

Three-column reading begins at 1280px. At 1024–1279px the TOC becomes a compact disclosure; at 768–1023px navigation moves into a drawer. Below 768px the content gutters are 20px, with header/taxonomy/utility rows of 56/48/44px. Reading controls have 44px touch targets. The mobile navigation retains Paper's compact 30px rows, 14/20 labels, 16px icons, and 6px icon gap.

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
| Header | Geist | 13 / 19.5px | 400 / 500 selected | normal |
| Code | Geist Mono | 13 / 22px | 400 | normal |
| Keyboard | Geist | 11 / 14px | 400 | normal |

Paper's marketing CTA uses variable weight 450. This is a deliberate docs-only exception to the app's usual weight scale, authorized by the user's instruction that Paper is the source of truth. Heading weight remains 500; selection in the sidebar uses surface alone rather than adding color and weight changes.

The header keeps weight 400 in every navigation state at the user's request, matching the landing navigation and preventing label widths from shifting. Current-section ink changes without changing geometry. The shared wordmark uses the landing's visible SVG overflow and optical offset; header and footer links do not initiate native drag operations. Root vertical overscroll is disabled while normal page and contained reference scrolling remain available.

The root scroll container uses `--docs-sticky-offset` once for every anchor: 80px on desktop and 172px below 1024px, where all three header rows occupy 148px. Individual headings, tabs, and API sections add no second offset. One shell-owned active-heading subscription reads the root scroll padding and drives every responsive TOC; selected links retain their accent on hover. Sidebar rows have one owner for hover and selection surfaces; flex gaps preserve section-label padding and nested group spacing.

## Materials and states

Light heading ink is `#0a0a0a`; body ink is 80% of that color and muted ink is 60%. Neutral panels use ink at 4%, hairlines black at 6%, hover ink at 6%, selected black at 8%, and pressed black at 12%. Glass header is white 80%; floating panels are white 88% with 20px blur; reading surfaces are white 96% without blur. Keyboard focus is a 2px blue outline. Default radius is 8px, screenshot outer radius 16px, screenshot inner radius 8px.

Dark canvas is `#1b1b1b`, reading surface `#1f1f1f`, text `#e6e6e6`, muted text `#ccc`, border `#444`, hover `#262626`, and selection `#2c2c2c`. Dark semantic text uses blue `#93c5fd`, green `#86efac`, purple `#d8b4fe`, orange `#fdba74`, red `#fca5a5`.

GET is blue `#0066cc`, POST green `#15803d`, PUT purple `#7c3aed`, PATCH orange `#c2410c`, DELETE red `#c83232`. Their light badge backgrounds are respectively `#bfdbfe`, `#bbf7d0`, `#e9d5ff`, `#fed7aa`, and `#fecaca` at 35%. Full method badges are 24px high, 8px horizontal padding, 6px radius, and centered mono labels. MCP capabilities use neutral badges rather than invented semantic colors.

Compact controls are 28px high with 10px horizontal padding, 6px gap, 8px radius, and 13/18 labels. They have separate hover, pressed, focused, disabled, and loading behavior. Copy replaces the glyph for two seconds without moving surrounding content and reports actual clipboard failures. Code is a neutral 4% surface with an 8px radius, 44px toolbar, and 16px content inset. Provider tabs use a 28px segmented pill, 12px horizontal label inset, and a white selected surface with a hairline and small shadow.

Selected segments share a shadow token and retain scroll-container clearance for their shadows and focus outlines. Compact API sample toolbars use 12px horizontal insets and 8px gaps; ordinary code toolbars use 16px and 12px. The Copy page trigger is 32px high. Floating menus share the Paper 10px outer radius, 6px item radius, 30px rows, inset highlight, and floating shadow. Route collections own straight separators; their rows use square edges and 16px padding. Empty search derives quick links from the current section's canonical navigation, with a bounded scrolling result area and one close control.

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
| Original screenshots and full-size viewer | `components/ui/image.tsx`, `media-viewer.tsx` |
| Open navigation rows | `components/ui/cards.tsx` |
| CLI command grids | `components/ui/command-table.tsx` |
| Canonical provider marks | `components/ui/integration-icon.tsx` |
| Original workflow graph/configuration | `components/workflow-preview/workflow-preview.tsx`, `block-inspector.tsx` |
| Complete nested workflow results, copy, download | `components/workflow-preview/output-bundle.tsx` |
| Real component/state gallery | `components/docs/gallery.tsx` |

Docs class merging extends the shared Tailwind merging utility with the named docs font-size tokens. Without that scoped extension, `text-docs-nav` was incorrectly treated as a text color and discarded next to a color token. This adaptation preserves platform merging behavior while preventing browser fallback to 16/24 text for 14/20 navigation.

Icons reuse EMCN's canonical SVGs. Provider marks reuse the original generated integration icon registry, without new decorative backgrounds. Product screenshots reuse the original source assets and optimized screenshot mapping; full-size dialogs open the original image. Workflow previews retain original graph fixtures, field configuration, branch values, and output trees. Decorative landscape backgrounds are omitted as explicitly allowed by the user.

Every tab panel remains in server-rendered HTML. Hydration enhances inactive panels with `hidden=until-found`, so browser find and hash navigation reveal them. Native disclosures retain their contents in HTML; hash navigation opens their ancestors. Overflow regions gain a keyboard tab stop only when their content exceeds their width. Images and workflows have keyboard-operable dialogs, Escape dismissal, and focus restoration. Reduced-motion settings suppress preview animation and control transitions.

The noindex component gallery is a verification surface, not a competing rendering system. It imports the same components as documentation pages. Browser verification and build status are recorded in the implementation report separately; extracted design values are not a claim that every screen has already been verified.
