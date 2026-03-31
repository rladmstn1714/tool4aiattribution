// Outcome tree (outcome_requirement_tree.json)
export interface OutcomeNode {
	outcome_id: string;
	outcome: string;
	created_at: number;
	last_updated: number;
	requirements: string[];
}

export interface OutputsDependencyEdge {
	parent_id: string;
	child_id: string;
}

export interface OutputsRelatedEdge {
	outcome_id: string;
	related_id: string;
}

export interface OutcomeRequirementTree {
	dialogue_id: string;
	final_turn: number;
	outcomes: OutcomeNode[];
	requirement_to_outcome_mapping: Record<string, string>;
	/** Output versions from requirements_outputs_lists.outputs (e.g. outcome_1_0, outcome_1_1). */
	output_versions?: Array<{
		id: string;
		content: string;
		turn_id: number;
	}>;
	/** Parent → child dependency (e.g. outcome_2_0 → outcome_3_0) */
	outputs_dependency?: OutputsDependencyEdge[];
	/** Outcome → related outcomes (e.g. outcome_5_0 related to outcome_2_0) */
	outputs_related?: OutputsRelatedEdge[];
}

// Outcome contributions (outcome_contributions.json) — key is thread_id as string
export interface SpeakerContribution {
	direct_influence: number;
	indirect_influence: number;
	total_influence: number;
	requirement_count: number;
}

export interface RoleContributionDetail {
	M_dir: number;
	M_ind: number;
	M_total: number;
	count: number;
	action_examples: Array<{
		action_id: string;
		action_type: string;
		action_text: string;
		turn_id: number;
		influence_type: string;
		influence: number;
	}>;
}

export interface OutcomeContribution {
	thread_id: number;
	outcome_id: string;
	outcome: string;
	speaker_contributions: {
		user: SpeakerContribution;
		assistant: SpeakerContribution;
	};
	role_contributions: {
		user: Record<string, RoleContributionDetail>;
		assistant: Record<string, RoleContributionDetail>;
	};
	role_frequencies: {
		user: Record<string, number>;
		assistant: Record<string, number>;
	};
	requirements: string[];
	summary?: string;
}

export type OutcomeContributionsData = Record<string, OutcomeContribution>;

// requirement.jsonl line (operation types like chatvis)
export type OperationType = 'ADD' | 'DELETE' | 'MODIFY' | 'MERGE' | 'SPLIT';

export interface RequirementRow {
	t: number;
	requirement_id: string;
	operation_type: string;
	related_prev_requirement: string | string[] | null;
	requirement_content: string | null;
	outcome_id?: string;
}

// For graph building (requirement as operation)
export interface Requirement {
	t: number;
	requirement_id: string;
	operation_type: OperationType;
	related_prev_requirement: string | string[] | null;
	requirement_content: string | null;
	outcome_id?: string;
}

// node_analysis.json
export interface RelatedUtterance {
	t: number;
	speaker: string;
	content: string;
	relationship_type: 'DIRECT' | 'INDIRECT';
	influence_score: number;
}

export interface NodeAnalysis {
	requirement_id: string;
	requirement_content: string;
	who_made_this_requirement: { primary_creator: string; contributors: string[]; creation_turn: number };
	related_utterances: {
		direct: RelatedUtterance[];
		indirect: RelatedUtterance[];
	};
	agent_contribution_rates?: unknown;
	overall_statement?: string;
}

export interface NodeAnalysisData {
	dialogue_id: string;
	final_turn: number;
	node_analyses: Record<string, NodeAnalysis>;
}

/** `requirement` = legacy req-op graph; `role_action` = SHAPER/EXECUTOR history per action_id */
export type GraphNodeKind = 'requirement' | 'role_action';

// Graph for requirement visualization or role history
export interface GraphNode {
	id: string;
	requirement_id?: string;
	content: string;
	operation_type?: OperationType;
	node_type: GraphNodeKind;
	/** Set when node_type === 'role_action' (aligned with ChatLogPanel normalizeRole). */
	role_kind?: 'SHAPER' | 'EXECUTOR' | 'OTHER';
	speaker?: string;
	created_at: number;
	is_deleted?: boolean;
	is_modified?: boolean;
}

export interface GraphEdge {
	source: string;
	target: string;
	type: 'parent' | 'merge' | 'split';
}

export interface GraphState {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
}
