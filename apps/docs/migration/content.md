# Content migration and authoring

The baseline is staging commit `01b236388a1fe4d9e609266d5acf265bef1b92c6`. `baseline.json` records each source document's frontmatter, public route, original heading IDs, JSX component use, imports, expressions, code-fence hashes, links and media. It also records every OpenAPI operation, specification metadata, navigation metadata, redirects and the public asset inventory. The inventory used the MDX AST and the original heading transform, not regular-expression component detection.

The migration accounts for 495 authored documents and 308 API operation pages across 201 API paths and seven registered specifications. All 187 public assets remain in place. The only source changes to existing MDX are 124 component import replacements across 92 authored files. Factual prose, code fences, integration `MANUAL-CONTENT` regions, platform screenshots, workflow objects and output fixtures remain at their original owners.

The latest completed content verification checked 2,147 internal links and their anchors. It found no lost routes, no lost authored heading IDs and no changed code-fence hashes. `report.json` contains a record for every canonical page and its content hash. These checks establish content preservation; browser, HTTP, MCP, generator and production-build results are separate verification artifacts.

## Ownership

| Concern | Owner |
| --- | --- |
| Authored prose and frontmatter | `content/docs/**/*.mdx` |
| Section ordering and hidden pages | Adjacent `meta.json`; only listed entries appear when `pages` is explicit |
| Integration credential-guide groups and aliases | `content/integration-navigation.json` |
| Generated integration descriptions and reference tables | Product block, tool, trigger and OAuth metadata through root `generate:docs` |
| API specifications | Product contracts/OpenAPI metadata through root `generate:openapi` |
| CLI reference pages and navigation | CLI command metadata through root `generate:cli-docs` |
| Agent streaming table | Streaming protocol metadata through root `generate:agent-stream-docs` |
| Agent VFS manifest | Root `generate:docs-manifest`; excludes `api-reference`, `academy`, and the root index |
| Canonical public page catalog | `lib/content/types.ts`, `compile.ts`, `markdown.ts`, `openapi.ts`, `navigation.ts` |
| Shared rendering registry | `components/docs/mdx.tsx` and the shared docs/UI component library |

## Add or update a page

Create a descriptive kebab-case `.mdx` file under the relevant section. Provide a nonempty `title` and a concrete `description`. Use `index.mdx` for a folder's overview: `workflows/index.mdx` becomes `/workflows`, including `/workflows.md` and `/workflows.mdx` representations. Preserve existing public paths and explicit heading aliases such as `## New title [#existing-anchor]`.

Import reusable reading components from the shared library. Repeated visual patterns belong there, not in per-page CSS. New component types require an explicit compiler allowlist entry and a meaningful Markdown serializer before use. The compiler fails on unknown modules or components rather than silently dropping their content. A first body paragraph matching the description is omitted only from rendered HTML because the shared page header already renders it; source prose and machine-readable Markdown retain it.

Add the page to the appropriate `meta.json` ordering. A folder's index is linked by its group, and its child list must not repeat the index. API, CLI and MCP previous/next links remain within their own section. Credential guides are grouped beneath their existing integration, while shared guides stay in the shared-guide group.

Use the shared `Image` component for platform screenshots. Keep the original file under `public/static` and provide useful alt text and intrinsic dimensions. The compiler verifies local media targets. Workflow previews use the existing `components/workflow-preview/examples.ts` objects; their complete block and edge configuration is also serialized into Markdown. Output bundles retain every typed field and nested value.

Run `bun run content:generate` inside `apps/docs`. The compiler emits ignored `.content` artifacts: the full catalog, a small canonical route list for negotiation, static MDX modules, an async module registry and the incremental cache. Public reading pages import precompiled server components; Markdown compilers and specification processing never need to run in the browser. The full Markdown aggregate is atomically regenerated from authored catalog entries, retaining its intentional API-operation exclusion.

## API reference behavior

Operation identity comes from the original tag and operation ID. Specifications remain authoritative for methods, paths, authentication alternatives, OAuth scopes, parameters, media types, request examples, responses, headers, callbacks, defaults and deprecation. Local JSON pointers preserve sibling properties; recursive references remain explicit. Standalone operation Markdown contains resolved reading data and referenced definitions so recursive schemas are not silently truncated.

Request examples are inert. They support cURL, JavaScript and Python, preserve all declared media types and named examples, and include the operation's authentication header. Multipart examples use file form data without manually setting the multipart boundary. Response samples include every status and media type; values derived from a schema are labeled as examples rather than presented as recorded responses. No live request executor or credential storage is introduced.

Original API anchors are retained as aliases in the shared API view: `authorization`, `parameters-path`, `parameters-query`, `parameters-header`, `parameters-cookie`, `request-body`, `response-body`, and `callbacks`. New search citations use the actual current rendered headings.

## Verification ownership

The old integration-navigation and OpenAPI-source unit tests instantiated the removed loader and plugin. Their source-existence and group-resolution contracts now fail during compilation against the complete real corpus. The real browser navigation suite owns index folding, expansion, current-page state, tab behavior and navigation boundaries. Existing OpenAPI redirect tests and combined-spec reference-integrity tests remain independent safeguards. No synthetic replacement tests were added merely to restate the new declarations.

The compiler report is migration evidence rather than proof of live provider behavior. Root generator checks establish that generated documentation still follows product sources, `check:docs-manifest` protects existing agent VFS paths, and the HTTP/MCP suites verify that public projections return the same canonical content.
