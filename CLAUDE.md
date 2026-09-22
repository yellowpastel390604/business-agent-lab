# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The actual codebase — a Python package called **leviathan** — lives entirely under `leviathan/`, which is excluded by the root `.gitignore`. Nothing in `leviathan/` (source, config, venv) is tracked by git in this repo; only the repo root (currently near-empty) is. Work happens inside `leviathan/` regardless of its git-ignored status.

## Commands

Run from `leviathan/`:

- **Install (editable):** `.venv/bin/pip install -e .` — a `.venv` already exists with `anthropic` and `pyyaml` installed; this adds the `leviathan` console entry point.
- **Run without installing:** `.venv/bin/python -m leviathan "<goal>"` — works directly from `leviathan/` since the package is importable from the cwd.
- **Run if installed:** `leviathan "<goal>"`
- Requires `ANTHROPIC_API_KEY`. Either export it, or put `ANTHROPIC_API_KEY=...` in `leviathan/.env` (auto-loaded on startup by `leviathan/leviathan/dotenv.py`; it only fills in variables not already set in the environment).
- Optional flags: `--org-chart <path>` (default `leviathan/config/org_chart.yaml`), `--runs-dir <path>` (default `leviathan/runs/`).
- There is no test suite and no linter/type-checker configured in this project.

## Architecture

Leviathan runs a high-level goal through a fixed, config-driven pipeline of LLM "departments," gated by interactive human approval.

- **Org chart** (`leviathan/config/org_chart.yaml`): defines a `manager` and a set of `departments`, each with a `system_prompt` and `model`. Loaded into `Department`/`OrgChart` dataclasses by `org.py`.
- **Phase pipeline** (`orchestrator.py`): `Orchestrator.run()` walks the four core phases in order — `analysis → planning → execution → audit` — calling the corresponding department's LLM each time via `llm.complete()` (single-turn, no tools), passing the goal plus all prior phases' output as accumulated context.
- **Execution phase is different**: instead of a single completion, `run_execution()` drives a full Anthropic tool-use loop. The execution department gets two tools (`write_file`, `run_shell`, defined in `tools.py`), sandboxed to a per-run `workspace/` directory (`tools._resolve()` rejects any path that would escape it). Every individual tool call is printed and requires a `y/N` approval from the human before it runs.
- **Specialist departments**: any department in the org chart that isn't one of the four core phases (`org.CORE_PHASES`) is treated as a specialist and consulted after the main department in every remaining phase, given the context plus that phase's output.
- **Manager synthesis** (`manager.py`): after each phase, the Manager LLM is called to produce a structured `BoardReport` (JSON: `situation`, `findings`, `recommendation`, `ask`, `proposed_new_teams`), rendered to the console (`reports.py`). If the manager's response isn't valid JSON, a degraded fallback report wraps the raw text instead of failing the run.
- **Dynamic org growth**: if the manager's report proposes new specialist teams, the human is asked to approve each one individually. Approved teams are added via `OrgChart.add_department()`, which appends them to the in-memory chart **and rewrites `org_chart.yaml` on disk** — so new departments persist across future runs, not just the current one.
- **Phase gating**: after each non-final phase, the human is asked whether to proceed to the next phase; declining stops the run early.
- **Run state** (`state.py`): each invocation creates `leviathan/runs/<UTC-timestamp>-<slugified-goal>/`, containing `goal.json`, `<phase>_output.json`, `<phase>_report.json` per phase, and an append-only `log.txt`. The execution phase's sandboxed file writes land in that run's `workspace/` subdirectory.
