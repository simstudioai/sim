# Helm chart repository

This branch is **generated**. Do not commit to it by hand.

`index.yaml` is maintained by the `publish-http` job in
[`.github/workflows/helm.yml`](https://github.com/simstudioai/sim/blob/main/.github/workflows/helm.yml),
which runs [chart-releaser](https://github.com/helm/chart-releaser) on every push
to `main` that changes the chart. The packaged charts themselves are attached to
GitHub releases named `helm-chart-<version>`, and `index.yaml` points at those,
so this branch stays small.

`.nojekyll` disables GitHub Pages' Jekyll processing, which would otherwise
rewrite or drop files it does not recognise.

The chart is also published as a signed OCI artifact, which is the recommended
install path:

    helm install sim oci://ghcr.io/simstudioai/charts/sim --version <version>
