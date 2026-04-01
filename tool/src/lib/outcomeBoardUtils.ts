import type { OutcomeContribution } from '$lib/types';

export type TitleParts = { main: string; paren: string | null };

export function splitTitleWithTrailingParen(title: string): TitleParts {
	const trimmed = title.trimEnd();
	const match = trimmed.match(/^([\s\S]*?)\s*(\([^)]*\)[.,;:!?\s]*)$/);
	if (match && match[1].trim().length > 0) {
		return { main: match[1].trimEnd(), paren: match[2].trimEnd() };
	}
	return { main: title, paren: null };
}

export function getContributionBarRatio(
	contribution: OutcomeContribution | null,
	kind: 'overall' | 'role',
	role?: string
): { human: number; model: number } {
	if (!contribution) return { human: 0.5, model: 0.5 };
	if (kind === 'overall') {
		const human = contribution.speaker_contributions?.user?.total_influence ?? 0;
		const assistant = contribution.speaker_contributions?.assistant?.total_influence ?? 0;
		const total = human + assistant;
		if (total === 0) return { human: 0, model: 0 };
		return { human: human / total, model: assistant / total };
	}
	if (!role) return { human: 0.5, model: 0.5 };
	const roleHuman = contribution.role_contributions?.user?.[role]?.M_total ?? 0;
	const roleAssistant = contribution.role_contributions?.assistant?.[role]?.M_total ?? 0;
	const total = roleHuman + roleAssistant;
	if (total === 0) return { human: 0, model: 0 };
	return { human: roleHuman / total, model: roleAssistant / total };
}

export function getContributionRoleTotal(contribution: OutcomeContribution | null, role: string): number {
	if (!contribution || !role) return 0;
	const roleHuman = contribution.role_contributions?.user?.[role]?.M_total ?? 0;
	const roleAssistant = contribution.role_contributions?.assistant?.[role]?.M_total ?? 0;
	return roleHuman + roleAssistant;
}

export function getShaperFourWayRatio(
	contribution: OutcomeContribution | null
): { humanDirect: number; humanIndirect: number; modelDirect: number; modelIndirect: number; empty: boolean } {
	if (!contribution) return { humanDirect: 0, humanIndirect: 0, modelDirect: 0, modelIndirect: 0, empty: true };
	const userDirect = contribution.role_contributions?.user?.SHAPER?.M_dir ?? 0;
	const userIndirect = contribution.role_contributions?.user?.SHAPER?.M_ind ?? 0;
	const assistantDirect = contribution.role_contributions?.assistant?.SHAPER?.M_dir ?? 0;
	const assistantIndirect = contribution.role_contributions?.assistant?.SHAPER?.M_ind ?? 0;
	const total = userDirect + userIndirect + assistantDirect + assistantIndirect;
	if (total === 0) return { humanDirect: 0, humanIndirect: 0, modelDirect: 0, modelIndirect: 0, empty: true };
	return {
		humanDirect: userDirect / total,
		humanIndirect: userIndirect / total,
		modelDirect: assistantDirect / total,
		modelIndirect: assistantIndirect / total,
		empty: false
	};
}

