import path from 'path';

/** Short names that live under `static/<name>/` in the repo (works locally + Vercel when files are committed). */
const BUNDLED_UNDER_STATIC = new Set(['wine3', 'user_study']);

/**
 * Resolve `VITE_DATA_BASE` to an absolute directory (same rules as vite dev middleware).
 */
export function resolveDataBasePath(dataBase: string): string {
	const trimmed = dataBase.trim();
	if (BUNDLED_UNDER_STATIC.has(trimmed)) {
		return path.join(process.cwd(), 'static', trimmed);
	}
	return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(process.cwd(), trimmed);
}
