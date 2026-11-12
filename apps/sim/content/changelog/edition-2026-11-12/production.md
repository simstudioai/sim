# Save database connections once, share everywhere

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

The strongest lead is saved database connections for PostgreSQL, MySQL, and SQL Server (PR #9929), which removes recurring friction of database passwords sitting in every block. Workspace/org admins save a connection once in Integrations and share it across workflows and agents. This is a complete, user-visible capability with verified docs links. No releaseTags are present, so availability is unverified and no 'Also in' section is appropriate. No other PRs in the batch share releaseTags with this PR. The draft avoids claiming rollout. Alternatives considered: no other PRs were supplied in this batch, so this is the only candidate.

## Proposed article

Sim lets workspace and organization admins save a PostgreSQL, MySQL, or SQL Server connection once in Integrations and reuse it across any workflow or agent, so database passwords no longer sit in individual blocks.

The database connection credential stores the host, port, database, username, password, and transport-security settings for PostgreSQL, MySQL, and SQL Server. Sim verifies the connection before saving it, then reads it server-side on each run — the block, the workflow, and agents never see the password. Existing workflows keep their inline connection fields and run unchanged.

Workspace and organization admins can add a connection under **Integrations**. See the [PostgreSQL](https://docs.sim.ai/integrations/postgresql), [MySQL](https://docs.sim.ai/integrations/mysql), and [SQL Server](https://docs.sim.ai/integrations/mssql) integration guides for setup steps and transport-security options.

## Editorial review

- Removed 'now' from social and email to comply with the rule against claiming rollout in automatic drafts, since no releaseTags are present.
- Tightened body paragraph 2 to remove repeated admin-access requirement sentence; the first sentence of that paragraph already establishes the admin role.
- Replaced 'TLS mode details' with 'transport-security options' for consistency with the body's terminology.
- No releaseTags on this PR and it merged to staging — owner review is critical to confirm Cloud availability before publication.
- The PR describes SELECT 1 verification, encrypted storage, and server-side credential reads. These are confirmed in the docs excerpts and PR body. The claim about blocks/agents never seeing the password is supported by the withSavedDatabaseConnection server-side read pattern described in the PR.

## Source evidence

- Workspace and organization admins can save a PostgreSQL, MySQL, or SQL Server connection in Integrations and share it across workflows and agents. — simstudioai/sim#9929
- Sim verifies the connection with SELECT 1 before saving it encrypted, and reads it server-side on each run; the block, workflow, and agents never see the password. — simstudioai/sim#9929
- Existing workflows with inline connection fields keep their inputs and run unchanged; legacy blocks are hidden from the toolbar but remain functional. — simstudioai/sim#9929
- New postgresql_v2, mysql_v2, and mssql_v2 blocks offer only the connection picker; the legacy blocks are marked as replaced. — simstudioai/sim#9929
- Setup is documented on the PostgreSQL, MySQL, and SQL Server integration pages, including transport-security options. — simstudioai/sim#9929

- https://github.com/simstudioai/sim/pull/9929

## Availability and open questions

- [ ] Has this shipped to Sim Cloud, or is it staging-only? No releaseTags are present — owner must confirm rollout status before publishing.
- [ ] Are the new postgresql_v2, mysql_v2, and mssql_v2 blocks visible in the toolbar on Cloud at time of publication?
- [ ] Should the announcement note that the legacy blocks are hidden from the toolbar but still functional for existing workflows, or is that too much implementation detail for users?
- [ ] Is there a recommended TLS mode for each database family that should be called out?

## Links checked during drafting

- [PostgreSQL integration guide](https://docs.sim.ai/integrations/postgresql)
- [MySQL integration guide](https://docs.sim.ai/integrations/mysql)
- [SQL Server integration guide](https://docs.sim.ai/integrations/mssql)

## Media production

Format: video · 30 seconds
Subject: Sim Integrations page showing database connection setup modal and saved credential list
Starting state: Integrations page open in a clean Sim workspace, no database connections saved yet
Action: Admin clicks to add a PostgreSQL connection, fills in sample host/port/database/username/password/SSL fields with non-real values, and saves; the verified connection appears in the list; then opens a workflow and selects the saved credential in a PostgreSQL block
Visible result: Saved PostgreSQL connection visible verified in the Integrations list; workflow block connection picker shows the saved credential selected instead of inline fields
Poster: The saved connection appearing verified in the Integrations list, with the workflow block's connection picker showing it selected
Framing: 390px-wide desktop browser, Integrations page centered; modal and list both visible in initial steps; workflow canvas centered when showing the block picker
Demonstration limits: Capture requires a real Sim workspace with admin access and a reachable test PostgreSQL database. Configure credentials through the real Integrations settings flow before capture. Do not show fake key entry or imply a placeholder was accepted. Verify the postgresql_v2 block is visible in the toolbar on the target environment before capture. No release tags confirm Cloud availability — owner must confirm environment before scheduling capture.

Capture the Integrations page in Sim showing the database connection setup flow for PostgreSQL. The goal is to show that credentials live in one central place, not in individual blocks. Use a clean workspace with sample non-real credentials and a reachable test database. End by showing the saved connection selected in a workflow block's connection picker.

1. Open the Integrations page in a clean Sim workspace with no database connections saved yet
2. Click to add a new PostgreSQL connection; show the modal with host, port, database, username, password, and SSL mode fields filled with sample non-real values
3. Submit and show the saved connection appearing verified in the Integrations list
4. Open a workflow canvas, add a PostgreSQL block, and show the connection picker selecting the saved credential instead of inline fields

Suggested alt text: Sim Integrations page showing a saved PostgreSQL database connection with host, port, database, username, and SSL mode fields, and the verified connection in the credentials list.

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim lets you save PostgreSQL, MySQL, and SQL Server connections once in Integrations and share them across every workflow and agent — no more passwords in block fields.

**Email**

Your team can save database connections for PostgreSQL, MySQL, and SQL Server once in Sim Integrations and reuse them across all workflows and agents. Sim verifies the connection before saving it and reads credentials server-side on each run — blocks and agents never see the password. Existing workflows keep their inline fields and run unchanged. Workspace and org admins can set this up under Integrations.

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
