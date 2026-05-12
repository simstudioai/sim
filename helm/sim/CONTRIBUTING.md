# Contributing to the Sim Helm chart

Thanks for improving the chart. This page covers how to run the checks that CI
runs on every PR, so you can catch regressions locally before pushing.

## Prerequisites

- [Helm](https://helm.sh/docs/intro/install/) v3.16+
- The [`helm-unittest`](https://github.com/helm-unittest/helm-unittest) plugin:

  ```bash
  helm plugin install https://github.com/helm-unittest/helm-unittest --version v0.7.2
  ```

- (Optional, for schema validation) [kubeconform](https://github.com/yannh/kubeconform)

## What CI runs

The `Helm Chart` workflow (`.github/workflows/helm-chart.yml`) runs four gates:

1. **`helm lint --strict`** — catches template syntax errors and chart-metadata problems.
2. **`helm unittest`** — runs every YAML suite in `helm/sim/tests/`.
3. **`helm template`** against every file in `helm/sim/ci/` — proves the chart
   actually renders under each supported install mode.
4. **`kubeconform`** on the rendered output — validates every manifest against
   Kubernetes API schemas (`-kubernetes-version 1.30.0`, `-strict`,
   `-ignore-missing-schemas` so CRDs from optional dependencies don't fail).

## Running the same checks locally

```bash
cd helm/sim
helm dependency build
helm lint . --strict
helm unittest .
for f in ci/*.yaml; do
  helm template t . -f "$f" > /dev/null
done
```

If you have kubeconform installed:

```bash
for f in ci/*.yaml; do
  helm template t . -f "$f" | kubeconform -strict -ignore-missing-schemas \
    -kubernetes-version 1.30.0 -summary
done
```

## Adding a unit test

Tests live in `helm/sim/tests/` and use the
[helm-unittest DSL](https://github.com/helm-unittest/helm-unittest/blob/main/DOCUMENT.md).
Each file is one suite. A test sets values, renders a template, and asserts on
the rendered manifest:

```yaml
suite: my feature
release:
  name: t
  namespace: sim
tests:
  - it: renders the thing
    template: deployment-app.yaml
    set:
      app.env.BETTER_AUTH_SECRET: x
      app.env.ENCRYPTION_KEY: x
      app.env.INTERNAL_API_SECRET: x
      app.env.CRON_SECRET: x
      postgresql.auth.password: x
      myFeature.enabled: true
    asserts:
      - contains:
          path: spec.template.spec.containers[0].env
          content: { name: MY_FEATURE_FLAG, value: "true" }
```

Use the existing suites as references:

- `tests/smoke_test.yaml` — minimal render checks
- `tests/validators_test.yaml` — `failedTemplate` assertions for required-value gates
- `tests/secret-modes_test.yaml` — inline / existingSecret / ESO routing
- `tests/env-defaults_test.yaml` — `envDefaults` secret-mode-aware inlining
- `tests/chart-computed-env_test.yaml` — chart-computed env keys cannot be overridden
- `tests/networkpolicy_test.yaml` — NetworkPolicy ingress/egress shape
- `tests/pdb-hpa_test.yaml` — PDB tri-state + HPA conditional rendering

When you fix a template bug, please add a regression test for it.

## Adding a ci/*.yaml render fixture

`helm/sim/ci/*.yaml` files are minimal values overlays that CI renders end-to-end
plus validates with kubeconform. Add one when you introduce a new install mode
(new secret backend, new database backend, new deployment topology). Keep them
small — they should test that the mode *renders*, not exercise every option;
detailed behavior belongs in unit tests.

## Updating `Chart.yaml`

- Bump `version` (the chart version) on every user-visible change.
- Bump `appVersion` when targeting a new Sim release.
- Follow SemVer: breaking values changes → major bump, additive → minor, fix → patch.

## Touching `values.schema.json`

The chart ships a JSON Schema that validates user-supplied values. If you add a
new top-level value or change a type, update the schema in the same PR.
