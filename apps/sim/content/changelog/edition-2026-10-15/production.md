# Oracle Database, Checkr, and Shopify updates

Edition: `2026-10-15`. This is the existing scheduled edition, expanded during human editorial review.

Article: `../oracle-checkr-and-shopify/index.mdx`

Canonical: https://www.sim.ai/changelog/oracle-checkr-and-shopify

Publication: pending the normal site release and hosted verification. A staging deployment is not production publication.

## Selection and release evidence

The initial draft considered only an older candidate batch and focused on Oracle Database. This catch-up edition adds substantial integration changes that were missing from earlier posts, followed by two concrete Chat fixes from the latest release. It does not imply that every item shipped on the article's publication date.

| Source | Verified release | Coverage |
| --- | --- | --- |
| [Oracle Database](https://github.com/simstudioai/sim/pull/7378) | [v0.9.17](https://github.com/simstudioai/sim/releases/tag/v0.9.17) | Queries, structured writes, schema inspection, reusable connections, encrypted transport, and access requirements. |
| [Checkr](https://github.com/simstudioai/sim/pull/8824) | v0.9.17 | Candidates, invitations, reports, and report/invitation event triggers. |
| [Shopify](https://github.com/simstudioai/sim/pull/8833) | v0.9.17 | Bulk product variants, fulfillment orders, shipment tracking, and refresh of expiring connections. |
| [Ramp and Vanta](https://github.com/simstudioai/sim/pull/8802) | v0.9.17 | Saved client-credentials connections selected from blocks. |
| [Chat recovery](https://github.com/simstudioai/sim/pull/9059) | [v0.9.23](https://github.com/simstudioai/sim/releases/tag/v0.9.23) | Recovery of interrupted runs after a server restart without reopening the chat. No exactly-once execution claim. |
| [Chat panel resizing](https://github.com/simstudioai/sim/pull/9065) | v0.9.23 | Retains the selected width when focus changes during a resize. |

Release membership comes from explicit PR references in the published release notes, not merge dates. Oracle and the integration notes belong to v0.9.17; the Chat section is explicitly v0.9.23. The combined edition uses its canonical URL as its RSS identity, without a single `release.url`.

## Availability and factual review

- The deployed public block catalog exposes Oracle Database, Checkr, Shopify, Ramp, and Vanta without preview gating. Their public integration pages and guides resolve successfully.
- Oracle Database requires version 12.1 or later and network access from the Sim runtime. Self-hosted installations require Node.js 24. Connection and SQL details remain in the linked guide.
- Checkr requires the user's API key. Ramp and Vanta require their client ID and secret. Existing Vanta workflows with inline credentials must create and select a saved credential before running again; the article links the setup guide. The copy makes no claims about provider execution, connection success, or account permissions established by the image.
- The latest release's Project-file work and workflow tests remain gated or foundational; they are excluded. OCI, Fusion, and EPM infrastructure has no corresponding public integration block to announce here.
- Routine dependency work, internal refactors, and the original narrow workflow-lint note remain in technical release history.

## Media provenance

- Asset: `/changelog/oracle-operations-v1.jpg`, a 496 × 226 JPEG.
- Captured October 15, 2026 from the actual Oracle Database block in a disposable local demo workspace, running this branch on the current staging base.
- Opened the real Operation dropdown and widened the editor panel before capture. The complete rounded menu shows search and all six operations. The optimized crop excludes the editor's outer edge and unrelated workspace content.
- No generated UI, fake credentials, edited labels, or fabricated query results. This capture demonstrates available operations; it is not an execution demonstration. Provider-account execution was not part of this capture.
- The article retains the shared 12px radius, width limit, and existing image lightbox. One focused image serves the edition; supporting notes do not need separate media.
- Full capture and review evidence are retained privately. Do not publish environment identifiers or logs.

## Editorial and delivery checklist

- [x] Concise lead plus five useful one-sentence notes within the body word budget.
- [x] Each supporting change traced to its actual release; no repeated coverage from earlier articles.
- [x] Public integration catalogs and contextual Oracle setup guide verified.
- [x] Authentic media captured with complete menu edges; access restrictions retained.
- [x] Desktop and 390px mobile review, including dark-theme icons and image-viewer zoom, dismissal, and focus return.
- [x] Generated artifacts, lint, type-check, 60 audits, block-registry checks, and HTTP discovery checks pass locally. Repository test suites run in CI.
- [ ] Both current-head PR reviews and final CI checks complete.
- [ ] Staging article, media, discovery feeds, and links verified after deployment.
- [ ] Production article and media verified before publication records or distribution advance.

## Announcement drafts

**Social:** Oracle Database and Checkr join Sim's integrations. Shopify adds bulk variant and fulfillment actions, while Ramp and Vanta connections can be reused across workflows. This changelog also covers the latest Chat recovery and resizing fixes.

**Email:** Query and update Oracle Database from your agents, run Checkr background-check workflows, and manage more Shopify operations. Saved Ramp and Vanta connections reduce repeated setup. Read the changelog for requirements and the latest Chat fixes.

These are drafts for the final canonical article. Distribution follows production verification.
