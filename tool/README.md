# Chatvis2 — Requirement evolution visualization

Visualizes requirement evolution from dialogue: outcome boards, requirement graphs, and related utterances. Data is loaded from `static/wine3/` by default (run subfolders: chenyang, jessie, vijay_1, etc.).

## Using another dataset

1. Put your data under `static/<folder>/` with the same file names and structure as `static/wine3/<run>/` (e.g. `utterance_list.json`, `requirement_action_map.json`, `requirement_output_dependency.json`, `requirements_outputs_lists.json`, `requirement_relations.jsonl`, `action_utterance_map.json`, `output_contributions.json`; see `static/wine3/` for the full set).

2. Run the app with that folder as the data base:

   ```sh
   VITE_DATA_BASE=your_folder_name npm run dev
   ```

   **High-level folder (multiple runs):** If you point `VITE_DATA_BASE` to a folder that contains *subfolders* (e.g. `results/wine/` with `xinran`, `chenyang_simple`, etc.), the app will list them in a **Run** dropdown. Choose a run to load that dataset.

   **Single run:** If your data is in one folder (e.g. `results/wine/xinran/`), set `VITE_DATA_BASE` to that folder; no dropdown is shown.

   Or for production build:

   ```sh
   VITE_DATA_BASE=your_folder_name npm run build
   npm run preview
   ```

   If you don’t set `VITE_DATA_BASE`, the app uses `wine3` (static/wine3) so the Run dropdown lists bundled runs.

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv create --template minimal --types ts --install npm chatvis2
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.
