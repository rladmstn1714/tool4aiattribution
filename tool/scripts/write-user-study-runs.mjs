#!/usr/bin/env node
/**
 * Scan static/user_study (or a given folder) for run directories and write
 * src/lib/data/user_study-runs.json — used as /api/runs fallback on Vercel when
 * the serverless filesystem cannot read static/.
 *
 * Usage:
 *   node scripts/write-user-study-runs.mjs
 *   node scripts/write-user-study-runs.mjs /path/to/static/user_study [out.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const RUN_MARKERS = ['requirements_outputs_lists.json', 'requirement_output_dependency.json'];

function isRunDirectory(absDir) {
	for (const name of RUN_MARKERS) {
		if (fs.existsSync(path.join(absDir, name))) return true;
		if (fs.existsSync(path.join(absDir, 'run', name))) return true;
	}
	return false;
}

function collectRunsUnderRoot(rootAbs, relative = '') {
	const found = [];
	let entries;
	try {
		entries = fs.readdirSync(rootAbs, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith('.')) continue;
		const childAbs = path.join(rootAbs, e.name);
		const relPath = relative ? `${relative}/${e.name}` : e.name;
		if (isRunDirectory(childAbs)) {
			found.push(relPath);
		} else {
			found.push(...collectRunsUnderRoot(childAbs, relPath));
		}
	}
	return found;
}

const scanRoot = path.resolve(process.argv[2] ?? path.join(rootDir, 'static', 'user_study'));
const outFile = path.resolve(process.argv[3] ?? path.join(rootDir, 'src', 'lib', 'data', 'user_study-runs.json'));

if (!fs.existsSync(scanRoot)) {
	console.error(`Folder not found: ${scanRoot}`);
	console.error('Copy your dataset to static/user_study first, e.g.:');
	console.error('  mkdir -p static/user_study && cp -r /path/to/user_study/* static/user_study/');
	process.exit(1);
}

const runs = [...new Set(collectRunsUnderRoot(scanRoot))].sort((a, b) => a.localeCompare(b));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(runs, null, '\t')}\n`);
console.log(`Wrote ${runs.length} run(s) to ${outFile}`);
