import type { RequirementActionMap } from '$lib/data/dataLoader';

export type TurnActionAnnotation = {
	actionId: string;
	relationType: string;
	direct: boolean;
	evidence_quote?: string;
	action_text?: string;
	reason?: string;
	role?: string;
	actionVerb?: string;
};

export type GroupedTurnActionAnnotation = {
	relationType: string;
	direct: boolean;
	role?: string;
	actionVerb?: string;
	items: TurnActionAnnotation[];
};

export function getTurnIdFromActionId(actionId: string): number {
	const parts = actionId.split('-');
	return Number.parseInt(parts[0], 10) || 0;
}

export function getOriginTurnFromEntry(entry: Record<string, unknown>): number | null {
	const origin = Array.isArray(entry?.origin_actions)
		? (entry.origin_actions as { action_id: string }[])
		: [];
	const turns = origin
		.map((action) => getTurnIdFromActionId(action.action_id))
		.filter((turn) => Number.isFinite(turn));
	return turns.length > 0 ? Math.min(...turns) : null;
}

export function getRequirementEntryById(
	requirementActionMap: RequirementActionMap,
	requirementId: string | null | undefined
): Record<string, unknown> | undefined {
	if (!requirementId) return undefined;
	return (
		requirementActionMap[requirementId] ??
		requirementActionMap[requirementId.replace(/^r/, '')] ??
		requirementActionMap[/^r/.test(requirementId) ? requirementId : `r${requirementId}`]
	);
}

export function filteredImplementationActions<T extends { action_id: string }>(
	entry: Record<string, unknown>
): T[] {
	const implementation = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
		? (entry as { implementation_actions: T[] }).implementation_actions
		: [];
	const origin = Array.isArray((entry as { origin_actions?: unknown[] }).origin_actions)
		? (entry as { origin_actions: { action_id: string }[] }).origin_actions
		: [];
	if (origin.length === 0 || implementation.length === 0) return implementation;
	const minOriginTurn = Math.min(...origin.map((action) => getTurnIdFromActionId(action.action_id)));
	return implementation.filter((action) => getTurnIdFromActionId(action.action_id) >= minOriginTurn);
}

export function collectActionIds(
	entry: Record<string, unknown>,
	maxTurn: number | null,
	cb: (actionId: string) => void
) {
	const origin = Array.isArray(entry?.origin_actions) ? entry.origin_actions : [];
	for (const action of origin) {
		if (maxTurn == null || getTurnIdFromActionId((action as { action_id: string }).action_id) <= maxTurn) {
			cb((action as { action_id: string }).action_id);
		}
	}
	const contributing = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
		? (entry as { contributing_actions: { action_id: string }[] }).contributing_actions
		: [];
	for (const action of contributing) {
		if (maxTurn == null || getTurnIdFromActionId(action.action_id) <= maxTurn) cb(action.action_id);
	}
	const implementation = filteredImplementationActions<{ action_id: string }>(entry);
	for (const action of implementation) {
		if (maxTurn == null || getTurnIdFromActionId(action.action_id) <= maxTurn) cb(action.action_id);
	}
	const related = Array.isArray(entry?.related_actions) ? entry.related_actions : [];
	const originTurn = getOriginTurnFromEntry(entry);
	for (const action of related) {
		if (action && typeof action === 'object' && 'action_id' in action) {
			const actionId = (action as { action_id: string }).action_id;
			if (
				originTurn != null &&
				(action as { influence?: string }).influence === 'indirect' &&
				getTurnIdFromActionId(actionId) > originTurn
			) {
				continue;
			}
			if (maxTurn == null || getTurnIdFromActionId(actionId) <= maxTurn) cb(actionId);
		}
	}
}

export function collectActionIdsWithDirect(
	entry: Record<string, unknown>,
	maxTurn: number | null,
	cb: (actionId: string, direct: boolean) => void
) {
	const add = (list: { action_id: string }[] | undefined, direct: boolean) => {
		if (!Array.isArray(list)) return;
		for (const action of list) {
			if (maxTurn == null || getTurnIdFromActionId(action.action_id) <= maxTurn) {
				cb(action.action_id, direct);
			}
		}
	};
	add(Array.isArray(entry?.origin_actions) ? (entry.origin_actions as { action_id: string }[]) : [], true);
	add((entry as { contributing_actions?: { action_id: string }[] }).contributing_actions, false);
	add(filteredImplementationActions<{ action_id: string }>(entry), true);

	const related = Array.isArray(entry?.related_actions) ? entry.related_actions : [];
	const originTurn = getOriginTurnFromEntry(entry);
	for (const action of related) {
		if (action && typeof action === 'object' && 'action_id' in action) {
			const actionId = (action as { action_id: string }).action_id;
			if (
				originTurn != null &&
				(action as { influence?: string }).influence === 'indirect' &&
				getTurnIdFromActionId(actionId) > originTurn
			) {
				continue;
			}
			if (maxTurn == null || getTurnIdFromActionId(actionId) <= maxTurn) cb(actionId, false);
		}
	}
}

export function extractActionVerb(actionText: string | undefined): string | undefined {
	if (!actionText) return undefined;
	const parts = actionText.trim().split(/\s+/);
	const candidate = (parts[1] ?? parts[0] ?? '').replace(/[^a-zA-Z_-]/g, '').toLowerCase();
	return candidate || undefined;
}

export function groupedAnnotationLabel(group: GroupedTurnActionAnnotation): string {
	const texts = group.items
		.map((item) => item.action_text?.trim())
		.filter((text): text is string => !!text);
	if (texts.length === 0) return `${group.relationType} (${group.items.length})`;
	const uniqueTexts = Array.from(new Set(texts));
	if (uniqueTexts.length === 1) return uniqueTexts[0];
	if (uniqueTexts.length === 2) return `${uniqueTexts[0]} / ${uniqueTexts[1]}`;
	return `${uniqueTexts[0]} / ${uniqueTexts[1]} +${uniqueTexts.length - 2}`;
}

export function groupedReasonLabel(group: GroupedTurnActionAnnotation): string {
	const reasons = group.items
		.map((item) => item.reason?.trim())
		.filter((reason): reason is string => !!reason);
	const uniqueReasons = Array.from(new Set(reasons));
	if (uniqueReasons.length === 0) return 'No reason provided';
	if (uniqueReasons.length === 1) return uniqueReasons[0];
	if (uniqueReasons.length === 2) return `${uniqueReasons[0]} / ${uniqueReasons[1]}`;
	return `${uniqueReasons[0]} / ${uniqueReasons[1]} +${uniqueReasons.length - 2}`;
}

export function normalizeRole(r: string | undefined): 'SHAPER' | 'EXECUTOR' {
	const normalized = (r ?? 'EXECUTOR').toUpperCase();
	return normalized === 'CREATOR' || normalized === 'SHAPER' ? 'SHAPER' : 'EXECUTOR';
}

export function roleEmoji(role: 'SHAPER' | 'EXECUTOR'): string {
	return role === 'SHAPER' ? '💡' : '🔧';
}

export function roleRankForMerge(r: 'SHAPER' | 'EXECUTOR'): number {
	return r === 'SHAPER' ? 1 : 0;
}
