# Power BI: production record

Status: prepared for publication review. Only `index.mdx` is rendered publicly.

## Evidence and availability

[PR #8538](https://github.com/simstudioai/sim/pull/8538), included in [v0.9.12](https://github.com/simstudioai/sim/releases/tag/v0.9.12). Reviewed the block, action implementations, and [setup guide](https://docs.sim.ai/integrations/powerbi).

Eight actions cover workspaces, report metadata, semantic-model metadata, DAX queries, refresh requests, and refresh history. An accepted refresh request is not a completed refresh. The public copy preserves this distinction and the query permission requirements.

The entry links to `/integrations/power-bi` and the matching docs guide at `/integrations/powerbi`. It has its own RSS identity because the fork-comparison story already carries the historical v0.9.12 release identity.

## Media provenance

Captured October 7, 2026, from the actual local self-hosted app based on staging commit `684b228623`, using a dedicated sample workspace. Asset: `/changelog/power-bi-query-v1.jpg`, 1440×900.

The screenshot shows the Power BI block and a synthetic DAX query using sample sales table and column names. The account, workspace, and model selectors are intentionally unconnected. No Microsoft account was connected and no query or refresh was executed. The article explicitly describes a configuration example, not a successful provider call. Do not add a results screen without a real authorized connection and a verified run.

The sample demonstrates where the query is configured. Actual table and column names must match the reader's model. The setup guide describes organizational accounts, delegated connection requirements, permission limits, and unsupported actions.

## Review and distribution

Assign the release editor and feature reviewer in the publication PR. Verify the local asset, mobile layout, canonical links, and public URL before distribution. Local availability does not independently verify every Cloud rollout.

Social draft:

> Bring Power BI data into your agents in Sim. Query semantic models, inspect reports, and request refreshes from a workflow block. Setup requirements and example: https://www.sim.ai/changelog/power-bi-for-agents

Email subject: Connect your agents to Power BI

Email body:

> Sim's Power BI integration can query semantic models, inspect reports, and request refreshes. Use the returned rows in a briefing or follow-up. See the configuration example and Microsoft connection requirements: https://www.sim.ai/changelog/power-bi-for-agents

These are drafts, not sent announcements.
