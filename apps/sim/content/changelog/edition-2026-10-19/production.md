# Excel block grows to 24 operations

Status: editorial draft. Availability and real media require review before an article is added.

## Editorial selection

Story type: feature

The Excel block expansion (7 to 24 operations) is the strongest standalone feature story with clear user-facing capability changes and verified access requirements. No PRs in the batch carry release tags, so the Zoho Desk and Greenhouse changes are not included as supporting notes because they are not directly related to the Excel feature. They should receive their own announcement when a release tag groups them.

## Proposed article

Sim's Microsoft Excel block expands from 7 to 24 operations, adding worksheet and table discovery, row management, formula writes, range formatting, sorting, and workbook sessions for OneDrive and SharePoint files.

The Excel block expands from 7 to 24 operations. Discover worksheets and tables, add and update table rows, write formulas and number formats, apply cell formatting, sort ranges, and calculate workbook results. Use sessions when several operations work on the same workbook — persist edits or work on a temporary copy, then close the session when finished.

Connect your Microsoft account with access to the workbook. A business account is required, and SharePoint browsing may require reconnecting to grant an additional permission. [See the Excel integration guide](https://docs.sim.ai/integrations/microsoft_excel) for setup details.

## Editorial review

- Removed 'Also in this batch' section: no PRs carry release tags, and Zoho Desk (#9205) and Greenhouse (#9214) are not directly related to the Excel expansion. They should receive their own announcement when a release tag groups them or be drafted separately.
- Removed specific OAuth scope name (Sites.Read.All), parameter names (sessionId, top, skip), and drive/workbook ID setup details from the body per editorial guidelines on technical plumbing. Left setup procedure to the linked guide.
- Simplified session management description to explain the capability without procedural parameter-passing detail.
- Reduced source_keys and claims to the Excel PR only since the supporting sources were dropped from the story.

## Source evidence

- The Microsoft Excel block expands from 7 to 24 operations, adding worksheet and table discovery, row management, formula writes, range formatting, sorting, calculation, and session management. — simstudioai/sim#9203
- SharePoint site browsing requires an additional permission; existing accounts must reconnect to grant the added scope. — simstudioai/sim#9203
- Excel workbook operations require a business account. — simstudioai/sim#9203
- Sessions let several operations work on the same workbook, with an option to persist edits or use a temporary copy. Requests without a session save changes directly. — simstudioai/sim#9203

- https://github.com/simstudioai/sim/pull/9203

## Availability and open questions

- [ ] Is the 7-to-24 Excel operation expansion confirmed available on Sim Cloud, or is it staged behind a flag? Owner review needed before publication.
- [ ] Does the SharePoint browsing permission require tenant-level admin consent, or is user-level consent sufficient?
- [ ] Should the Zoho Desk (10 to 30 operations) and Greenhouse (customer-owned credential) changes be announced in a separate changelog entry or batched under a future release tag?

## Links checked during drafting

- [Microsoft Excel integration guide](https://docs.sim.ai/integrations/microsoft_excel)

## Media production

Format: screenshot
Subject: Microsoft Excel block operation picker in the Sim workflow canvas
Starting state: Excel block placed on canvas with a connected Microsoft business account credential, operation picker closed
Action: Click the operation dropdown to open the full list of 24 operations, scroll to show new operations including List Worksheets, Add to Microsoft Excel Table, and Create Session
Visible result: Operation picker open with at least three new operations clearly readable in the list
Poster: Operation picker fully open showing new operations including List Worksheets, Add to Table, and Create Session
Framing: Single Excel block centered at 390px width, operation picker open and readable, no other blocks or distracting UI elements
Demonstration limits: Picker must show operations not present in the previous 7-operation block; credential must be genuinely connected through the real Microsoft OAuth flow before capture

Capture a focused screenshot of the Excel block in the Sim workflow canvas showing the expanded operation picker open, with representative new operations visible (e.g., List Worksheets, Add to Microsoft Excel Table, Create Session). The block should have a connected Microsoft credential selected. Use a clean sample workspace with readable labels at 390px width. Connect a real Microsoft business account through the settings flow before capture — do not show fake credentials.

1. Open a workflow canvas with the Excel block placed and a Microsoft business account credential connected through the real settings flow.
2. Click the operation dropdown on the Excel block to open the full operation list.
3. Scroll to show a mix of new operations such as List Worksheets, Add to Microsoft Excel Table, and Create Session visible in the picker.
4. Capture the picker open with at least three new operations clearly readable — this is the poster frame.

Suggested alt text: Sim workflow canvas showing the Microsoft Excel block with its operation picker open, displaying operations including List Worksheets, Add to Microsoft Excel Table, and Create Session.

- [ ] Capture the real feature with sample data; record environment, date, permissions and limitations.
- [ ] Review a feature image or a focused 20–45 second recording. Use consistent product theme and sample data.
- [ ] Choose the poster from the visible result; verify the relevant panel is readable at 390px. Candidate frames are not approved assets.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim's Excel block expands from 7 to 24 operations — discover worksheets and tables, manage rows, write formulas, format ranges, and run workbook sessions. Works with OneDrive and SharePoint. docs.sim.ai/integrations/microsoft_excel

**Email**

The Microsoft Excel block in Sim expands from 7 to 24 operations. Discover worksheets and tables, add and update rows, write formulas and number formats, apply formatting, sort ranges, calculate workbooks, and manage sessions for multi-step edits. SharePoint files are supported alongside OneDrive, and a business account is required. Reconnect your Microsoft account if SharePoint browsing requires an additional permission. Full details: https://docs.sim.ai/integrations/microsoft_excel

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
