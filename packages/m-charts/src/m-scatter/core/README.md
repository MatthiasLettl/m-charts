# Scatter Core Boundary

This subtree contains the framework-free scatter implementation pieces that are
intended to be reusable outside the demo app.

Keep this layer limited to scatter data contracts, typed buffers, domains,
layout, transforms, hit testing, selection and measurement math, aggregation,
formatting, and the WebGL2 renderer helpers used by `m-scatter`. The separate
`m-scatter-webgpu/core` renderer imports the shared scatter contract rather than
moving WebGPU-specific code into this subtree.

Do not import React, React Router, Vite route modules, environment setup, app
state, or demo-specific dataset fixtures here.
Route adapters can translate app-owned row or schema data into the package
contracts outside of `core`.

The same boundary should be used for future visualization types:
`packages/m-charts/src/<viz>/core` stays pure and copyable, while
`packages/m-charts/src/<viz>/engine` owns host lifecycle, commands, events,
updates, and bindings. See the root `README.md` architecture section for the
full custom plot mental model.
