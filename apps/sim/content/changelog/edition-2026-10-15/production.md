# Connect agents to Oracle Database

Status: editorial draft. Availability and real media require review before an article is added.

## Editorial selection

Story type: feature

Oracle Database is the strongest user-facing feature in this batch: a new integration with concrete setup requirements, documented behavior, and a verified docs link. The workflow lint fix shares the v0.9.17 tag and makes a meaningful supporting note. The MCP SDK/sharp security patch carries a v0.9.16 tag and cannot be combined under the same Also heading, so it is dropped from this draft.

## Proposed article

Sim adds an Oracle Database block that queries, modifies, and introspects Oracle Database 12.1 or later over Oracle Net with saved connections supporting TCP and verified TCPS.

The Oracle Database block lets agents query, execute, insert, update, delete, and introspect Oracle Database 12.1 or later over Oracle Net. Use named binds such as `:customer_id` for data values in queries and statements. Queries run in read-only transactions; writes autocommit. PL/SQL blocks and stored-procedure calls are not supported.

Connect through **Integrations** by entering the host, port, service name or SID, username, and password — Sim verifies the connection before saving it encrypted. TCP is available for trusted networks; TCPS always verifies the server certificate and hostname and cannot downgrade. The runtime must be able to reach the database listener; self-hosted runtimes require Node.js 24. See the [Oracle Database integration guide](https://docs.sim.ai/integrations/oracledb) for mutual TLS wallet setup and full SQL behavior.

### Also in v0.9.17

- Workflow lint flags unquoted block-output references in JSON editor fields when the output is declared a string, catching errors that previously appeared only at run time.

## Editorial review

- Dropped the MCP SDK/sharp security note (simstudioai/sim#8798): it carries a v0.9.16 release tag, not v0.9.17, so it cannot appear under the Also in v0.9.17 heading with the Oracle Database and lint sources.
- Removed 'now' from summary, social, and email per editorial policy against availability claims in automatic drafts.
- Shortened body from ~227 words to ~125 words: moved mutual TLS wallet details and named-bind examples to the guide link; removed the sentence about reconnecting credentials from Integrations (setup procedure).
- Consolidated media plan from two screenshots (connection modal + canvas block) to one focused screenshot of the block on canvas with credential picker, which better demonstrates the integration in use.
- Kept the Node.js 24 self-hosted requirement and network-access requirement as they are documented access restrictions in the evidence.

## Source evidence

- The Oracle Database block supports query, execute, insert, update, delete, and introspect operations against Oracle Database 12.1 or later. — simstudioai/sim#7378
- Connections are verified before encryption and saved as a reusable credential; no shared OAuth application or Oracle-specific deployment secret is required. — simstudioai/sim#7378
- TCPS always verifies the server certificate and hostname and cannot downgrade to TCP; mutual TLS is supported via an in-memory PEM wallet. — simstudioai/sim#7378
- Workflow lint flags unquoted block-output references in JSON editor fields when the referenced output is declared a string, a class of error previously silent until run time. — simstudioai/sim#8803

- https://github.com/simstudioai/sim/pull/7378
- https://github.com/simstudioai/sim/pull/8803

## Availability and open questions

- [ ] Oracle Database: evidence notes live provider credentials were unavailable during some development — has a live-account verification pass been completed before publication?
- [ ] OCI, Oracle Fusion, and Oracle EPM foundations also merged in v0.9.17 but expose no user-facing blocks — should they be held for a combined announcement when product blocks ship?
- [ ] Confirm the Oracle Database block appears in the Integrations panel and the block picker in a staging or production workspace before media capture.

## Links checked during drafting

- [Oracle Database integration guide](https://docs.sim.ai/integrations/oracledb)
- [Oracle Database on sim.ai](https://www.sim.ai/integrations/oracle-database)
- [Workflows documentation](https://docs.sim.ai/workflows)

## Media production

Format: screenshot
Subject: Oracle Database block on the Sim workflow canvas
Starting state: Clean workspace with an Oracle Database block added and a credential already saved via Integrations
Action: Select the block to open its panel; open the credential picker to show the saved connection
Visible result: Oracle Database block panel open with saved connection selected in the credential picker, operation set to query
Poster: Oracle Database block panel with credential picker showing the saved Oracle connection selected
Framing: 390px-wide workspace view; block panel visible and readable with credential picker open
Demonstration limits: Do not show real credentials, accepted placeholder keys, or fabricated query results

Capture a focused screenshot of an Oracle Database block on the Sim workflow canvas. The block should be selected with its panel open and the credential picker showing a saved Oracle Database connection chosen. Operation should be set to query. Use a clean workspace with no real data. Configure real credentials through the Integrations flow before capture; do not show credential values or imply a placeholder key was accepted.

1. Workflow canvas with an Oracle Database block selected, credential picker open showing a saved Oracle connection, operation set to query — clean sample workspace, no real data or credentials visible

Suggested alt text: Sim workflow canvas showing the Oracle Database block with a saved connection selected in the credential picker

- [ ] Capture the real feature with sample data; record environment, date, permissions and limitations.
- [ ] Review a feature image or a focused 20–45 second recording. Use consistent product theme and sample data.
- [ ] Choose the poster from the visible result; verify the relevant panel is readable at 390px. Candidate frames are not approved assets.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim adds an Oracle Database block — query, execute, insert, update, delete, and introspect over Oracle Net with TCP or verified TCPS. Save your connection once in Integrations and reuse it across workflows.

**Email**

An Oracle Database block is available in Sim. Connect by entering your host, port, service name or SID, username, and password in Integrations — Sim verifies and encrypts the connection. Query, execute SQL, and perform structured writes with named binds. TCPS connections always verify the server certificate and hostname. See the integration guide for wallet setup and full SQL behavior.

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
