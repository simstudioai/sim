# Reading Sim documentation from tools

Every interface uses the same compiled catalog as the rendered pages. Documentation access is public and read-only. It does not authorize access to Sim workspaces or execute product API requests.

## Markdown and discovery

Append `.md` or `.mdx` to a canonical page URL, or request that URL with `Accept: text/markdown`:

```sh
curl https://docs.sim.ai/integrations/slack.md
curl -H 'Accept: text/markdown' https://docs.sim.ai/integrations/slack
```

The compatibility path `/llms.mdx/integrations/slack` returns the same complete Markdown. HTTP negotiation respects quality values, defaults to HTML when representations have equal quality, and preserves `Vary: Accept`. Asset and API routes do not negotiate document Markdown.

`/llms.txt` lists canonical pages, including API operations. `/llms-full.txt` contains authored guides and integration references; it deliberately excludes generated API operation bodies. Each API operation has its own complete Markdown representation. `/openapi.json` downloads the combined canonical OpenAPI document.

## JSON API

`GET /api/docs/pages` returns `{ pages, nextCursor, total }`. Each metadata record includes `id`, `path`, canonical `url`, title, description, section, content hash and last-modified time when available.

- `section`: optional `docs`, `api`, `cli`, or `mcp`.
- `limit`: 1–100, default 25.
- `cursor`: the previous response's `nextCursor`. Omit it for the first page.

Continue until `nextCursor` is `null`. Unknown cursors and invalid parameters return 400.

`GET /api/docs/page?path=/introduction` returns `{ page }`, containing the same metadata, headings and complete processed `markdown`. Use a canonical site-relative path. Remote URLs, traversal paths and malformed paths return 400; an unknown canonical page returns 404. Content is never silently truncated.

`GET /api/search?query=slack&limit=10` returns the established array of `{ id, type: "page", url, content, breadcrumbs }`. `q` is a supported alias for `query`. Queries are bounded to 256 code points; the result limit defaults to 10 and is capped at 20. Heading citations preserve explicit document anchors. An empty query returns `[]`; an actual service failure returns 503.

## Documentation MCP

Configure a remote Streamable HTTP server at `https://docs.sim.ai/api/mcp`. This endpoint is separate from Sim's workspace MCP server and `/mcp/...` documentation pages. It requires no API key.

The official stable MCP TypeScript SDK 2.3.1 serves the 2026-07-28 protocol and stateless compatibility for 2025-era clients. Tools:

| Tool | Input | Result |
| --- | --- | --- |
| `list_pages` | Optional `section`, `cursor`, `limit` as above | Paginated metadata and next cursor |
| `get_page` | `path` | Complete Markdown and canonical metadata |
| `search` | `query`, optional `limit` 1–20 | The same search results as the docs UI |

All three tools advertise read-only behavior. Unknown pages produce tool errors; invalid inputs produce protocol/tool validation errors. The transport rejects unapproved browser origins, unrecognized hosts and request bodies over 16 KiB. Non-browser MCP clients normally omit `Origin`. No caller-supplied URL is fetched.

## Search index operations

Basic search uses a server-only index generated atomically with the local compiled catalog and needs no database or embedding credentials. Markdown parsing and text normalization happen during content compilation; requests read precomputed chunks. The generated index is capped at 64 MiB and its catalog fingerprint is validated before serving results. When `DATABASE_URL` is present, bounded PostgreSQL keyword search can supplement it; `OPENAI_API_KEY` additionally enables vector search using the existing 1536-dimensional `text-embedding-3-small` table contract. Unavailable providers fall back to lexical results. Results with old content hashes or nonexistent heading targets are excluded.

From `apps/docs`:

```sh
bun run content:generate
bun scripts/index-search.ts --plan
bun scripts/index-search.ts --check
bun scripts/index-search.ts
```

`--plan` is local and read-only. `--check` requires the search database and reports missing, stale or retired documents without writes. The final command publishes changed pages with database and embedding credentials: it prepares bounded embedding batches, atomically replaces one document at a time, and removes retired documents only after all page updates succeed. A failed page leaves its previous index intact. The canonical index includes authored content and generated API operations; the agent VFS retains its deliberate `academy` and `api-reference` exclusions.

Set `DOCS_SEARCH_REPORT_PATH` to choose the JSON report destination. The default is `test-results/docs-search-index.json`. The main-branch docs workflow runs publication and freshness checks; no production indexing is part of the docs build.

## Repeatable verification

Start a local production server, then run the existing negotiation and navigation suites and the official-client interface suite:

```sh
DOCS_E2E_BASE_URL=http://127.0.0.1:3001 \
DOCS_INTERFACES_REPORT_PATH=test-results/interfaces.json \
bun scripts/test-docs-interfaces-e2e.ts
```

The suite exercises real HTTP and the official MCP client, including discovery pagination, complete page retrieval, search consistency, invalid inputs, denied origins and byte limits. `DOCS_NEGOTIATION_REPORT_PATH` and `DOCS_NAVIGATION_REPORT_PATH` configure the companion reports. CI uploads the reports and browser screenshots on success or failure.


The PostgreSQL suite uses a new, empty, loopback database and no embedding key. It verifies real keyword search, citation freshness, graceful database failure, repeated index publication, retirement and failed-publication preservation. It refuses databases containing existing tables. CI provisions its own `pgvector/pgvector:pg17` service and uploads the report with the other docs checks.

To repeat locally, create a disposable container (the command returns its ID):

```sh
docker run --rm -d --name sim-docs-search-e2e \
  -e POSTGRES_USER=docs_test -e POSTGRES_PASSWORD=docs_test \
  -e POSTGRES_DB=docs_search_test -p 127.0.0.1:15432:5432 \
  pgvector/pgvector:pg17
docker exec sim-docs-search-e2e pg_isready -U docs_test -d docs_search_test
```

After PostgreSQL reports ready, run from `apps/docs`:

```sh
DOCS_SEARCH_E2E_DATABASE_URL=postgresql://docs_test:docs_test@127.0.0.1:15432/docs_search_test \
DOCS_SEARCH_E2E_REPORT_PATH=test-results/search-postgres/report.json \
bun --no-env-file --conditions=react-server scripts/test-search-postgres-e2e.ts
```

Then stop the container using the ID returned by `docker run`; `--rm` removes its temporary data. Successful vector generation and provider ranking still require separate verification with an embedding provider. The local suite makes no paid provider calls.
