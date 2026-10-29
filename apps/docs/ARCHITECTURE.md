# Sim docs architecture and authoring

Sim owns the content catalog, page rendering, navigation, search, and machine interfaces. Next.js prerenders public pages from that catalog. MDX, Shiki, Radix primitives, and the official MCP SDK provide focused parsing, highlighting, accessibility, and protocol implementations. No Fumadocs runtime or build dependency remains.

## Directory ownership

| Location | Responsibility |
| --- | --- |
| `content/docs/` | Authored MDX, navigation metadata, and generated content regions |
| `scripts/compile-content.ts` | Build orchestration, validation, cache, and migration report |
| `lib/content/` | Typed catalog, MDX compilation, Markdown serialization, navigation, and OpenAPI projection |
| `.content/` | Ignored generated catalog and individually loadable compiled page modules |
| `components/docs/` | Shared design tokens, shell, navigation, page framing, search, and API reference |
| `components/ui/` | Shared reading components used by MDX and generated references |
| `components/workflow-preview/` | Interactive examples and their existing graph/configuration/output data |
| `lib/search/` | Common search implementation for the UI, HTTP API, and MCP |
| `lib/http/`, `app/api/` | Bounded public discovery, page retrieval, and MCP adapters |
| `app/[[...slug]]/page.tsx` | Thin catalog-backed page, metadata, and static-parameter adapter |
| `app/design-system/` | Local component gallery, excluded from indexing |
| `migration/` | Baseline inventory, Paper measurements, parity matrix, and migration results |

`app/` follows the App Router's file conventions. Ordinary content does not create a React route or duplicate a layout. The single catch-all route imports a shared article and shell, then loads that page's server-compiled MDX or specification reference. Promised route parameters and the Metadata API follow the installed Next.js 16 documentation.

## Add or change a page

1. Read `EDITORIAL_GUIDE.md` and the complete existing page before editing.
2. Add `content/docs/<section>/<page>.mdx` with a nonempty `title` and a useful `description`. Folder `index.mdx` files fold to the folder URL. Keep existing paths and explicit `[#anchor]` aliases stable.
3. Place the page in the appropriate `meta.json` order. Its optional `labels` map overrides a navigation entry's label without changing the article title. The catalog derives navigation, section-local previous/next links, discovery, and the sitemap. Do not add another page list in a consumer.
4. Use ordinary Markdown and shared components. MDX imports must be named imports registered in `lib/content/compile.ts`. Unknown modules, components, metadata, duplicate routes/anchors, broken internal links, or missing local media fail compilation with source context.
5. Run `bun run --cwd apps/docs content:generate`, inspect the affected page and Markdown, and run the applicable repository gates.

The compiler records source hashes, heading IDs, code-fence hashes and media references. Run `content:verify-migration` to enforce preservation against the frozen replacement baseline; ordinary authoring permits intentional prose and code updates. It serializes every tab and disclosure into meaningful Markdown, including workflow configuration and outputs. The introductory paragraph is hidden in HTML only when it exactly repeats the page description; machine-readable prose remains intact.

## Extend the component library

Paper is the visual source of truth. Exact board references, dimensions, tokens and intentional differences from platform components are in `migration/paper-design.md`.

Keep reusable chrome in `components/docs/` and reusable reading components in `components/ui/`. Export Markdown element mappings from `getMDXComponents()` rather than styling each page. A new MDX component also needs an explicit compiler allowlist entry and a meaningful serializer in `lib/content/markdown.ts`. Add its states to `/design-system` and inspect its keyboard, touch, light and dark behavior.

Use canonical `@sim/emcn/icons` glyphs. Docs tokens are scoped under `.docs-root`/`.docs-portal`; platform and landing styles are unchanged. The docs `cn` wrapper extends class merging for the Paper text-size tokens, so a color utility cannot erase a typography utility. Shared controls own hover, focus, pressed, disabled, loading, success, and error states.

Default components to server rendering. Client islands are reserved for navigation, search, tabs, disclosure reveal, clipboard, media viewing, theme choice, and interactive workflow examples. Pass rendered server content into those islands. Never import the catalog, compiler, specifications, embedding credentials, or syntax highlighter into a client component.

## Assets and generated references

Keep platform screenshots and original integration logos in `public/static/` with meaningful alternative text. Use the shared `Image` component for sizing, captions and expansion. Preserve workflow fixtures as data; the shared preview renders the actual graph, inspector, and outputs.

Product contracts remain authoritative for OpenAPI. Run `bun run generate:openapi` after changing their owners; the docs compiler projects operations from all registered specifications. CLI, MCP operations, integration content, and marked Agent streaming regions retain their existing generators listed in `EDITORIAL_GUIDE.md`. Do not hand-edit generated regions. Request examples are inert and never execute an API call or accept credentials.

The agent docs manifest continues to publish existing `.mdx` paths and its deliberate corpus exclusions. Run `bun run check:docs-manifest`, `bun run check:agent-stream-docs`, `bun run check:cli-docs`, `bun run check:openapi`, and `bun run check:docs` after relevant changes.

## Delivery, discovery, and performance

One catalog owns HTML, canonical metadata, heading citations, per-page Markdown, JSON, MCP, and sitemap identity. The aggregate `llms-full.txt` deliberately excludes generated operation bodies; individual operation Markdown is complete. See `MACHINE_ACCESS.md` for public contracts, search freshness and real-client verification.

Reading routes use `generateStaticParams` and reject unknown slugs. Compilation and highlighting happen before or during the production build, not in the browser. The compiler caches unchanged MDX and emits separate modules per page; it bounds aggregate catalog size. The shell receives only navigation and headings, while article content remains server rendered. Fonts are local Geist/Geist Mono assets; only the reading font is preloaded. Code and tables scroll within their own surfaces. Reduced-motion preferences suppress decorative transitions.

Metadata uses canonical URLs, descriptive titles, Open Graph/Twitter images, real Git modification dates when available, `TechArticle`/`BreadcrumbList` structured data, and a generated sitemap. JSON-LD is safely serialized. Robots permit public docs and machine-readable discovery. There is no special AI-ranking markup or indexing guarantee: clear HTML, preserved citations, useful text, crawlable links, and consistent public representations are the supported foundations.

The implementation was checked against the installed Next.js 16.4.1 docs and current official [project structure](https://nextjs.org/docs/app/getting-started/project-structure), [server/client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components), [MDX](https://nextjs.org/docs/app/guides/mdx), and [metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) guidance. The monorepo's patched Next version is retained. Google's [AI search guidance](https://developers.google.com/search/docs/appearance/ai-features) remains the basis for crawlability; no separate AI-specific schema is required.

## Review and rollback

Review the migration report first, then the library gallery and representative pages, then the HTTP/browser reports. Run a production build without embedding credentials to verify the local fallback. Production search index publication remains a separate deployment step and must pass its freshness check.

This change preserves the docs workspace, origin, deployment identity, product generators, and content paths. Reverting the docs replacement commit and its lockfile/workflow changes restores the prior implementation; it requires no database migration or product-data rollback. Keep the PR in draft until the visual and behavior evidence has been reviewed.
