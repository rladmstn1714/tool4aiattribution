<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { OutcomeNode } from '$lib/types';
	import { stripTrailingParen, outcomeSortKey, outcomeLabel } from '$lib/utils';
	import type {
		OutcomeActionMapData,
		RequirementActionMap,
		OutcomeActionItem
	} from '$lib/data/dataLoader';

	type OriginAction = { action_id: string; role: string; action_text: string };

	function getTurnIdFromActionId(actionId: string): number {
		const parts = actionId.split('-');
		return parseInt(parts[0], 10) || 0;
	}
	/** Normalize role: data may use CREATOR/DOER or SHAPER/EXECUTOR */
	function normalizeRole(role: string | undefined): 'SHAPER' | 'EXECUTOR' {
		const r = (role ?? 'EXECUTOR').toUpperCase();
		if (r === 'CREATOR' || r === 'SHAPER') return 'SHAPER';
		return 'EXECUTOR';
	}

	/** dependencyEdges: parentId → childId (child depends on parent). Used to show hierarchy with indent. */
	type DepEdge = { parentId: string; childId: string };

	let {
		outcomes = [],
		outcomeActionMap = null,
		requirementActionMap = {},
		finalTurn = 1,
		dependencyEdges = [],
		hideOutcomeLabel = false,
		onOutcomeHover,
		onOutcomeFocus,
		actionTimeline,
		actionTimelineDirect,
		actionTimelineIndirect,
		showSplitActionTimelines = false
	}: {
		outcomes: OutcomeNode[];
		outcomeActionMap: OutcomeActionMapData | null;
		requirementActionMap: RequirementActionMap;
		finalTurn: number;
		dependencyEdges?: DepEdge[];
		hideOutcomeLabel?: boolean;
		onOutcomeHover?: (outcomeId: string | null) => void;
		onOutcomeFocus?: (outcomeId: string) => void;
		/** Rendered below outcome rows, in the same box; use for Action timeline (same track width). */
		actionTimeline?: Snippet;
		/** Direct actions timeline row (same track width). When set, shown as "Direct actions". */
		actionTimelineDirect?: Snippet;
		/** Indirect actions timeline row (same track width). When set, shown as "Indirect actions". */
		actionTimelineIndirect?: Snippet;
		/** When true, show Direct + Indirect action rows; when false, show single Actions row. */
		showSplitActionTimelines?: boolean;
	} = $props();

	const TOOLTIP_DELAY_MS = 500;
	let tooltipOutcomeId = $state<string | null>(null);
	let tooltipTimeoutId = $state<ReturnType<typeof setTimeout> | null>(null);

	function handleRowMouseEnter(outcomeId: string) {
		if (tooltipTimeoutId != null) clearTimeout(tooltipTimeoutId);
		tooltipTimeoutId = setTimeout(() => {
			tooltipOutcomeId = outcomeId;
			tooltipTimeoutId = null;
		}, TOOLTIP_DELAY_MS);
		onOutcomeHover?.(outcomeId);
	}
	function handleRowMouseLeave() {
		if (tooltipTimeoutId != null) {
			clearTimeout(tooltipTimeoutId);
			tooltipTimeoutId = null;
		}
		tooltipOutcomeId = null;
		onOutcomeHover?.(null);
	}

	/** outcome_id → parent outcome_id when this outcome is a child in some edge (child depends on parent). Uses acyclic edges so cycles don't create false hierarchy. */
	const parentByOutcomeId = $derived.by(() => {
		const map = new Map<string, string>();
		const outcomeIds = new Set(outcomes.map((o) => o.outcome_id));
		for (const e of acyclicEdges) {
			if (outcomeIds.has(e.childId) && outcomeIds.has(e.parentId)) {
				map.set(e.childId, e.parentId);
			}
		}
		return map;
	});

	/** Creation turn per outcome: earliest turn among origin (creation) actions; fallback to outcome.created_at. */
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
					const entry = requirementActionMap[reqId];
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

	/** parent_id → [child_id, ...] (direct children only), sorted by original outcomes order. Uses acyclic edges. */
	const childrenByParentId = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const e of acyclicEdges) {
			if (!outcomes.some((o) => o.outcome_id === e.parentId) || !outcomes.some((o) => o.outcome_id === e.childId)) continue;
			const list = map.get(e.parentId) ?? [];
			if (!list.includes(e.childId)) list.push(e.childId);
			map.set(e.parentId, list);
		}
		for (const [, list] of map) {
			list.sort((a, b) => {
				const ia = outcomes.findIndex((o) => o.outcome_id === a);
				const ib = outcomes.findIndex((o) => o.outcome_id === b);
				return ia - ib;
			});
		}
		return map;
	});

	/** Outcomes in dependency order: roots first, then each root's descendants. Uses acyclic edges so hierarchy is a DAG. */
	const { orderedOutcomes, displayDepthByOutcomeId } = $derived.by(() => {
		if (outcomes.length === 0) return { orderedOutcomes: [] as OutcomeNode[], displayDepthByOutcomeId: new Map<string, number>() };
		const added = new Set<string>();
		const result: OutcomeNode[] = [];
		const displayDepth = new Map<string, number>();
		const visit = (oid: string, depth: number) => {
			if (added.has(oid)) return;
			added.add(oid);
			displayDepth.set(oid, depth);
			const node = outcomes.find((o) => o.outcome_id === oid);
			if (node) result.push(node);
			for (const c of childrenByParentId.get(oid) ?? []) {
				visit(c, depth + 1);
			}
		};
		const roots = outcomes.filter((o) => !parentByOutcomeId.has(o.outcome_id));
		roots.sort((a, b) => outcomes.indexOf(a) - outcomes.indexOf(b));
		for (const r of roots) visit(r.outcome_id, 0);
		for (const o of outcomes) {
			if (!added.has(o.outcome_id)) visit(o.outcome_id, 0);
		}
		return { orderedOutcomes: result, displayDepthByOutcomeId: displayDepth };
	});

	function getOutcomeNumber(outcomeId: string): number {
		return outcomeSortKey(outcomeId);
	}

	/** Break cycles by keeping only "forward" edges (parent outcome number <= child). Produces a DAG for a single, plausible hierarchy. */
	const acyclicEdges = $derived.by(() => {
		return dependencyEdges.filter((e) => getOutcomeNumber(e.parentId) <= getOutcomeNumber(e.childId));
	});

	/** Blue gets lighter as depth increases (layer 0 = darkest). */
	const DEPTH_BLUES = ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe'] as const;
	function depthBlue(depth: number): string {
		return DEPTH_BLUES[Math.min(depth, DEPTH_BLUES.length - 1)] ?? DEPTH_BLUES[DEPTH_BLUES.length - 1];
	}

	/** Per outcome_id: for each turn 0..finalTurn, { shaper, executor } counts */
	type TurnCounts = { shaper: number; executor: number };
	const outcomeTimelineCounts = $derived.by((): Record<string, TurnCounts[]> => {
		const result: Record<string, TurnCounts[]> = {};
		const maxTurn = Math.max(0, finalTurn);
		for (const outcome of outcomes) {
			const counts: TurnCounts[] = [];
			for (let t = 0; t <= maxTurn; t++) {
				counts.push({ shaper: 0, executor: 0 });
			}
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
					const contrib = Array.isArray((entry as { contributing_actions?: OriginAction[] }).contributing_actions)
						? (entry as { contributing_actions: OriginAction[] }).contributing_actions
						: [];
					const impl = Array.isArray((entry as { implementation_actions?: OriginAction[] }).implementation_actions)
						? (entry as { implementation_actions: OriginAction[] }).implementation_actions
						: [];
					for (const a of origin) add(a);
					for (const a of contrib) add(a);
					for (const a of impl) add(a);
				}
			}
			// Mark "goal shaped" when the outcome is created (currently we only had req-shaped points)
			const createdTurn = outcome.created_at ?? 0;
			if (createdTurn >= 0 && createdTurn <= maxTurn) {
				points.push({ turn_id: createdTurn, role: 'SHAPER' });
			}

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

	/** Max count per turn across all outcomes (for normalizing bar height) */
	const maxCountPerTurn = $derived.by(() => {
		let max = 0;
		for (const counts of Object.values(outcomeTimelineCounts)) {
			for (const c of counts) {
				const total = c.shaper + c.executor;
				if (total > max) max = total;
			}
		}
		return max || 1;
	});

	/** Timeline ticks: step so we have at most ~40 ticks for readability */
	const turnTicks = $derived.by(() => {
		if (finalTurn <= 0) return [];
		const step = finalTurn <= 20 ? 1 : finalTurn <= 60 ? 2 : Math.ceil(finalTurn / 30);
		const ticks: number[] = [];
		for (let t = 0; t <= finalTurn; t += step) ticks.push(t);
		if (ticks[ticks.length - 1] !== finalTurn) ticks.push(finalTurn);
		return ticks;
	});

	function positionPercent(turn: number): number {
		if (finalTurn <= 0) return 0;
		return Math.min(100, Math.max(0, (turn / finalTurn) * 100));
	}

</script>

<div class="overview-timeline" class:compact-labels={!!actionTimeline || !!actionTimelineDirect || !!actionTimelineIndirect}>
	<h3 class="overview-title">Overview timeline</h3>
	<div class="overview-legend">
		<span class="overview-legend-item shaper"><span class="legend-badge shaper"><span class="legend-badge-icon" data-role="SHAPER"></span></span> Goal Shaped (Created/Revised)</span>
		<span class="overview-legend-item executor"><span class="legend-badge executor"><span class="legend-badge-icon" data-role="EXECUTOR"></span></span> Goal Executed</span>
	</div>
	<div class="overview-body">
		<div class="overview-axis-labels">
			<span class="axis-label">Turn</span>
			<div class="axis-ticks" role="presentation">
				{#each turnTicks as t}
					<span class="axis-tick" style="left: {positionPercent(t)}%;">{t + 1}</span>
				{/each}
			</div>
		</div>
		{#each orderedOutcomes as outcome, i}
			{@const counts = outcomeTimelineCounts[outcome.outcome_id] ?? []}
			{@const hasParent = parentByOutcomeId.get(outcome.outcome_id) != null}
			{@const depDepth = displayDepthByOutcomeId.get(outcome.outcome_id) ?? 0}
			<div
				class="overview-row"
				class:has-dep={hasParent && !hideOutcomeLabel}
				class:no-label-row={hideOutcomeLabel}
				style="--outcome-blue: {depthBlue(depDepth)}{hasParent && depDepth >= 1 ? `; --dep-depth: ${depDepth}` : ''}"
				role={hideOutcomeLabel ? 'presentation' : 'button'}
				tabindex={hideOutcomeLabel ? undefined : 0}
				onmouseenter={() => !hideOutcomeLabel && handleRowMouseEnter(outcome.outcome_id)}
				onmouseleave={hideOutcomeLabel ? undefined : handleRowMouseLeave}
				onclick={() => !hideOutcomeLabel && onOutcomeFocus?.(outcome.outcome_id)}
				onkeydown={(e) => !hideOutcomeLabel && e.key === 'Enter' && onOutcomeFocus?.(outcome.outcome_id)}
			>
				{#if !hideOutcomeLabel}
					<div class="outcome-full-tooltip" class:visible={tooltipOutcomeId === outcome.outcome_id} role="tooltip">
						{outcome.outcome ?? outcome.outcome_id}
					</div>
				{/if}
				<div class="outcome-label">
					{#if !hideOutcomeLabel}
						{#if hasParent}
							<span class="connector dep-connector" aria-hidden="true"></span>
						{/if}
						<span class="outcome-index">{outcomeLabel(outcome.outcome_id)}</span>
						<span class="outcome-title">{stripTrailingParen(outcome.outcome ?? outcome.outcome_id)}</span>
					{/if}
				</div>
				<div class="outcome-track" role="presentation">
					{#each counts as cell, turnIdx}
						{@const hasAny = cell.shaper > 0 || cell.executor > 0}
						{#if hasAny}
							<div
								class="turn-cell"
								class:turn-cell-first={turnIdx === 0}
								class:turn-cell-last={turnIdx === counts.length - 1}
								style="left: {positionPercent(turnIdx)}%;"
								title="Turn {turnIdx + 1}: Goal Created/Changed {cell.shaper}, Goal Executed {cell.executor}"
							>
								<div class="bar-pair">
									{#if cell.shaper > 0}
										<div
											class="bar-stack shaper-only"
											style="--scale: {cell.shaper / maxCountPerTurn};"
										>
											<div class="bar shaper"></div>
										</div>
									{/if}
									{#if cell.executor > 0}
										<div
											class="bar-stack executor-only"
											style="--scale: {cell.executor / maxCountPerTurn};"
										>
											<div class="bar executor"></div>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
		{#if showSplitActionTimelines && actionTimelineDirect}
			<div class="overview-row overview-action-row">
				<div class="outcome-label overview-action-label-col">
					<span class="overview-action-label">Direct actions</span>
					<div class="overview-action-lane-labels">
						<span class="overview-lane-label agent">Assistant</span>
						<span class="overview-lane-label user">User</span>
					</div>
				</div>
				<div class="outcome-track overview-action-track">
					{@render actionTimelineDirect()}
				</div>
			</div>
		{/if}
		{#if showSplitActionTimelines && actionTimelineIndirect}
			<div class="overview-row overview-action-row">
				<div class="outcome-label overview-action-label-col">
					<span class="overview-action-label">Indirect actions</span>
					<div class="overview-action-lane-labels">
						<span class="overview-lane-label agent">Assistant</span>
						<span class="overview-lane-label user">User</span>
					</div>
				</div>
				<div class="outcome-track overview-action-track">
					{@render actionTimelineIndirect()}
				</div>
			</div>
		{/if}
		{#if !showSplitActionTimelines && actionTimeline}
			<div class="overview-row overview-action-row">
				<div class="outcome-label overview-action-label-col">
					<span class="overview-action-label">Actions</span>
					<div class="overview-action-lane-labels">
						<span class="overview-lane-label agent">Assistant</span>
						<span class="overview-lane-label user">User</span>
					</div>
				</div>
				<div class="outcome-track overview-action-track">
					{@render actionTimeline()}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.overview-timeline {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1.15rem 1.35rem;
		background: linear-gradient(180deg, #fefefe 0%, #f8fafc 100%);
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
		min-width: 0;
	}
	.overview-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.02em;
	}
	.overview-legend {
		display: flex;
		gap: 1.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #475569;
	}
	.overview-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.legend-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}
	.legend-badge.shaper {
		background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
		border: 1px solid #b45309;
	}
	.legend-badge.executor {
		background: linear-gradient(180deg, #818cf8 0%, #6366f1 100%);
		border: 1px solid #4f46e5;
	}
	.legend-badge-icon {
		display: inline-block;
		width: 14px;
		height: 14px;
	}
	.legend-badge.shaper .legend-badge-icon {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffffff'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.legend-badge.executor .legend-badge-icon {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffffff'%3E%3Cpath d='M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.overview-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	/* Same track width for all rows when action timeline is present */
	.overview-timeline.compact-labels .overview-body {
		display: grid;
		grid-template-columns: 72px 1fr;
		gap: 0.25rem 0.5rem;
		align-items: start;
	}
	.overview-timeline.compact-labels .overview-axis-labels {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
	}
	.overview-timeline.compact-labels .overview-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
	}
	.overview-timeline.compact-labels .overview-row .outcome-full-tooltip {
		grid-column: 1 / -1;
		grid-row: 1;
	}
	.overview-timeline.compact-labels .overview-row .outcome-label {
		grid-column: 1;
		grid-row: 1;
	}
	.overview-timeline.compact-labels .overview-row .outcome-track {
		grid-column: 2;
		grid-row: 1;
	}
	.overview-timeline.compact-labels .overview-action-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
	}
	.overview-timeline.compact-labels .overview-action-row .outcome-label {
		grid-column: 1;
		grid-row: 1;
	}
	.overview-timeline.compact-labels .overview-action-row .outcome-track {
		grid-column: 2;
		grid-row: 1;
	}
	.overview-axis-labels {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin-bottom: 2px;
		min-height: 20px;
	}
	.axis-label {
		flex-shrink: 0;
		width: 320px;
		font-size: 0.65rem;
		font-weight: 700;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.overview-timeline.compact-labels .axis-label,
	.overview-timeline.compact-labels .outcome-label {
		width: 72px;
	}
	.axis-ticks {
		flex: 1;
		position: relative;
		height: 16px;
	}
	.axis-tick {
		position: absolute;
		transform: translateX(-50%);
		font-size: 0.6rem;
		color: #9ca3af;
		white-space: nowrap;
	}
	.overview-row {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-height: 28px;
		cursor: pointer;
		border-radius: 6px;
		transition: background 0.15s;
	}
	.overview-row:hover {
		background: rgba(14, 165, 233, 0.06);
		border-radius: 8px;
	}
	.overview-row.no-label-row {
		cursor: default;
	}
	.overview-row.no-label-row:hover {
		background: transparent;
	}
	.overview-action-row {
		cursor: default;
		align-items: stretch;
	}
	.overview-action-row:hover {
		background: transparent;
	}
	.overview-action-row .outcome-label {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.overview-action-label-col {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-height: 0;
	}
	.overview-action-label {
		font-size: 0.65rem;
		font-weight: 700;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.overview-action-lane-labels {
		display: grid;
		grid-template-rows: 1fr 1fr;
		align-items: end;
		flex: 1;
		min-height: 0;
	}
	.overview-action-lane-labels .overview-lane-label.agent {
		align-self: end;
	}
	.overview-action-lane-labels .overview-lane-label.user {
		align-self: start;
	}
	.overview-lane-label {
		font-size: 0.55rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.overview-lane-label.agent { color: #b08540; }
	.overview-lane-label.user { color: #3d8968; }
	.overview-action-track {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 0;
		min-width: 0;
		flex: 1;
		padding: 0;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
	}
	.outcome-full-tooltip {
		position: absolute;
		left: 0;
		bottom: 100%;
		margin-bottom: 6px;
		z-index: 20;
		max-width: 420px;
		max-height: 280px;
		padding: 0.6rem 0.75rem;
		background: #1f2937;
		color: #f9fafb;
		font-size: 0.8rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
		overflow: auto;
		border-radius: 8px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transition: opacity 0.15s, visibility 0.15s;
	}
	.outcome-full-tooltip.visible {
		opacity: 1;
		visibility: visible;
	}
	.overview-row.has-dep .outcome-label {
		/* Step per level = dep-connector width (0.6rem) so connectors align */
		padding-left: calc(0.5rem + (var(--dep-depth, 1) - 1) * 0.6rem);
	}
	.connector {
		flex-shrink: 0;
		display: inline-block;
		margin-right: 0.35rem;
		vertical-align: middle;
	}
	/* Hierarchy: L-shaped branch (vertical + horizontal); color by layer depth */
	.dep-connector {
		width: 0.6rem;
		height: 0.65em;
		border-left: 2px solid var(--outcome-blue, #0ea5e9);
		border-bottom: 2px solid var(--outcome-blue, #0ea5e9);
		border-radius: 0 0 0 2px;
		box-sizing: border-box;
	}
	/* Related: flat horizontal line only, no indent */
	.outcome-label {
		flex-shrink: 0;
		width: 320px;
		display: flex;
		align-items: flex-start;
		gap: 0.35rem;
		padding: 0.25rem 0.4rem;
		text-align: left;
		font-size: 0.8rem;
		color: #374151;
		pointer-events: none;
	}
	.outcome-index {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 700;
		color: #fff;
		background: var(--outcome-blue, #0ea5e9);
		border-radius: 50%;
		margin-top: 0.1em;
		box-shadow: 0 1px 4px rgba(14, 165, 233, 0.35);
	}
	.outcome-title {
		flex: 1;
		min-width: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
		line-height: 1.35;
	}
	.outcome-track {
		flex: 1;
		position: relative;
		min-height: 24px;
		background: #f1f5f9;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		min-width: 0;
	}
	.turn-cell {
		position: absolute;
		bottom: 2px;
		top: 2px;
		width: 20px;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		transform: translateX(-50%);
		pointer-events: auto;
	}
	.turn-cell.turn-cell-first {
		transform: translateX(0);
	}
	.turn-cell.turn-cell-last {
		left: 100%;
		transform: translateX(-100%);
	}
	.bar-pair {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		justify-content: center;
		gap: 2px;
		height: 100%;
		max-height: 20px;
	}
	.bar-stack {
		width: 8px;
		height: 100%;
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		justify-content: flex-end;
		transform: scaleY(var(--scale, 1));
		transform-origin: bottom;
	}
	.bar-stack .bar {
		width: 100%;
		height: 100%;
		min-height: 3px;
		border-radius: 1px;
	}
	.bar.shaper {
		background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
		border: 1px solid #b45309;
		box-shadow: 0 1px 2px rgba(217, 119, 6, 0.2);
	}
	.bar.executor {
		background: linear-gradient(180deg, #a5b4fc 0%, #6366f1 100%);
		border: 1px solid #4f46e5;
		box-shadow: 0 1px 2px rgba(99, 102, 241, 0.2);
	}

</style>
