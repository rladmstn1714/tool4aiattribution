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

## Deploy to Vercel

The project is configured to deploy on [Vercel](https://vercel.com) using [SvelteKit's Vercel adapter](https://vercel.com/docs/frameworks/full-stack/sveltekit).

1. **Install dependencies** (includes `@sveltejs/adapter-vercel`):

   ```sh
   npm install
   ```

2. **Deploy** via Vercel:

   - Push the repo to GitHub/GitLab/Bitbucket, then [import the project on Vercel](https://vercel.com/new).
   - Or use the [Vercel CLI](https://vercel.com/docs/cli): `npx vercel` in the project root.

3. **Environment variables** (Vercel project → Settings → Environment Variables):

   - **`VITE_DATA_BASE`**: short name of the folder under `static/` (e.g. `wine3` or `user_study`). This must match where you put the JSON files. For the same setup as `sh run.sh /path/to/user_study`, use `user_study` and put that folder’s contents in `static/user_study/` in the repo (or sync them in CI before `npm run build`).

4. **User study dataset on Vercel** (equivalent to `VITE_DATA_BASE=user_study` locally):

   - Copy the study output tree into the repo:

     ```sh
     mkdir -p static/user_study
     cp -r /path/to/results/user_study/* static/user_study/
     ```

   - Refresh the run list used when serverless cannot scan disk (commit the result):

     ```sh
     npm run write-user-study-runs
     ```

     This writes `src/lib/data/user_study-runs.json` from `static/user_study/`.

   - Set **`VITE_DATA_BASE=user_study`** on Vercel and deploy. The UI loads files from `/user_study/<run>/...`; `/api/runs` uses the filesystem when available and falls back to `user_study-runs.json` on Vercel.

5. **Size limits**: Vercel bundles `static/` into the deployment. Very large datasets may exceed [deployment limits](https://vercel.com/docs/limits); use a subset or an external host if needed.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
