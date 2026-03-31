<script lang="ts">
	import type { OutcomeNode } from '$lib/types';
	import { outcomeSortKey, outcomeLabel } from '$lib/utils';
	import type { RequirementActionMap, UtteranceListData, ActionUtteranceMap, OutcomeActionItem, OutcomeActionMapData } from '$lib/data/dataLoader';

	function getTurnIdFromActionId(actionId: string): number {
		const parts = actionId.split('-');
		return parseInt(parts[0], 10) || 0;
	}
	function normalizeRole(r: string | undefined): 'SHAPER' | 'EXECUTOR' {
		const u = (r ?? 'EXECUTOR').toUpperCase();
		return u === 'CREATOR' || u === 'SHAPER' ? 'SHAPER' : 'EXECUTOR';
	}

	function collectActionIds(entry: Record<string, unknown>, maxTurn: number | null, cb: (actionId: string) => void) {
		const origin = Array.isArray(entry?.origin_actions) ? entry.origin_actions : [];
		for (const a of origin) {
			if (maxTurn == null || getTurnIdFromActionId(a.action_id) <= maxTurn) cb(a.action_id);
		}
		const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions) ? (entry as { contributing_actions: { action_id: string }[] }).contributing_actions : [];
		for (const a of contrib) {
			if (maxTurn == null || getTurnIdFromActionId(a.action_id) <= maxTurn) cb(a.action_id);
		}
		const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions) ? (entry as { implementation_actions: { action_id: string }[] }).implementation_actions : [];
		for (const a of impl) {
			if (maxTurn == null || getTurnIdFromActionId(a.action_id) <= maxTurn) cb(a.action_id);
		}
		const related = Array.isArray(entry?.related_actions) ? entry.related_actions : [];
		for (const a of related) {
			if (a && typeof a === 'object' && 'action_id' in a) {
				const id = (a as { action_id: string }).action_id;
				if (maxTurn == null || getTurnIdFromActionId(id) <= maxTurn) cb(id);
			}
		}
	}

	function collectActionsWithMeta(entry: Record<string, unknown>, maxTurn: number | null): { actionId: string; direct: boolean; role: 'SHAPER' | 'EXECUTOR' }[] {
		const out: { actionId: string; direct: boolean; role: 'SHAPER' | 'EXECUTOR' }[] = [];
		const add = (actionId: string, direct: boolean, role: string | undefined) => {
			if (maxTurn != null && getTurnIdFromActionId(actionId) > maxTurn) return;
			out.push({ actionId, direct, role: normalizeRole(role) });
		};
		const origin = Array.isArray(entry?.origin_actions) ? entry.origin_actions : [];
		for (const a of origin) add(a.action_id, true, (a as { role?: string }).role);
		const contrib = Array.isArray((entry as { contributing_actions?: { action_id: string; role?: string }[] }).contributing_actions) ? (entry as { contributing_actions: { action_id: string; role?: string }[] }).contributing_actions : [];
		for (const a of contrib) add(a.action_id, true, a.role);
		const impl = Array.isArray((entry as { implementation_actions?: { action_id: string; role?: string }[] }).implementation_actions) ? (entry as { implementation_actions: { action_id: string; role?: string }[] }).implementation_actions : [];
		for (const a of impl) add(a.action_id, true, a.role);
		const related = Array.isArray(entry?.related_actions) ? entry.related_actions : [];
		for (const a of related) {
			if (a && typeof a === 'object' && 'action_id' in a) {
				const id = (a as { action_id: string }).action_id;
				const role = (a as { role?: string }).role;
				add(id, false, role);
			}
		}
		return out;
	}

	type StripMarker = { turnIndex: number; turnId: number; speaker: string; actionId: string; direct: boolean; role: 'SHAPER' | 'EXECUTOR' };

	let {
		utteranceList = null,
		requirementId = null,
		allRequirementIds = [],
		requirementActionMap = {},
		actionUtteranceMap = {},
		outcomeTurnIdWhenNoReqs = null,
		outcomeActionsFromMap = null,
		filterToRelatedOnly = false,
		showAllUtterances = false,
		viewAllWhenFiltered = false,
		selectedActionId = null,
		hoveredActionId = null,
		onActionClick,
		onActionHover,
		outcomes = [],
		selectedOutcomeId = null,
		outcomeActionMap = null,
		dependencyEdges = [],
		onOutcomeClick
	}: {
		utteranceList: UtteranceListData | null;
		requirementId?: string | null;
		allRequirementIds?: string[];
		requirementActionMap: RequirementActionMap;
		actionUtteranceMap: ActionUtteranceMap;
		outcomeTurnIdWhenNoReqs?: number | null;
		outcomeActionsFromMap?: OutcomeActionItem[] | null;
		filterToRelatedOnly?: boolean;
		showAllUtterances?: boolean;
		viewAllWhenFiltered?: boolean;
		selectedActionId?: string | null;
		hoveredActionId?: string | null;
		onActionClick?: (id: string | null) => void;
		onActionHover?: (id: string | null) => void;
		outcomes?: OutcomeNode[];
		selectedOutcomeId?: string | null;
		outcomeActionMap?: OutcomeActionMapData | null;
		dependencyEdges?: { parentId: string; childId: string }[];
		onOutcomeClick?: (outcomeId: string) => void;
	} = $props();

	const relatedTurnIds = $derived.by((): Set<number> => {
		const set = new Set<number>();
		const collect = (actionId: string) => {
			const ev = actionUtteranceMap[actionId];
			if (ev != null) set.add(ev.turn_id);
		};
		if (requirementId) {
			const entry = requirementActionMap[requirementId];
			if (entry) collectActionIds(entry as unknown as Record<string, unknown>, null, collect);
		} else if (selectedActionId) {
			collect(selectedActionId);
		} else if (allRequirementIds.length > 0) {
			for (const reqId of allRequirementIds) {
				const entry = requirementActionMap[reqId];
				if (entry) collectActionIds(entry as unknown as Record<string, unknown>, null, collect);
			}
		} else if (allRequirementIds.length === 0 && outcomeActionsFromMap != null) {
			for (const a of outcomeActionsFromMap) {
				if (a.turn_id != null) set.add(a.turn_id);
			}
		} else if (allRequirementIds.length === 0 && outcomeTurnIdWhenNoReqs != null) {
			for (const entry of Object.values(requirementActionMap)) {
				if (entry) collectActionIds(entry as unknown as Record<string, unknown>, outcomeTurnIdWhenNoReqs, collect);
			}
		}
		return set;
	});

	const displayedUtterances = $derived.by(() => {
		const list = utteranceList?.utterances ?? [];
		if (showAllUtterances || viewAllWhenFiltered) return list;
		if (!filterToRelatedOnly || relatedTurnIds.size === 0) return list;
		return list.filter((u) => relatedTurnIds.has(u.turn_id));
	});

	const speakerByTurn = $derived.by(() => {
		const map = new Map<number, string>();
		if (!utteranceList?.utterances) return map;
		for (const u of utteranceList.utterances) map.set(u.turn_id, u.speaker);
		return map;
	});
	const turnIndexMap = $derived.by(() => {
		const map = new Map<number, number>();
		if (!utteranceList?.utterances) return map;
		utteranceList.utterances.forEach((u, i) => map.set(u.turn_id, i));
		return map;
	});

	const allStripMarkers = $derived.by((): StripMarker[] => {
		const markers: StripMarker[] = [];
		const addMarker = (actionId: string, turnId: number, direct: boolean, role: 'SHAPER' | 'EXECUTOR') => {
			const idx = turnIndexMap.get(turnId);
			if (idx == null) return;
			markers.push({ turnIndex: idx, turnId, speaker: speakerByTurn.get(turnId) ?? 'user', actionId, direct, role });
		};
		const reqIds = requirementId ? [requirementId] : allRequirementIds.length > 0 ? allRequirementIds : [];
		if (reqIds.length > 0) {
			for (const reqId of reqIds) {
				const entry = requirementActionMap[reqId] as unknown as Record<string, unknown> | undefined;
				if (!entry) continue;
				const list = collectActionsWithMeta(entry, null);
				for (const { actionId, direct, role } of list) {
					const ev = actionUtteranceMap[actionId];
					if (ev) addMarker(actionId, ev.turn_id, direct, role);
				}
			}
		} else if (outcomeActionsFromMap != null) {
			for (const a of outcomeActionsFromMap) {
				if (a.turn_id != null) addMarker(a.action_id, a.turn_id, true, normalizeRole(a.role));
			}
		} else if (outcomeTurnIdWhenNoReqs != null) {
			for (const entry of Object.values(requirementActionMap)) {
				if (!entry) continue;
				const list = collectActionsWithMeta(entry as unknown as Record<string, unknown>, outcomeTurnIdWhenNoReqs);
				for (const { actionId, direct, role } of list) {
					const ev = actionUtteranceMap[actionId];
					if (ev) addMarker(actionId, ev.turn_id, direct, role);
				}
			}
		}
		markers.sort((a, b) => a.turnIndex - b.turnIndex || (a.direct === b.direct ? 0 : a.direct ? -1 : 1));
		return markers;
	});

	const stripMarkersByTurn = $derived.by(() => {
		const groups: { turnId: number; markers: StripMarker[] }[] = [];
		let current: { turnId: number; markers: StripMarker[] } | null = null;
		for (const m of allStripMarkers) {
			if (current && current.turnId === m.turnId) current.markers.push(m);
			else {
				current = { turnId: m.turnId, markers: [m] };
				groups.push(current);
			}
		}
		return groups;
	});

	const creationTurnByOutcomeId = $derived.by((): Map<string, number> => {
		const map = new Map<string, number>();
		for (const outcome of outcomes) {
			let earliest = outcome.created_at ?? 0;
			if (outcome.requirements.length === 0 && outcomeActionMap?.outcome_action_map) {
				const entry = outcomeActionMap.outcome_action_map[outcome.outcome_id];
				const actions: OutcomeActionItem[] = entry?.actions ?? [];
				for (const a of actions) {
					const t = a.turn_id ?? getTurnIdFromActionId(a.action_id);
					if (t < earliest) earliest = t;
				}
			} else {
				for (const reqId of outcome.requirements) {
					const entry = requirementActionMap[reqId] as { origin_actions?: { action_id: string }[] } | undefined;
					const origin = Array.isArray(entry?.origin_actions) ? entry.origin_actions : [];
					for (const a of origin) {
						const t = getTurnIdFromActionId(a.action_id);
						if (t < earliest) earliest = t;
					}
				}
			}
			map.set(outcome.outcome_id, earliest);
		}
		return map;
	});

	const showOutcomeLevelTimeline = $derived(outcomes.length > 0 && (utteranceList?.utterances?.length ?? 0) > 0);

	function getOutcomeNum(id: string): number {
		return outcomeSortKey(id);
	}
	const acyclicEdges = $derived.by(() => dependencyEdges.filter((e) => getOutcomeNum(e.parentId) <= getOutcomeNum(e.childId)));
	const parentByOutcomeId = $derived.by(() => {
		const map = new Map<string, string>();
		const ids = new Set(outcomes.map((o) => o.outcome_id));
		for (const e of acyclicEdges) {
			if (ids.has(e.childId) && ids.has(e.parentId)) map.set(e.childId, e.parentId);
		}
		return map;
	});
	const childrenByParentId = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const e of acyclicEdges) {
			if (!outcomes.some((o) => o.outcome_id === e.parentId) || !outcomes.some((o) => o.outcome_id === e.childId)) continue;
			const list = map.get(e.parentId) ?? [];
			if (!list.includes(e.childId)) list.push(e.childId);
			map.set(e.parentId, list);
		}
		for (const [, list] of map) {
			list.sort((a, b) => outcomes.findIndex((o) => o.outcome_id === a) - outcomes.findIndex((o) => o.outcome_id === b));
		}
		return map;
	});

	const rootOutcomesForTimeline = $derived.by(() => {
		const roots = outcomes.filter((o) => !parentByOutcomeId.has(o.outcome_id));
		roots.sort((a, b) => outcomes.indexOf(a) - outcomes.indexOf(b));
		return roots;
	});

	const depthByOutcomeId = $derived.by(() => {
		const depth = new Map<string, number>();
		const visit = (oid: string, d: number) => {
			depth.set(oid, d);
			for (const c of childrenByParentId.get(oid) ?? []) visit(c, d + 1);
		};
		const roots = outcomes.filter((o) => !parentByOutcomeId.has(o.outcome_id));
		roots.sort((a, b) => outcomes.indexOf(a) - outcomes.indexOf(b));
		for (const r of roots) visit(r.outcome_id, 0);
		for (const o of outcomes) {
			if (!depth.has(o.outcome_id)) depth.set(o.outcome_id, 0);
		}
		return depth;
	});

	const selectedTreeOutcomes = $derived.by(() => {
		if (!selectedOutcomeId) return [];
		const parent = parentByOutcomeId;
		let rootId: string | null = selectedOutcomeId;
		while (parent.get(rootId!) != null) rootId = parent.get(rootId!)!;
		const result: OutcomeNode[] = [];
		const rootNode = outcomes.find((o) => o.outcome_id === rootId);
		if (!rootNode) return [];
		result.push(rootNode);
		const visit = (oid: string) => {
			for (const c of childrenByParentId.get(oid) ?? []) {
				const node = outcomes.find((o) => o.outcome_id === c);
				if (node) {
					result.push(node);
					visit(c);
				}
			}
		};
		visit(rootId!);
		return result;
	});

	const selectedTreeIdSet = $derived.by(() => new Set(selectedTreeOutcomes.map((o) => o.outcome_id)));
	const rootIdSet = $derived.by(() => new Set(rootOutcomesForTimeline.map((o) => o.outcome_id)));

	const outcomeLevelSource = $derived.by(() => {
		const roots = rootOutcomesForTimeline;
		if (!selectedOutcomeId) return roots;
		const tree = selectedTreeOutcomes;
		const seen = new Set(roots.map((o) => o.outcome_id));
		const out = [...roots];
		for (const o of tree) {
			if (!seen.has(o.outcome_id)) {
				seen.add(o.outcome_id);
				out.push(o);
			}
		}
		return out;
	});

	const outcomeLevelEntries = $derived.by(() => {
		if (!showOutcomeLevelTimeline || !utteranceList?.utterances) return [];
		const list = utteranceList.utterances;
		const n = list.length;
		const turnIndexMapLocal = new Map<number, number>();
		list.forEach((u, i) => turnIndexMapLocal.set(u.turn_id, i));
		const creation = creationTurnByOutcomeId;
		const depthBy = depthByOutcomeId;
		const inSelectedTree = selectedTreeIdSet;
		const isRoot = rootIdSet;
		return outcomeLevelSource
			.map((o) => {
				const turnId = creation.get(o.outcome_id) ?? o.created_at ?? 0;
				const idx = turnIndexMapLocal.get(turnId) ?? Math.min(Math.max(0, turnId), n - 1);
				const leftPct = n > 1 ? ((idx + 0.5) / n) * 100 : 50;
				const num = outcomeSortKey(o.outcome_id);
				const label = outcomeLabel(o.outcome_id);
				const depth = depthBy.get(o.outcome_id) ?? 0;
				return { outcomeId: o.outcome_id, outcomeNumber: num, outcomeDisplayLabel: label, leftPct, depth, isInSelectedTree: inSelectedTree.has(o.outcome_id), isRoot: isRoot.has(o.outcome_id) };
			})
			.sort((a, b) => a.leftPct - b.leftPct || a.outcomeNumber - b.outcomeNumber);
	});

	const actionTrackEntries = $derived.by(() => {
		const list = utteranceList?.utterances ?? [];
		const n = list.length;
		if (n === 0) return [];
		const turnToMarkers = new Map<number, StripMarker[]>();
		for (const g of stripMarkersByTurn) turnToMarkers.set(g.turnId, g.markers);
		return list.map((u, i) => ({
			turnId: u.turn_id,
			leftPct: n > 1 ? ((i + 0.5) / n) * 100 : 50,
			markers: turnToMarkers.get(u.turn_id) ?? []
		}));
	});

	function roleEmoji(role: string): string {
		return role === 'SHAPER' ? '💡' : '🔧';
	}
