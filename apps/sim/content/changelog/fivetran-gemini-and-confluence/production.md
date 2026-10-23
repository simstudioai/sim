# October 13 releases: production record

Edition key: `manual-fivetran-gemini-and-confluence`.

Status: editorial, availability, and media review complete. Desktop/mobile and publication-route verification are recorded with the publication PR; production delivery remains subject to the publication monitor. Only `index.mdx` is rendered on the website. This brief is public source documentation and contains no credentials or private workspace evidence.

## Story and release evidence

One edition covers the meaningful additions in [v0.9.20](https://github.com/simstudioai/sim/releases/tag/v0.9.20) and [v0.9.21](https://github.com/simstudioai/sim/releases/tag/v0.9.21), both published October 13, 2026. The lead is Fivetran workflow control; the supporting notes cover a new model, searchable Confluence images, and search improvements. Routine infrastructure, performance refactors, and minor fixes remain in the technical release notes.

| Claim | Source | Release |
| --- | --- | --- |
| Fivetran connection status, sync history, sync/re-sync, schema and table selection, and sync/transformation event triggers | [#8983](https://github.com/simstudioai/sim/pull/8983), [#8988](https://github.com/simstudioai/sim/pull/8988) | v0.9.21 |
| Gemini 4 Argon in Agent, thinking levels, tools, images, and structured output | [#8970](https://github.com/simstudioai/sim/pull/8970) | v0.9.21 |
| Confluence image attachments become searchable text, new-connector default, existing-connector opt-in, and per-image model usage | [#8949](https://github.com/simstudioai/sim/pull/8949) | v0.9.20 |
| Confluence/Jira partial-match fallback and Confluence matching-passage previews | [#8968](https://github.com/simstudioai/sim/pull/8968) | v0.9.20 |

Release membership comes from explicit source PR references in the published notes. Both versions are retained in frontmatter. There is no single `release.url`: this combined edition uses its canonical article URL as its RSS identity and links both technical releases in the body.

## Availability and access

- The production Fivetran block definition exposes the selected operations and event triggers. Its integration catalog and setup guide resolve successfully. Fivetran actions use a saved API-key/secret credential; event triggers take their own key/secret inputs. The article does not imply one saved action credential also configures a webhook. Available resources and operations remain subject to Fivetran permissions.
- The production Agent block definition includes `gemini-4-argon`, and its model catalog resolves successfully. The released provider definition supports the stated thinking levels, tool calling, image input, and structured output. The source PR records live provider acceptance. This entry makes no new performance or quality benchmark claim.
- The production connector catalog includes Confluence; the published connector guide documents Image Attachments and the Read with AI behavior. Current connector metadata defaults new connectors to image extraction; existing connectors require opt-in. Attachment access and normal model billing still apply. The article preserves the opt-in and billing information rather than suggesting existing connections change automatically.
- Search behavior was checked against the release source and current implementation: partial matches are a fallback when exact results are scarce, not a replacement for exact/native query behavior. Matching passages are extracted for supported text results; the entry makes no claim that every result contains one.

## Reviewed media

Captured October 13, 2026 (Pacific time), from a running self-hosted app at staging base `0c3540ae6c`. A dedicated sample workflow contains Start and Fivetran blocks. The capture selects Fivetran and filters Operation to sync-related actions. The crop shows the complete rounded operation menu, search field, and six actual sync options. It excludes the surrounding editor edge and scrollbar. Asset: `/changelog/fivetran-sync-menu-v1.jpg`, 486 × 226 pixels. Only cropping and JPEG encoding were applied; product text, controls, and state were not altered. No outer whitespace was added; the shared media component retains its existing rounded treatment. The article uses `max-w-lg` to display it near its captured size. This image demonstrates operation selection; it does not represent a provider execution or returned account data. No placeholder credentials are saved.

A still lets readers inspect the new controls without an unnecessary setup video. Use the existing shared image lightbox and normal article styling. Capture provenance, review notes, and execution limits belong here, not in article captions or disclaimers.

## Publication review

Editorial and feature review completed for this entry. The source claims, release membership, contextual links, real media, and access requirements were reviewed before setting `draft: false`. Release approval is recorded separately from production publication.

Publication checks:

- Compressed capture inspected: correct dimensions, legible controls, and no private data.
- Rendered copy checked on desktop and at 390px with no horizontal overflow. The existing shared lightbox loads the original image, zooms to 125%, dismisses with Escape, and returns focus to the image trigger.
- Canonical URL, BlogPosting and ImageObject structured data, index, archive, RSS, sitemap, and live contextual links verified. The new RSS GUID is the canonical article URL; the six earlier entries remain included and drafts remain excluded.
- Content audit, required generators, lint, 59 repository audits, block-registry audit, and type-check passed; generators produced no unrelated changes. Repository test suites run only in CI as requested. Existing lint warnings outside this content change remain unchanged.
- Keep candidate sources selected under this manual identity while the PR is open. Add the edition record after merge, with actual approvals and `pending_deployment`. Mark production publication only after the canonical article, media, RSS, and sitemap pass the production monitor.

Canonical URL: https://www.sim.ai/changelog/fivetran-gemini-and-confluence

## Announcement drafts

Social:

> New in Sim: manage Fivetran syncs from workflows, use Gemini 4 Argon in Agent, and search the text inside Confluence image attachments. Details and setup: https://www.sim.ai/changelog/fivetran-gemini-and-confluence

Email subject: Fivetran workflows, Gemini 4 Argon, and Confluence images

Email body:

> Sim now supports Fivetran connection and sync controls, including workflows triggered by sync and transformation events. Gemini 4 Argon is available in Agent, and Confluence connectors can read image attachments as searchable text. Existing Confluence connectors require opt-in; image reading incurs model usage. See the update and setup links: https://www.sim.ai/changelog/fivetran-gemini-and-confluence

These are drafts. Distribute only after production publication is verified.
