import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs';
import path from 'path';
import { resolveDataBasePath } from '$lib/server/resolveDataBasePath';

/** Serve requirement_contributions.json from the same data folder as /api/runs (server-side VITE_DATA_BASE). Run may be "parent/child" (e.g. wine2_revised_prompt_gpt52-3/jessie). */

export const GET: RequestHandler = async ({ params }) => {
	const run = params.run?.trim();
	const dataBase = (typeof process !== 'undefined' && process.env?.VITE_DATA_BASE?.trim()) ?? '';
	if (!run || !dataBase) {
		return new Response(null, { status: 404 });
	}
	// Prevent path traversal; allow "parent/child" run names
	if (run.includes('..') || run.includes('\\')) {
		return new Response(null, { status: 400 });
	}
	const rootDir = resolveDataBasePath(dataBase);
	// wine: {run}/requirement_contributions.json; wine2: {run}/run/requirement_contributions.json
	const paths = [
		path.join(rootDir, run, 'requirement_contributions.json'),
		path.join(rootDir, run, 'run', 'requirement_contributions.json')
	];
	for (const filePath of paths) {
		try {
			const raw = fs.readFileSync(filePath, 'utf-8');
			const data = JSON.parse(raw) as Record<string, unknown>;
			return json(data);
		} catch {
			/* try next path */
		}
	}
	return new Response(null, { status: 404 });
};
