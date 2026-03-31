<script lang="ts">
	import type { OutcomeNode, OutcomeContribution } from '$lib/types';

	export type RequirementChainItem = {
		currentId: string;
		currentText: string;
		history: { id: string; text: string }[];
	};

	let {
		outcome,
		contribution,
		roleRatioPerSpeaker = false,
		hideContribution = false,
		overviewFirstMentionTurn = null,
		requirementStatusOverview = [],
		requirementChains = [],
		requirementContributionByReqId = {},
		requirementBarOnTop = false,
		onRequirementClick,
		selectedRequirementId = null,
		hoveredActionRelatedRequirementIds = new Set<string>(),
		index,
		onOutcomeClick,
		requirementCreationTurnByReqId = {},
		requirementDirectActionCountByReqId = {}
	}: {
		outcome: OutcomeNode;
		contribution: OutcomeContribution | null;
		/** When true (e.g. outcome has no requirements), per-role label shows ratio of that role per speaker (user% / asst%) */
		roleRatioPerSpeaker?: boolean;
		/** When true, do not show contribution section (e.g. when it is shown in the overview timeline box) */
		hideContribution?: boolean;
		/** First turn where this outcome is explicitly created/mentioned (0-based). */
		overviewFirstMentionTurn?: number | null;
		/** Requirement implementation overview for this outcome. */
		requirementStatusOverview?: Array<{
			id: string;
			is_executed: boolean | null;
			is_dismissed: boolean | null;
			dismissed_at_turn: number | null;
		}>;
		requirementChains?: RequirementChainItem[];
		/** Per-requirement User vs Assistant rate (0–1) + Shaper/Executor M_total for contribution bar */
		requirementContributionByReqId?: Record<string, { user: number; assistant: number; userShaper: number; assistantShaper: number; userShaperDir?: number; userShaperInd?: number; assistantShaperDir?: number; assistantShaperInd?: number; userExecutor: number; assistantExecutor: number }>;
		/** If true, show contribution bar above requirement text; if false, vertical bar on the left */
		requirementBarOnTop?: boolean;
		onRequirementClick?: (reqId: string) => void;
		selectedRequirementId?: string | null;
		hoveredActionRelatedRequirementIds?: Set<string>;
		index: number | string;
		/** When user clicks a dependency link, focus that outcome */
		onOutcomeClick?: (outcomeId: string) => void;
		/** turn index (0-based) when each requirement was created */
		requirementCreationTurnByReqId?: Record<string, number>;
		/** number of direct actions linked to each requirement */
		requirementDirectActionCountByReqId?: Record<string, number>;
	} = $props();

	let hovered = $state(false);

	function handleBoardMouseEnter() {
		hovered = true;
	}
	function handleBoardMouseLeave() {
		hovered = false;
	}
	/** Index of the requirement stack currently expanded by hover (for modify-history stacks). */
	let hoveredStackIndex = $state<number | null>(null);

	// Use only data-driven outcome description (no hard-coded titles)
	const title = $derived(outcome.outcome?.trim() || outcome.outcome_id);

	/** Whether to show the parenthetical suffix in the board title */
	let showTitleParen = $state(false);

	/** Split title into main text and trailing parenthetical (e.g. "Foo (bar)" or "Foo (bar).") */
	const titleParts = $derived.by(() => {
		const t = title;
		// Match trailing (content) with optional punctuation/whitespace after
		const match = t.trimEnd().match(/^([\s\S]*?)\s*(\([^)]*\)[.,;:!?\s]*)$/);
		if (match && match[1].trim().length > 0) {
			return { main: match[1].trimEnd(), paren: match[2].trimEnd() };
		}
		return { main: t, paren: null };
	});

	/** Rate from data; normalized for flex so bar always fills (human + model = 1). */
	function getBarRatio(
		c: OutcomeContribution | null,
		kind: 'overall' | 'role',
		role?: string
	): { human: number; model: number } {
		if (!c) return { human: 0.5, model: 0.5 };
		if (kind === 'overall') {
			const hu = c.speaker_contributions?.user?.total_influence ?? 0;
			const as = c.speaker_contributions?.assistant?.total_influence ?? 0;
			const total = hu + as;
			if (total === 0) return { human: 0, model: 0 };
			return { human: hu / total, model: as / total };
		}
		if (!role) return { human: 0.5, model: 0.5 };
		const ru = c.role_contributions?.user?.[role]?.M_total ?? 0;
		const ra = c.role_contributions?.assistant?.[role]?.M_total ?? 0;
		const total = ru + ra;
		if (total === 0) return { human: 0, model: 0 };
		return { human: ru / total, model: ra / total };
	}

	function getRoleTotal(c: OutcomeContribution | null, role: string): number {
		if (!c || !role) return 0;
		const ru = c.role_contributions?.user?.[role]?.M_total ?? 0;
		const ra = c.role_contributions?.assistant?.[role]?.M_total ?? 0;
		return ru + ra;
	}

	/** When roleRatioPerSpeaker, label is user% / asst% (ratio of that role per speaker); else normalized bar split. */
	function getRoleLabel(c: OutcomeContribution | null, role: string): string {
		if (!c || !role) return '—';
		const ru = c.role_contributions?.user?.[role]?.M_total ?? 0;
		const ra = c.role_contributions?.assistant?.[role]?.M_total ?? 0;
		if (roleRatioPerSpeaker) {
			return `${Math.round(ru * 100)}% / ${Math.round(ra * 100)}%`;
		}
		const total = ru + ra;
		if (total === 0) return '—';
		return `${Math.round((ru / total) * 100)} / ${Math.round((ra / total) * 100)}`;
	}

	/** User vs Assistant ratio for a role's M_dir only (for Direct bar). empty when both 0. */
	function getRoleDirectBarRatio(c: OutcomeContribution | null, role: string): { human: number; model: number; empty: boolean } {
		if (!c || !role) return { human: 0.5, model: 0.5, empty: true };
		const u = c.role_contributions?.user?.[role]?.M_dir ?? 0;
		const a = c.role_contributions?.assistant?.[role]?.M_dir ?? 0;
		const total = u + a;
		if (total === 0) return { human: 0, model: 0, empty: true };
		return { human: u / total, model: a / total, empty: false };
	}
	/** User vs Assistant ratio for a role's M_ind only (for Indirect bar). empty when both 0. */
	function getRoleIndirectBarRatio(c: OutcomeContribution | null, role: string): { human: number; model: number; empty: boolean } {
		if (!c || !role) return { human: 0.5, model: 0.5, empty: true };
		const u = c.role_contributions?.user?.[role]?.M_ind ?? 0;
		const a = c.role_contributions?.assistant?.[role]?.M_ind ?? 0;
		const total = u + a;
		if (total === 0) return { human: 0, model: 0, empty: true };
		return { human: u / total, model: a / total, empty: false };
	}

	/** Shaper bar: four proportions (human direct, human indirect, model direct, model indirect) for shading. Sum = 1 when has contribution. */
	function getShaperFourWay(c: OutcomeContribution | null): { humanDirect: number; humanIndirect: number; modelDirect: number; modelIndirect: number; empty: boolean } {
		if (!c) return { humanDirect: 0, humanIndirect: 0, modelDirect: 0, modelIndirect: 0, empty: true };
		const uDir = c.role_contributions?.user?.SHAPER?.M_dir ?? 0;
		const uInd = c.role_contributions?.user?.SHAPER?.M_ind ?? 0;
		const aDir = c.role_contributions?.assistant?.SHAPER?.M_dir ?? 0;
		const aInd = c.role_contributions?.assistant?.SHAPER?.M_ind ?? 0;
		const total = uDir + uInd + aDir + aInd;
		if (total === 0) return { humanDirect: 0, humanIndirect: 0, modelDirect: 0, modelIndirect: 0, empty: true };
		return {
			humanDirect: uDir / total,
			humanIndirect: uInd / total,
			modelDirect: aDir / total,
			modelIndirect: aInd / total,
			empty: false
		};
	}

	const shaperRatio = $derived(contribution ? getBarRatio(contribution, 'role', 'SHAPER') : { human: 0.5, model: 0.5 });
	const executorRatio = $derived(contribution ? getBarRatio(contribution, 'role', 'EXECUTOR') : { human: 0.5, model: 0.5 });
	const shaperFourWay = $derived(contribution ? getShaperFourWay(contribution) : { humanDirect: 0, humanIndirect: 0, modelDirect: 0, modelIndirect: 0, empty: true });

	const shaperHasContribution = $derived(!!contribution && getRoleTotal(contribution, 'SHAPER') > 0);
	const executorHasContribution = $derived(!!contribution && getRoleTotal(contribution, 'EXECUTOR') > 0);

	/** Rule-based one-line summary: who mostly shaped/executed; if eligible, "X contributed but mostly indirectly". */
	const outcomeSummaryLine = $derived.by((): string | null => {
		if (!contribution || hideContribution) return null;
		const THRESH = 0.55;
		const INDIRECT_THRESH = 0.6;
		const parts: string[] = [];

		function indirectRatio(dir: number, ind: number): number {
			const t = dir + ind;
			return t > 0 ? ind / t : 0;
		}

		if (shaperHasContribution) {
			const sr = getBarRatio(contribution, 'role', 'SHAPER');
			const uDir = contribution.role_contributions?.user?.SHAPER?.M_dir ?? 0;
			const uInd = contribution.role_contributions?.user?.SHAPER?.M_ind ?? 0;
			const aDir = contribution.role_contributions?.assistant?.SHAPER?.M_dir ?? 0;
			const aInd = contribution.role_contributions?.assistant?.SHAPER?.M_ind ?? 0;
			let shaperPhrase: string;
			if (sr.human >= THRESH) {
				shaperPhrase = 'User mostly shaped the goal';
				if (aDir + aInd > 0 && indirectRatio(aDir, aInd) >= INDIRECT_THRESH) shaperPhrase += ' (Assistant contributed a little but mostly indirectly)';
			} else if (sr.model >= THRESH) {
				shaperPhrase = 'Assistant mostly shaped the goal';
				if (uDir + uInd > 0 && indirectRatio(uDir, uInd) >= INDIRECT_THRESH) shaperPhrase += ' (User contributed a little but mostly indirectly)';
			} else {
				shaperPhrase = 'Both shaped similarly';
			}
			parts.push(shaperPhrase);
		}
		if (executorHasContribution) {
			const er = getBarRatio(contribution, 'role', 'EXECUTOR');
			const uDir = contribution.role_contributions?.user?.EXECUTOR?.M_dir ?? 0;
			const uInd = contribution.role_contributions?.user?.EXECUTOR?.M_ind ?? 0;
			const aDir = contribution.role_contributions?.assistant?.EXECUTOR?.M_dir ?? 0;
			const aInd = contribution.role_contributions?.assistant?.EXECUTOR?.M_ind ?? 0;
			let execPhrase: string;
			if (er.human >= THRESH) {
				execPhrase = 'User mostly executed the goal';
				if (aDir + aInd > 0 && indirectRatio(aDir, aInd) >= INDIRECT_THRESH) execPhrase += ' (Assistant contributed a little but mostly indirectly)';
			} else if (er.model >= THRESH) {
				execPhrase = 'Assistant mostly executed the goal';
				if (uDir + uInd > 0 && indirectRatio(uDir, uInd) >= INDIRECT_THRESH) execPhrase += ' (User contributed a little but mostly indirectly)';
			} else {
				execPhrase = 'Both executed similarly';
			}
			parts.push(execPhrase);
		}
		return parts.length > 0 ? parts.map((p) => p + '.').join('\n') : null;
	});

	const requirementStatusSummary = $derived.by(() => {
		const rows = requirementStatusOverview ?? [];
		let executed = 0;
		let pending = 0;
		let dismissed = 0;
		let unknown = 0;
		for (const r of rows) {
			if (r.is_dismissed) {
				dismissed += 1;
				continue;
			}
			if (r.is_executed === true) executed += 1;
			else if (r.is_executed === false) pending += 1;
			else unknown += 1;
		}
		return { total: rows.length, executed, pending, dismissed, unknown };
	});

	const requirementStatusById = $derived.by(() => {
		const map = new Map<
			string,
			{ is_executed: boolean | null; is_dismissed: boolean | null; dismissed_at_turn: number | null }
		>();
		for (const row of requirementStatusOverview ?? []) {
			if (!row?.id) continue;
			map.set(row.id, row);
			if (/^r\d+/.test(row.id)) map.set(row.id.replace(/^r/, ''), row);
			if (/^\d+/.test(row.id)) map.set(`r${row.id}`, row);
		}
		return map;
	});

	function getReqStatusKind(reqId: string): 'done' | 'pending' | 'dismissed' | 'unknown' {
		const st = requirementStatusById.get(reqId);
		if (!st) return 'unknown';
		if (st.is_dismissed) return 'dismissed';
		if (st.is_executed === true) return 'done';
		if (st.is_executed === false) return 'pending';
		return 'unknown';
	}

	function getReqStatusLabel(reqId: string): string {
		const kind = getReqStatusKind(reqId);
		if (kind === 'done') return 'Implemented';
		if (kind === 'pending') return 'Pending';
		if (kind === 'dismissed') return 'Dismissed';
		return 'Unknown';
	}

	/** Requirements sorted by creation turn (earliest first; unknown turn last). */
	const sortedRequirementChains = $derived.by(() => {
		const turnByReq = requirementCreationTurnByReqId ?? {};
		return [...requirementChains].sort((a, b) => {
			const ta = turnByReq[a.currentId] ?? Infinity;
			const tb = turnByReq[b.currentId] ?? Infinity;
			return ta - tb;
		});
	});

	/** When a requirement from a stack is selected, keep that stack expanded (no hover needed). */
	const selectedStackIndex = $derived.by(() => {
		if (!selectedRequirementId) return null;
		const idx = sortedRequirementChains.findIndex(
			(chain) =>
				chain.currentId === selectedRequirementId ||
				chain.history.some((h) => h.id === selectedRequirementId)
		);
		return idx >= 0 ? idx : null;
	});

	function isStackExpanded(i: number): boolean {
		return hoveredStackIndex === i || selectedStackIndex === i;
	}

	/** Group requirementChains by creation turn for same-turn card stacking. Uses sorted order. */
	const turnGrouped = $derived.by(() => {
		type GroupEntry = { turn: number | null; chains: Array<{ chain: RequirementChainItem; idx: number }> };
		const groups: GroupEntry[] = [];
		const seen = new Map<number | null, number>();
		for (let i = 0; i < sortedRequirementChains.length; i++) {
			const chain = sortedRequirementChains[i];
			const turn = requirementCreationTurnByReqId[chain.currentId] ?? null;
			if (!seen.has(turn)) {
				seen.set(turn, groups.length);
				groups.push({ turn, chains: [] });
			}
			groups[seen.get(turn)!].chains.push({ chain, idx: i });
		}
		// Sort groups by turn (earliest first; null last)
		groups.sort((a, b) => {
			const ta = a.turn ?? Infinity;
			const tb = b.turn ?? Infinity;
			return ta - tb;
		});
		return groups;
	});

	let expandedTurnGroups = $state(new Set<number>());

	function toggleTurnGroup(gi: number) {
		const next = new Set(expandedTurnGroups);
		if (next.has(gi)) next.delete(gi);
		else next.add(gi);
		expandedTurnGroups = next;
	}

	/** User (green) vs Assistant (yellow) rate for bar. Returns userPct 0–100 or null. */
	function getReqContributionRate(reqId: string): number | null {
		const c = requirementContributionByReqId[reqId];
		if (!c || (c.user === 0 && c.assistant === 0)) return null;
		const total = c.user + c.assistant;
		return total > 0 ? (c.user / total) * 100 : null;
	}

	type ReqRoleRatios = {
		shaperUser: number; shaperAssistant: number; shaperTotal: number;
		shaperFourWay: { hd: number; hi: number; ad: number; ai: number };
		executorUser: number; executorAssistant: number; executorTotal: number;
		hasShaper: boolean; hasExecutor: boolean;
	};
	function getReqRoleRatios(reqId: string): ReqRoleRatios | null {
		const c = requirementContributionByReqId[reqId];
		if (!c) return null;
		const shaperTotal = c.userShaper + c.assistantShaper;
		const executorTotal = c.userExecutor + c.assistantExecutor;
		if (shaperTotal === 0 && executorTotal === 0) return null;
		const uD = c.userShaperDir ?? 0;
		const uI = c.userShaperInd ?? 0;
		const aD = c.assistantShaperDir ?? 0;
		const aI = c.assistantShaperInd ?? 0;
		const fw4Total = uD + uI + aD + aI;
		const fw4: { hd: number; hi: number; ad: number; ai: number } = fw4Total > 0
			? { hd: uD / fw4Total, hi: uI / fw4Total, ad: aD / fw4Total, ai: aI / fw4Total }
			: { hd: shaperTotal > 0 ? (c.userShaper / shaperTotal) * 0.5 : 0, hi: shaperTotal > 0 ? (c.userShaper / shaperTotal) * 0.5 : 0, ad: shaperTotal > 0 ? (c.assistantShaper / shaperTotal) * 0.5 : 0, ai: shaperTotal > 0 ? (c.assistantShaper / shaperTotal) * 0.5 : 0 };
		return {
			shaperUser: shaperTotal > 0 ? c.userShaper / shaperTotal : 0,
			shaperAssistant: shaperTotal > 0 ? c.assistantShaper / shaperTotal : 0,
			shaperTotal,
			shaperFourWay: fw4,
			executorUser: executorTotal > 0 ? c.userExecutor / executorTotal : 0,
			executorAssistant: executorTotal > 0 ? c.assistantExecutor / executorTotal : 0,
			executorTotal,
			hasShaper: shaperTotal > 0,
			hasExecutor: executorTotal > 0
		};
	}

