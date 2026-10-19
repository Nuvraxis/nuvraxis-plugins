# The three workflows

The template's workflows, byte for byte (`scripts/check-skills.mjs` fails CI if they drift). `__APP__` is replaced by the app name at scaffold time.

## pr.yaml

Four independent jobs so a failure points at one area. `quality` and `build` both need full history for `--affected`; `docker` and `helm` don't.

<!-- template: .github/workflows/pr.yaml -->
```yaml
# Checks every pull request, against any base branch. Publishes nothing.
name: PR

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  APP: __APP__
  HELM_VERSION: v4.3.1
  KUBECONFORM_IMAGE: ghcr.io/yannh/kubeconform:v0.8.0
  KUBERNETES_VERSION: 1.34.0
  NEXT_TELEMETRY_DISABLED: "1"
  TURBO_TELEMETRY_DISABLED: "1"

jobs:
  quality:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # --affected diffs against the base branch, so it needs history, not just one commit.
          fetch-depth: 0
          filter: blob:none
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec biome ci --reporter=github .
      - run: pnpm exec stylelint "**/*.scss" --allow-empty-input
      - run: pnpm exec turbo run typecheck test --affected
      - run: pnpm audit --audit-level high

  build:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          filter: blob:none
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec turbo run build --affected

  docker:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      # One platform, loaded into the local daemon so it can be run. main.yaml builds both.
      - uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          context: .
          file: apps/${{ env.APP }}/Dockerfile
          platforms: linux/amd64
          push: false
          load: true
          tags: ${{ env.APP }}:pr
          build-args: |
            NEXT_DEPLOYMENT_ID=${{ github.event.pull_request.head.sha }}
          # Reads the cache main.yaml writes; a PR never writes it.
          cache-from: type=gha,scope=${{ env.APP }}
      - name: Run the image and hit /api/health
        run: |
          docker run -d --name app -p 3000:3000 \
            --read-only --tmpfs "/app/apps/${APP}/.next/cache:uid=1001,gid=1001" \
            --cap-drop ALL --security-opt no-new-privileges \
            "${APP}:pr"
          for _ in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:3000/api/health; then exit 0; fi
            sleep 1
          done
          docker logs app
          exit 1

  helm:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310 # v5.0.1
        with:
          version: ${{ env.HELM_VERSION }}
      - name: helm lint
        run: |
          helm lint --strict "charts/${APP}"
          helm lint --strict "charts/${APP}" -f "charts/${APP}/values-production.yaml"
      - name: helm template | kubeconform
        run: |
          {
            helm template "${APP}" "charts/${APP}"
            echo "---"
            helm template "${APP}" "charts/${APP}" -f "charts/${APP}/values-production.yaml"
          } | docker run --rm -i "${KUBECONFORM_IMAGE}" \
                -strict -summary -kubernetes-version "${KUBERNETES_VERSION}" -
```

## main.yaml

One job. The image is built once per commit; every later step (release, deploy) reuses it by tag or digest.

<!-- template: .github/workflows/main.yaml -->
```yaml
# Builds the image once per commit on main and pushes it to GHCR as sha-<short-sha> and main.
# Never `latest`: that tag belongs to releases. The chart is published only by release.yaml.
name: Main

on:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # Let every commit on main finish: release.yaml retags the image of a specific commit.
  cancel-in-progress: false

env:
  APP: __APP__
  IMAGE: ghcr.io/nuvraxis/__APP__

jobs:
  image:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0
      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      - uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
        with:
          images: ${{ env.IMAGE }}
          tags: |
            type=sha,format=short,prefix=sha-
            type=raw,value=main
          flavor: |
            latest=false
      - id: build
        uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          context: .
          file: apps/${{ env.APP }}/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          annotations: ${{ steps.meta.outputs.annotations }}
          build-args: |
            NEXT_DEPLOYMENT_ID=${{ github.sha }}
          provenance: mode=max
          sbom: true
          cache-from: type=gha,scope=${{ env.APP }}
          cache-to: type=gha,mode=max,scope=${{ env.APP }}
      - name: Summary
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
          TAGS: ${{ steps.meta.outputs.tags }}
        run: |
          {
            echo "### Image pushed"
            echo
            echo "Digest: \`${IMAGE}@${DIGEST}\`"
            echo
            echo "Tags:"
            while read -r tag; do echo "- \`${tag}\`"; done <<< "${TAGS}"
          } >> "$GITHUB_STEP_SUMMARY"
```

