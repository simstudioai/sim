# Deployment comparison: production record

Status: published; October 9 media refresh prepared for review. Only `index.mdx` is rendered publicly.

## Evidence

- [PR #8455](https://github.com/simstudioai/sim/pull/8455), commit `4436f825cf`, included in [v0.9.10](https://github.com/simstudioai/sim/releases/tag/v0.9.10).
- Checked the implementation and the actual Compare flow in a local self-hosted app on October 7, 2026, based on staging commit `684b228623`.
- Public copy states the released version. This local verification does not establish every Cloud organization's rollout.
- Links: [deployment guide](https://docs.sim.ai/workflows/deployment), [comparison API](https://docs.sim.ai/api-reference/workflows/compareWorkflowVersionsV2), and the Slack integration catalog.

## Media provenance

Refreshed on October 9, 2026 (October 10 UTC), using the running local app at commit `36f91a76e2`, including the current embedded comparison presentation from #8862. A dedicated disposable workspace contains a synthetic support-ticket workflow with two deployment snapshots. The second changes the agent prompt and adds a Slack step. No model or Slack call was executed.

Open deployment history, choose Compare from v2's menu, and inspect v1 against v2. The reviewed image shows the real comparison dialog, including the changed prompt, added Slack step, and connection. It is a direct browser capture cropped to the dialog, 1200 × 605 pixels; no controls or results were generated or altered.

Current asset: `/changelog/compare-workflow-deployments-v2.jpg`. A still is more useful for inspecting this before/after state than the previous slideshow. It opens in the shared image lightbox and supplies the share image. The earlier v1 JPEG and MP4 remain available at their immutable URLs for existing links, but the article no longer embeds the video.

## Review notes

The refreshed screenshot replaces the edited video walkthrough. The comparison is read-only and shows actual before/after fields. Copy covers both two-version comparison and draft-versus-live review; the media demonstrates the two-version path. The draft remains unchanged after opening and closing Compare.

The entry keeps the historical release timestamp and RSS identity. Lightbox zoom, mobile layout, asset responses, and content validation belong in the publication PR's validation record. Assign the release editor and feature reviewer in that PR; verify the public URL before distributing.

## Announcement drafts

Social:

> See what changed before you deploy in Sim. Compare workflow versions, review prompt edits and new steps, and inspect changed connections. Demo and guide: https://www.sim.ai/changelog/compare-workflow-deployments

Email subject: See what changed before you deploy

Email body:

> Open deployment history and choose Compare to review two workflow versions. You can also review a draft against the live workflow before redeploying. See the product walkthrough and setup guide: https://www.sim.ai/changelog/compare-workflow-deployments

These are drafts, not sent announcements.
