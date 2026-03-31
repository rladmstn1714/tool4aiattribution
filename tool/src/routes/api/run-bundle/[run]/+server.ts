import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs';
import path from 'path';
import { resolveDataBasePath } from '$lib/server/resolveDataBasePath';

function readFile(paths: string[]): Promise<{ data: unknown; ext: string } | null> {
	return new Promise((resolve) => {
		const tryNext = (i: number) => {
			if (i >= paths.length) {
				resolve(null);
				return;
			}
			fs.readFile(paths[i], 'utf-8', (err, raw) => {
				if (err) {
					tryNext(i + 1);
					return;
				}
				const ext = path.extname(paths[i]);
				try {
					const data = ext === '.jsonl'
						? raw.trim().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
						: JSON.parse(raw);
					resolve({ data, ext });
				} catch {
					tryNext(i + 1);
				}
			});
		};
		tryNext(0);
	});
}

/** Read one file from run dir: try {run}/{name}, then {run}/run/{name}. */
function readRunFile(
	rootDir: string,
	run: string,
	name: string
): Promise<{ data: unknown; ext: string } | null> {
	const paths = [
		path.join(rootDir, run, name),
		path.join(rootDir, run, 'run', name)
	];
	return readFile(paths);
}

const FILES = [
	'requirement_output_dependency.json',
	'requirements_outputs_lists.json',
	'output_contributions.json',
	'requirement_relations.jsonl',
	'requirement_action_map.json',
	'action_utterance_map.json',
	'utterance_list.json',
	'requirement_contributions.json',
	'outcome_action_map.json',
	'intent_outcome_map.json'
] as const;

/** In-memory cache: first load hits NAS, later loads (same run or switch back) are instant. */
const BUNDLE_CACHE_MAX = 10;
const bundleCache = new Map<string, Record<string, unknown>>();

export const GET: RequestHandler = async ({ params }) => {
	const run = params.run?.trim();
	const dataBase = (typeof process !== 'undefined' && process.env?.VITE_DATA_BASE?.trim()) ?? '';
	if (!run || !dataBase) {
		return new Response(null, { status: 404 });
	}
	// Allow "parent/child" run names (e.g. wine2_revised_prompt_gpt52-3/jessie); only reject path traversal
	if (run.includes('..') || run.includes('\\')) {
		return new Response(null, { status: 400 });
	}
	// Cache key = run (same run from same dataBase reuses cache)
	const cacheKey = run;
	const cached = bundleCache.get(cacheKey);
	if (cached) {
		const res = json(cached);
		res.headers.set('X-Run-Bundle-Root', path.basename(resolveDataBasePath(dataBase)));
		res.headers.set('X-Run-Bundle-Run', run);
		res.headers.set('X-Run-Bundle-Cache', 'hit');
		return res;
	}
	const rootDir = resolveDataBasePath(dataBase);
	const results = await Promise.all(
		FILES.map((name) => readRunFile(rootDir, run, name).then((r) => ({ name, result: r })))
	);
	const bundle: Record<string, unknown> = {};
	const missing: string[] = [];
	for (const { name, result } of results) {
		if (result) {
			bundle[name] = result.data;
		} else {
			missing.push(name);
		}
	}
	// Need at least tree inputs to be useful
	const needTree = 'requirement_output_dependency.json';
	const needLists = 'requirements_outputs_lists.json';
	if (!bundle[needTree] || !bundle[needLists]) {
		const msg = JSON.stringify({
			run,
			rootDirLastSegment: path.basename(rootDir),
			missingRequired: [needTree, needLists].filter((f) => !bundle[f]),
			allMissing: missing
		});
		return new Response(msg, {
			status: 404,
			headers: {
				'Content-Type': 'application/json',
				'X-Run-Bundle-Run': run,
				'X-Run-Bundle-Root': path.basename(rootDir)
			}
		});
	}
	// Cache so next time this run is requested we skip NAS
	if (bundleCache.size >= BUNDLE_CACHE_MAX) {
		const firstKey = bundleCache.keys().next().value;
		if (firstKey !== undefined) bundleCache.delete(firstKey);
	}
	bundleCache.set(cacheKey, bundle);
	const res = json(bundle);
	res.headers.set('X-Run-Bundle-Root', path.basename(rootDir));
	res.headers.set('X-Run-Bundle-Run', run);
	res.headers.set('X-Run-Bundle-Cache', 'miss');
	return res;
};