## release.yaml

One job, strictly ordered: refuse bad tags, refuse missing images, retag, publish the chart, then the Release. If a later step fails after the retag, re-running the job is safe: `imagetools create` points the same tags at the same digest again, `helm push` overwrites the same chart version, and `gh release create` fails cleanly if the Release already exists (delete it and re-run).

<!-- template: .github/workflows/release.yaml -->
```yaml
# Releases a tag vX.Y.Z without rebuilding: retags the image main.yaml built for that commit,
# publishes the Helm chart to GHCR as OCI, and creates the GitHub Release.
#
# Ritual: merge to main → wait for main.yaml to go green → git tag vX.Y.Z && git push origin vX.Y.Z
name: Release

on:
  push:
    tags: ["v*.*.*"]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

env:
  APP: __APP__
  IMAGE: ghcr.io/nuvraxis/__APP__
  CHART_REPOSITORY: oci://ghcr.io/nuvraxis/charts
  HELM_VERSION: v4.3.1

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Check the tag is vX.Y.Z and on main
        run: |
          if [[ ! "${GITHUB_REF_NAME}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "::error::Tag ${GITHUB_REF_NAME} isn't vMAJOR.MINOR.PATCH."
            exit 1
          fi
          git fetch --no-tags origin main
          if ! git merge-base --is-ancestor "${GITHUB_SHA}" origin/main; then
            echo "::error::Tag ${GITHUB_REF_NAME} points at ${GITHUB_SHA}, which isn't on main. Tag a commit that has been merged to main."
            exit 1
          fi

      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      - uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Retag the image built by main.yaml
        run: |
          source_ref="${IMAGE}:sha-${GITHUB_SHA::7}"
          if ! docker buildx imagetools inspect "${source_ref}" > /dev/null 2>&1; then
            echo "::error::${source_ref} doesn't exist. Let main.yaml finish for ${GITHUB_SHA::7}, then re-run this workflow. Nothing is rebuilt here."
            exit 1
          fi
          # Manifest-level copy: keeps both architectures, the provenance and the SBOM.
          docker buildx imagetools create \
            --tag "${IMAGE}:${GITHUB_REF_NAME}" \
            --tag "${IMAGE}:latest" \
            "${source_ref}"
          mkdir -p dist
          digest="$(docker buildx imagetools inspect "${IMAGE}:${GITHUB_REF_NAME}" --format '{{ json .Manifest }}' | jq -r .digest)"
          echo "${IMAGE}@${digest}" > dist/image-digest.txt
          docker buildx imagetools inspect "${IMAGE}:${GITHUB_REF_NAME}" --format '{{ json .SBOM }}' > dist/sbom.spdx.json

      - uses: azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310 # v5.0.1
        with:
          version: ${{ env.HELM_VERSION }}

      - name: Package and push the chart
        env:
          REGISTRY_PASSWORD: ${{ secrets.GITHUB_TOKEN }}
        run: |
          version="${GITHUB_REF_NAME#v}"
          helm lint --strict "charts/${APP}"
          # Sets version and appVersion in the packaged chart; Chart.yaml in git stays 0.0.0.
          helm package "charts/${APP}" --version "${version}" --app-version "${GITHUB_REF_NAME}" --destination dist
          echo "${REGISTRY_PASSWORD}" | helm registry login ghcr.io --username "${GITHUB_ACTOR}" --password-stdin
          helm push "dist/${APP}-${version}.tgz" "${CHART_REPOSITORY}"

      - name: Create the GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --verify-tag \
            --generate-notes \
            --title "${GITHUB_REF_NAME}" \
            dist/*.tgz dist/image-digest.txt dist/sbom.spdx.json
```
