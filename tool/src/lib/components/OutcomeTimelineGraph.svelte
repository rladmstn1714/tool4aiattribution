<script lang="ts">
	import type { OutcomeNode } from '$lib/types';
	import { outcomeSortKey } from '$lib/utils';
	import type { OutcomeActionMapData, RequirementActionMap, OutcomeActionItem } from '$lib/data/dataLoader';

	type DepEdge = { parentId: string; childId: string };
	type TurnCounts = { shaper: number; executor: number };

	function getTurnIdFromActionId(actionId: string): number {
		const parts = actionId.split('-');
		return parseInt(parts[0], 10) || 0;
	}
	function normalizeRole(role: string | undefined): 'SHAPER' | 'EXECUTOR' {
		const r = (role ?? 'EXECUTOR').toUpperCase();
		if (r === 'CREATOR' || r === 'SHAPER') return 'SHAPER';
		return 'EXECUTOR';
	}

	let {
		outcomes = [],
		outcomeActionMap = null,
		requirementActionMap = {},
		finalTurn = 1,
		dependencyEdges = [],
		selectedOutcomeId = null
	}: {
		outcomes: OutcomeNode[];
		outcomeActionMap: OutcomeActionMapData | null;
		requirementActionMap: RequirementActionMap;
		finalTurn: number;
		dependencyEdges?: DepEdge[];
		selectedOutcomeId?: string | null;
	} = $props();

	const acyclicEdges = $derived.by(() => {
		return dependencyEdges.filter((e) => outcomeSortKey(e.parentId) <= outcomeSortKey(e.childId));
	});

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

	const orderedOutcomes = $derived.by(() => {
		if (outcomes.length === 0) return [];
		const added = new Set<string>();
		const result: OutcomeNode[] = [];
		const visit = (oid: string) => {
			if (added.has(oid)) return;
			added.add(oid);
			const node = outcomes.find((o) => o.outcome_id === oid);
			if (node) result.push(node);
			for (const c of childrenByParentId.get(oid) ?? []) visit(c);
		};
		const roots = outcomes.filter((o) => !parentByOutcomeId.has(o.outcome_id));
		roots.sort((a, b) => outcomes.indexOf(a) - outcomes.indexOf(b));
		for (const r of roots) visit(r.outcome_id);
		for (const o of outcomes) {
			if (!added.has(o.outcome_id)) visit(o.outcome_id);
		}
		return result;
	});

	const outcomeTimelineCounts = $derived.by((): Record<string, TurnCounts[]> => {
		const result: Record<string, TurnCounts[]> = {};
		const maxTurn = Math.max(0, finalTurn);
		type OriginAction = { action_id: string; role: string };
		for (const outcome of outcomes) {
			const counts: TurnCounts[] = [];
			for (let t = 0; t <= maxTurn; t++) counts.push({ shaper: 0, executor: 0 });
			const points: { turn_id: number; role: string }[] = [];

			if (outcome.requirements.length === 0 && outcomeActionMap?.outcome_action_map) {
				const entry = outcomeActionMap.outcome_action_map[outcome.outcome_id];
				const actions: OutcomeActionItem[] = entry?.actions ?? [];
				for (const a of actions) {
					const turn_id = a.turn_id ?? getTurnIdFromActionId(a.action_id);
					points.push({ turn_id, role: normalizeRole(a.role) });
				}
			} else {
				for (const reqId of outcome.requirements) {
					const entry = requirementActionMap[reqId];
					if (!entry) continue;
					const add = (a: OriginAction) => {
						const turn_id = getTurnIdFromActionId(a.action_id);
						points.push({ turn_id, role: normalizeRole(a.role) });
					};
					const origin = Array.isArray(entry.origin_actions) ? entry.origin_actions : [];
					const contrib = Array.isArray((entry as { contributing_actions?: OriginAction[] }).contributing_actions) ? (entry as { contributing_actions: OriginAction[] }).contributing_actions : [];
					const impl = Array.isArray((entry as { implementation_actions?: OriginAction[] }).implementation_actions) ? (entry as { implementation_actions: OriginAction[] }).implementation_actions : [];
					for (const a of origin) add(a);
					for (const a of contrib) add(a);
					for (const a of impl) add(a);
				}
			}
			const createdTurn = outcome.created_at ?? 0;
			if (createdTurn >= 0 && createdTurn <= maxTurn) points.push({ turn_id: createdTurn, role: 'SHAPER' });

			for (const { turn_id, role } of points) {
				if (turn_id >= 0 && turn_id < counts.length) {
					if (role === 'SHAPER') counts[turn_id].shaper += 1;
					else counts[turn_id].executor += 1;
				}
			}
			result[outcome.outcome_id] = counts;
		}
		return result;
	});

	function positionPercent(turn: number): number {
		if (finalTurn <= 0) return 0;
		return Math.min(100, Math.max(0, (turn / finalTurn) * 100));
	}
</script>

<div class="timeline-graph">
	<div class="graph-legend">
		<span class="legend-item shaper">Shaped</span>
		<span class="legend-item executor">Executed</span>
	</div>
	<div class="graph-body">
		{#each orderedOutcomes as outcome}
			{@const counts = outcomeTimelineCounts[outcome.outcome_id] ?? []}
			<div
				class="outcome-row"
				class:selected={selectedOutcomeId === outcome.outcome_id}
				title={outcome.outcome ?? outcome.outcome_id}
			>
				<div class="row-track">
					{#each counts as cell, turnIdx}
						{@const hasAny = cell.shaper > 0 || cell.executor > 0}
						{#if hasAny}
							<span
								class="turn-dot"
								class:shaper-only={cell.shaper > 0 && cell.executor === 0}
								class:executor-only={cell.executor > 0 && cell.shaper === 0}
								class:both={cell.shaper > 0 && cell.executor > 0}
								style="left: {positionPercent(turnIdx)}%;"
								title="Turn {turnIdx + 1}: Shaped {cell.shaper}, Executed {cell.executor}"
							></span>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.timeline-graph {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		min-width: 0;
		width: fit-content;
	}
	.graph-legend {
		display: flex;
		gap: 0.5rem;
		font-size: 0.65rem;
		color: #6b7280;
		flex-shrink: 0;
	}
	.legend-item.shaper { color: #b45309; }
	.legend-item.executor { color: #4f46e5; }
	.graph-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
	}
	.outcome-row {
		display: flex;
		align-items: center;
		min-height: 32px;
		border-radius: 4px;
	}
	.outcome-row.selected {
		background: #e0f2fe;
	}
	.row-track {
		position: relative;
		width: 48px;
		height: 18px;
		background: #f3f4f6;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.turn-dot {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 3px;
		height: 10px;
		border-radius: 2px;
		pointer-events: none;
	}
	.turn-dot.shaper-only {
		background: #d4a55a;
	}
	.turn-dot.executor-only {
		background: #6366f1;
	}
	.turn-dot.both {
		background: linear-gradient(to bottom, #d4a55a 50%, #6366f1 50%);
	}
</style>
