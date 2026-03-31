/**
 * Parse an outcome ID like "outcome_1", "outcome_1a", "outcome_10" into
 * a [numericPart, alphaSuffix] tuple for natural sorting.
 * "outcome_1"  → [1, ""]
 * "outcome_1a" → [1, "a"]
 * "outcome_10" → [10, ""]
 */
function parseOutcomeKey(outcomeId: string): [number, string] {
	const raw = outcomeId.replace('outcome_', '');
	const m = raw.match(/^(\d+)(.*)$/);
	if (!m) return [0, raw];
	return [parseInt(m[1], 10), m[2]];
}

/** Compare two outcome IDs naturally: outcome_1 < outcome_1a < outcome_1b < outcome_2 */
export function compareOutcomeIds(a: string, b: string): number {
	const [aNum, aSuffix] = parseOutcomeKey(a);
	const [bNum, bSuffix] = parseOutcomeKey(b);
	if (aNum !== bNum) return aNum - bNum;
	return aSuffix.localeCompare(bSuffix);
}

/** Extract a display-friendly sort key from an outcome ID. Returns a number
 *  that preserves natural ordering for use in places that need a numeric index.
 *  outcome_1 → 1.0, outcome_1a → 1.01, outcome_1b → 1.02, outcome_2 → 2.0 */
export function outcomeSortKey(outcomeId: string): number {
	const [num, suffix] = parseOutcomeKey(outcomeId);
	if (!suffix) return num;
	// Convert alpha suffix to a small fractional part: a=0.01, b=0.02, ...
	let frac = 0;
	for (let i = 0; i < suffix.length; i++) {
		frac = frac * 26 + (suffix.charCodeAt(i) - 96);
	}
	return num + frac * 0.01;
}

/** Extract a human-readable label from an outcome ID: outcome_1 → "1", outcome_1a → "1a" */
export function outcomeLabel(outcomeId: string): string {
	return outcomeId.replace('outcome_', '');
}

/**
 * Strip trailing parenthetical suffix from a string.
 * Handles optional punctuation/whitespace after the closing paren, e.g.:
 *   "Book a flight (round-trip, economy)"   → "Book a flight"
 *   "Book a flight (round-trip, economy)."  → "Book a flight"
 *   "Book a flight (round-trip, economy). " → "Book a flight"
 *   "Normal text without parens"            → "Normal text without parens"
 */
export function stripTrailingParen(text: string): string {
	const stripped = text.trimEnd().replace(/\s*\([^)]*\)[.,;:!?\s]*$/, '').trimEnd();
	return stripped.length > 0 ? stripped : text.trimEnd();
}

/** Escape for safe HTML. */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Bold the second word (e.g. "user requests" → "user **requests**" as HTML).
 * Returns HTML string safe for {@html}; use with @html in Svelte.
 */
export function boldSecondWord(text: string): string {
	if (!text || typeof text !== 'string') return '';
	const parts = text.trim().split(/\s+/);
	if (parts.length < 2) return escapeHtml(text);
	const escaped = parts.map((p) => escapeHtml(p));
	escaped[1] = '<strong>' + escaped[1] + '</strong>';
	return escaped.join(' ');
}
