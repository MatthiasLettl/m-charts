# Scatter Core Boundary

This subtree contains the framework-free scatter implementation pieces that are
intended to be reusable outside the demo app.

Keep this layer limited to scatter data contracts, typed buffers, domains,
layout, transforms, hit testing, selection and measurement math, aggregation,
formatting, and WebGL renderer helpers.

Do not import React, React Router, Vite route modules, environment setup, app
state, or demo-specific dataset fixtures here.
Route adapters can translate app-owned row or schema data into the package
contracts outside of `core`.

The same boundary should be used for future visualization types:
`packages/m-charts/src/<viz>/core` stays pure and copyable, while
`packages/m-charts/src/<viz>/engine` owns host lifecycle, commands, events,
updates, and bindings. See the root `README.md` architecture section for the
full custom plot mental model.
