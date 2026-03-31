# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                        # Start dev server
npm run dev -- --open              # Dev server + open browser
npm run build                      # Production build
npm run preview                    # Preview production build
npm run check                      # Type-check with svelte-check
npm run check:watch                # Watch mode type-checking
```

### Using a custom dataset

```sh
VITE_DATA_BASE=your_folder_name npm run dev   # Point to data in static/<folder>
VITE_DATA_BASE=/absolute/path npm run dev     # Or an absolute path outside static/
```

If `VITE_DATA_BASE` is unset, defaults to `static/wine3/`.

## Architecture

**SvelteKit + TypeScript + D3** application for visualizing dialogue-driven requirement evolution. Loads JSON/JSONL datasets, builds requirement graphs, and links dialogue utterances to outcomes.

### Data Flow

1. `/api/runs` endpoint lists run subfolders from `VITE_DATA_BASE`
2. User selects a run → `dataLoader.ts` fetches all JSON/JSONL files for that run
3. `graphBuilder.ts` constructs a DAG of requirement operations
4. Components render the outcomes, graphs, and chat log

### Key directories

- `src/routes/` — SvelteKit pages and API endpoints
  - `+page.svelte` — Main dashboard (run selection, outcome board)
  - `outcome/[outcomeId]/+page.svelte` — Outcome detail view
  - `api/runs/`, `api/run-bundle/[run]/`, `api/requirement_contributions/[run]/` — Data API routes
- `src/lib/components/` — All Svelte UI components
- `src/lib/data/dataLoader.ts` — Fetches and normalizes all run data
- `src/lib/data/graphBuilder.ts` — Builds requirement dependency graphs from `requirement_relations.jsonl`
- `src/lib/types/index.ts` — All TypeScript interfaces (`OutcomeNode`, `RequirementRow`, `GraphNode`, etc.)
- `static/wine3/` — Default bundled dataset (subfolders = runs)

### Data model

Each run folder contains these files:
- `utterance_list.json` — Full dialogue transcript
- `requirements_outputs_lists.json` — Requirement and output content
- `requirement_relations.jsonl` — Requirement operations: ADD / MODIFY / DELETE / MERGE / SPLIT
- `requirement_output_dependency.json` — Maps outcomes to requirements
- `action_utterance_map.json` — Links actions to utterances
- `output_contributions.json` — User vs. assistant contribution metrics

### Vite plugin

`vite.config.ts` includes a custom `dataDirPlugin` that:
- Serves JSON/JSONL from `VITE_DATA_BASE` at runtime (dev) and build time
- Caches files in memory (LRU, max 80) for NAS performance
- Supports both flat (`wine3` layout) and nested (`/run/` subdir) folder structures

### Deployment

Configured for Vercel via `@sveltejs/adapter-auto`. For Vercel production, the bundled `static/wine3/` data is used; `src/lib/data/wine3-runs.json` provides the run list fallback when the filesystem is unavailable.
