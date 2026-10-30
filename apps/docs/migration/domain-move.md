# Move documentation to sim.ai/docs

Status: planned, not deployed. The replacement continues to serve `docs.sim.ai`. Changing `NEXT_PUBLIC_DOCS_URL` alone is insufficient; routing, generated URLs, assets and search citations must move together.

## Current routing

Read-only checks on October 29, 2026 found that `https://sim.ai/docs/introduction` receives an AWS Application Load Balancer redirect to `https://www.sim.ai:443/docs/introduction`, which returns 404. The independent landing site runs on Astro/ECS; its README assigns path routing to `simstudioai/infra`. Documentation runs in the Vercel `sim-studio/docs` project, with `docs-sim-studio.vercel.app` available as a separate origin alias.

The requested canonical destination is the apex `https://sim.ai/docs`, so its routing rule must precede the existing apex-to-www redirect. Keep the docs application independently deployed. Next.js documents this arrangement through [multi-zones and external rewrites](https://nextjs.org/docs/app/guides/multi-zones). An ALB cannot directly use Vercel's public addresses as IP targets; route through a reverse-proxy-capable service or edge layer managed by infrastructure. See [AWS target restrictions](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html).

## Implementation requirements

| Owner | Required change |
| --- | --- |
| Docs build | Build with `basePath: '/docs'`. This is compiled into browser bundles and requires a rebuild; `assetPrefix` alone does not mount an application under a path. Follow [Next basePath guidance](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath). |
| Docs URL module | Centralize public path and absolute URL generation while retaining catalog identifiers such as `/introduction`. `new URL('/introduction', 'https://sim.ai/docs')` discards `/docs`. Internal Next links receive the base path automatically; native links, images and fetches need explicit handling. |
| Public representations | Update canonical URLs, Open Graph, JSON-LD, sitemap, Markdown links, discovery JSON and llms manifests together. Preserve `.md`, `.mdx`, `llms.mdx`, redirects and `Vary: Accept`. |
| Search | Rebuild local artifacts and run the current publisher to reconcile PostgreSQL citation URLs. Freshness checks include citations and embedding-input hashes, so URL-only changes reuse unchanged vectors. Normalize public citation paths before catalog lookup. |
| MCP and proxy | Serve `/docs/api/mcp` with the existing method, body, Origin and cache semantics. Verify proxy Host/Origin behavior. Route upstream requests to a stable alias separate from the redirected hostname to prevent loops; avoid forwarding platform session credentials. |
| Infrastructure | Route apex `/docs` and `/docs/*` before apex redirection and platform authentication/indexing rules. Preserve docs headers, static asset paths, RSC query parameters and content negotiation. The root `sim.ai/robots.txt` must advertise the docs sitemap; `/docs/robots.txt` does not govern the parent origin. |
| Existing consumers | Update `SIM_DOCS_URL`, landing links and the platform docs VFS base in `apps/sim/lib/mothership/docs/corpus.ts`. Keep existing VFS document identities and `.mdx` requests compatible. |

## Cutover and verification

1. Implement the path-aware build and verify it on a separate origin. Run the complete corpus, assets, browser, content-negotiation, search and official MCP-client suites under `/docs`.
2. Configure the AWS path route to the verified Vercel origin. Repeat the checks through `https://sim.ai/docs`, including root redirects, unknown-path 404s, nested assets, query preservation and cache variants.
3. Update search citations and outbound links, then permanently redirect `docs.sim.ai/:path*` to `https://sim.ai/docs/:path*` with status 308. Match the old hostname explicitly, preserve queries and methods, and test existing MCP clients. Do not redirect the upstream alias.
4. Verify the apex robots sitemap entry, canonical URLs and old-host deep links. Keep the previous deployment and routing configuration available for rollback.

## Required cutover evidence

Record the docs source commit, deployment IDs, upstream alias, routing revision and index backup before changing the route. Parameterize the existing verification harnesses for the prefix first: their current root-relative URLs do not prove `/docs` support.

| Check through the actual routing layer | Required result |
| --- | --- |
| `/docs`, `/docs/`, `/docs/introduction`, an unknown page and a nested API page | One intended root redirect, real unknown-page 404, correct article and metadata; no login/interstitial or redirect loop |
| Sidebar, history, search, code copy, media viewer and direct fragments | Native and framework links retain exactly one `/docs`; old heading bookmarks reveal the correct ancestor panels |
| Static images, optimizer URLs, fonts, JavaScript and RSC navigation | No root-path 404s or HTML returned for assets; hashes and image variants remain correct |
| `.md`, `.mdx`, `/docs/llms.mdx/...`, llms files, OpenAPI, discovery, search and MCP | Complete representations and pagination; MCP discovery/read/search remains public and read-only, with its Origin and Host checks intact |
| HTML/Markdown in both request orders, mixed Accept values, HEAD and validators | Correct content type/status/body and combined `Vary`; no HTML/Markdown/RSC cache contamination |
| Old-host requests with queries and MCP POST bodies | 308 preserves path, query and method/body; verify fragment inheritance in a browser because fragments are not sent to the server |
| Proxy request/response headers | Strip platform `Cookie` and `Authorization` before forwarding to public docs; do not relay upstream `Set-Cookie`; retain required protocol, representation and routing headers |
| Root robots, sitemap, canonicals and consumers | `sim.ai/robots.txt` advertises the prefixed sitemap; no old-origin canonical or missing/duplicated prefix; VFS identities remain unchanged |
| Citation publication | Matching-source plan/check and URL-only publication retain vectors; search result → full read → public heading works through the new origin |

Keep explicit redirect cache policy in the routing change. A 308 can be cached, so rollback must continue serving a known-good docs build at the new destination for clients retaining that redirect; redirecting the new destination back to the old host can create a loop. Fragment inheritance and 308 cacheability follow [HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-308-permanent-redirect). Rehearse rollback on an isolated route: hold publishers, restore the paired routing/deployment/index state, then repeat representation, citation and credential-isolation checks. No rollback rehearsal through the future production route has been completed.

No domain, deployment, redirect or infrastructure settings were changed during this review. The path-aware build remains follow-up implementation, not an environment-variable-only switch.
