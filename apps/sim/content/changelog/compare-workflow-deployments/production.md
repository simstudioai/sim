# Deployment comparison: production record

Status: prepared for publication review. Only `index.mdx` is rendered publicly.

## Evidence

- [PR #8455](https://github.com/simstudioai/sim/pull/8455), commit `4436f825cf`, included in [v0.9.10](https://github.com/simstudioai/sim/releases/tag/v0.9.10).
- Checked the implementation and the actual Compare flow in a local self-hosted app on October 7, 2026, based on staging commit `684b228623`.
- Public copy states the released version. This local verification does not establish every Cloud organization's rollout.
- Links: [deployment guide](https://docs.sim.ai/workflows/deployment), [comparison API](https://docs.sim.ai/api-reference/workflows/compareWorkflowVersionsV2), and the Slack integration catalog.

## Media provenance

A dedicated local workspace contains a synthetic support-ticket workflow with two deployments. The second changes the agent prompt and adds a Slack step. No model or Slack call was executed for this capture.

The media comes from the running product, captured through the browser. The video is a silent, edited walkthrough assembled from three unmodified UI captures with reading pauses; it is not a continuous screen recording. No generated controls or results are used.

1. Open deployment history.
2. Open the version menu and choose Compare.
3. Inspect the changed prompt, added Slack step, and connection.

Assets: `/changelog/compare-workflow-deployments-v1.mp4` and `/changelog/compare-workflow-deployments-v1.jpg`. The poster is the final comparison view. The short MP4 is served locally with the site; larger future recordings should use the approved media CDN. Keep filenames immutable.

## Review notes

The screenshot replaces the older deployment-history reference. The comparison is read-only and shows actual before/after fields. Copy covers both two-version comparison and draft-versus-live review; the media demonstrates the two-version path. The draft remains unchanged after opening and closing Compare.

The entry keeps the historical release timestamp and RSS identity. Playback, mobile layout, asset responses, and content validation belong in the publication PR's validation record. Assign the release editor and feature reviewer in that PR; verify the public URL before distributing.

## Announcement drafts

Social:

> See what changed before you deploy in Sim. Compare workflow versions, review prompt edits and new steps, and inspect changed connections. Demo and guide: https://www.sim.ai/changelog/compare-workflow-deployments

Email subject: See what changed before you deploy

Email body:

> Open deployment history and choose Compare to review two workflow versions. You can also review a draft against the live workflow before redeploying. See the product walkthrough and setup guide: https://www.sim.ai/changelog/compare-workflow-deployments

These are drafts, not sent announcements.
