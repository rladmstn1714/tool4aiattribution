<script lang="ts">
	import { isAssistantSpeakerId } from '$lib/speakerUtils';
	import type { RequirementActionMap, UtteranceListData, OutcomeActionItem } from '$lib/data/dataLoader';

	type OriginAction = { action_id: string; role: string; action_text: string };

	function getTurnIdFromActionId(actionId: string): number {
		const parts = actionId.split('-');
		return parseInt(parts[0], 10) || 0;
	}

	let {
		requirementIds = [],
		requirementActionMap = {},
		utteranceList,
		finalTurn = 1,
		highlightedActionIds = null,
		selectedRequirementId = null,
		requirementCreationTurn = null,
		creationActionIds = null,
		earliestVersionCreationTurn = null,
		creationTurnAction = null,
		inheritedFromEarlierActionIds = null,
		selectedActionId = null,
		hoveredActionId = null,
		onActionHover,
		onActionClick,
		outcomeTurnIdWhenNoReqs = null,
		outcomeActionsFromMap = null,
		embedded = false,
		actionFilter,
		outcomeCreatedTurn = null
	}: {
		requirementIds: string[];
		requirementActionMap: RequirementActionMap;
		utteranceList: UtteranceListData | null;
		finalTurn: number;
		highlightedActionIds?: Set<string> | null;
		selectedRequirementId?: string | null;
		requirementCreationTurn?: number | null;
		/** Only these action IDs show "Created here!" (creation_action_ids / origin_actions). */
		creationActionIds?: Set<string> | null;
		earliestVersionCreationTurn?: number | null;
		creationTurnAction?: { action_id: string; role: string; action_text: string } | null;
		inheritedFromEarlierActionIds?: Set<string> | null;
		selectedActionId?: string | null;
		hoveredActionId?: string | null;
		onActionHover?: (actionId: string | null) => void;
		onActionClick?: (actionId: string) => void;
		/** When outcome has no requirements, show actions with turn_id <= this (fallback when no outcome_action_map) */
		outcomeTurnIdWhenNoReqs?: number | null;
		/** When outcome has no requirements and outcome_action_map.json exists, use these actions (preferred) */
		outcomeActionsFromMap?: OutcomeActionItem[] | null;
		/** When true, render without header and without lane labels so track uses full width (e.g. inside Overview timeline) */
		embedded?: boolean;
		/** When set, show only direct or only indirect actions; 'all' = show all (default). */
		actionFilter?: 'direct' | 'indirect' | 'all';
		/** When set (e.g. no requirement selected), show star at this turn for "Outcome created here". */
		outcomeCreatedTurn?: number | null;
	} = $props();

	const speakerByTurn = $derived.by(() => {
		const map = new Map<number, string>();
		if (!utteranceList?.utterances) return map;
		for (const u of utteranceList.utterances) {
			map.set(u.turn_id, u.speaker);
		}
		return map;
	});

	type TimelineAction = OriginAction & { turn_id: number; speaker: string; influential?: boolean };

	const timelineActions = $derived.by((): TimelineAction[] => {
		// When outcome has no requirements and outcome_action_map has an entry, use it (exact outcome–action pairs; empty = no markers)
		if (requirementIds.length === 0 && outcomeActionsFromMap != null) {
			const list: TimelineAction[] = outcomeActionsFromMap.map((a) => ({
				action_id: a.action_id,
				role: a.role ?? 'EXECUTOR',
				action_text: a.action_text,
				turn_id: a.turn_id,
				speaker: a.speaker ?? (a.turn_id != null ? speakerByTurn.get(a.turn_id) ?? 'user' : 'user')
			}));
			list.sort((a, b) => a.turn_id - b.turn_id || a.action_id.localeCompare(b.action_id));
			return list;
		}
		const seen = new Map<string, TimelineAction>();
		const maxTurn = requirementIds.length === 0 ? outcomeTurnIdWhenNoReqs : null;
		const add = (a: { action_id: string; role: string; action_text: string }, influential: boolean) => {
			const turn_id = getTurnIdFromActionId(a.action_id);
			if (maxTurn != null && turn_id > maxTurn) return;
			const existing = seen.get(a.action_id);
			if (existing) {
				// Direct (origin/impl/contributing) always wins: never show as transparent. If we're adding as direct, downgrade.
				if (!influential) {
					existing.influential = false;
				} else if (existing.influential !== false) {
					existing.influential = true;
				}
				return;
			}
			const speaker = speakerByTurn.get(turn_id) ?? 'user';
			seen.set(a.action_id, { ...a, turn_id, speaker, influential: influential === true ? true : false });
		};
		if (requirementIds.length > 0) {
			for (const reqId of requirementIds) {
				const entry = requirementActionMap[reqId];
				if (!entry) continue;
				const origin = Array.isArray(entry.origin_actions) ? entry.origin_actions : [];
				const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
					? (entry as { contributing_actions: { action_id: string; role: string; action_text: string }[] }).contributing_actions
					: [];
				const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
					? (entry as { implementation_actions: { action_id: string; role: string; action_text: string }[] }).implementation_actions
					: [];
				const related = Array.isArray(entry.related_actions) ? entry.related_actions : [];
				const isSelectedReq = selectedRequirementId != null && reqId === selectedRequirementId;
				for (const a of origin) add(a, false);
				for (const a of contrib) add(a, false);
				for (const a of impl) add(a, false);
				for (const a of related) {
					if (a && typeof a === 'object' && 'action_id' in a && 'action_text' in a) {
						const r = a as { action_id: string; role?: string; action_text: string; influence?: string };
						add(
							{ action_id: r.action_id, role: r.role ?? '', action_text: r.action_text },
							isSelectedReq && r.influence === 'indirect'
						);
					}
				}
			}
			// Overlay outcome_action_map so goal-level roles (e.g. user SHAPER) appear when requirements exist too.
			if (outcomeActionsFromMap != null) {
				for (const a of outcomeActionsFromMap) {
					const turn_id = a.turn_id ?? getTurnIdFromActionId(a.action_id);
					const speaker = a.speaker ?? speakerByTurn.get(turn_id) ?? 'user';
					const existing = seen.get(a.action_id);
					if (existing) {
						existing.role = a.role ?? existing.role;
						existing.action_text = a.action_text || existing.action_text;
						existing.turn_id = turn_id;
						existing.speaker = speaker;
					} else {
						seen.set(a.action_id, {
							action_id: a.action_id,
							role: a.role ?? 'EXECUTOR',
							action_text: a.action_text,
							turn_id,
							speaker,
							influential: false
						});
					}
				}
			}
		} else if (maxTurn != null) {
			for (const entry of Object.values(requirementActionMap)) {
				if (!entry) continue;
				const origin = Array.isArray(entry.origin_actions) ? entry.origin_actions : [];
				const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
					? (entry as { contributing_actions: { action_id: string; role: string; action_text: string }[] }).contributing_actions
					: [];
				const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
					? (entry as { implementation_actions: { action_id: string; role: string; action_text: string }[] }).implementation_actions
					: [];
				for (const a of origin) add(a, false);
				for (const a of contrib) add(a, false);
				for (const a of impl) add(a, false);
				const related = Array.isArray(entry.related_actions) ? entry.related_actions : [];
				for (const a of related) {
					if (a && typeof a === 'object' && 'action_id' in a && 'action_text' in a) {
						const r = a as { action_id: string; role?: string; action_text: string };
						add({ action_id: r.action_id, role: r.role ?? '', action_text: r.action_text }, false);
					}
				}
			}
		}
		let list = Array.from(seen.values());
		// If creation turn has no marker (e.g. viewing Current), inject the creation-turn action so the star can attach to it
		if (
			requirementCreationTurn != null &&
			selectedRequirementId != null &&
			creationTurnAction != null &&
			!list.some((a) => a.turn_id === requirementCreationTurn)
		) {
			const parts = creationTurnAction.action_id.split('-');
			const turn_id = parseInt(parts[0], 10) || 0;
			const speaker = speakerByTurn.get(turn_id) ?? 'user';
			list = [...list, { ...creationTurnAction, turn_id, speaker }];
			list.sort((a, b) => a.turn_id - b.turn_id || a.action_id.localeCompare(b.action_id));
		} else {
			list.sort((a, b) => a.turn_id - b.turn_id || a.action_id.localeCompare(b.action_id));
		}
		return list;
	});

	/** Actions to display: all, or filtered by direct/indirect when actionFilter is set */
	const filteredTimelineActions = $derived.by(() => {
		const filter = actionFilter ?? 'all';
		if (filter === 'direct') return timelineActions.filter((a) => !a.influential);
		if (filter === 'indirect') return timelineActions.filter((a) => a.influential);
		return timelineActions;
	});

	const agentActions = $derived(filteredTimelineActions.filter((a) => isAssistantSpeakerId(a.speaker)));
	const userActions = $derived(filteredTimelineActions.filter((a) => !isAssistantSpeakerId(a.speaker)));

	/** When hovering an action, its turn — used to spread multiple markers at same turn */
	const hoveredTurnIdFromAction = $derived.by(() => {
		if (!hoveredActionId) return null;
		const parts = hoveredActionId.split('-');
		return parseInt(parts[0], 10) || null;
	});

	/** Turns that have multiple actions in either lane — spread when cursor is over these */
	const turnsWithMultipleActions = $derived.by(() => {
		const set = new Set<number>();
		const byTurn = (list: TimelineAction[]) => {
			const m = new Map<number, number>();
			for (const a of list) m.set(a.turn_id, (m.get(a.turn_id) ?? 0) + 1);
			for (const [t, n] of m) if (n > 1) set.add(t);
		};
		byTurn(agentActions);
		byTurn(userActions);
		return set;
	});

	let hoveredTurnIdFromPosition = $state<number | null>(null);
	const hoveredTurnId = $derived(hoveredTurnIdFromAction ?? hoveredTurnIdFromPosition);

	function handleTrackMouseMove(e: MouseEvent, trackEl: HTMLElement) {
		const rect = trackEl.getBoundingClientRect();
		const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		const turn = Math.round((percent / 100) * finalTurn);
		hoveredTurnIdFromPosition = turnsWithMultipleActions.has(turn) ? turn : null;
	}
	function handleTrackMouseLeave() {
		hoveredTurnIdFromPosition = null;
	}

	/** Per-lane: for each turn with multiple actions, assign spread index 0,1,2... when that turn is hovered */
	function getSpreadOffset(actions: TimelineAction[], turnId: number, actionId: string): number {
		if (hoveredTurnId !== turnId) return 0;
		const atTurn = actions.filter((a) => a.turn_id === turnId);
		if (atTurn.length <= 1) return 0;
		const index = atTurn.findIndex((a) => a.action_id === actionId);
		if (index < 0) return 0;
		const step = 5; // % offset per step (wider spread so labels stay visible)
		return (index - (atTurn.length - 1) / 2) * step;
	}

	/** Count of actions at this turn in this lane (for badge when > 1) */
	function getSameTurnCount(actions: TimelineAction[], turnId: number): number {
		return actions.filter((a) => a.turn_id === turnId).length;
	}

	/** Index of this action among same-turn actions (0 = first); show badge only on first when stacked */
	function getSameTurnIndex(actions: TimelineAction[], turnId: number, actionId: string): number {
		const atTurn = actions.filter((a) => a.turn_id === turnId);
		return atTurn.findIndex((a) => a.action_id === actionId);
	}

	const turnTicks = $derived.by(() => {
		if (finalTurn <= 0) return [];
		const step = finalTurn <= 10 ? 1 : finalTurn <= 30 ? 5 : 10;
		const ticks: number[] = [];
		for (let t = 0; t <= finalTurn; t += step) ticks.push(t);
		if (ticks[ticks.length - 1] !== finalTurn) ticks.push(finalTurn);
		return ticks;
	});

	const roleDescriptions: Record<string, string> = {
		SHAPER: 'Shaper: Proposing ideas, shaping direction',
		EXECUTOR: 'Executor: Executing tasks, implementing solutions'
	};

	function positionPercent(turn_id: number): number {
		if (finalTurn <= 0) return 0;
		return Math.min(100, Math.max(0, (turn_id / finalTurn) * 100));
	}

	function isDimmed(actionId: string): boolean {
		return highlightedActionIds != null && !highlightedActionIds.has(actionId);
	}

	function isActive(actionId: string): boolean {
		return selectedActionId === actionId || hoveredActionId === actionId;
	}

	function truncate(s: string, n: number): string {
		return s.length <= n ? s : s.slice(0, n) + '…';
	}
