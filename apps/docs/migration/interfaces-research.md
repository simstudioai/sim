# Public interface baseline and replacement plan

Baseline: `01b236388a1fe4d9e609266d5acf265bef1b92c6`, inspected 29 October 2026. This records confirmed repository behavior; it does not assert deployed configuration.

| Existing behavior | Replacement owner | Verification |
| --- | --- | --- |
| `.md` / `.mdx` rewrite to `/llms.mdx/...`; folded `index.mdx` URLs | Existing Next rewrites, catalog Markdown adapter | Fetch identical text through all three paths; unknown paths return 404 |
| Markdown begins `# Title (/canonical-path)` | Canonical catalog and `lib/llms.ts` | Compare HTTP, JSON and MCP page content byte for byte |
| `Accept: text/markdown` negotiates document routes | Sim-owned `lib/http/negotiation.ts` and `proxy.ts` | Existing negotiation E2E plus quality values, wildcard precedence, assets and APIs |
| `Vary: Accept` merges with Next router dimensions | Proxy plus existing patched Next runtime | Existing real HTTP header merger and negotiation E2E |
| `/llms.txt` indexes authored and virtual API pages | Catalog-derived discovery adapter | Every advertised canonical URL resolves |
| `/llms-full.txt` is a streamed, atomically generated static asset capped at 64 MiB; excludes API operation bodies | Catalog-driven build script | Corpus count and representative content checks; build without embedding credentials |
| `/openapi.json` combines seven specs, namespacing non-security component references | Retained Sim-owned `openapi-download.ts` | Existing reference-integrity tests and downloaded document checks |
| `/api/search` accepts `query` or `q`, bounds query to 256 code points, default limit 10 / maximum 20 | Shared search service and thin HTTP adapter | Real HTTP searches in all four sections; invalid and oversized inputs |
| Search success array is `{id,type:'page',url,content,breadcrumbs}` | Shared search contract | HTTP and MCP search equivalence |
| Search ranks PostgreSQL full text plus 1536-dimensional `text-embedding-3-small` vectors with reciprocal rank fusion, title boost and page deduplication | Optional hybrid provider plus deterministic lexical catalog search | Basic search without credentials; hybrid degradation and stale-citation filtering |
| Search currently turns all failures into `[]`; an embedding failure prevents even keyword search | Replaced behavior: use lexical fallback, reserve 503 for actual failure | UI distinguishes empty/error states; no service required for local search |
| Agent docs VFS fetches public `.mdx`, folds directory indexes, excludes only `academy`, `api-reference`, and root `index.mdx` | Existing manifest/path contract; public Markdown adapter | `check:docs-manifest`, agent corpus tests, real endpoint reads |
| Platform docs search directly reads `docs_embeddings`; source paths and header links are durable contracts | Catalog-based search index publication using same table and source paths | Freshness report, bounded batches, per-document atomic replacement |
| Prerendered pages, canonical/Markdown alternate, OG/Twitter metadata, TechArticle/BreadcrumbList JSON-LD, sitemap and crawler access | Page rendering and metadata from the same catalog | Production HTML inspection and sitemap URL coverage |
| No docs JSON API or docs-origin MCP endpoint exists | New `api/docs/pages`, `api/docs/page`, `api/mcp` adapters | Real HTTP and official MCP client |

## Source ownership and delivery

The existing database table is `packages/db/schema.ts#docsEmbeddings`; it has generated English `tsvector`, HNSW cosine index and JSON metadata. The old index writer is `apps/sim/scripts/process-docs.ts`, using `lib/chunkers/docs-chunker.ts` against raw MDX. It cannot see generated API operations. `.github/workflows/docs.yml` runs it with `--clear`, so changing the canonical pipeline also requires changing this publication owner rather than introducing an unrelated second index. Database and OpenAI credentials must remain server-side. Static generation must not initialize the database or contact OpenAI.

The docs workspace remains the same Next deployment. `vercel.json` delegates ignored-build decisions to `scripts/vercel-ignore-build.sh`; production and staging always build, feature previews build for docs changes. Preserve this behavior. The existing pinned Next 16.4.1 has a repository patch for correct `Vary` merging, independently tested by `test-header-merge-e2e.ts`. Do not drop that patch during migration.

## Current framework and protocol guidance

Read the installed Next 16.4.1 guides under `node_modules/next/dist/docs/01-app/`, including project structure, Server/Client Components, Route Handlers, public static pages, Metadata/OG and JSON-LD. Current upstream documentation reports 16.4.3. Use the installed runtime's behavior and patch rather than silently upgrading all monorepo apps.

- [Next Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers): use Web Request/Response adapters; query-dependent endpoints remain dynamic and static document representations explicitly prerender.
- [Next metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images): generate page identity on the server and retain crawler-readable head tags.
- [Next JSON-LD](https://nextjs.org/docs/app/guides/json-ld): native JSON-LD script, escape `<` in serialized content.
- [MCP v2 guide](https://ts.sdk.modelcontextprotocol.io/v2/): the current stable line is v2; registry verified latest 2.4.0, but the repository release-age policy requires pinning `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1 (published 5 October). The handoff's unversioned server URL is now the v1 maintenance guide.
- [MCP HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) and [web runtimes](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html): `createMcpHandler` creates a server per request, returns Web responses, supports legacy clients statelessly and owns cleanup. Set a small request-byte budget and validate Host/Origin before it.
- [2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): use the SDK's protocol implementation; modern MCP uses POST and request metadata rather than sessions. Legacy GET/DELETE receive 405 under stateless compatibility. Invalid browser origins receive 403.

Public documentation is intentionally unauthenticated and read-only. `get_page` resolves catalog paths only; it must never fetch caller-supplied URLs. Page discovery uses bounded pagination; page retrieval returns complete content.

## E2E authoring gate

The new interface suite tests independent wire and security contracts that a compiler cannot prove: protocol negotiation, HTTP quality weighting, denied origins, oversized streamed bodies, pagination without gaps, malformed/unknown page inputs, exact representation consistency, and working credential-free search. It uses a running loopback server and the real official MCP client, introduces no production test seam, and writes named status/duration/error results to `DOCS_INTERFACES_REPORT_PATH`. Existing navigation and header suites remain the owners of their behavior rather than duplicating their checks.
