# dsh-toolbox-client

Human-visible DeepSeek Harness entry for DSH Toolbox.

The package declares `dsh.client` and exports `./client`, a browser bundle that
registers a `sidebar.panellist` entry with id `toolbox` and the matching `main`
keyed panel. Selecting the sidebar row opens the original desktop toolbox window
through the Host adapter; it sends no model request and registers no model tool.

The Host half re-exports `dsh-toolbox/human-entry`, which registers the
`/toolbox-human` generic Connection RPC channel and consumes the proposed
`toolboxDesktop` service supplied by the integration layer.

Install through the Harness Plugins UI or `dsh plugin --profile desktop add
<package-spec>`. The package is private/local until Codex integrates and
validates it in a real desktop profile.
