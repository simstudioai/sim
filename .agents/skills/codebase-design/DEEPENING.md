# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**.

## Dependency categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface directly. No adapter needed.

### 2. Local-substitutable

Dependencies you can run for real in a test: Postgres, Redis, the filesystem. Deepenable. The seam is internal; no port at the module's external interface. Verify the deepened module against the real dependency (a `*.integration.ts` suite on real Postgres/Redis) or end to end, never against a hand-built stand-in.

### 3. Remote but owned (Ports & Adapters)

Your own services across a network boundary (microservices, internal APIs). Define a **port** (interface) at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Production uses an HTTP/gRPC/queue adapter. Prove the module end to end over the real transport (`apps/sim/scripts/test-*-e2e.ts`) rather than through an in-memory adapter written only for tests.

Recommendation shape: *"Define a port at the seam and implement the production adapter there, so the logic sits in one deep module even though it's deployed across a network."*

### 4. True external (Mock)

Third-party services (Stripe, Twilio, etc.) you don't control. The deepened module takes the external dependency as an injected port. Where an isolated test is unavoidable, use the shared mocks in `@sim/testing` and `apps/sim/vitest.setup.ts` rather than hand-rolling one.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified. A single-adapter seam is just indirection.
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them.

## Testing strategy: replace, don't layer

Testing follows the repo's rules in `CLAUDE.md` ("Testing") and the `test-audit` skill; this section only says how they apply to deepening.

- Old unit tests on shallow modules become waste once the deepened module exists; delete them. Deleting a test that only restated a pass-through is a win, not lost coverage.
- Don't write new unit tests at the deepened interface after the fact. Prove the change through the real boundary: a `*.integration.ts` suite on real Postgres/Redis, or an end-to-end run.
- Whatever tests remain assert on observable outcomes through the interface, not internal state. If a test has to change when the implementation changes, it's testing past the interface.
