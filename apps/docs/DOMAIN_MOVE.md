# Moving docs to a path prefix

The site currently targets `docs.sim.ai`. A move to `sim.ai/docs` is separate infrastructure work, not completed by the docs redesign. Changing `NEXT_PUBLIC_DOCS_URL` alone is insufficient.

The platform's temporary 307 redirects send `/docs` to the introduction and `/docs/*` to the matching path on `docs.sim.ai`, preserving query parameters. Remove these outgoing redirects when mounting the docs at `/docs`; they are not the routing layer for the future move.

## Required changes

- Build Next.js with `basePath: '/docs'`; an asset prefix alone does not mount the app. Keep canonical catalog IDs such as `/introduction` independent of the public prefix.
- Centralize public URLs for native links, images, client fetches, fonts, canonicals, metadata, sitemap, Markdown, discovery, and MCP. Next links receive the configured base path; root-relative `new URL` inputs discard it.
- Route `/docs` and `/docs/*` before platform redirects and authentication. Preserve method, body, query, RSC parameters, content negotiation, and response headers. Use a stable upstream alias distinct from the redirected old hostname to avoid loops.
- Strip platform cookies and authorization before forwarding to public docs; do not relay upstream `Set-Cookie` headers.
- Update platform/landing consumers and search citations together. Retain agent VFS identities and `.mdx` compatibility; reuse vectors when only citation URLs change.
- Advertise the prefixed sitemap in the destination origin's root `robots.txt`; a nested robots file does not govern the origin.

## Verify before cutover

Run corpus, assets, navigation, content negotiation, search, and official MCP-client suites through the actual prefixed routing layer. The existing harnesses use root-relative paths and do not by themselves prove prefix support.

Verify HTML, Markdown, JSON, discovery, static assets, optimizer images, fonts, RSC navigation, direct fragments, unknown-page 404s, and MCP POST requests. Exercise mixed Accept values and both request orders to rule out representation-cache contamination. Every public URL must contain exactly one prefix.

Only then redirect the old hostname with a path/query-preserving 308 and verify existing client methods, bodies, and browser fragment inheritance. Do not redirect the upstream alias. No routing cutover or rollback rehearsal is implied by repository CI.

## Rollback

Record the source revision, docs deployment, routing revision, upstream alias, and a restorable search-index backup before cutover. Hold publishers while restoring paired routing, deployment, and index state; repeat citation and credential-isolation checks.

A 308 may be cached. Keep a known-good build available at the new destination for clients retaining the redirect; redirecting the new destination back can create a loop. Rehearse rollback in isolation before changing production routing. See [search publication operations](MACHINE_ACCESS.md#search-index-operations).
