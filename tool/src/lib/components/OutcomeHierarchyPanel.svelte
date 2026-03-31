<script lang="ts">
	import type { OutcomeNode } from '$lib/types';
	import { stripTrailingParen, outcomeSortKey, outcomeLabel } from '$lib/utils';

	type DepEdge = { parentId: string; childId: string };

	let {
		outcomes = [],
		dependencyEdges = [],
		selectedOutcomeId = null,
		showRequirements = false,
		requirementTextsByOutcome = new Map<string, string[]>(),
		onOutcomeClick
	}: {
		outcomes: OutcomeNode[];
		dependencyEdges?: DepEdge[];
		selectedOutcomeId?: string | null;
		showRequirements?: boolean;
		requirementTextsByOutcome?: Map<string, string[]>;
		onOutcomeClick?: (outcomeId: string) => void;
	} = $props();

	// DFS-based cycle detection: drop back-edges (edges into a node currently on the stack)
	// so the result is guaranteed acyclic regardless of ID ordering.
	const acyclicEdges = $derived.by(() => {
		const ids = new Set(outcomes.map((o) => o.outcome_id));
		const validEdges = dependencyEdges.filter(
			(e) => ids.has(e.parentId) && ids.has(e.childId) && e.parentId !== e.childId
		);

		const adj = new Map<string, DepEdge[]>();
		for (const e of validEdges) {
			const list = adj.get(e.parentId) ?? [];
			list.push(e);
			adj.set(e.parentId, list);
		}

		const UNVISITED = 0, IN_STACK = 1, DONE = 2;
		const state = new Map<string, number>();
		const backEdges = new Set<DepEdge>();

		const dfs = (node: string) => {
			state.set(node, IN_STACK);
			for (const edge of adj.get(node) ?? []) {
				const s = state.get(edge.childId) ?? UNVISITED;
				if (s === IN_STACK) backEdges.add(edge);
				else if (s === UNVISITED) dfs(edge.childId);
			}
			state.set(node, DONE);
		};

		for (const o of outcomes) {
			if ((state.get(o.outcome_id) ?? UNVISITED) === UNVISITED) dfs(o.outcome_id);
		}

		return validEdges.filter((e) => !backEdges.has(e));
	});

	const parentByOutcomeId = $derived.by(() => {
		const map = new Map<string, string>();
		for (const e of acyclicEdges) {
			if (!map.has(e.childId)) map.set(e.childId, e.parentId);
		}
		return map;
	});

	const childrenByParentId = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const e of acyclicEdges) {
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
			for (const c of childrenByParentId.get(oid) ?? []) visit(c, depth + 1);
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

	function truncate(s: string, n: number): string {
		return s.length <= n ? s : s.slice(0, n) + '…';
	}
</script>

<div class="hierarchy-panel">
	<h3 class="panel-title">Outcome hierarchy</h3>
	<label class="toggle-req">
		<input type="checkbox" bind:checked={showRequirements} />
		<span>Show requirements</span>
	</label>
	<ul class="hierarchy-list" role="tree">
		{#each orderedOutcomes as outcome}
			{@const depth = displayDepthByOutcomeId.get(outcome.outcome_id) ?? 0}
			{@const num = outcomeLabel(outcome.outcome_id)}
			<li
				class="hierarchy-item"
				class:selected={selectedOutcomeId === outcome.outcome_id}
				style="--depth: {depth};"
				role="treeitem"
				aria-selected={selectedOutcomeId === outcome.outcome_id}
				tabindex="0"
				onclick={() => onOutcomeClick?.(outcome.outcome_id)}
				onkeydown={(e) => e.key === 'Enter' && onOutcomeClick?.(outcome.outcome_id)}
			>
				<span class="outcome-num">{num}</span>
				<span class="outcome-title" title={outcome.outcome ?? outcome.outcome_id}>{truncate(stripTrailingParen(outcome.outcome ?? outcome.outcome_id), 60)}</span>
				{#if showRequirements}
					{@const reqTexts = requirementTextsByOutcome.get(outcome.outcome_id) ?? []}
					{#if reqTexts.length > 0}
						<ul class="req-sublist">
							{#each reqTexts as text}
								<li class="req-item">{truncate(text, 50)}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.hierarchy-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		min-width: 0;
	}
	.panel-title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #111827;
	}
	.toggle-req {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: #6b7280;
		cursor: pointer;
	}
	.toggle-req input {
		cursor: pointer;
	}
	.hierarchy-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hierarchy-item {
		padding: 0.4rem 0.5rem;
		padding-left: calc(0.5rem + var(--depth, 0) * 1rem);
		margin: 0.15rem 0;
		min-height: 32px;
		box-sizing: border-box;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		border-left: 3px solid transparent;
	}
	.hierarchy-item:hover {
		background: #f3f4f6;
	}
	.hierarchy-item.selected {
		background: #e0f2fe;
		border-left-color: #0284c7;
	}
	.outcome-num {
		font-weight: 600;
		color: #64748b;
		font-size: 0.75rem;
		margin-right: 0.35rem;
	}
	.outcome-title {
		font-size: 0.875rem;
		line-height: 1.35;
		color: #111827;
	}
	.req-sublist {
		list-style: none;
		margin: 0.25rem 0 0 0;
		padding-left: 1rem;
		border-left: 1px solid #e5e7eb;
	}
	.req-item {
		font-size: 0.75rem;
		color: #6b7280;
		line-height: 1.3;
		margin: 0.15rem 0;
	}
</style>
