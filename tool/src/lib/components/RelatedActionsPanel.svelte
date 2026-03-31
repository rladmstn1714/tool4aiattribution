<script lang="ts">
	import { tick } from 'svelte';
	import { boldSecondWord } from '$lib/utils';
	import { actionSpeakerLabel, isAssistantSpeakerId } from '$lib/speakerUtils';
	import type { RequirementActionMap, UtteranceListData, OutcomeActionItem } from '$lib/data/dataLoader';

	type ActionItem = {
		action_id: string;
		role: string;
		action_text: string;
		kind: 'origin' | 'related';
		influence?: 'direct' | 'indirect';
		explanation?: string;
	};

	function getTurnId(actionId: string): number {
		const parts = actionId.split('-');
		return parseInt(parts[0], 10) || 0;
	}

	/** Resolve requirement id to map entry (r1 / 1 / requirement_1 etc.) */
	function getRequirementEntry(reqId: string | null): (typeof requirementActionMap)[string] | undefined {
		if (!reqId) return undefined;
		return (
			requirementActionMap[reqId] ??
			requirementActionMap[reqId.replace(/^r/, '')] ??
			requirementActionMap[/^r/.test(reqId) ? reqId : `r${reqId}`]
		);
	}

	let {
		requirementId = null,
		requirementCreationTurn = null,
		creationActionIds = null,
		versionLabel = null,
		inheritedFromEarlierActionIds = null,
		requirementActionMap = {},
		utteranceList,
		selectedActionId = null,
		hoveredActionId = null,
		onActionClick,
		onActionHover,
		outcomeRequirementIdsWhenNoneSelected = [],
		outcomeTurnIdWhenNoReqs = null,
		outcomeActionsFromMap = null
	}: {
		requirementId: string | null;
		requirementCreationTurn?: number | null;
		/** Only these action IDs show "Created here!" (creation_action_ids / origin_actions). */
		creationActionIds?: Set<string> | null;
		versionLabel?: 'Earlier' | 'Current' | null;
		inheritedFromEarlierActionIds?: Set<string> | null;
		requirementActionMap: RequirementActionMap;
		utteranceList: UtteranceListData | null;
		selectedActionId?: string | null;
		hoveredActionId?: string | null;
		onActionClick?: (actionId: string | null) => void;
		onActionHover?: (actionId: string | null) => void;
		/** When no requirement is selected, show "All actions" for these outcome requirement IDs */
		outcomeRequirementIdsWhenNoneSelected?: string[];
		/** When outcome has no requirements, show actions with turn_id <= this (fallback when no outcome_action_map) */
		outcomeTurnIdWhenNoReqs?: number | null;
		/** When outcome has no requirements and outcome_action_map.json exists, use these actions (preferred) */
		outcomeActionsFromMap?: OutcomeActionItem[] | null;
	} = $props();

	const actions = $derived.by((): ActionItem[] => {
		if (!requirementId) return [];
		const entry = getRequirementEntry(requirementId);
		if (!entry) return [];
		const list: ActionItem[] = [];
		const origin = Array.isArray(entry.origin_actions) ? entry.origin_actions : [];
		for (const a of origin) {
			list.push({ ...a, kind: 'origin' });
		}
		// related_actions may have explanation for same action_id as contrib; use for enrichment
		const related = Array.isArray(entry.related_actions) ? entry.related_actions : [];
		const explanationByActionId = new Map<string, string>();
		for (const r of related) {
			if (r && typeof r === 'object' && 'action_id' in r && (r as Record<string, unknown>).explanation) {
				explanationByActionId.set((r as { action_id: string }).action_id, (r as Record<string, unknown>).explanation as string);
			}
		}
		// contributing_actions + implementation_actions = direct for this requirement (show as "Direct")
		const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
			? (entry as { contributing_actions: { action_id: string; role: string; action_text: string }[] }).contributing_actions
			: [];
		for (const a of contrib) {
			list.push({ ...a, kind: 'origin', explanation: explanationByActionId.get(a.action_id) });
		}
		const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
			? (entry as { implementation_actions: { action_id: string; role: string; action_text: string }[] }).implementation_actions
			: [];
		for (const a of impl) {
			list.push({ ...a, kind: 'origin' });
		}
		for (const a of related) {
			if (!a || typeof a !== 'object' || !('action_id' in a) || !('action_text' in a)) continue;
			const r = a as Record<string, unknown>;
			list.push({
				action_id: r.action_id as string,
				role: (r.role as string) ?? '',
				action_text: r.action_text as string,
				kind: 'related',
				influence: (r.influence as 'direct' | 'indirect') ?? 'indirect',
				explanation: r.explanation as string | undefined
			});
		}
		return list;
	});

	/** When no requirement selected: use outcome_action_map if provided (including empty list); else aggregate from outcome's requirements; else turn-based fallback for outcomes with no requirements. */
	const allActionsForOutcome = $derived.by((): ActionItem[] => {
		if (requirementId) return [];
		// Prefer outcome_action_map.json (outcome–action pairs from pipeline); empty array = no actions, don't fall back
		if (outcomeActionsFromMap != null) {
			return outcomeActionsFromMap
				.map((a) => ({
					action_id: a.action_id,
					role: a.role ?? 'EXECUTOR',
					action_text: a.action_text,
					kind: 'origin' as const
				}))
				.sort((a, b) => getTurnId(a.action_id) - getTurnId(b.action_id));
		}
		const seen = new Map<string, ActionItem>();
		const add = (a: ActionItem) => {
			if (seen.has(a.action_id)) return;
			seen.set(a.action_id, a);
		};
		const addFromEntry = (entry: Record<string, unknown>, maxTurn: number | null) => {
			const origin = Array.isArray(entry?.origin_actions) ? entry.origin_actions : [];
			for (const a of origin) {
				if (maxTurn != null && getTurnId(a.action_id) > maxTurn) continue;
				add({ ...a, kind: 'origin' });
			}
			const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
				? (entry as { contributing_actions: { action_id: string; role: string; action_text: string }[] }).contributing_actions
				: [];
			for (const a of contrib) {
				if (maxTurn != null && getTurnId(a.action_id) > maxTurn) continue;
				add({ ...a, kind: 'origin' });
			}
			const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
				? (entry as { implementation_actions: { action_id: string; role: string; action_text: string }[] }).implementation_actions
				: [];
			for (const a of impl) {
				if (maxTurn != null && getTurnId(a.action_id) > maxTurn) continue;
				add({ ...a, kind: 'origin' });
			}
			const related = Array.isArray(entry?.related_actions) ? entry.related_actions : [];
			for (const a of related) {
				if (!a || typeof a !== 'object' || !('action_id' in a) || !('action_text' in a)) continue;
				const r = a as Record<string, unknown>;
				if (maxTurn != null && getTurnId(r.action_id as string) > maxTurn) continue;
				add({
					action_id: r.action_id as string,
					role: (r.role as string) ?? '',
					action_text: r.action_text as string,
					kind: 'related',
					influence: (r.influence as 'direct' | 'indirect') ?? 'indirect',
					explanation: r.explanation as string | undefined
				});
			}
		};
		if (outcomeRequirementIdsWhenNoneSelected?.length) {
			for (const reqId of outcomeRequirementIdsWhenNoneSelected) {
				const entry = getRequirementEntry(reqId);
				if (entry) addFromEntry(entry as unknown as Record<string, unknown>, null);
			}
		} else if (outcomeTurnIdWhenNoReqs != null) {
			for (const entry of Object.values(requirementActionMap)) {
				if (entry) addFromEntry(entry as unknown as Record<string, unknown>, outcomeTurnIdWhenNoReqs);
			}
		}
		return [...seen.values()].sort((a, b) => getTurnId(a.action_id) - getTurnId(b.action_id));
	});

	/** Pinned at top: creation (origin) + implementation only, sorted by turn */
	const pinnedActions = $derived.by((): ActionItem[] => {
		if (!requirementId) return [];
		const entry = getRequirementEntry(requirementId);
		if (!entry) return [];
		const list: ActionItem[] = [];
		const origin = Array.isArray(entry.origin_actions) ? entry.origin_actions : [];
		for (const a of origin) {
			list.push({ ...a, kind: 'origin' });
		}
		const impl = Array.isArray((entry as { implementation_actions?: unknown[] }).implementation_actions)
			? (entry as { implementation_actions: { action_id: string; role: string; action_text: string }[] }).implementation_actions
			: [];
		const seen = new Set(list.map((a) => a.action_id));
		for (const a of impl) {
			if (!seen.has(a.action_id)) {
				seen.add(a.action_id);
				list.push({ ...a, kind: 'origin' });
			}
		}
		return list.sort((a, b) => getTurnId(a.action_id) - getTurnId(b.action_id));
	});

	/** Direct tab: contributing + related with direct influence, sorted by turn */
	const directTabActions = $derived.by((): ActionItem[] => {
		if (!requirementId) return [];
		const entry = getRequirementEntry(requirementId);
		if (!entry) return [];
		const list: ActionItem[] = [];
		const relatedForDirect = Array.isArray(entry.related_actions) ? entry.related_actions : [];
		const explanationByActionId = new Map<string, string>();
		for (const r of relatedForDirect) {
			if (r && typeof r === 'object' && 'action_id' in r && (r as Record<string, unknown>).explanation) {
				explanationByActionId.set((r as { action_id: string }).action_id, (r as Record<string, unknown>).explanation as string);
			}
		}
		const contrib = Array.isArray((entry as { contributing_actions?: unknown[] }).contributing_actions)
			? (entry as { contributing_actions: { action_id: string; role: string; action_text: string }[] }).contributing_actions
			: [];
		for (const a of contrib) {
			list.push({ ...a, kind: 'origin', explanation: explanationByActionId.get(a.action_id) });
		}
		const related = relatedForDirect;
		for (const a of related) {
			if (!a || typeof a !== 'object' || !('action_id' in a) || !('action_text' in a)) continue;
			const r = a as Record<string, unknown>;
			if ((r.influence as string) !== 'direct') continue;
			list.push({
				action_id: r.action_id as string,
				role: (r.role as string) ?? '',
				action_text: r.action_text as string,
				kind: 'related',
				influence: 'direct' as const,
				explanation: r.explanation as string | undefined
			});
		}
		const seen = new Set<string>();
		return list
			.filter((a) => {
				if (seen.has(a.action_id)) return false;
				seen.add(a.action_id);
				return true;
			})
			.sort((a, b) => getTurnId(a.action_id) - getTurnId(b.action_id));
	});

	/** Indirect tab: related with indirect influence only */
	const indirectRelatedActions = $derived.by(() => {
		const list = actions.filter((a) => a.kind === 'related' && a.influence === 'indirect');
		return [...list].sort((a, b) => getTurnId(a.action_id) - getTurnId(b.action_id));
	});

	function handleActionClick(actionId: string) {
		if (!onActionClick) return;
		onActionClick(selectedActionId === actionId ? null : actionId);
	}

	const speakerByTurn = $derived.by(() => {
		const map = new Map<number, string>();
		if (!utteranceList?.utterances) return map;
		for (const u of utteranceList.utterances) {
			map.set(u.turn_id, u.speaker);
		}
		return map;
	});

	const roleDescriptions: Record<string, string> = {
		SHAPER: 'Shaper: Proposing ideas, shaping direction',
		EXECUTOR: 'Executor: Executing tasks, implementing solutions'
	};
	const roleLabels: Record<string, string> = {
		SHAPER: 'Shaper',
		EXECUTOR: 'Executor'
	};

	function getSpeaker(actionId: string): string {
		const parts = actionId.split('-');
		const turnId = parseInt(parts[0], 10) || 0;
		return speakerByTurn.get(turnId) ?? 'user';
	}

	/** Human-side vs assistant-side counts for indirect (influential) actions */
	const indirectCountBySpeaker = $derived.by(() => {
		let user = 0;
		let assistant = 0;
		for (const a of indirectRelatedActions) {
			if (isAssistantSpeakerId(getSpeaker(a.action_id))) assistant += 1;
			else user += 1;
		}
		return { user, assistant };
	});
	/** Meta text: "Indirect Influence N | User X, Assistant Y" */
	const indirectMetaText = $derived.by(() => {
		const n = indirectRelatedActions.length;
		return `Indirect ${n} | User ${indirectCountBySpeaker.user}, Assistant ${indirectCountBySpeaker.assistant}`;
	});

	let actionsListEl: HTMLDivElement | null = $state(null);
	/** When a requirement is selected: which action list tab is active. */
	let actionListTab = $state<'direct' | 'indirect'>('direct');

	$effect(() => {
		const id = selectedActionId;
		if (!id || !actionsListEl) return;
		tick().then(() => {
			const el = actionsListEl?.querySelector(`[data-action-id="${id}"]`) as HTMLElement | null;
			el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
	});
</script>

<div class="panel">
	{#if !requirementId && allActionsForOutcome.length > 0}
		<div class="actions-list" bind:this={actionsListEl}>
			<div class="section-block section-block-primary">
				<div class="section-header">
					<h4 class="section-heading">All actions</h4>
				</div>
				<div class="section-cards">
					{#each allActionsForOutcome as action}
						{@const speaker = getSpeaker(action.action_id)}
						<button
							type="button"
							class="action-card"
							class:sp-human={!isAssistantSpeakerId(speaker)}
							class:sp-bot={isAssistantSpeakerId(speaker)}
							data-action-id={action.action_id}
							data-kind={action.kind}
							data-influence={action.influence ?? ''}
							data-selected={selectedActionId === action.action_id}
							data-hovered={hoveredActionId === action.action_id}
							onclick={() => handleActionClick(action.action_id)}
							onmouseenter={() => onActionHover?.(action.action_id)}
							onmouseleave={() => onActionHover?.(null)}
						>
							<div class="card-header">
								<div class="card-header-left">
									<span class="speaker-badge" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}>
										<span class="speaker-icon" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}></span>
										{actionSpeakerLabel(speaker)}
									</span>
									<span class="role-box" title={roleDescriptions[action.role] ?? action.role}>
										<span class="role-icon-only" data-role={action.role}></span>
										<span class="role-label">{roleLabels[action.role] ?? action.role}</span>
									</span>
								</div>
								<span class="turn-num">T{getTurnId(action.action_id) + 1}</span>
							</div>
							<div class="action-body">
								<p class="action-text">{@html boldSecondWord(action.action_text)}</p>
								{#if action.explanation}
									<div class="explanation-box">
										<p class="action-explanation">{action.explanation}</p>
									</div>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{:else if !requirementId}
		<p class="hint">Click a requirement in the outcome box or a node in the timeline to see related actions.</p>
	{:else if actions.length === 0}
		<p class="hint">No related actions for this requirement.</p>
	{:else}
		{#if versionLabel}
			<p class="version-context" title="This requirement has multiple versions. You are viewing actions for this version.">
				Viewing: <span class="version-context-label" data-version={versionLabel}>{versionLabel}</span>
			</p>
		{/if}
		{#if pinnedActions.length > 0}
			<div class="section-block section-block-pinned">
				<div class="section-header">
					<h4 class="section-heading">Creation & Implementation</h4>
				</div>
				<div class="section-cards">
					{#each pinnedActions as action}
						{@const speaker = getSpeaker(action.action_id)}
						<div class="direct-action-slot">
							<button
								type="button"
								class="action-card"
								class:sp-human={!isAssistantSpeakerId(speaker)}
								class:sp-bot={isAssistantSpeakerId(speaker)}
								data-action-id={action.action_id}
								data-kind={action.kind}
								data-influence={action.influence ?? ''}
								data-selected={selectedActionId === action.action_id}
								data-hovered={hoveredActionId === action.action_id}
								onclick={() => handleActionClick(action.action_id)}
								onmouseenter={() => onActionHover?.(action.action_id)}
								onmouseleave={() => onActionHover?.(null)}
							>
								<div class="card-header">
									<div class="card-header-left">
										<span class="speaker-badge" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}>
											<span class="speaker-icon" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}></span>
											{actionSpeakerLabel(speaker)}
										</span>
										<span class="role-box" title={roleDescriptions[action.role] ?? action.role}>
											<span class="role-icon-only" data-role={action.role}></span>
											<span class="role-label">{roleLabels[action.role] ?? action.role}</span>
										</span>
										{#if creationActionIds != null && creationActionIds.has(action.action_id)}
											<span class="creation-badge" title="This requirement was created by this action">⭐ Created here!</span>
										{/if}
										{#if versionLabel === 'Current' && inheritedFromEarlierActionIds != null}
											{#if inheritedFromEarlierActionIds.has(action.action_id)}
												<span class="origin-badge from-earlier" title="This action was already linked to the Earlier version">From Earlier</span>
											{:else}
												<span class="origin-badge new-in-current" title="This action is new in the Current version">New in Current</span>
											{/if}
										{/if}
									</div>
									<span class="turn-num">T{getTurnId(action.action_id) + 1}</span>
								</div>
								<div class="action-body">
									<p class="action-text">{@html boldSecondWord(action.action_text)}</p>
									{#if action.explanation}
										<div class="explanation-box">
											<p class="action-explanation">{action.explanation}</p>
										</div>
									{/if}
								</div>
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		<div class="actions-list-tabs-wrap">
			<div class="actions-list-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					class="actions-list-tab"
					class:active={actionListTab === 'direct'}
					aria-selected={actionListTab === 'direct'}
					onclick={() => (actionListTab = 'direct')}
				>Direct</button>
				<button
					type="button"
					role="tab"
					class="actions-list-tab"
					class:active={actionListTab === 'indirect'}
					aria-selected={actionListTab === 'indirect'}
					onclick={() => (actionListTab = 'indirect')}
				>Indirect</button>
			</div>
			<p class="actions-list-tabs-meta">Direct {directTabActions.length} | Indirect {indirectRelatedActions.length} (User {indirectCountBySpeaker.user}, Assistant {indirectCountBySpeaker.assistant})</p>
		</div>
		<div class="actions-list" bind:this={actionsListEl}>
			{#if actionListTab === 'direct' && directTabActions.length > 0}
				<div class="section-block section-block-primary">
					<div class="section-header">
						<h4 class="section-heading">Actions that may have directly influenced this</h4>
					</div>
					<div class="section-cards">
						{#each directTabActions as action}
							{@const speaker = getSpeaker(action.action_id)}
							<div class="direct-action-slot">
								<button
									type="button"
									class="action-card"
									class:sp-human={!isAssistantSpeakerId(speaker)}
									class:sp-bot={isAssistantSpeakerId(speaker)}
									data-action-id={action.action_id}
									data-kind={action.kind}
									data-influence={action.influence ?? ''}
									data-selected={selectedActionId === action.action_id}
									data-hovered={hoveredActionId === action.action_id}
									onclick={() => handleActionClick(action.action_id)}
									onmouseenter={() => onActionHover?.(action.action_id)}
									onmouseleave={() => onActionHover?.(null)}
								>
									<div class="card-header">
										<div class="card-header-left">
											<span class="speaker-badge" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}>
												<span class="speaker-icon" class:sp-human={!isAssistantSpeakerId(speaker)} class:sp-bot={isAssistantSpeakerId(speaker)}></span>
												{actionSpeakerLabel(speaker)}
											</span>
											<span class="role-box" title={roleDescriptions[action.role] ?? action.role}>
												<span class="role-icon-only" data-role={action.role}></span>
												<span class="role-label">{roleLabels[action.role] ?? action.role}</span>
											</span>
											{#if versionLabel === 'Current' && inheritedFromEarlierActionIds != null}
												{#if inheritedFromEarlierActionIds.has(action.action_id)}
													<span class="origin-badge from-earlier" title="This action was already linked to the Earlier version">From Earlier</span>
												{:else}
													<span class="origin-badge new-in-current" title="This action is new in the Current version">New in Current</span>
												{/if}
											{/if}
										</div>
										<span class="turn-num">T{getTurnId(action.action_id) + 1}</span>
									</div>
									<div class="action-body">
										<p class="action-text">{@html boldSecondWord(action.action_text)}</p>
										{#if action.explanation}
											<div class="explanation-box">
												<p class="action-explanation">{action.explanation}</p>
											</div>
										{/if}
									</div>
								</button>
							</div>
						{/each}
					</div>
				</div>
			{:else if actionListTab === 'indirect'}
				{#if indirectRelatedActions.length > 0}
					<div class="section-block section-block-primary">
						<div class="section-header">
							<h4 class="section-heading">Actions that may have indirectly influenced this</h4>
						</div>
						<div class="section-cards">
							{#each indirectRelatedActions as indAction}
								{@const indSpeaker = getSpeaker(indAction.action_id)}
								<button
									type="button"
									class="action-card"
									class:sp-human={!isAssistantSpeakerId(indSpeaker)}
									class:sp-bot={isAssistantSpeakerId(indSpeaker)}
									data-action-id={indAction.action_id}
									data-kind={indAction.kind}
									data-influence={indAction.influence ?? ''}
									data-selected={selectedActionId === indAction.action_id}
									data-hovered={hoveredActionId === indAction.action_id}
									onclick={() => handleActionClick(indAction.action_id)}
									onmouseenter={() => onActionHover?.(indAction.action_id)}
									onmouseleave={() => onActionHover?.(null)}
								>
									<div class="card-header">
										<div class="card-header-left">
											<span class="speaker-badge" class:sp-human={!isAssistantSpeakerId(indSpeaker)} class:sp-bot={isAssistantSpeakerId(indSpeaker)}>
												<span class="speaker-icon" class:sp-human={!isAssistantSpeakerId(indSpeaker)} class:sp-bot={isAssistantSpeakerId(indSpeaker)}></span>
												{actionSpeakerLabel(indSpeaker)}
											</span>
											<span class="role-box" title={roleDescriptions[indAction.role] ?? indAction.role}>
												<span class="role-icon-only" data-role={indAction.role}></span>
												<span class="role-label">{roleLabels[indAction.role] ?? indAction.role}</span>
											</span>
											{#if creationActionIds != null && creationActionIds.has(indAction.action_id)}
												<span class="creation-badge" title="This requirement was created by this action">⭐ Created here!</span>
											{/if}
											{#if versionLabel === 'Current' && inheritedFromEarlierActionIds != null}
												{#if inheritedFromEarlierActionIds.has(indAction.action_id)}
													<span class="origin-badge from-earlier" title="This action was already linked to the Earlier version">From Earlier</span>
												{:else}
													<span class="origin-badge new-in-current" title="This action is new in the Current version">New in Current</span>
												{/if}
											{/if}
										</div>
										<span class="turn-num">T{getTurnId(indAction.action_id) + 1}</span>
									</div>
									<div class="action-body">
										<p class="action-text">{@html boldSecondWord(indAction.action_text)}</p>
										{#if indAction.explanation}
											<div class="explanation-box">
												<p class="action-explanation">{indAction.explanation}</p>
											</div>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<p class="hint">No indirect actions for this requirement.</p>
				{/if}
			{:else if actionListTab === 'direct' && directTabActions.length === 0}
				<p class="hint">No direct actions (contributing + direct influence) for this requirement.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.hint {
		margin: 0;
		color: #6b7280;
		font-size: 0.875rem;
	}
	.version-context {
		margin: 0 0 0.5rem 0;
		font-size: 0.7rem;
		color: #6b7280;
	}
	.version-context-label {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.version-context-label[data-version='Current'] {
		color: #1565c0;
	}
	.version-context-label[data-version='Earlier'] {
		color: #6b7280;
	}
	.section-block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.section-block-primary {
		border-left: 3px solid #92400e;
		padding-left: 0.6rem;
	}
	.section-block-pinned {
		border-left: 3px solid #0ea5e9;
		padding-left: 0.6rem;
		margin-bottom: 0.5rem;
		max-height: 200px;
		overflow-y: auto;
		flex-shrink: 0;
	}
	.actions-list-tabs-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}
	.actions-list-tabs {
		display: flex;
		gap: 0.25rem;
	}
	.actions-list-tabs-meta {
		margin: 0;
		font-size: 0.75rem;
		color: #6b7280;
	}
	.actions-list-tab {
		padding: 0.35rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #6b7280;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		cursor: pointer;
	}
	.actions-list-tab:hover {
		background: #e5e7eb;
		color: #374151;
	}
	.actions-list-tab.active {
		background: #1f2937;
		color: #fff;
		border-color: #1f2937;
	}
	.section-cards {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.direct-action-slot {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.section-header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.2rem;
	}
	.section-block:first-child .section-header {
		margin-top: 0;
	}
	.section-heading {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: #6b7280;
	}
	.actions-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		min-height: 320px;
		flex: 1;
	}
	.action-card {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.4rem 0.5rem;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 2px solid transparent;
		width: 100%;
		text-align: left;
		cursor: pointer;
		font: inherit;
		color: inherit;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	/* Box color by speaker (chat-like): human side = green, assistant/bot = yellow */
	.action-card.sp-human {
		background: #e5f0ea;
		border-color: #a0d4b8;
	}
	.action-card.sp-bot {
		background: #fef9c3;
		border-color: #eab308;
	}
	.action-card.sp-human:hover {
		background: #c8e0d2;
		border-color: #7dc4a0;
	}
	.action-card.sp-bot:hover {
		background: #fef08a;
		border-color: #ca8a04;
	}
	.action-card[data-hovered='true'] {
		border-color: #1976d2;
		box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.35);
	}
	.action-card[data-selected='true'] {
		border: 2px solid #1976d2;
		box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.35);
	}
	.action-card[data-kind='related'][data-influence='indirect'] .action-text {
		font-size: 0.8125rem;
		color: #4b5563;
	}
	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		flex-shrink: 0;
		width: 100%;
	}
	.card-header-left {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.turn-num {
		font-size: 0.6rem;
		font-weight: 600;
		color: #9ca3af;
		flex-shrink: 0;
	}
	.creation-badge {
		display: inline-block;
		background: #fff;
		color: #111827;
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
		border: 1px solid #e5e7eb;
	}
	.origin-badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.12rem 0.35rem;
		border-radius: 4px;
		white-space: nowrap;
	}
	.origin-badge.from-earlier {
		background: #f3f4f6;
		color: #6b7280;
		border: 1px solid #d1d5db;
	}
	.origin-badge.new-in-current {
		background: #dbeafe;
		color: #1d4ed8;
		border: 1px solid #93c5fd;
	}
	.speaker-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
	}
	.speaker-badge.sp-human {
		background: #4a9e7a;
		color: #fff;
	}
	.speaker-badge.sp-bot {
		background: #eab308;
		color: #fff;
	}
	.speaker-icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}
	.speaker-icon.sp-human {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.speaker-icon.sp-bot {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-.5-4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.role-box {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.5rem;
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 4px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}
	.role-box .role-icon-only {
		width: 12px;
		height: 12px;
	}
	.role-label {
		font-size: 0.7rem;
		font-weight: 700;
		color: #374151;
	}
	/* Role icon: single neutral color (no colored circle) */
	.role-icon-only {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
	}
	.role-icon-only[data-role='SHAPER'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.role-icon-only[data-role='EXECUTOR'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	/* influence label removed – influence is shown via left border */
	.action-body {
		flex: 1 1 100%;
		min-width: 0;
	}
	.action-text {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.45;
		color: #374151;
	}
	.explanation-box {
		margin-top: 0.5rem;
		padding: 0.5rem 0.65rem;
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.action-explanation {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: #4b5563;
	}
</style>
