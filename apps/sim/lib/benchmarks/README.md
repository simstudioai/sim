# Organization benchmarks

Enable `MOTHERSHIP_BENCHMARK_ENABLED=true` on Sim and configure `COPILOT_DEV_URL` plus the normal Mothership service credentials. Apply the additive Sim and worker migrations before using the tab. Benchmark requests always use this dev endpoint; they never fall back to production or require superuser mode.

Enable `COPILOT_PLAN_MODE=true` on the dev worker. To evaluate graph memory, configure its `MEMORY_URL` and `MEMORY_API_KEY` and use the hosted provider path: the existing BYOK path disables memory. Each benchmark Plan run receives a fresh memory scope, so previous runs cannot supply its answers.

Configure the worker's `SIM_ENDPOINT` and service credentials for the same Sim deployment that starts the benchmark. Enterprise control requests use checkpoint transport, including on hosted Sim deployments; billing settlement still uses the worker's normal `SIM_ENDPOINT` callback.

Open **Benchmark** in an organization's sidebar. Cases belong to the signed-in user. Existing organization Copilot permissions and source-workspace read permissions apply on every request; the planning step also uses the existing organization Plan permission. Enterprise tools retain the same member and source access checks as ordinary Mothership.

1. Select a workspace. Generate the reference from its active workflow exports, or paste/import a reference produced by another client. Review the original task brief and reference.
2. Generate the blanks and review their expected answers. Only select facts discoverable from the permitted enterprise sources. Replacing `[[BLANK:id]]` with each exact answer must restore the reference byte for byte. Remove answer hints left elsewhere in the reference.
3. Run the planner. It receives the brief in a fresh organization Plan conversation, with enterprise search/document reads and isolated memory. It receives neither the completed workspace inventory nor the reference, masks, or expected answers. Its final response is the generated spec.
4. Reconstruct and grade separately. Reconstruction is a fresh tool-free execution with only the generated spec and redacted reference. Grading compares the recovered answers to the hidden targets and checks support in the generated spec. An exact supporting passage is required for credit. The score is correct details divided by the fixed number of blanks.

The UI groups these actions into Reference, Plan, Reconstruction, and Grade. Each output is saved independently. Editing upstream inputs clears dependent outputs. Regeneration replaces that stage's previous output; export the case JSON before rerunning if you want to retain a comparison. Create separate cases for separate experiments.

Reference specs can be prose or JSON text; **Import spec** accepts Markdown, text, and JSON files without reformatting their contents. **Generate blanks with AI** creates the redacted reference and expected answers together. **Edit JSON** also lets you paste or edit a mapping such as `{"queue":"Customer Escalations","handoff":"Engineering explicitly accepts the case"}` alongside the matching redacted reference. Keys are blank IDs and values are exact original passages as strings. Applying validates that the mapping restores the reference exactly and updates the draft; **Save changes** persists it.

Every stage is limited to ten minutes, with a twelve-minute persistence lease. Concurrent starts or stale completions cannot overwrite newer results. Interrupted steps are retryable; a hard server failure becomes retryable when its lease expires. This first version runs a stage within its HTTP request, so the deployment's request timeout must accommodate the run. Page reload may interrupt a pending request; saved completed stages remain available.

Automatic distillation supports at most 50 workflows and 500 KB of sanitized exports. Credentials/passwords are removed by the canonical workflow exporter. Larger projects can use an imported reference. Stateless generation has a 16,384-token output cap. The planner uses the dev worker's model configuration; keep worker/model configuration constant when comparing agent changes.

This version uses **live enterprise context**, not a frozen historical snapshot. The completed Sim workspace is excluded from planning, but historical solution documents in connected enterprise sources can still reveal answers. Treat these cases as retrospective evaluations and review source availability. The score measures recovery of the selected requirements, not execution correctness or every claim in the plan.

Validation includes real PostgreSQL ownership/organization/access-revocation checks and concurrent stage/lease fencing in `repository.integration.ts`; redaction integrity and dependency invalidation in `artifacts.test.ts`; reconstruction evidence and denominator checks in `evaluation.test.ts`; and executable tool isolation in the Mothership tool-executor tests. The worker tests cover fresh conversations, memory isolation, restricted tools, restart continuation, and tool-free execution.
