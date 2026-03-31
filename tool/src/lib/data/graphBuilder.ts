import type { GraphState, GraphNode, GraphEdge } from '$lib/types';
import type { OutcomeActionMapData, OutcomeActionItem } from '$lib/data/dataLoader';

function turnFromActionId(actionId: string): number {
	const parts = actionId.split('-');
	return parseInt(parts[0], 10) || 0;
}

export type RoleKind = 'SHAPER' | 'EXECUTOR' | 'OTHER';

export function normalizeRoleKind(role: string | undefined): RoleKind {
	const u = (role ?? 'EXECUTOR').toUpperCase();
	if (u === 'CREATOR' || u === 'SHAPER') return 'SHAPER';
	if (u === 'OTHER') return 'OTHER';
	return 'EXECUTOR';
}

function rankRole(a: RoleKind): number {
	if (a === 'SHAPER') return 3;
	if (a === 'EXECUTOR') return 2;
	return 1;
}

function mergeRoleKind(a: RoleKind, b: RoleKind): RoleKind {
	return rankRole(a) >= rankRole(b) ? a : b;
}

type LooseAction = { action_id: string; role?: string; action_text?: string; speaker?: string };

function collectFromRequirementEntry(entry: Record<string, unknown>): LooseAction[] {
	const out: LooseAction[] = [];
	const addList = (list: unknown) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (item && typeof item === 'object' && 'action_id' in item) {
				out.push(item as LooseAction);
			}
		}
	};
	addList(entry.origin_actions);
	addList(entry.contributing_actions);
	addList(entry.implementation_actions);
	addList(entry.related_actions);
	addList(entry.revise_actions);
	return out;
}

/** `requirement_action_map.json` may include an `"others"` array of loose actions. */
function collectOthersBucket(map: Record<string, unknown>): LooseAction[] {
	const raw = map['others'];
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(x): x is LooseAction =>
			!!x && typeof x === 'object' && typeof (x as LooseAction).action_id === 'string'
	);
}

function resolveRequirementEntry(
	reqId: string,
	map: Record<string, unknown>
): Record<string, unknown> | undefined {
	const candidates = [reqId, reqId.replace(/^r/i, ''), /^r/i.test(reqId) ? reqId : `r${reqId.replace(/^r/i, '')}`];
	for (const k of candidates) {
		const v = map[k];
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
	}
	return undefined;
}

type Accum = {
	action_id: string;
	action_text: string;
	role: RoleKind;
	speaker?: string;
	turn: number;
};

/**
 * Per-outcome SHAPER / EXECUTOR (and OTHER) action history: one node per action_id, edges in dialogue order.
 * Merges actions listed under each requirement for this outcome, optional `others` bucket, and
 * `outcome_action_map` actions for the same outcome (deduped by action_id).
 */
export function buildRoleHistoryGraph(
	outcome: { outcome_id: string; requirements: string[] },
	requirementActionMap: Record<string, unknown>,
	outcomeActionMap: OutcomeActionMapData | null
): GraphState {
	const byId = new Map<string, Accum>();

	const mergeOne = (a: LooseAction, turnOverride?: number, speakerOverride?: string) => {
		const id = a.action_id;
		if (!id) return;
		const turn = turnOverride ?? turnFromActionId(id);
		const rk = normalizeRoleKind(a.role);
		const text = (a.action_text ?? '').trim();
		const sp = speakerOverride ?? a.speaker;
		const prev = byId.get(id);
		if (!prev) {
			byId.set(id, {
				action_id: id,
				action_text: text,
				role: rk,
				speaker: sp,
				turn
			});
			return;
		}
		byId.set(id, {
			action_id: id,
			action_text: text.length > prev.action_text.length ? text : prev.action_text,
			role: mergeRoleKind(prev.role, rk),
			speaker: sp ?? prev.speaker,
			turn: prev.turn
		});
	};

	const mergeOutcomeActions = (list: OutcomeActionItem[] | undefined) => {
		if (!list?.length) return;
		for (const a of list) {
			mergeOne(
				{
					action_id: a.action_id,
					role: a.role,
					action_text: a.action_text,
					speaker: a.speaker
				},
				a.turn_id,
				a.speaker
			);
		}
	};

	/** Actions listed under outcome_action_map for this outcome; optional bound_outcome_id must match when set. */
	function filterActionsBoundToOutcome(outcomeId: string, list: OutcomeActionItem[] | undefined): OutcomeActionItem[] {
		if (!list?.length) return [];
		return list.filter((a) => !a.bound_outcome_id || a.bound_outcome_id === outcomeId);
	}

	const oamEntry = outcomeActionMap?.outcome_action_map?.[outcome.outcome_id];
	const oamForOutcome = filterActionsBoundToOutcome(outcome.outcome_id, oamEntry?.actions);

	// Prefer canonical per-outcome list from outcome_action_map.json (e.g. outcome_1.actions with bound_outcome_id).
	if (oamForOutcome.length > 0) {
		mergeOutcomeActions(oamForOutcome);
	} else {
		const reqIds = outcome.requirements ?? [];
		if (reqIds.length > 0) {
			for (const rid of reqIds) {
				const entry = resolveRequirementEntry(rid, requirementActionMap);
				if (entry) {
					for (const a of collectFromRequirementEntry(entry)) mergeOne(a);
				}
			}
			for (const a of collectOthersBucket(requirementActionMap)) mergeOne(a);
		}
		mergeOutcomeActions(oamEntry?.actions);
	}

	const sorted = [...byId.values()].sort((a, b) => {
		if (a.turn !== b.turn) return a.turn - b.turn;
		return a.action_id.localeCompare(b.action_id, undefined, { numeric: true });
	});

	const state: GraphState = { nodes: new Map(), edges: [] };

	for (const item of sorted) {
		const node: GraphNode = {
			id: item.action_id,
			requirement_id: item.action_id,
			content: item.action_text,
			node_type: 'role_action',
			role_kind: item.role,
			speaker: item.speaker,
			created_at: item.turn,
			is_deleted: false
		};
		state.nodes.set(item.action_id, node);
	}

	for (let i = 0; i < sorted.length - 1; i++) {
		const e: GraphEdge = {
			source: sorted[i].action_id,
			target: sorted[i + 1].action_id,
			type: 'parent'
		};
		state.edges.push(e);
	}

	return state;
}