</script>

<div
	class="outcome-board"
	class:hovered
	class:interactive={!!onRequirementClick}
	role="button"
	tabindex="0"
	onmouseenter={handleBoardMouseEnter}
	onmouseleave={handleBoardMouseLeave}
>
	<span class="contribution-title">Outcome</span>
	<div class="board-header">
		<span class="board-number">{index}</span>
		<button
			type="button"
			class="board-title"
			class:paren-expanded={showTitleParen}
			title={showTitleParen ? '클릭하면 접기' : '클릭하면 전체 내용 표시'}
			onclick={(e) => { e.stopPropagation(); showTitleParen = !showTitleParen; }}
		>
			{#if showTitleParen}
				{title}
			{:else}
				{titleParts.main}{#if titleParts.paren}<span class="paren-ellipsis"> (...)</span>{/if}
			{/if}
		</button>
	</div>

	<div class="outcome-meta-row">
		{#if contribution && !hideContribution}
			<div class="meta-cell contrib-cell">
				<span class="meta-cell-key">Contribution</span>
				<div class="contrib-bars-and-summary">
					<div class="meta-contrib-bars">
						{#each [shaperFourWay] as fw4}
						<div class="meta-contrib-item" class:no-contribution={!shaperHasContribution} title="Shaper: U-Dir {Math.round(fw4.humanDirect * 100)}% / U-Ind {Math.round(fw4.humanIndirect * 100)}% / A-Dir {Math.round(fw4.modelDirect * 100)}% / A-Ind {Math.round(fw4.modelIndirect * 100)}%">
							<span class="meta-contrib-emoji">💡</span>
							<svg class="meta-ratio-svg" width="8" height="28" viewBox="0 0 8 28">
								<rect x="0" y="0" width="8" height="28" rx="2" fill="#f3f4f6"/>
								<rect x="0" y="0" width="8" height="{fw4.humanDirect * 28}" fill="#4a9e7a" rx="2"/>
								<rect x="0" y="{fw4.humanDirect * 28}" width="8" height="{fw4.humanIndirect * 28}" fill="#4a9e7a" opacity="0.4"/>
								<rect x="0" y="{(fw4.humanDirect + fw4.humanIndirect) * 28}" width="8" height="{fw4.modelDirect * 28}" fill="#eab308"/>
								<rect x="0" y="{(fw4.humanDirect + fw4.humanIndirect + fw4.modelDirect) * 28}" width="8" height="{fw4.modelIndirect * 28}" fill="#eab308" opacity="0.4" rx="2"/>
							</svg>
							<span class="meta-contrib-pct">{shaperHasContribution ? Math.round(shaperRatio.human * 100) + '/' + Math.round(shaperRatio.model * 100) : '—'}</span>
						</div>
						{/each}
						<div class="meta-contrib-item" class:no-contribution={!executorHasContribution} title="Executor: User {Math.round(executorRatio.human * 100)}% / Assistant {Math.round(executorRatio.model * 100)}%">
							<span class="meta-contrib-emoji">🔧</span>
							<div class="meta-ratio-bar" class:empty={!executorHasContribution || (executorRatio.human === 0 && executorRatio.model === 0)} style="--u:{executorRatio.human};--a:{executorRatio.model}"></div>
							<span class="meta-contrib-pct">{executorHasContribution ? Math.round(executorRatio.human * 100) + '/' + Math.round(executorRatio.model * 100) : '—'}</span>
						</div>
					</div>
					{#if outcomeSummaryLine}
						<span class="outcome-summary-line" title="Rule-based summary from contribution data">{outcomeSummaryLine}</span>
					{/if}
				</div>
			</div>
		{/if}
		<div class="meta-cell">
			<span class="meta-cell-key">First specified</span>
			<span class="meta-cell-value">{overviewFirstMentionTurn != null ? 'T' + (overviewFirstMentionTurn + 1) : 'Unknown'}</span>
		</div>
		<div class="meta-cell">
			<span class="meta-cell-key">Req. status</span>
			<div class="meta-status-chips">
				<span class="status-chip executed">Impl. {requirementStatusSummary.executed}</span>
				<span class="status-chip pending">Pend. {requirementStatusSummary.pending}</span>
				{#if requirementStatusSummary.dismissed > 0}
					<span class="status-chip dismissed">Dism. {requirementStatusSummary.dismissed}</span>
				{/if}
				{#if requirementStatusSummary.unknown > 0}
					<span class="status-chip unknown">Unk. {requirementStatusSummary.unknown}</span>
				{/if}
			</div>
		</div>
	</div>

	{#snippet renderReqMeta(reqId: string, reqTurn: number | null)}
		<span class="req-meta-row">
			{#if reqTurn != null}<span class="req-turn-badge" title="Created at turn {reqTurn + 1}">T{reqTurn + 1}</span>{/if}
			<span class="req-status-badge {getReqStatusKind(reqId)}">{getReqStatusLabel(reqId)}</span>
		</span>
	{/snippet}

	{#snippet renderReqBar(reqId: string)}
		{@const roles = getReqRoleRatios(reqId)}
		{#if roles && (roles.hasShaper || roles.hasExecutor)}
			{@const fw = roles.shaperFourWay}
			<span class="req-mini-bars" title="💡 U-Dir {Math.round(fw.hd*100)}% U-Ind {Math.round(fw.hi*100)}% A-Dir {Math.round(fw.ad*100)}% A-Ind {Math.round(fw.ai*100)}%  🔧 U{Math.round(roles.executorUser*100)}%/A{Math.round(roles.executorAssistant*100)}%">
				{#if roles.hasShaper}
					<svg class="req-mini-svg" width="5" height="22" viewBox="0 0 5 22">
						<rect x="0" y="0" width="5" height="{fw.hd * 22}" fill="#4a9e7a" rx="1.5"/>
						<rect x="0" y="{fw.hd * 22}" width="5" height="{fw.hi * 22}" fill="#4a9e7a" opacity="0.4"/>
						<rect x="0" y="{(fw.hd + fw.hi) * 22}" width="5" height="{fw.ad * 22}" fill="#eab308"/>
						<rect x="0" y="{(fw.hd + fw.hi + fw.ad) * 22}" width="5" height="{fw.ai * 22}" fill="#eab308" opacity="0.4" rx="1.5"/>
					</svg>
				{/if}
				{#if roles.hasExecutor}<span class="req-mini-vbar executor" style="--u:{roles.executorUser};--a:{roles.executorAssistant}"></span>{/if}
			</span>
		{/if}
	{/snippet}

	{#snippet renderChain(chain: RequirementChainItem, i: number)}
		{@const reqTurn = requirementCreationTurnByReqId[chain.currentId] ?? null}
		{#if chain.history.length === 0}
			{@const roles = getReqRoleRatios(chain.currentId)}
			<div class="requirement-row" class:has-contribution-bar={roles != null} class:bar-on-top={requirementBarOnTop}>
				{#if requirementBarOnTop}
					<div class="requirement-content-col">
						{@render renderReqBar(chain.currentId)}
					{#if onRequirementClick && chain.currentId != null}
						<button
							type="button"
							class="requirement-para requirement-btn"
							class:selected={selectedRequirementId === chain.currentId}
							class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(chain.currentId)}
							data-req-id={chain.currentId}
							onclick={(e) => { e.stopPropagation(); onRequirementClick(chain.currentId); }}
						>
							{@render renderReqMeta(chain.currentId, reqTurn)}
							{chain.currentText}
						</button>
					{:else}
						<p class="requirement-para" data-req-id={chain.currentId}>{@render renderReqMeta(chain.currentId, reqTurn)}{chain.currentText}</p>
					{/if}
				</div>
				{:else}
					{@render renderReqBar(chain.currentId)}
					{#if onRequirementClick && chain.currentId != null}
						<button
							type="button"
							class="requirement-para requirement-btn"
							class:selected={selectedRequirementId === chain.currentId}
							class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(chain.currentId)}
							data-req-id={chain.currentId}
							onclick={(e) => { e.stopPropagation(); onRequirementClick(chain.currentId); }}
						>
							{@render renderReqMeta(chain.currentId, reqTurn)}
							{chain.currentText}
						</button>
					{:else}
						<p class="requirement-para" data-req-id={chain.currentId}>{@render renderReqMeta(chain.currentId, reqTurn)}{chain.currentText}</p>
					{/if}
				{/if}
			</div>
		{:else}
			{@const items = [...chain.history.map((h) => ({ id: h.id, text: h.text })), { id: chain.currentId, text: chain.currentText }]}
			<div
				class="requirement-stack"
				class:expanded={isStackExpanded(i)}
				onmouseenter={() => (hoveredStackIndex = i)}
				onmouseleave={() => (hoveredStackIndex = null)}
				role="group"
				aria-label="Requirement with revision history"
			>
				{#if isStackExpanded(i)}
					<div class="requirement-stack-expanded-inner">
						{#each items as item, j}
							{@const itemRoles = getReqRoleRatios(item.id)}
							{@const isCurrent = j === items.length - 1}
							{@const itemTurn = requirementCreationTurnByReqId[item.id] ?? null}
							<div class="requirement-row" class:has-contribution-bar={itemRoles != null} class:bar-on-top={requirementBarOnTop}>
								{#if requirementBarOnTop}
									<div class="requirement-content-col">
										{@render renderReqBar(item.id)}
										{#if onRequirementClick}
											<button
												type="button"
												class="requirement-para requirement-btn requirement-stack-card"
												class:selected={selectedRequirementId === item.id}
												class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(item.id)}
												class:is-current={isCurrent}
												class:is-earlier={!isCurrent}
												onclick={(e) => { e.stopPropagation(); onRequirementClick(item.id); }}
											>
												<span class="revision-label" class:revision-label-current={isCurrent}>{isCurrent ? 'Current' : 'Earlier'}</span>
												{#if isCurrent}{@render renderReqMeta(item.id, itemTurn)}{/if}
												{item.text}
											</button>
										{:else}
											<div class="requirement-para requirement-stack-card" class:is-current={isCurrent} class:is-earlier={!isCurrent}>
												<span class="revision-label" class:revision-label-current={isCurrent}>{isCurrent ? 'Current' : 'Earlier'}</span>
												{#if isCurrent}{@render renderReqMeta(item.id, itemTurn)}{/if}
												{item.text}
											</div>
										{/if}
									</div>
								{:else}
									{@render renderReqBar(item.id)}
									{#if onRequirementClick}
										<button
											type="button"
											class="requirement-para requirement-btn requirement-stack-card"
											class:selected={selectedRequirementId === item.id}
											class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(item.id)}
											class:is-current={isCurrent}
											class:is-earlier={!isCurrent}
											onclick={(e) => { e.stopPropagation(); onRequirementClick(item.id); }}
										>
											<span class="revision-label" class:revision-label-current={isCurrent}>{isCurrent ? 'Current' : 'Earlier'}</span>
											{#if isCurrent}{@render renderReqMeta(item.id, itemTurn)}{/if}
											{item.text}
										</button>
									{:else}
										<div class="requirement-para requirement-stack-card" class:is-current={isCurrent} class:is-earlier={!isCurrent}>
											<span class="revision-label" class:revision-label-current={isCurrent}>{isCurrent ? 'Current' : 'Earlier'}</span>
											{#if isCurrent}{@render renderReqMeta(item.id, itemTurn)}{/if}
											{item.text}
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					{@const collapsedRoles = getReqRoleRatios(chain.currentId)}
					<div class="requirement-row" class:has-contribution-bar={collapsedRoles != null} class:bar-on-top={requirementBarOnTop}>
						{#if requirementBarOnTop}
							<div class="requirement-content-col">
								{@render renderReqBar(chain.currentId)}
							{#if onRequirementClick}
								<button
									type="button"
									class="requirement-para requirement-btn requirement-stack-collapsed"
									class:selected={selectedRequirementId === chain.currentId}
									class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(chain.currentId)}
									data-req-id={chain.currentId}
									onclick={(e) => { e.stopPropagation(); onRequirementClick(chain.currentId); }}
								>
									<span class="stack-badge" aria-hidden="true">{chain.history.length + 1} versions</span>
									{@render renderReqMeta(chain.currentId, reqTurn)}
									{chain.currentText}
								</button>
							{:else}
								<div class="requirement-para requirement-stack-collapsed" data-req-id={chain.currentId}>
									<span class="stack-badge" aria-hidden="true">{chain.history.length + 1} versions</span>
									{@render renderReqMeta(chain.currentId, reqTurn)}
									{chain.currentText}
								</div>
							{/if}
						</div>
						{:else}
							{@render renderReqBar(chain.currentId)}
							{#if onRequirementClick}
								<button
									type="button"
									class="requirement-para requirement-btn requirement-stack-collapsed"
									class:selected={selectedRequirementId === chain.currentId}
									class:highlighted-by-action={hoveredActionRelatedRequirementIds?.has(chain.currentId)}
									data-req-id={chain.currentId}
									onclick={(e) => { e.stopPropagation(); onRequirementClick(chain.currentId); }}
								>
									<span class="stack-badge" aria-hidden="true">{chain.history.length + 1} versions</span>
									{@render renderReqMeta(chain.currentId, reqTurn)}
									{chain.currentText}
								</button>
							{:else}
								<div class="requirement-para requirement-stack-collapsed" data-req-id={chain.currentId}>
									<span class="stack-badge" aria-hidden="true">{chain.history.length + 1} versions</span>
									{@render renderReqMeta(chain.currentId, reqTurn)}
									{chain.currentText}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}

	<div class="requirements-section">
		<div class="requirements-header">
			<span class="contribution-title">Requirements ({requirementChains.length})</span>
			<span class="req-legend">
				<span class="legend-item"><span class="legend-dot human"></span><span class="legend-label">User</span></span>
				<span class="legend-item"><span class="legend-dot model"></span><span class="legend-label">Assistant</span></span>
				<span class="req-legend-divider"></span>
				<span class="legend-item"><span class="req-legend-emoji">💡</span><span class="legend-label">Shaper</span></span>
				<span class="legend-item"><span class="req-legend-emoji">🔧</span><span class="legend-label">Executor</span></span>
			</span>
		</div>
		<div class="requirements-list">
		{#each turnGrouped as group, gi}
			{#if group.chains.length === 1}
				{@render renderChain(group.chains[0].chain, group.chains[0].idx)}
			{:else}
				{@const isExpanded = expandedTurnGroups.has(gi)}
				{@const anyHighlighted = group.chains.some(({ chain }) => hoveredActionRelatedRequirementIds?.has(chain.currentId))}
				<div
					class="turn-group-stack"
					class:expanded={isExpanded}
					class:highlighted-by-action={anyHighlighted}
					role="group"
					aria-label="Requirements created at turn {(group.turn ?? 0) + 1}"
				>
					{#if !isExpanded}
						{#if group.chains.length >= 3}<div class="turn-stack-shadow shadow-back"></div>{/if}
						<div class="turn-stack-shadow shadow-mid"></div>
					{/if}
					<div class="turn-stack-foreground">
						<button
							class="turn-group-toggle"
							onclick={(e) => { e.stopPropagation(); toggleTurnGroup(gi); }}
						>
							<span class="turn-group-label">T{(group.turn ?? 0) + 1} · {group.chains.length} requirements</span>
							<span class="turn-group-chevron">{isExpanded ? '▾' : '▸'}</span>
						</button>
						{#if isExpanded}
							{#each group.chains as { chain, idx }}
								{@render renderChain(chain, idx)}
							{/each}
						{:else}
							{@render renderChain(group.chains[0].chain, group.chains[0].idx)}
						{/if}
					</div>
				</div>
			{/if}
		{/each}
		</div>
	</div>

	{#if hovered && !onRequirementClick}
		<div class="learn-more">Click to learn more</div>
	{/if}
</div>

<style>
	.outcome-board {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		flex: 1;
		min-height: 400px;
		background: #f5f5f5;
		border-radius: 12px;
		border: 1px solid #e5e5e5;
		cursor: pointer;
		transition: background-color 0.2s, box-shadow 0.2s;
		min-width: 0;
		overflow: visible;
	}
	.outcome-board:hovered {
		background: #fefce8;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		border-color: #e4e4a0;
	}

	.board-header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-width: 0;
	}
	.contrib-bars-and-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		min-width: 0;
	}
	.outcome-summary-line {
		font-size: 0.8rem;
		color: #475569;
		line-height: 1.35;
		flex-shrink: 0;
		max-width: 100%;
		white-space: pre-line;
		padding: 0.35rem 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: #f8fafc;
	}
	.board-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		font-size: 0.72rem;
		font-weight: 700;
		color: #1e40af;
		background: #dbeafe;
		border: 1px solid #93c5fd;
		flex-shrink: 0;
	}
	.outcome-board:hovered .board-number {
		background: #bfdbfe;
		color: #1e3a8a;
	}
	.board-title {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-weight: 600;
		color: #111827;
		font-size: 0.88rem;
		position: relative;
		cursor: pointer;
		min-width: 0;
		line-height: 1.35;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}
	.board-title:not(.paren-expanded) {
		display: -webkit-box;
	}
	.board-title.paren-expanded {
		-webkit-line-clamp: unset;
		line-clamp: unset;
		display: block;
		overflow: visible;
	}
	.board-title .paren-ellipsis {
		color: #6b7280;
		font-size: 0.9em;
	}
	.header-tooltip {
		top: calc(100% + 6px);
		bottom: auto;
		left: 0;
		transform: none;
	}
	.header-tooltip::after {
		top: auto;
		bottom: 100%;
		left: 16px;
		transform: none;
		border-top-color: transparent;
		border-bottom-color: #1f2937;
	}

	.contribution-section {
		display: none;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
		min-width: 0;
	}
	.outcome-meta-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.6rem 0.85rem;
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		align-items: stretch;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}
	.meta-cell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-items: center;
		justify-content: flex-start;
		min-width: 0;
	}
	.meta-cell.contrib-cell {
		flex-shrink: 0;
	}
	.meta-cell-key {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #6b7280;
		white-space: nowrap;
	}
	.meta-cell-value {
		font-size: 0.72rem;
		font-weight: 600;
		color: #111827;
	}
	.meta-contrib-bars {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}
	.meta-contrib-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.meta-contrib-item.no-contribution {
		opacity: 0.35;
	}
	.meta-contrib-emoji {
		font-size: 0.7rem;
		line-height: 1;
	}
	.meta-ratio-bar {
		width: 8px;
		height: 28px;
		border-radius: 2px;
		overflow: hidden;
		background: linear-gradient(
			to bottom,
			#4a9e7a 0%,
			#4a9e7a calc(var(--u) * 100%),
			#eab308 calc(var(--u) * 100%),
			#eab308 100%
		);
	}
	.meta-ratio-bar.empty {
		background: #f3f4f6;
	}
	.meta-ratio-svg {
		display: block;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
	}
	.req-mini-svg {
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
		border-radius: 1.5px;
		overflow: hidden;
	}
	.meta-contrib-pct {
		font-size: 0.52rem;
		font-weight: 600;
		color: #9ca3af;
		white-space: nowrap;
	}
	.meta-status-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		justify-content: center;
	}
	.status-chip {
		font-size: 0.66rem;
		font-weight: 700;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		border: 1px solid transparent;
	}
	.status-chip.executed {
		color: #166534;
		background: #dcfce7;
		border-color: #86efac;
	}
	.status-chip.pending {
		color: #9a3412;
		background: #ffedd5;
		border-color: #fdba74;
	}
	.status-chip.dismissed {
		color: #475569;
		background: #e2e8f0;
		border-color: #cbd5e1;
	}
	.status-chip.unknown {
		color: #1e3a8a;
		background: #dbeafe;
		border-color: #93c5fd;
	}
	.contribution-title {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		margin-right: auto;
	}

	.bar-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.pattern-legend {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.pattern-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.pattern-swatch {
		width: 14px;
		height: 8px;
		border-radius: 3px;
		border: 1px solid #d1d5db;
		background: #94a3b8;
	}
	.pattern-swatch.striped {
		background-image: repeating-linear-gradient(
			-45deg,
			transparent,
			transparent 2px,
			rgba(255, 255, 255, 0.55) 2px,
			rgba(255, 255, 255, 0.55) 4px
		);
	}
	.pattern-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: #6b7280;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.legend-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.legend-dot.human { background: #4a9e7a; }
	.legend-dot.model { background: #eab308; }
	.legend-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: #6b7280;
	}

	.bar-segment {
		display: flex;
		align-items: center;
		justify-content: center;
		transition: flex 0.3s ease;
		position: relative;
	}
	.bar-segment.human {
		background: linear-gradient(135deg, #5cb88a, #4a9e7a);
	}
	.bar-segment.model {
		background: linear-gradient(135deg, #f5c842, #eab308);
	}
	.role-icon {
		display: inline-block;
		flex-shrink: 0;
		width: 14px;
		height: 14px;
	}
	.role-icon[data-role='SHAPER'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E") center/contain no-repeat;
	}
	.role-icon[data-role='EXECUTOR'] {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'/%3E%3C/svg%3E") center/contain no-repeat;
	}

	.requirements-section {
		display: flex;
		flex-direction: column;
		gap: 0;
		overflow: hidden;
		min-width: 0;
		flex: 1;
		min-height: 0;
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}
	.requirements-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.75rem 0.5rem;
		border-bottom: 1px solid #f1f5f9;
		background: #fafbfc;
		border-radius: 10px 10px 0 0;
	}
	.req-legend {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.req-legend-divider {
		width: 1px;
		height: 10px;
		background: #cbd5e1;
		flex-shrink: 0;
	}
	.req-legend-emoji {
		font-size: 0.75rem;
		line-height: 1;
	}
	/* ── Turn-group card stack ─────────────────────────────── */
	.turn-group-stack {
		position: relative;
		isolation: isolate;
	}
	.turn-group-stack:not(.expanded) {
		margin-bottom: 6px; /* room for shadow layers */
	}
	.turn-stack-shadow {
		position: absolute;
		inset: 0;
		border-radius: 8px;
		background: #dde5f2;
		border: 1px solid #b8c6dc;
		pointer-events: none;
	}
	.shadow-mid {
		transform: translate(4px, 5px);
		z-index: -1;
	}
	.shadow-back {
		transform: translate(8px, 9px);
		z-index: -2;
		background: #cdd8eb;
		border-color: #a8bbcf;
	}
	.turn-stack-foreground {
		position: relative;
		z-index: 1;
		background: #fff;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		overflow: hidden;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.turn-group-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.3rem 0.55rem;
		background: #f1f5f9;
		border: none;
		border-bottom: 1px solid #e2e8f0;
		cursor: pointer;
		font-size: 0.68rem;
		color: #334155;
		text-align: left;
	}
	.turn-group-toggle:hover {
		background: #e2e8f0;
	}
	.turn-group-stack.expanded .turn-group-toggle {
		border-bottom: 1px solid #e2e8f0;
	}
	.turn-group-label {
		font-weight: 600;
		flex: 1;
	}
	.turn-group-chevron {
		font-size: 0.8rem;
		color: #64748b;
	}
	.turn-stack-foreground .requirement-row,
	.turn-stack-foreground .requirement-stack {
		margin: 0.3rem 0.3rem 0;
	}
	.turn-stack-foreground .requirement-row:last-child,
	.turn-stack-foreground .requirement-stack:last-child {
		margin-bottom: 0.3rem;
	}
	.turn-group-stack.highlighted-by-action > .turn-stack-foreground {
		border-color: #1976d2;
		box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.18);
	}
	/* ─────────────────────────────────────────────────────── */

	.requirements-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
		padding: 0.5rem 0.75rem 0.6rem;
	}
	.requirement-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-width: 0;
	}
	.requirement-row .requirement-para {
		flex: 1;
		min-width: 0;
	}
	.req-mini-bars {
		display: inline-flex;
		gap: 2px;
		flex-shrink: 0;
		align-items: center;
		margin-right: 2px;
	}
	.req-mini-vbar {
		display: inline-block;
		width: 4px;
		height: 22px;
		border-radius: 1.5px;
		background: linear-gradient(
			to bottom,
			#4a9e7a 0%,
			#4a9e7a calc(var(--u) * 100%),
			#eab308 calc(var(--u) * 100%),
			#eab308 100%
		);
	}
	.req-mini-vbar.executor {
		opacity: 0.6;
	}
	.requirement-content-col {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}
	.requirement-row.bar-on-top.has-contribution-bar .requirement-content-col {
		gap: 0.2rem;
	}
	.requirement-stack {
		overflow: hidden;
		min-width: 0;
	}
	/* Collapsed: single card with "N versions" badge and subtle stack cue (no overlap) */
	.requirement-stack-collapsed {
		position: relative;
		padding-left: 0.85rem;
		border-left: 3px solid #4A90E2;
	}
	.requirement-stack-collapsed .stack-badge {
		display: inline-block;
		font-size: 0.65rem;
		font-weight: 700;
		color: #1565c0;
		background: #e3f2fd;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		margin-bottom: 0.35rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	/* Expanded: group border + hierarchy */
	.requirement-stack-expanded-inner {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 2px solid #4A90E2;
		border-radius: 10px;
		background: #e8f4fd;
		box-shadow: 0 2px 8px rgba(74, 144, 226, 0.15);
	}
	.requirement-stack-card {
		min-width: 0;
	}
	.requirement-stack-card.is-earlier {
		padding-left: 0.85rem;
		background: #f3f4f6;
		color: #6b7280;
	}
	.requirement-stack.expanded .requirement-stack-card.is-earlier:hover {
		background: #f3f4f6;
	}
	.requirement-stack-card.is-earlier.selected {
		background: #bbdefb;
		border-color: #4A90E2;
		color: #374151;
	}
	.requirement-stack-card.is-current {
		background: #ebebeb;
		color: #374151;
		font-weight: 600;
	}
	.requirement-stack.expanded .requirement-stack-card.is-current:hover {
		background: #ebebeb;
	}
	.requirement-stack-card .revision-label {
		display: block;
		font-size: 0.65rem;
		font-weight: 700;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		margin-bottom: 0.2rem;
	}
	.requirement-stack-card.is-earlier .revision-label {
		color: #9ca3af;
	}
	.requirement-stack-card .revision-label-current {
		color: #374151;
	}
	.req-meta-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.3rem;
		flex-wrap: wrap;
	}
	.req-turn-badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 700;
		color: #1e40af;
		background: #dbeafe;
		border: 1px solid #93c5fd;
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		letter-spacing: 0.02em;
		line-height: 1.4;
		white-space: nowrap;
	}
	.req-status-badge {
		display: inline-block;
		font-size: 0.58rem;
		font-weight: 700;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		letter-spacing: 0.02em;
		line-height: 1.35;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.req-status-badge.done {
		color: #166534;
		background: #dcfce7;
		border-color: #86efac;
	}
	.req-status-badge.pending {
		color: #9a3412;
		background: #ffedd5;
		border-color: #fdba74;
	}
	.req-status-badge.dismissed {
		color: #475569;
		background: #e2e8f0;
		border-color: #cbd5e1;
	}
	.req-status-badge.unknown {
		color: #1e3a8a;
		background: #dbeafe;
		border-color: #93c5fd;
	}
	.requirement-para {
		margin: 0;
		padding: 0.5rem 0.65rem;
		background: #ebebeb;
		border-radius: 8px;
		font-size: 0.8rem;
		line-height: 1.4;
		color: #374151;
	}
	.requirement-btn {
		width: 100%;
		text-align: left;
		border: 1px solid transparent;
		cursor: pointer;
		font: inherit;
		transition: background 0.15s, border-color 0.15s;
	}
	.requirement-btn:hover {
		background: #bbdefb;
		border-color: transparent;
	}
	/* No hover color change for requirement stacks (2+ versions): collapsed button */
	.requirement-stack-collapsed.requirement-btn:hover {
		background: #ebebeb;
		border-color: transparent;
	}
	.requirement-btn.selected {
		background: #bbdefb;
		border-color: #4A90E2;
	}
	.requirement-btn.highlighted-by-action {
		background: #e3f2fd;
		box-shadow: 0 0 0 1px rgba(74, 144, 226, 0.25);
	}
	.requirement-btn.highlighted-by-action:hover,
	.requirement-btn.highlighted-by-action.selected {
		background: #bbdefb;
	}
	.outcome-board:hovered .requirement-para:not(.requirement-stack-card) {
		background: #f5f5e0;
	}
	/* No hover color change for requirement stacks (2+ versions) */
	.outcome-board:hovered .requirement-stack-collapsed {
		background: inherit;
		border-left-color: #4A90E2;
	}
	.outcome-board:hovered .requirement-btn:hover:not(.requirement-stack-card) {
		background: #bbdefb;
		border-color: transparent;
	}

	/* Next screen (outcome selected): 2+ version req also gets hover, same blue as other requirements */
	.outcome-board.interactive .requirement-stack-collapsed.requirement-btn:hover {
		background: #bbdefb;
		border-color: transparent;
	}
	.outcome-board.interactive .requirement-stack.expanded .requirement-stack-card.is-current:hover {
		background: #bbdefb;
	}
	.outcome-board.interactive .requirement-stack.expanded .requirement-stack-card.is-earlier:hover {
		background: #bbdefb;
	}
	.outcome-board.interactive:hovered .requirement-stack-collapsed.requirement-btn:hover {
		background: #bbdefb;
	}

	.learn-more {
		margin-top: auto;
		padding-top: 0.5rem;
		font-size: 0.78rem;
		color: #a16207;
		font-weight: 500;
		text-shadow: 0 0 8px rgba(254, 240, 138, 0.5);
	}
</style>