</script>

<div class="tl-wrap" class:embedded>
	{#if !embedded}
	<div class="tl-header">
		<div class="tl-header-row">
			<h3 class="tl-title">Timeline</h3>
			<span class="tl-subtitle">Turn 1 – {finalTurn + 1}</span>
			<span class="tl-legend-wrap">
				{#if selectedRequirementId}
					<span class="tl-legend" title="Actions that directly contributed to the selected requirement">
						<span class="tl-legend-solid"></span> Direct
					</span>
					<span class="tl-legend" title="Actions that indirectly influenced the selected requirement">
						<span class="tl-legend-dash"></span> Indirect influence
					</span>
				{/if}
			</span>
		</div>
		<div class="tl-role-legend">
			<span class="tl-role-legend-item">
				<span class="tl-role-swatch user-swatch"></span>
				<span class="tl-role-label">User</span>
			</span>
			<span class="tl-role-legend-item">
				<span class="tl-role-swatch assistant-swatch"></span>
				<span class="tl-role-label">Assistant</span>
			</span>
			<span class="tl-role-legend-divider"></span>
			<span class="tl-role-legend-item">
				<span class="tl-role-icon" data-role="SHAPER"></span>
				<span class="tl-role-label">Shaper</span>
			</span>
			<span class="tl-role-legend-item">
				<span class="tl-role-icon" data-role="EXECUTOR"></span>
				<span class="tl-role-label">Executor</span>
			</span>
			{#if selectedRequirementId && inheritedFromEarlierActionIds != null}
				<span class="tl-role-legend-divider"></span>
				<span class="tl-role-legend-item" title="Actions from Earlier version are toned down">
					<span class="tl-legend-earlier"></span>
					<span class="tl-role-label">From Earlier</span>
				</span>
			{/if}
		</div>
	</div>
	{/if}

	<div class="tl-body">
		<!-- Agent lane (above) -->
		<div class="tl-lane above">
			<span class="lane-label agent" class:embedded>Assistant</span>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lane-track"
				role="presentation"
				onmousemove={(e) => handleTrackMouseMove(e, e.currentTarget as HTMLElement)}
				onmouseleave={handleTrackMouseLeave}
			>
				{#each agentActions as action}
					{@const spread = getSpreadOffset(agentActions, action.turn_id, action.action_id)}
					{@const sameCount = getSameTurnCount(agentActions, action.turn_id)}
					{@const sameIndex = getSameTurnIndex(agentActions, action.turn_id, action.action_id)}
					{@const fromEarlier = inheritedFromEarlierActionIds != null && inheritedFromEarlierActionIds.has(action.action_id)}
					{@const newInCurrent = inheritedFromEarlierActionIds != null && !fromEarlier}
					<!-- Stem at turn position (one per action; overlap at same turn); only icons spread -->
					<div
						class="stem-anchor above"
						class:dimmed={isDimmed(action.action_id)}
						class:active={isActive(action.action_id)}
						class:direct={selectedRequirementId && !action.influential}
						class:influential={action.influential}
						class:from-earlier={fromEarlier}
						class:new-in-current={newInCurrent}
						style="left: {positionPercent(action.turn_id)}%;"
					>
						<div class="stem"></div>
					</div>
					<div
						class="marker-group above"
						class:dimmed={isDimmed(action.action_id)}
						class:active={isActive(action.action_id)}
						class:direct={selectedRequirementId && !action.influential}
						class:influential={action.influential}
						class:from-earlier={fromEarlier}
						class:new-in-current={newInCurrent}
						class:spread={spread !== 0}
						class:has-badge={sameCount > 1 && sameIndex === 0}
						style="left: {positionPercent(action.turn_id) + spread}%;"
					>
						<div class="marker-wrap">
							{#if sameCount > 1 && sameIndex === 0}
								<span class="turn-count-badge" title="{sameCount} actions at this turn">{sameCount}</span>
							{/if}
							{#if creationActionIds != null && creationActionIds.has(action.action_id)}
								<span class="creation-badge above" title="Created here">⭐</span>
							{:else if earliestVersionCreationTurn != null && action.turn_id === earliestVersionCreationTurn}
								<span class="creation-badge above earliest" title="First created here (earlier version)">⭐</span>
							{:else if outcomeCreatedTurn != null && action.turn_id === outcomeCreatedTurn}
								<span class="creation-badge above outcome-created" title="Outcome created here">⭐</span>
							{/if}
							<button
								class="marker agent"
								data-tutorial-marker
								title="{(selectedRequirementId && !action.influential) ? 'Direct action — ' : action.influential ? 'Influential action — ' : ''}{fromEarlier ? 'From Earlier. ' : newInCurrent ? 'New in Current. ' : ''}{roleDescriptions[action.role] ?? action.role} — T{action.turn_id + 1}: {truncate(action.action_text, 80)}"
								onmouseenter={() => onActionHover?.(action.action_id)}
								onmouseleave={() => onActionHover?.(null)}
								onclick={() => onActionClick?.(action.action_id)}
							>
								<span class="role-icon" data-role={action.role}></span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Central axis: when embedded show line only (no turn numbers), otherwise full axis -->
		<div class="tl-axis" class:axis-line-only={embedded}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="axis-line"
				role="presentation"
				onmousemove={(e) => handleTrackMouseMove(e, e.currentTarget as HTMLElement)}
				onmouseleave={handleTrackMouseLeave}
			>
				{#each turnTicks as t}
					<div class="tick" style="left: {positionPercent(t)}%;">
						<div class="tick-mark"></div>
						{#if !embedded}
							<span class="tick-label">{t + 1}</span>
						{/if}
					</div>
				{/each}
				{#if requirementCreationTurn != null && selectedRequirementId != null && !filteredTimelineActions.some((a) => a.turn_id === requirementCreationTurn)}
					<div
						class="creation-turn-marker"
						style="left: {positionPercent(requirementCreationTurn)}%;"
						title="Created here (Turn {requirementCreationTurn + 1})"
					>
						<span class="creation-turn-star">⭐</span>
					</div>
				{/if}
				{#if earliestVersionCreationTurn != null && earliestVersionCreationTurn !== requirementCreationTurn && !filteredTimelineActions.some((a) => a.turn_id === earliestVersionCreationTurn)}
					<div
						class="creation-turn-marker earliest"
						style="left: {positionPercent(earliestVersionCreationTurn)}%;"
						title="First created here (Turn {earliestVersionCreationTurn + 1})"
					>
						<span class="creation-turn-star">⭐</span>
					</div>
				{/if}
				{#if outcomeCreatedTurn != null && !filteredTimelineActions.some((a) => a.turn_id === outcomeCreatedTurn)}
					<div
						class="creation-turn-marker outcome-created"
						style="left: {positionPercent(outcomeCreatedTurn)}%;"
						title="Outcome created here (Turn {outcomeCreatedTurn + 1})"
					>
						<span class="creation-turn-star">⭐</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- User lane (below) -->
		<div class="tl-lane below">
			<span class="lane-label user" class:embedded>User</span>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lane-track"
				role="presentation"
				onmousemove={(e) => handleTrackMouseMove(e, e.currentTarget as HTMLElement)}
				onmouseleave={handleTrackMouseLeave}
			>
				{#each userActions as action}
					{@const spread = getSpreadOffset(userActions, action.turn_id, action.action_id)}
					{@const sameCount = getSameTurnCount(userActions, action.turn_id)}
					{@const sameIndex = getSameTurnIndex(userActions, action.turn_id, action.action_id)}
					{@const fromEarlier = inheritedFromEarlierActionIds != null && inheritedFromEarlierActionIds.has(action.action_id)}
					{@const newInCurrent = inheritedFromEarlierActionIds != null && !fromEarlier}
					<!-- Stem at turn position (one per action; overlap at same turn); only icons spread -->
					<div
						class="stem-anchor below"
						class:dimmed={isDimmed(action.action_id)}
						class:active={isActive(action.action_id)}
						class:direct={selectedRequirementId && !action.influential}
						class:influential={action.influential}
						class:from-earlier={fromEarlier}
						class:new-in-current={newInCurrent}
						style="left: {positionPercent(action.turn_id)}%;"
					>
						<div class="stem"></div>
					</div>
					<div
						class="marker-group below"
						class:dimmed={isDimmed(action.action_id)}
						class:active={isActive(action.action_id)}
						class:direct={selectedRequirementId && !action.influential}
						class:influential={action.influential}
						class:from-earlier={fromEarlier}
						class:new-in-current={newInCurrent}
						class:spread={spread !== 0}
						class:has-badge={sameCount > 1 && sameIndex === 0}
						style="left: {positionPercent(action.turn_id) + spread}%;"
					>
						<div class="marker-wrap">
							{#if sameCount > 1 && sameIndex === 0}
								<span class="turn-count-badge" title="{sameCount} actions at this turn">{sameCount}</span>
							{/if}
							{#if creationActionIds != null && creationActionIds.has(action.action_id)}
								<span class="creation-badge below" title="Created here">⭐</span>
							{:else if earliestVersionCreationTurn != null && action.turn_id === earliestVersionCreationTurn}
								<span class="creation-badge below earliest" title="First created here (earlier version)">⭐</span>
							{:else if outcomeCreatedTurn != null && action.turn_id === outcomeCreatedTurn}
								<span class="creation-badge below outcome-created" title="Outcome created here">⭐</span>
							{/if}
							<button
								class="marker user"
								data-tutorial-marker
								title="{(selectedRequirementId && !action.influential) ? 'Direct action — ' : action.influential ? 'Influential action — ' : ''}{fromEarlier ? 'From Earlier. ' : newInCurrent ? 'New in Current. ' : ''}{roleDescriptions[action.role] ?? action.role} — T{action.turn_id + 1}: {truncate(action.action_text, 80)}"
								onmouseenter={() => onActionHover?.(action.action_id)}
								onmouseleave={() => onActionHover?.(null)}
								onclick={() => onActionClick?.(action.action_id)}
							>
								<span class="role-icon" data-role={action.role}></span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.tl-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.2rem 1.4rem;
		background: linear-gradient(180deg, #fefefe 0%, #f8fafc 100%);
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
		min-width: 0;
	}
	.tl-wrap.embedded {
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 0;
		box-shadow: none;
		gap: 0;
		width: 100%;
		min-width: 0;
	}
	.tl-wrap.embedded .tl-axis {
		padding-left: 0;
	}
	.tl-header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.tl-header-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	
	.tl-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.02em;
	}
	.tl-subtitle {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 500;
	}
	.tl-legend-wrap {
		display: inline-flex;
		align-items: center;
		gap: 1rem;
		margin-left: auto;
	}
	.tl-legend {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.tl-legend-wrap .tl-legend:first-child {
		color: #92400e;
	}
	.tl-legend-wrap .tl-legend:last-child {
		color: #6b7280;
	}
	
	.tl-legend-solid {
		display: inline-block;
		width: 14px;
		height: 0;
		border-top: 2px solid #92400e;
	}
	.tl-legend-dash {
		display: inline-block;
		width: 14px;
		height: 0;
		border-top: 2px dashed #6b7280;
	}
	.tl-legend-earlier {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: #e5e7eb;
		border: 1px solid #9ca3af;
		opacity: 0.85;
	}

	.tl-role-legend {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
	}
	.tl-role-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.tl-role-swatch {
		display: inline-block;
		width: 14px;
		height: 8px;
		border-radius: 3px;
	}
	.tl-role-swatch.user-swatch {
		background: linear-gradient(135deg, #5cb88a, #4a9e7a);
	}
	.tl-role-swatch.assistant-swatch {
		background: linear-gradient(135deg, #f5c842, #eab308);
	}
	.tl-role-label {
		font-size: 0.65rem;
		font-weight: 600;
		color: #6b7280;
	}
	.tl-role-icon {
		display: inline-block;
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}
	.tl-role-icon[data-role='SHAPER'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.tl-role-icon[data-role='EXECUTOR'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.tl-role-legend-divider {
		width: 1px;
		height: 12px;
		background: #cbd5e1;
		flex-shrink: 0;
	}

	.tl-body {
		display: flex;
		flex-direction: column;
		gap: 0;
		position: relative;
	}

	/* Lanes */
	.tl-lane {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		position: relative;
	}
	.tl-lane.below {
		align-items: flex-start;
	}
	.lane-label {
		flex-shrink: 0;
		width: 58px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-align: right;
		padding: 0 0.25rem;
	}
	.lane-label.agent { color: #b08540; }
	.lane-label.user { color: #3d8968; }
	.lane-label.embedded {
		width: 0;
		min-width: 0;
		padding: 0;
		overflow: hidden;
		font-size: 0;
		line-height: 0;
	}
	.lane-track {
		flex: 1;
		position: relative;
		height: 44px;
		min-width: 0;
	}

	/* Marker groups (marker + stem) */
	.marker-group {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		transform: translateX(-50%);
		transition: opacity 0.2s, left 0.2s ease;
		z-index: 1;
	}
	.marker-group.above {
		bottom: 0;
	}
	.marker-group.below {
		top: 0;
	}
	.marker-group.dimmed {
		opacity: 0.25;
	}
	.marker-group.active {
		z-index: 3;
	}
	/* Badge visible on top when markers stack at same turn */
	.marker-group.has-badge {
		z-index: 2;
	}

	/* Stem (vertical line) and stem-anchor at turn position */
	.stem {
		width: 2px;
		height: 10px;
		min-height: 10px;
		border-radius: 1px;
		transition: height 0.15s, background 0.15s;
		flex-shrink: 0;
	}

	/* Stem anchored at turn position (stays put; only icons spread) */
	.stem-anchor {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		transform: translateX(-50%);
		z-index: 0;
		pointer-events: none;
		transition: opacity 0.2s;
		min-width: 2px;
		min-height: 10px;
	}
	.stem-anchor.above {
		bottom: 0;
		justify-content: flex-end;
	}
	.stem-anchor.below {
		top: 0;
		justify-content: flex-start;
	}
	.stem-anchor.dimmed {
		opacity: 0.25;
	}
	.stem-anchor.above .stem {
		background: linear-gradient(to bottom, transparent, #f59e0b);
	}
	.stem-anchor.below .stem {
		background: linear-gradient(to top, transparent, #22c55e);
	}
	.stem-anchor.active .stem {
		height: 14px;
	}
	.stem-anchor.active.above .stem {
		background: linear-gradient(to bottom, transparent, #2563eb);
	}
	.stem-anchor.active.below .stem {
		background: linear-gradient(to top, transparent, #2563eb);
	}
	/* Influential (indirect): thick dashed stem */
	.stem-anchor.influential .stem {
		height: 14px;
		background: none;
		border-left: none;
		border-radius: 0;
	}
	.stem-anchor.influential.above .stem {
		border-left: 3px dashed #6b7280;
		box-shadow: 0 0 0 1px rgba(107, 114, 128, 0.3);
	}
	.stem-anchor.influential.below .stem {
		border-left: 3px dashed #6b7280;
		box-shadow: 0 0 0 1px rgba(107, 114, 128, 0.3);
	}
	.stem-anchor.influential.active.above .stem,
	.stem-anchor.influential.active.below .stem {
		border-left-width: 3px;
		border-left-color: #4b5563;
		box-shadow: 0 0 0 2px rgba(75, 85, 99, 0.35);
	}

	/* Marker button */
	.marker {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 2px solid transparent;
		cursor: pointer;
		border-radius: 50%;
		width: 26px;
		height: 26px;
		transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
	}
	.marker.agent {
		background: linear-gradient(180deg, #facc15 0%, #eab308 100%);
		border-color: #ca8a04;
		box-shadow: 0 2px 6px rgba(234, 179, 8, 0.35), 0 1px 0 rgba(255, 255, 255, 0.3) inset;
	}
	.marker.user {
		background: linear-gradient(180deg, #5cb88a 0%, #4a9e7a 100%);
		border-color: #3d8968;
		box-shadow: 0 2px 6px rgba(74, 158, 122, 0.35), 0 1px 0 rgba(255, 255, 255, 0.25) inset;
	}
	.marker-group.influential .marker {
		border: 3px dashed #6b7280;
		box-shadow: 0 1px 4px rgba(107, 114, 128, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
	}
	.marker-group.influential.active .marker {
		border: 3px dashed #4b5563;
		box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.4), 0 0 0 5px rgba(107, 114, 128, 0.2);
	}
	.marker:hover {
		transform: scale(1.12);
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
	}
	.marker-group.active .marker {
		transform: scale(1.18);
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35), 0 2px 10px rgba(37, 99, 235, 0.2);
	}

	.marker-wrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.turn-count-badge {
		position: absolute;
		top: -6px;
		right: -6px;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		font-weight: 700;
		color: #fff;
		background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
		border: 1px solid #fff;
		border-radius: 7px;
		box-shadow: 0 1px 3px rgba(37, 99, 235, 0.4);
		z-index: 2;
		pointer-events: none;
	}
	.creation-badge {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.75rem;
		line-height: 1;
		z-index: 3;
		pointer-events: none;
	}
	.creation-badge.above {
		bottom: 100%;
		margin-bottom: 2px;
	}
	.creation-badge.below {
		top: 100%;
		margin-top: 2px;
	}
	.creation-badge.earliest {
		opacity: 0.75;
		filter: grayscale(1) brightness(0.9);
	}
	/* From Earlier: toned-down grayish marker and stem */
	.stem-anchor.from-earlier.above .stem {
		background: linear-gradient(to bottom, transparent, #b0b4b8);
	}
	.stem-anchor.from-earlier.below .stem {
		background: linear-gradient(to top, transparent, #9ca89e);
	}
	.marker-group.from-earlier .marker.agent {
		background: #c4b896;
		border-color: #a89b6e;
		opacity: 0.85;
		filter: saturate(0.7) brightness(1.05);
	}
	.marker-group.from-earlier .marker.user {
		background: #8a9e8e;
		border-color: #6b7c6e;
		opacity: 0.85;
		filter: saturate(0.7) brightness(1.05);
	}
	.marker-group.from-earlier.active .marker {
		opacity: 1;
		filter: saturate(0.85) brightness(1.1);
	}

	/* White role icons inside markers */
	.role-icon {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}
	.role-icon[data-role='SHAPER'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.role-icon[data-role='EXECUTOR'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}

	/* Central axis */
	.tl-axis {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-left: calc(58px + 0.5rem);
	}
	.axis-line {
		flex: 1;
		position: relative;
		height: 3px;
		background: linear-gradient(to right, #cbd5e1 0%, #94a3b8 50%, #cbd5e1 100%);
		border-radius: 3px;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
	}
	.creation-turn-marker {
		position: absolute;
		bottom: 100%;
		margin-bottom: 6px;
		transform: translateX(-50%);
		z-index: 2;
		pointer-events: none;
	}
	.creation-turn-star {
		display: inline-block;
		font-size: 0.85rem;
		line-height: 1;
		filter: drop-shadow(0 0 1px rgba(0,0,0,0.25));
	}
	.creation-turn-marker.earliest .creation-turn-star {
		opacity: 0.8;
		filter: grayscale(1) brightness(0.85) drop-shadow(0 0 1px rgba(0,0,0,0.2));
	}

	/* Tick marks */
	.tick {
		position: absolute;
		top: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.tick-mark {
		width: 1px;
		height: 10px;
		background: linear-gradient(to bottom, #94a3b8, #cbd5e1);
		transform: translateY(-50%);
		border-radius: 1px;
	}
	.tick-label {
		margin-top: 6px;
		font-size: 0.6rem;
		color: #64748b;
		font-weight: 600;
		white-space: nowrap;
	}

	/* Handled via .active class */
</style>
