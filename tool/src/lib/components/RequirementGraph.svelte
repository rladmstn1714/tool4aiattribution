<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import type { GraphState, GraphNode, GraphEdge } from '$lib/types';

	let {
		graphState,
		selectedNode = $bindable(null),
		onNodeClick = (_n: GraphNode) => {},
		compact = false
	}: {
		graphState: GraphState;
		selectedNode: GraphNode | null;
		onNodeClick?: (node: GraphNode) => void;
		/** Shorter min-height for embedding in the main three-column layout */
		compact?: boolean;
	} = $props();

	let svgElement: SVGSVGElement;
	let containerElement: HTMLDivElement;
	let width = $state(1000);
	let height = $state(600);

	const nodeWidth = 220;
	const nodeHeight = 56;
	const opColors: Record<string, string> = {
		ADD: '#4A90E2',
		MODIFY: '#f59e0b',
		MERGE: '#42a5f5',
		SPLIT: '#1976d2',
		DELETE: '#9ca3af'
	};

	function nodeFill(d: GraphNode): string {
		if (d.node_type === 'role_action') {
			if (d.role_kind === 'SHAPER') return '#7c3aed';
			if (d.role_kind === 'OTHER') return '#64748b';
			return '#16a34a';
		}
		const op = d.operation_type || 'ADD';
		return opColors[op] || '#60a5fa';
	}

	function nodeTitle(d: GraphNode): string {
		if (d.node_type === 'role_action') {
			const r = d.role_kind ?? 'EXECUTOR';
			const sp = d.speaker ? ` · ${d.speaker}` : '';
			return `${d.id} · ${r}${sp}\n${d.content ?? ''}`;
		}
		return d.requirement_id ?? d.id;
	}

	function truncate(str: string, maxLen: number): string {
		if (!str) return '';
		return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
	}

	onMount(() => {
		if (containerElement) {
			const rect = containerElement.getBoundingClientRect();
			width = rect.width || 1000;
			height = rect.height || 600;
		}
		render();
	});

	$effect(() => {
		if (graphState && svgElement) render();
	});

	function render() {
		if (!svgElement || !graphState) return;
		const nodes = Array.from(graphState.nodes.values()).filter((n) => !n.is_deleted);
		const edges = graphState.edges.filter(
			(e) => graphState.nodes.has(e.source) && graphState.nodes.has(e.target)
		);
		const svg = d3.select(svgElement);
		svg.selectAll('*').remove();
		const container = svg.append('g').attr('class', 'container');
		const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 3]).on('zoom', (ev) => container.attr('transform', ev.transform));
		svg.call(zoom);

		if (nodes.length === 0) {
			svg.append('g')
				.append('text')
				.attr('x', width / 2)
				.attr('y', height / 2)
				.attr('text-anchor', 'middle')
				.attr('fill', '#9ca3af')
				.text('No role actions for this outcome');
			return;
		}

		// Left-to-right layered layout: compute level (column) from edges, then place nodes
		interface SimNode extends GraphNode {
			x: number;
			y: number;
			level: number;
		}
		const nodeMap = new Map<string, SimNode>();
		nodes.forEach((n) => nodeMap.set(n.id, { ...n, x: 0, y: 0, level: 0 }));

		// Level = 0 if no incoming edge, else 1 + max(level of sources)
		let changed = true;
		while (changed) {
			changed = false;
			for (const e of edges) {
				const target = nodeMap.get(e.target);
				const source = nodeMap.get(e.source);
				if (!target || !source) continue;
				const newLevel = source.level + 1;
				if (newLevel > target.level) {
					target.level = newLevel;
					changed = true;
				}
			}
		}

		const levelGroups = new Map<number, SimNode[]>();
		for (const n of nodeMap.values()) {
			const list = levelGroups.get(n.level) || [];
			list.push(n);
			levelGroups.set(n.level, list);
		}
		const hGap = 80;
		const vGap = 24;
		const levels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
		for (const level of levels) {
			const list = levelGroups.get(level)!;
			for (let i = 0; i < list.length; i++) {
				const n = list[i];
				n.x = 60 + level * (nodeWidth + hGap) + nodeWidth / 2;
				n.y = i * (nodeHeight + vGap) + nodeHeight / 2;
			}
		}
		// Center the layout in the viewport
		const simNodes = Array.from(nodeMap.values());
		const minX = Math.min(...simNodes.map((n) => n.x - nodeWidth / 2));
		const maxX = Math.max(...simNodes.map((n) => n.x + nodeWidth / 2));
		const minY = Math.min(...simNodes.map((n) => n.y - nodeHeight / 2));
		const maxY = Math.max(...simNodes.map((n) => n.y + nodeHeight / 2));
		const shiftX = width / 2 - (minX + maxX) / 2;
		const shiftY = height / 2 - (minY + maxY) / 2;
		for (const n of simNodes) {
			n.x += shiftX;
			n.y += shiftY;
		}

		interface SimLink {
			source: SimNode;
			target: SimNode;
			type: string;
		}
		const simLinks: SimLink[] = [];
		for (const e of edges) {
			const a = nodeMap.get(e.source);
			const b = nodeMap.get(e.target);
			if (a && b) simLinks.push({ source: a, target: b, type: e.type });
		}

		const defs = svg.append('defs');
		defs.append('marker')
			.attr('id', 'arrow')
			.attr('viewBox', '-0 -5 10 10')
			.attr('refX', 24)
			.attr('refY', 0)
			.attr('orient', 'auto')
			.attr('markerWidth', 6)
			.attr('markerHeight', 6)
			.append('path')
			.attr('d', 'M 0,-5 L 10,0 L 0,5')
			.attr('fill', '#94a3b8');

		const linkGroup = container.append('g').attr('class', 'links');
		linkGroup
			.selectAll('line')
			.data(simLinks)
			.join('line')
			.attr('x1', (d) => d.source.x)
			.attr('y1', (d) => d.source.y)
			.attr('x2', (d) => d.target.x)
			.attr('y2', (d) => d.target.y)
			.attr('stroke', '#94a3b8')
			.attr('stroke-width', (d) => (d.type === 'merge' ? 2.5 : 1.5))
			.attr('stroke-dasharray', (d) => (d.type === 'split' ? '5,5' : '0'))
			.attr('opacity', 0.7)
			.attr('marker-end', 'url(#arrow)');

		const nodeGroup = container.append('g').attr('class', 'nodes');
		const nodeEl = nodeGroup
			.selectAll('g.node')
			.data(simNodes)
			.join('g')
			.attr('class', 'node')
			.attr('transform', (d) => `translate(${d.x - nodeWidth / 2},${d.y - nodeHeight / 2})`)
			.style('cursor', 'pointer')
			.on('click', (ev, d) => {
				ev.stopPropagation();
				onNodeClick(d);
			});

		nodeEl.append('title').text((d) => nodeTitle(d));

		// Box (rounded rect)
		nodeEl
			.append('rect')
			.attr('width', nodeWidth)
			.attr('height', nodeHeight)
			.attr('rx', 8)
			.attr('ry', 8)
			.attr('fill', (d) => nodeFill(d))
			.attr('opacity', (d) => (selectedNode?.id === d.id ? 1 : 0.9))
			.attr('stroke', (d) => (selectedNode?.id === d.id ? '#111827' : '#475569'))
			.attr('stroke-width', (d) => (selectedNode?.id === d.id ? 3 : 1.5));

		// Top line: turn + id (role graph) or requirement id
		nodeEl
			.append('text')
			.attr('x', 10)
			.attr('y', 17)
			.attr('font-size', '11px')
			.attr('font-weight', 'bold')
			.attr('fill', '#fff')
			.attr('pointer-events', 'none')
			.text((d) =>
				d.node_type === 'role_action'
					? `T${d.created_at} · ${d.id}`
					: (d.requirement_id ?? d.id)
			);

		// Role label (role graph only)
		nodeEl
			.append('text')
			.attr('x', 10)
			.attr('y', 30)
			.attr('font-size', '9px')
			.attr('font-weight', '600')
			.attr('fill', '#f1f5f9')
			.attr('pointer-events', 'none')
			.style('opacity', (d) => (d.node_type === 'role_action' ? 1 : 0))
			.text((d) => (d.node_type === 'role_action' ? (d.role_kind ?? 'EXECUTOR') : ''));

		// Content (truncated)
		nodeEl
			.append('text')
			.attr('x', 10)
			.attr('y', (d) => (d.node_type === 'role_action' ? 44 : 36))
			.attr('font-size', '10px')
			.attr('fill', '#fff')
			.attr('pointer-events', 'none')
			.attr('style', 'font-family: inherit;')
			.text((d) => truncate(d.content || '', d.node_type === 'role_action' ? 32 : 38));

		nodeEl
			.on('mouseenter', function () {
				d3.select(this).select('rect').attr('stroke-width', 2.5);
			})
			.on('mouseleave', function () {
				if (selectedNode?.id !== (d3.select(this).datum() as SimNode).id)
					d3.select(this).select('rect').attr('stroke-width', 1.5);
			});

		const bbox = container.node()?.getBBox();
		if (bbox && bbox.width > 0 && bbox.height > 0) {
			const scale = Math.min(0.85 * width / bbox.width, 0.85 * height / bbox.height, 1.2);
			const tx = width / 2 - (bbox.x + bbox.width / 2) * scale;
			const ty = height / 2 - (bbox.y + bbox.height / 2) * scale;
			svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
		}
	}
</script>

<div class="graph-wrap" class:compact bind:this={containerElement}>
	<svg bind:this={svgElement} width="100%" height="100%" viewBox="0 0 {width} {height}"></svg>
</div>

<style>
	.graph-wrap {
		width: 100%;
		height: 100%;
		min-height: 400px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #fafafa;
	}
	.graph-wrap.compact {
		min-height: 220px;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