export function buildOutcomeSummaryLine(
	contribution: OutcomeContribution | null,
	hideContribution: boolean
): string | null {
	if (!contribution || hideContribution) return null;
	const threshold = 0.55;
	const indirectThreshold = 0.6;
	const parts: string[] = [];

	function indirectRatio(direct: number, indirect: number): number {
		const total = direct + indirect;
		return total > 0 ? indirect / total : 0;
	}

	const shaperTotal = getContributionRoleTotal(contribution, 'SHAPER');
	if (shaperTotal > 0) {
		const shaperRatio = getContributionBarRatio(contribution, 'role', 'SHAPER');
		const userDirect = contribution.role_contributions?.user?.SHAPER?.M_dir ?? 0;
		const userIndirect = contribution.role_contributions?.user?.SHAPER?.M_ind ?? 0;
		const assistantDirect = contribution.role_contributions?.assistant?.SHAPER?.M_dir ?? 0;
		const assistantIndirect = contribution.role_contributions?.assistant?.SHAPER?.M_ind ?? 0;
		let phrase: string;
		if (shaperRatio.human >= threshold) {
			phrase = 'User mostly shaped the goal';
			if (assistantDirect + assistantIndirect > 0 && indirectRatio(assistantDirect, assistantIndirect) >= indirectThreshold) {
				phrase += ' (Assistant contributed a little but mostly indirectly)';
			}
		} else if (shaperRatio.model >= threshold) {
			phrase = 'Assistant mostly shaped the goal';
			if (userDirect + userIndirect > 0 && indirectRatio(userDirect, userIndirect) >= indirectThreshold) {
				phrase += ' (User contributed a little but mostly indirectly)';
			}
		} else {
			phrase = 'Both shaped similarly';
		}
		parts.push(phrase);
	}

	const executorTotal = getContributionRoleTotal(contribution, 'EXECUTOR');
	if (executorTotal > 0) {
		const executorRatio = getContributionBarRatio(contribution, 'role', 'EXECUTOR');
		const userDirect = contribution.role_contributions?.user?.EXECUTOR?.M_dir ?? 0;
		const userIndirect = contribution.role_contributions?.user?.EXECUTOR?.M_ind ?? 0;
		const assistantDirect = contribution.role_contributions?.assistant?.EXECUTOR?.M_dir ?? 0;
		const assistantIndirect = contribution.role_contributions?.assistant?.EXECUTOR?.M_ind ?? 0;
		let phrase: string;
		if (executorRatio.human >= threshold) {
			phrase = 'User mostly executed the goal';
			if (assistantDirect + assistantIndirect > 0 && indirectRatio(assistantDirect, assistantIndirect) >= indirectThreshold) {
				phrase += ' (Assistant contributed a little but mostly indirectly)';
			}
		} else if (executorRatio.model >= threshold) {
			phrase = 'Assistant mostly executed the goal';
			if (userDirect + userIndirect > 0 && indirectRatio(userDirect, userIndirect) >= indirectThreshold) {
				phrase += ' (User contributed a little but mostly indirectly)';
			}
		} else {
			phrase = 'Both executed similarly';
		}
		parts.push(phrase);
	}

	return parts.length > 0 ? parts.map((part) => part + '.').join('\n') : null;
}

export type RequirementStatusRow = {
	id: string;
	is_executed: boolean | null;
	is_dismissed: boolean | null;
	dismissed_at_turn: number | null;
};

export function summarizeRequirementStatuses(rows: RequirementStatusRow[]): {
	total: number;
	executed: number;
	pending: number;
	dismissed: number;
	unknown: number;
} {
	let executed = 0;
	let pending = 0;
	let dismissed = 0;
	let unknown = 0;
	for (const row of rows) {
		if (row.is_dismissed) {
			dismissed += 1;
			continue;
		}
		if (row.is_executed === true) executed += 1;
		else if (row.is_executed === false) pending += 1;
		else unknown += 1;
	}
	return { total: rows.length, executed, pending, dismissed, unknown };
}

export type RequirementStatusMap = Map<
	string,
	{ is_executed: boolean | null; is_dismissed: boolean | null; dismissed_at_turn: number | null }
>;

export function buildRequirementStatusIndex(rows: RequirementStatusRow[]): RequirementStatusMap {
	const map: RequirementStatusMap = new Map();
	for (const row of rows) {
		if (!row?.id) continue;
		map.set(row.id, row);
		if (/^r\d+/.test(row.id)) map.set(row.id.replace(/^r/, ''), row);
		if (/^\d+/.test(row.id)) map.set(`r${row.id}`, row);
	}
	return map;
}

export function getRequirementStatusKind(
	statusById: RequirementStatusMap,
	requirementId: string
): 'done' | 'pending' | 'dismissed' | 'unknown' {
	const status = statusById.get(requirementId);
	if (!status) return 'unknown';
	if (status.is_dismissed) return 'dismissed';
	if (status.is_executed === true) return 'done';
	if (status.is_executed === false) return 'pending';
	return 'unknown';
}

export function getRequirementStatusLabel(
	statusById: RequirementStatusMap,
	requirementId: string
): string {
	const kind = getRequirementStatusKind(statusById, requirementId);
	if (kind === 'done') return 'Implemented';
	if (kind === 'pending') return 'Pending';
	if (kind === 'dismissed') return 'Dismissed';
	return 'Unknown';
}

export type RequirementChainLike = {
	currentId: string;
	history: Array<{ id: string; text: string }>;
};

export function sortRequirementChainsByCreationTurn<T extends RequirementChainLike>(
	chains: T[],
	creationTurnById: Record<string, number>
): T[] {
	return [...chains].sort((a, b) => {
		const aTurn = creationTurnById[a.currentId] ?? Number.POSITIVE_INFINITY;
		const bTurn = creationTurnById[b.currentId] ?? Number.POSITIVE_INFINITY;
		return aTurn - bTurn;
	});
}

