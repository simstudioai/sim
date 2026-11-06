# Move knowledge bases between workspaces

Edition: 2026-10-26. Canonical: https://www.sim.ai/changelog/knowledge-base-imports.

## Editorial selection

Lead with knowledge portability: a team can copy prepared knowledge to another workspace or deployment without rebuilding it document by document. Completing that task matters more than the novelty or operation count of another integration. Amazon EC2 is a concise supporting note from the same release.

Reviewed the published v0.9.32 and v0.9.33 changes across knowledge, Chat, execution, account security, infrastructure, and integrations. Scheduled agent jobs have no creation API, command, or UI yet, so their runtime is not announced. Parser, log, retry, token-storage, and deployment internals stay in the technical history. Minor Chat conveniences do not carry a standalone announcement.

Copy leads with the reader's outcome, gives the minimum useful behavior and constraints, and keeps a smaller change in a short note. No publication quota, operation inventory, speculative benefit, or filler.

## Source and release evidence

| Claim | Source | Release |
| --- | --- | --- |
| Import an archive as a new base, preserving documents, tags, configuration and enabled flags | [#9327](https://github.com/simstudioai/sim/pull/9327) | [v0.9.32](https://github.com/simstudioai/sim/releases/tag/v0.9.32) |
| Compatible included vectors avoid re-embedding; other documents follow normal processing and billing | #9327 | v0.9.32 |
| Connector connections, credentials and access grants are not transferred | #9327 and the export/import guide | v0.9.32 |
| Inspect/control EC2 instances, create snapshots and manage tags with AWS credentials and IAM permissions | [#9304](https://github.com/simstudioai/sim/pull/9304) | v0.9.32 |

Release membership is explicit in the published release body. Both source commits are included in the successfully deployed production release. The new editorial entry uses its canonical URL as the feed identity.

## Availability and boundaries

- Verified the deployed [export/import guide](https://docs.sim.ai/knowledgebase/export-import), CLI command contract, and hosted authenticated import-status route. Import is available through the API and current CLI; no browser import control is claimed.
- Export includes eligible workspace-readable content. Creation/uploads permission is needed in the destination; permission grants and live connector configuration are not portable.
- Index reuse requires both the embedding model and dimensions to match. Otherwise normal processing and usage charges apply. Partial document failures are reported; the guide explains archive limits and cancellation.
- Verified the deployed EC2 catalog and [setup guide](https://docs.sim.ai/integrations/ec2). AWS permissions still govern operations. No AWS mutation or successful new cloud-account execution is claimed by this article.
- Source CI includes an export/import round trip against real storage and a database. This editorial task does not claim a new production import or run local test suites.

## Media production

Format: original generated editorial illustration. A curved stone walkway connects open rooms overlooking a coast, suggesting portability between workspaces. It is conceptual art, not a product screenshot or evidence of an import.

Generation art direction: “Create one original wide 16:9 editorial illustration. Restrained grayscale matte painting, fine graphite and dry-brush paper texture, soft overcast light. A spacious modern stone colonnade on a coastal hillside: repeated simple rectangular doorways receding into the distance, one broad curved stone walkway returning around an open courtyard, distant pale hills and clouds through the openings. Human-scale understated architecture, negative space, readable at mobile width. No people, text, logos, icons, diagrams, UI, devices, borders or floating objects.”

The original unused illustration was generated during earlier editorial exploration and is used here for its connecting-spaces concept. Final asset: `/changelog/knowledge-open-rooms-v1.jpg`, 1672 × 941, optimized from the original PNG. Generation provenance is retained privately. Existing shared image styling and viewer remain unchanged.

## Publication review

- [x] Source claims, release membership, access requirements and editorial selection reviewed.
- [x] Final media and copy reviewed in the actual desktop/mobile article.
- [x] Canonical/schema, discovery, previous feed identities and links verified.
- [ ] Repository checks and both current-head reviews complete.
- [ ] Normal staging deployment and hosted article verified.

## Announcement drafts

**Social:** Move prepared knowledge between Sim workspaces or deployments, keeping documents, tags, and settings. Import an exported archive through the CLI or API to create a new knowledge base. https://www.sim.ai/changelog/knowledge-base-imports

**Email:** Your prepared knowledge can move with your team. Export a Sim knowledge base and import it into another workspace or deployment, preserving its documents, tags, and settings. Connections and permissions stay separate. This update also adds Amazon EC2 actions for agents and workflows. https://www.sim.ai/changelog/knowledge-base-imports

Do not distribute before the production article is verified. Private operational evidence is kept outside this public brief.
