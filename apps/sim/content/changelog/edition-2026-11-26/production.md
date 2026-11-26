# Test workflows without side effects

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

The dry-run feature (10402, 10416, 10412, 10413, 10410) is the clear lead: it introduces a substantial new capability—side-effect-free workflow test runs via `--dry` or `run.dry: true`—that changes how teams safely test workflows. All five PRs are directly related and form one coherent story. No releaseTags are present on any source, so no `### Also in` section applies. Other candidates (Slack timeline sources, billing fixes, SCIM fix, CLI deploy status) are either narrower, bug fixes, or not part of this batch. Lead beats alternatives on breadth of impact across all workflow users.

## Proposed article

Sim dry runs execute a workflow with every write stubbed—table inserts, Slack messages, HTTP calls—and return the exact payloads for inspection, so you can verify logic without creating test data to clean up.

A dry run executes reads and model calls for real while stubbing every write—table inserts, Slack messages, HTTP calls, and more. Each stubbed call appears under `sideEffects.stubbed` with the request it would have sent, credentials and secrets redacted, so you can inspect what a workflow would write without creating data to clean up afterward.

Child workflows inherit dry mode, and create-then-read chains are handled automatically so a later block that references a stubbed write's output does not fail against the provider. Code in Function and Condition blocks has its non-GET network calls stubbed as well. Nothing persists beyond the run's own log.

Use `--allow <block>` to send one block's writes for real against a test resource, or `--mock <block>='{...}'` to steer a branch with fixed output. See the [CLI workflows reference](https://docs.sim.ai/cli/workflows) and the [API reference](https://docs.sim.ai/api-reference/build-and-run-workflows) for the full options.

## Editorial review

- Trimmed body from ~250+ words to ~150 words, removing implementation details: placeholder id format (dry_run_<kind>_<n>), dependsOnStub flag specifics, isolate vs remote sandbox distinction, --mock-from syntax, Human-in-the-loop/Wait block handling. These details remain in claims for verification.
- Removed 'now' from social copy and rephrased summary to describe the capability without asserting temporal newness, per automatic-draft guidelines.
- All five PRs merged to staging with no releaseTags. Availability is unverified—owner must confirm Sim Cloud availability before publication.
- The draft originally listed --mock-from <runId> and <workflow>.<block> targeting syntax in the body; moved to claims since these are advanced options documented in the linked references.
- No releaseTags on any source PR, so no Also in section is appropriate. The Slack timeline-sources feature (10370) was not included in this batch.

## Source evidence

- A dry run stubs every write tool call and returns a correctly shaped placeholder, listing each under `sideEffects.stubbed` with the request it would have sent, credentials and secrets redacted. — simstudioai/sim#10402, simstudioai/sim#10410
- A read that would send a placeholder id produced by the same dry run is automatically stubbed and flagged with `dependsOnStub: true`, so create-then-read chains do not fail against the provider. — simstudioai/sim#10416
- JavaScript in Function, Condition, and loop blocks has non-GET network calls stubbed on the host during a dry run; only code in a remote sandbox remains listed as `sideEffects.unchecked`. — simstudioai/sim#10412
- Child-workflow blocks can be targeted with `--allow <workflow>.<block>` or `--mock <workflow>.<block>='{...}'`, and `--mock-from <runId>` replays outputs from an earlier run. — simstudioai/sim#10413
- Dry-run placeholders for common write tools echo the data the request determines—including table row data, Slack message text, and issue fields—with provider-generated ids replaced by distinctive placeholder tokens. — simstudioai/sim#10410

- https://github.com/simstudioai/sim/pull/10402
- https://github.com/simstudioai/sim/pull/10416
- https://github.com/simstudioai/sim/pull/10412
- https://github.com/simstudioai/sim/pull/10413
- https://github.com/simstudioai/sim/pull/10410

## Availability and open questions

- [ ] Has the dry-run feature shipped to Sim Cloud, or is it staging-only at publication time? No releaseTags are present on any source PR.
- [ ] Are `--allow` and `--mock` available in the visual workflow editor, or only via the CLI and v2 API?
- [ ] Is there a dedicated docs page for dry runs, or is the canonical reference the CLI workflows page and API reference page?

## Links checked during drafting

- [CLI workflows reference](https://docs.sim.ai/cli/workflows)
- [API reference: build and run workflows](https://docs.sim.ai/api-reference/build-and-run-workflows)
- [CLI reference](https://docs.sim.ai/cli/reference)
- [Workflows](https://docs.sim.ai/workflows)

## Media production

Format: video · 30 seconds
Subject: Terminal running `sim workflows run --dry` against a workflow with a write block
Starting state: Terminal showing the dry-run command typed and ready to execute
Action: Execute the dry run; the workflow completes and prints sideEffects.stubbed output with redacted payloads
Visible result: Terminal held on the stubbed output showing placeholder ids and redacted request fields, readable at 390px
Poster: Terminal output showing sideEffects.stubbed entries with a placeholder id and redacted credentials visible
Framing: Full-width terminal at 390px, dark theme, sample-data workspace, no real credentials visible
Demonstration limits: Capture against a real workflow with a Slack or table write block; configure credentials through the real settings flow before capture; verify sideEffects.stubbed appears in output and no real write occurs; do not fabricate output

Record a 20–30 second terminal screen capture showing a dry run in action. Use a workflow containing at least one write block (e.g. a Slack message or table insert). Run the workflow with `--dry`, then hold on the terminal output showing `sideEffects.stubbed` entries with redacted request payloads and placeholder ids, readable at 390px width. Configure real credentials through the settings flow before capture; verify no real write occurs and sideEffects.stubbed appears in the output.

1. Terminal ready state: workflow directory open, `sim workflows run <id> --dry --input '{...}'` typed but not yet executed
2. Execute the dry run: press Enter, show the run completing with exit 0
3. Hold on the terminal output showing `sideEffects.stubbed` entries with redacted request payloads and placeholder ids, readable at 390px

Suggested alt text: Terminal showing a dry-run workflow completing with sideEffects.stubbed output listing a stubbed write with credentials redacted

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim dry runs let you execute a workflow with every write stubbed. Inspect the exact payloads, verify the logic, no cleanup needed. Reads and model calls run for real. Details: https://docs.sim.ai/cli/workflows

**Email**

Subject: Test your workflows without side effects

Sim dry runs execute a workflow with every write stubbed. Each table insert, HTTP call, or message returns a correctly shaped placeholder, and the result lists each stubbed call with the request it would have sent—credentials redacted—so you can verify payloads without creating test data to clean up.

Reads and model calls run for real. Child workflows inherit dry mode. Use --allow to send one block's writes for real, or --mock to steer a branch with fixed output.

CLI reference: https://docs.sim.ai/cli/workflows
API reference: https://docs.sim.ai/api-reference/build-and-run-workflows

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
