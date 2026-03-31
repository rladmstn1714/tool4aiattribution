<script lang="ts">
	import type { NodeAnalysis, RelatedUtterance } from '$lib/types';

	let {
		selectedRequirementId = null,
		nodeAnalysis = null,
		requirementContent = '',
		fallbackAnalysis = null,
		fallbackLabel = '',
		roleActionDetail = null
	}: {
		selectedRequirementId: string | null;
		nodeAnalysis: NodeAnalysis | null;
		requirementContent: string;
		fallbackAnalysis?: NodeAnalysis | null;
		fallbackLabel?: string;
		/** Role-history graph: selected action + evidence */
		roleActionDetail?: {
			action_id: string;
			turn: number;
			role_kind: string;
			action_text: string;
			speaker?: string;
			evidence_quote?: string;
		} | null;
	} = $props();

	// Use direct analysis, or fallback (e.g. utterances for merged/modified version)
	const effectiveAnalysis = $derived(nodeAnalysis ?? fallbackAnalysis ?? null);
	// Single list sorted by t (turn order)
	const utterancesSortedByT: { type: 'direct' | 'indirect'; ut: RelatedUtterance }[] = $derived.by(() => {
		if (!effectiveAnalysis) return [];
		const { direct = [], indirect = [] } = effectiveAnalysis.related_utterances;
		const combined: { type: 'direct' | 'indirect'; ut: RelatedUtterance }[] = [
			...direct.map((ut) => ({ type: 'direct' as const, ut })),
			...indirect.map((ut) => ({ type: 'indirect' as const, ut }))
		];
		combined.sort((a, b) => a.ut.t - b.ut.t);
		return combined;
	});
</script>

<div class="panel">
	<h3 class="panel-title">{roleActionDetail ? 'Action' : 'Relevant Utterances'}</h3>
	{#if roleActionDetail}
		<div class="role-action-card">
			<div class="role-action-meta">
				<span class="role-badge" class:shaper={roleActionDetail.role_kind === 'SHAPER'} class:executor={roleActionDetail.role_kind === 'EXECUTOR'} class:other={roleActionDetail.role_kind === 'OTHER'}>
					{roleActionDetail.role_kind}
				</span>
				<span class="role-meta-bits">T{roleActionDetail.turn} · {roleActionDetail.action_id}</span>
				{#if roleActionDetail.speaker}<span class="role-meta-bits">{roleActionDetail.speaker}</span>{/if}
			</div>
			<p class="role-action-text">{roleActionDetail.action_text}</p>
			{#if roleActionDetail.evidence_quote}
				<div class="evidence-block">
					<span class="callout-label">Evidence</span>
					<p class="evidence-quote">{roleActionDetail.evidence_quote}</p>
				</div>
			{/if}
		</div>
	{:else if !selectedRequirementId}
		<p class="hint">Click a graph node to see action details or related utterances.</p>
	{:else}
		{#if requirementContent}
			<div class="requirement-callout">
				<span class="callout-label">Requirement</span>
				<p class="callout-text">{requirementContent}</p>
			</div>
		{/if}
		{#if fallbackLabel && effectiveAnalysis && !nodeAnalysis}
			<p class="fallback-note">{fallbackLabel}</p>
		{/if}
		{#if effectiveAnalysis}
			<div class="utterances-scroll">
				{#if utterancesSortedByT.length === 0}
					<p class="hint">No related utterances.</p>
				{:else}
					<div class="utterances">
						{#each utterancesSortedByT as { type, ut }}
							<div class="utterance-box" data-type={type}>
								<div class="utterance-meta">
									<span class="type-badge" class:direct={type === 'direct'} class:indirect={type === 'indirect'}>
										{type === 'direct' ? 'Direct' : 'Indirect'}
									</span>
									<span class="influence">Influence: {ut.influence_score.toFixed(2)}</span>
								</div>
								<p class="utterance-content">{ut.content}</p>
								<span class="utterance-meta-footer">t={ut.t} · {ut.speaker}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<p class="hint">No related utterance analysis for this requirement. It may have been merged or modified into another requirement.</p>
		{/if}
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
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.utterances-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}
	.panel-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #111827;
		flex-shrink: 0;
	}
	.hint {
		margin: 0;
		color: #6b7280;
		font-size: 0.875rem;
	}
	.fallback-note {
		flex-shrink: 0;
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: #f0e8cc;
		border-radius: 6px;
		font-size: 0.8rem;
		color: #8a5a2a;
	}
	.requirement-callout {
		flex-shrink: 0;
		padding: 0.75rem 1rem;
		background: #f3f4f6;
		border-radius: 8px;
		border-left: 4px solid #1976d2;
	}
	.callout-label {
		font-size: 0.7rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
	}
	.callout-text {
		margin: 0.35rem 0 0 0;
		font-size: 0.875rem;
		line-height: 1.45;
		color: #374151;
	}
	.utterances {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-right: 0.25rem;
	}
	.utterance-box {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		border-left: 4px solid #9ca3af;
		background: #f9fafb;
	}
	.utterance-box[data-type='direct'] {
		border-left-color: #4a9e7a;
		background: #f2f7f4;
	}
	.utterance-box[data-type='indirect'] {
		border-left-color: #dc2626;
		background: #fef2f2;
	}
	.utterance-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}
	.type-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
	}
	.type-badge.direct {
		background: #4a9e7a;
		color: #fff;
	}
	.type-badge.indirect {
		background: #dc2626;
		color: #fff;
	}
	.influence {
		font-size: 0.75rem;
		color: #6b7280;
	}
	.utterance-content {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.45;
		color: #374151;
	}
	.utterance-meta-footer {
		display: block;
		margin-top: 0.35rem;
		font-size: 0.7rem;
		color: #9ca3af;
	}
	.role-action-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: #f8fafc;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
	}
	.role-action-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.role-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.2rem 0.45rem;
		border-radius: 4px;
	}
	.role-badge.shaper {
		background: #ede9fe;
		color: #5b21b6;
	}
	.role-badge.executor {
		background: #dcfce7;
		color: #166534;
	}
	.role-badge.other {
		background: #f1f5f9;
		color: #475569;
	}
	.role-meta-bits {
		font-size: 0.75rem;
		color: #64748b;
	}
	.role-action-text {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.45;
		color: #1e293b;
	}
	.evidence-block {
		padding-top: 0.5rem;
		border-top: 1px solid #e2e8f0;
	}
	.evidence-quote {
		margin: 0.35rem 0 0 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: #334155;
	}
</style>
