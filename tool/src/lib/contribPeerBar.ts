/**
 * Requirement contribution bar: for Slack-style data, split mass between the two
 * teammates with distinct colors, excluding "Eunsu" (facilitator) from that pair.
 */

export type ContribBarDisplay =
	| { mode: 'peers'; leftPct: number; leftName: string; rightName: string; hasData: true }
	| { mode: 'legacy'; userPct: number; hasData: boolean };

export function isEunsuSpeakerName(name: string): boolean {
	return name.trim().toLowerCase() === 'eunsu';
}

function sumMassesFromRoleContributions(
	rc: Record<string, Record<string, { M_total?: number }>> | undefined
): Map<string, number> {
	const masses = new Map<string, number>();
	if (!rc || typeof rc !== 'object') return masses;
	for (const [sp, roles] of Object.entries(rc)) {
		if (!roles || typeof roles !== 'object') continue;
		let t = 0;
		for (const d of Object.values(roles)) {
			t += Number((d as { M_total?: number })?.M_total ?? 0);
		}
		if (t > 1e-9) masses.set(sp, t);
	}
	return masses;
}

/** Build bar view from one requirement_contributions.json entry. */
export function buildContribBarFromRequirementContributionEntry(entry: unknown): ContribBarDisplay {
	const e = entry as {
		overall?: { user?: { rate?: number }; assistant?: { rate?: number } };
		role_contributions?: Record<string, Record<string, { M_total?: number }>>;
	} | null;
	if (!e) return { mode: 'legacy', userPct: 50, hasData: false };

	const userRate = Number(e.overall?.user?.rate ?? 0);
	const assistantRate = Number(e.overall?.assistant?.rate ?? 0);
	const legacyTotal = userRate + assistantRate;

	const masses = sumMassesFromRoleContributions(e.role_contributions);
	const hasNamedSpeakers = [...masses.keys()].some((k) => k !== 'user' && k !== 'assistant');

	if (hasNamedSpeakers && masses.size > 0) {
		const namedPeers = [...masses.entries()]
			.filter(([name]) => !isEunsuSpeakerName(name))
			.filter(([name]) => name !== 'user' && name !== 'assistant')
			.sort((a, b) => b[1] - a[1]);

		if (namedPeers.length >= 2) {
			const [a, b] = namedPeers;
			const denom = a[1] + b[1];
			const leftPct = denom > 0 ? (a[1] / denom) * 100 : 50;
			return {
				mode: 'peers',
				leftPct,
				leftName: a[0],
				rightName: b[0],
				hasData: true
			};
		}
		if (namedPeers.length === 1) {
			return {
				mode: 'peers',
				leftPct: 100,
				leftName: namedPeers[0][0],
				rightName: '',
				hasData: true
			};
		}
	}

	if (legacyTotal > 1e-9) {
		return {
			mode: 'legacy',
			userPct: (userRate / legacyTotal) * 100,
			hasData: true
		};
	}

	return { mode: 'legacy', userPct: 50, hasData: false };
}
