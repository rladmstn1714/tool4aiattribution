import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

const dataBase = process.env.VITE_DATA_BASE?.trim() ?? '';

/** Resolve VITE_DATA_BASE to an absolute path. Short names → static/<name>/ (bundled for Vercel). */
const resolvedDataBase = dataBase
	? dataBase === 'wine3' || dataBase === 'user_study'
		? path.resolve(process.cwd(), 'static', dataBase)
		: path.isAbsolute(dataBase)
			? path.resolve(dataBase)
			: path.resolve(process.cwd(), dataBase)
	: '';

/** URL prefix the client uses for data requests (must match dataLoader BASE). */
const baseUrlPrefix = dataBase ? '/' + dataBase.replace(/^\/+/, '').replace(/\\/g, '/') : '';

const FILE_CACHE_MAX = 80; // cache up to 80 files (e.g. 9 per run) to speed up NAS / repeated run switch
const fileCache = new Map<string, { data: Buffer; ext: string }>();

function getCached(filePath: string): { data: Buffer; ext: string } | undefined {
	return fileCache.get(path.normalize(filePath));
}
function setCache(filePath: string, data: Buffer, ext: string) {
	const key = path.normalize(filePath);
	fileCache.set(key, { data, ext });
	if (fileCache.size > FILE_CACHE_MAX) {
		const first = fileCache.keys().next().value;
		if (first !== undefined) fileCache.delete(first);
	}
}

/** Serve JSON/jsonl from VITE_DATA_BASE (absolute or relative to cwd). Uses in-memory cache to avoid repeated slow reads (e.g. on NAS). */
function dataDirPlugin() {
	return {
		name: 'serve-data-dir',
		configureServer(server: import('vite').ViteDevServer) {
			if (!dataBase || !resolvedDataBase) return;
			server.middlewares.use((req, res, next) => {
				const urlPath = decodeURIComponent(req.url?.split('?')[0] ?? '');
				if (!urlPath.startsWith(baseUrlPrefix)) return next();
				const relativePath = urlPath.slice(baseUrlPrefix.length).replace(/^\//, '');
				const filePath = path.join(resolvedDataBase, relativePath);
				if (!filePath.startsWith(resolvedDataBase)) return next();
				const ext = path.extname(filePath);
				function serve(data: Buffer) {
					res.setHeader('Content-Type', ext === '.jsonl' ? 'application/x-ndjson' : 'application/json');
					res.end(data);
				}
				const cached = getCached(filePath);
				if (cached) {
					serve(cached.data);
					return;
				}
				fs.readFile(filePath, (err, data) => {
					if (err) {
						// wine2 layout: try {run}/run/{filename} (e.g. .../chenyang_simple/run/utterance_list.json)
						const dir = path.dirname(filePath);
						const name = path.basename(filePath);
						const fallbackPath = path.join(dir, 'run', name);
						const fallbackCached = getCached(fallbackPath);
						if (fallbackCached) {
							serve(fallbackCached.data);
							return;
						}
						fs.readFile(fallbackPath, (err2, data2) => {
							if (err2) return next();
							setCache(fallbackPath, data2!, path.extname(fallbackPath));
							serve(data2!);
						});
						return;
					}
					setCache(filePath, data, ext);
					serve(data);
				});
			});
		}
	};
}

export default defineConfig({
	plugins: [dataDirPlugin(), sveltekit()]
});