</script>

{#if showOutcomeLevelTimeline || (selectedOutcomeId && (utteranceList?.utterances?.length ?? 0) > 0)}
	<div class="diag-timeline-bar" role="presentation">
		<div class="diag-timeline-head">
			<span class="diag-timeline-label">Timeline</span>
		</div>
		<div class="diag-timeline-tracks">
			{#if showOutcomeLevelTimeline}
				<div class="diag-timeline-track outcome-track">
					{#each outcomeLevelEntries as { outcomeId, outcomeNumber, outcomeDisplayLabel, leftPct, depth, isInSelectedTree, isRoot }}
						<button
							type="button"
							class="timeline-outcome-marker"
							class:depth-0={depth === 0}
							class:depth-1={depth === 1}
							class:depth-2={depth === 2}
							class:depth-3={depth >= 3}
							class:selected={outcomeId === selectedOutcomeId}
							class:dimmed={!!selectedOutcomeId && isRoot && !isInSelectedTree}
							style="left: {leftPct}%; --depth: {depth};"
							title={"Outcome " + outcomeDisplayLabel + (outcomeId === selectedOutcomeId ? " (선택됨)" : depth > 0 ? " (depth " + depth + ")" : "")}
							onclick={() => onOutcomeClick?.(outcomeId)}
						>{outcomeDisplayLabel}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.diag-timeline-bar {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		margin-bottom: 0.5rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}
	.diag-timeline-head {
		display: flex;
		align-items: center;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid #f3f4f6;
	}
	.diag-timeline-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
		letter-spacing: 0.02em;
		flex-shrink: 0;
	}
	.diag-timeline-tracks {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}
	.diag-timeline-track {
		flex: 0 0 auto;
		min-height: 36px;
		position: relative;
		display: flex;
		align-items: center;
		background: #f9fafb;
		border-radius: 8px;
		border: 1px solid #f3f4f6;
	}
	.diag-timeline-track.outcome-track {
		min-height: 56px;
	}
	.timeline-outcome-marker {
		position: absolute;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		cursor: pointer;
		transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
		z-index: 1;
		top: calc(4px + var(--depth, 0) * 16px);
	}
	.timeline-outcome-marker:hover {
		transform: translateX(-50%) scale(1.08);
	}
	.timeline-outcome-marker.depth-0 {
		width: 1.6rem;
		height: 1.6rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #1e40af;
		background: #bfdbfe;
		border: 1px solid #93c5fd;
	}
	.timeline-outcome-marker.depth-0:hover {
		background: #93c5fd;
		color: #1e3a8a;
	}
	.timeline-outcome-marker.depth-1 {
		width: 1.35rem;
		height: 1.35rem;
		font-size: 0.66rem;
		font-weight: 700;
		color: #2563eb;
		background: #dbeafe;
		border: 1px solid #bfdbfe;
	}
	.timeline-outcome-marker.depth-1:hover {
		background: #bfdbfe;
		color: #1d4ed8;
	}
	.timeline-outcome-marker.depth-2 {
		width: 1.15rem;
		height: 1.15rem;
		font-size: 0.6rem;
		font-weight: 700;
		color: #3b82f6;
		background: #e0f2fe;
		border: 1px solid #bae6fd;
	}
	.timeline-outcome-marker.depth-2:hover {
		background: #bae6fd;
		color: #2563eb;
	}
	.timeline-outcome-marker.depth-3 {
		width: 1rem;
		height: 1rem;
		font-size: 0.54rem;
		font-weight: 700;
		color: #60a5fa;
		background: #f0f9ff;
		border: 1px solid #e0f2fe;
	}
	.timeline-outcome-marker.depth-3:hover {
		background: #e0f2fe;
		color: #2563eb;
	}
	.timeline-outcome-marker.selected {
		box-shadow: 0 0 0 2px #2563eb, 0 2px 6px rgba(37, 99, 235, 0.25);
	}
	.timeline-outcome-marker.dimmed {
		opacity: 0.22;
	}
	.timeline-outcome-marker.dimmed:hover {
		opacity: 0.5;
	}
</style>