export function findSelectedRequirementStackIndex<T extends RequirementChainLike>(
	chains: T[],
	selectedRequirementId: string | null
): number | null {
	if (!selectedRequirementId) return null;
	const index = chains.findIndex(
		(chain) =>
			chain.currentId === selectedRequirementId ||
			chain.history.some((historyItem) => historyItem.id === selectedRequirementId)
	);
	return index >= 0 ? index : null;
}

export type RequirementTurnGroup<T extends RequirementChainLike> = {
	turn: number | null;
	chains: Array<{ chain: T; idx: number }>;
};

export function groupRequirementChainsByTurn<T extends RequirementChainLike>(
	chains: T[],
	creationTurnById: Record<string, number>
): RequirementTurnGroup<T>[] {
	const groups: RequirementTurnGroup<T>[] = [];
	const seenTurns = new Map<number | null, number>();
	for (let i = 0; i < chains.length; i++) {
		const chain = chains[i];
		const turn = creationTurnById[chain.currentId] ?? null;
		if (!seenTurns.has(turn)) {
			seenTurns.set(turn, groups.length);
			groups.push({ turn, chains: [] });
		}
		groups[seenTurns.get(turn)!].chains.push({ chain, idx: i });
	}
	groups.sort((a, b) => {
		const aTurn = a.turn ?? Number.POSITIVE_INFINITY;
		const bTurn = b.turn ?? Number.POSITIVE_INFINITY;
		return aTurn - bTurn;
	});
	return groups;
}

export type RequirementRoleRatios = {
	shaperUser: number;
	shaperAssistant: number;
	shaperTotal: number;
	shaperFourWay: { hd: number; hi: number; ad: number; ai: number };
	executorUser: number;
	executorAssistant: number;
	executorTotal: number;
	hasShaper: boolean;
	hasExecutor: boolean;
};

export type RequirementContributionValue = {
	user: number;
	assistant: number;
	userShaper: number;
	assistantShaper: number;
	userShaperDir?: number;
	userShaperInd?: number;
	assistantShaperDir?: number;
	assistantShaperInd?: number;
	userExecutor: number;
	assistantExecutor: number;
};

export function getRequirementRoleRatios(
	requirementContributionByReqId: Record<string, RequirementContributionValue>,
	requirementId: string
): RequirementRoleRatios | null {
	const contribution = requirementContributionByReqId[requirementId];
	if (!contribution) return null;
	const shaperTotal = contribution.userShaper + contribution.assistantShaper;
	const executorTotal = contribution.userExecutor + contribution.assistantExecutor;
	if (shaperTotal === 0 && executorTotal === 0) return null;

	const userDirect = contribution.userShaperDir ?? 0;
	const userIndirect = contribution.userShaperInd ?? 0;
	const assistantDirect = contribution.assistantShaperDir ?? 0;
	const assistantIndirect = contribution.assistantShaperInd ?? 0;
	const fourWayTotal = userDirect + userIndirect + assistantDirect + assistantIndirect;
	const shaperFourWay =
		fourWayTotal > 0
			? {
				hd: userDirect / fourWayTotal,
				hi: userIndirect / fourWayTotal,
				ad: assistantDirect / fourWayTotal,
				ai: assistantIndirect / fourWayTotal
			}
			: {
				hd: shaperTotal > 0 ? (contribution.userShaper / shaperTotal) * 0.5 : 0,
				hi: shaperTotal > 0 ? (contribution.userShaper / shaperTotal) * 0.5 : 0,
				ad: shaperTotal > 0 ? (contribution.assistantShaper / shaperTotal) * 0.5 : 0,
				ai: shaperTotal > 0 ? (contribution.assistantShaper / shaperTotal) * 0.5 : 0
			};

	return {
		shaperUser: shaperTotal > 0 ? contribution.userShaper / shaperTotal : 0,
		shaperAssistant: shaperTotal > 0 ? contribution.assistantShaper / shaperTotal : 0,
		shaperTotal,
		shaperFourWay,
		executorUser: executorTotal > 0 ? contribution.userExecutor / executorTotal : 0,
		executorAssistant: executorTotal > 0 ? contribution.assistantExecutor / executorTotal : 0,
		executorTotal,
		hasShaper: shaperTotal > 0,
		hasExecutor: executorTotal > 0
	};
}
