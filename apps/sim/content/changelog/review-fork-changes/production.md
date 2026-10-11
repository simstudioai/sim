# Fork comparison: production record

Status: prepared for publication review. Only `index.mdx` is rendered publicly.

## Evidence and availability

[PR #8586](https://github.com/simstudioai/sim/pull/8586), commit `405cc6a835`, included in [v0.9.12](https://github.com/simstudioai/sim/releases/tag/v0.9.12). Checked the source and the actual fork comparison in the local self-hosted app based on staging commit `684b228623` on October 7, 2026.

A dedicated sample workspace was forked through the real application operation. A real sync and its deployment outbox completed before creating the next source deployment. The subsequent preview reported an available baseline between source versions 1 and 2. This avoids inventing a Last Sync snapshot or displaying a first-sync screen as the comparison feature.

The public copy preserves workspace admin access, Cloud Enterprise enablement, and self-hosted Forks enablement requirements from the [workspace forks guide](https://docs.sim.ai/platform/enterprise/forks). Local verification does not establish each Cloud organization's rollout.

## Media provenance

The running product shows a sample renewal-reminder workflow changing from seven to fourteen days and adding an account-summary setting. No customer data or external message is used.

1. Open the fork's parent mapping settings and select Pull.
2. Choose Compare from the deployed workflow's menu.
3. Review Last Sync → Now and the actual changed code.

Assets: `/changelog/review-fork-changes-v1.jpg` and `/changelog/review-fork-changes-v1.mp4`. The poster shows the final comparison. The silent video is an edited walkthrough assembled from three unmodified UI captures with reading pauses, not a continuous screen recording. It uses the actual product UI; no controls or results are generated.

The previous mapping-only reference image has been removed. The new screenshot proves the announced comparison. The capture stops before performing another sync.

## Review and edge cases

The baseline records a successful destination activation, is specific to the source/destination relationship, and can be unavailable before the first sync or when an older snapshot has been removed. The article explains those limits. Comparison does not claim to preview destination edits or resource mappings.

Assign the release editor and feature reviewer in the publication PR. Validate playback, asset responses, responsive layout, links, and the public URL before distribution. Keep the historical timestamp and v0.9.12 RSS identity stable.

Social draft:

> Review changes before syncing a workspace fork in Sim. Last Sync → Now shows what changed in the source workflow. Available with Workspace Forks; setup and demo: https://www.sim.ai/changelog/review-fork-changes

Email subject: Review fork changes before syncing

Email body:

> Open your fork's mapping settings and choose Compare from a deployed workflow's menu. Inspect source changes since the last successful sync before updating the fork. Availability and demo: https://www.sim.ai/changelog/review-fork-changes

These are drafts, not sent announcements.
