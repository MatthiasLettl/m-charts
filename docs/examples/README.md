# Source-Copy Examples

These examples are small TypeScript snippets for hosts that copied the required
`packages/m-charts/src` slices into their own app. They intentionally avoid npm
package imports and demo app imports.

Assumed host layout:

```text
src/vendor/m-charts/plot-engine
src/vendor/m-charts/plot-engine-webgpu
src/vendor/m-charts/m-scatter/core
src/vendor/m-charts/m-scatter/engine
src/vendor/m-charts/m-scatter-webgpu/core
src/vendor/m-charts/m-scatter-webgpu/engine
src/vendor/m-charts/m-histogram/core
src/vendor/m-charts/m-histogram/engine
src/vendor/m-charts/m-parallel/core
src/vendor/m-charts/m-parallel/engine
```

Each example imports from `./vendor/m-charts/...` as a placeholder. Rewrite the
relative prefix to match the file location in your app after copying.
Copy chart `adapters`, scatter `workers`, or chart `react` folders only when
the host uses those optional helpers.

Examples:

- [Scatter WebGL2](scatter-source-copy.md)
- [Migrate scatter from WebGL2 to WebGPU](scatter-webgpu-migration.md)
- [Histogram](histogram-source-copy.md)
- [Parallel coordinates](parallel-source-copy.md)

## Validation

These are documentation snippets, not an executable app in this repository, and
the fenced TypeScript blocks are not compiled by the repository TypeScript
project. They are kept small enough to paste into a host app after import-path
rewrites.

Repository validation checks the surrounding project and docs hygiene:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

After copying into a host app, validate there too:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

Then verify in browsers that support each selected backend. The host element
must have nonzero size, the chart must render, interactions must work, and
cleanup must dispose subscriptions, bindings, plots, and any externally created
worker controllers. For WebGPU, also verify a secure context, asynchronous
startup, representative device limits, and the host's WebGL2 fallback policy.
