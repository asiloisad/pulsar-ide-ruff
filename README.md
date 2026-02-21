# ide-ruff

Python linting for Pulsar, powered by [Ruff](https://docs.astral.sh/ruff/) LSP server.

## Features

- **Fast linting** — Real-time diagnostics as you type
- **Hover info** — Documentation for lint rules on hover over error codes
- **Project scan** — Lint entire project via command

## Installation

To install `ide-ruff` search for [ide-ruff](https://web.pulsar-edit.dev/packages/ide-ruff) in the Install pane of the Pulsar settings or run `ppm install ide-ruff`. Alternatively, you can run `ppm install asiloisad/pulsar-ide-ruff` to install a package directly from the GitHub repository.

## ruff

A package ruff is an extremely fast Python linter, written in Rust. Ruff can be used to replace Flake8 (plus dozens of plugins), isort, pydocstyle, yesqa, eradicate, pyupgrade, and autoflake, all while executing tens or hundreds of times faster than any individual tool.

For command line use, ruff is installed with `pip install ruff`.

Ruff supports over 800 lint [rules](https://docs.astral.sh/ruff/rules/), many of which are inspired by popular tools like Flake8, isort, pyupgrade, and others. Regardless of the rule's origin, Ruff re-implements every rule in Rust as a first-party feature.

Ruff can attempt to automatically fix lint violations. List of rule codes to treat as eligible & ineligible can be set in package setting or in configuration file.

## Commands

Commands available in `atom-workspace`:

- `ide-ruff:restart-server`: restart LSP server (apply config changes),
- `ide-ruff:lint-project`: scan entire project for lint issues,
- `ide-ruff:toggle-noqa`: toggle config of noqa setting,
- `ide-ruff:global-pyproject`: open ruff global config file.

## Configuration

Ruff reads configuration from `pyproject.toml` or `ruff.toml` in your project root.

**Example `pyproject.toml`:**
```toml
[tool.ruff]
line-length = 100
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "W", "I"]
ignore = ["E501"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

See [Ruff documentation](https://docs.astral.sh/ruff/configuration/) for all options.

## Settings

Settings override config file values. Leave empty/default to use config file. After changing settings, run `ide-ruff:restart-server` from the command palette to apply changes.

## Troubleshooting

Enable **Debug Mode** in settings and check the developer console (View > Developer > Toggle Developer Tools).

```
[ide-ruff] Project: /path/to/project
[ide-ruff] Ruff found: /usr/local/bin/ruff
[ide-ruff] InitializationOptions: { ... }
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback's welcome!
