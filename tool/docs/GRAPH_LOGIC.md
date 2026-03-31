# 그래프/차트 그리는 로직 요약

## 1. 데이터가 어디서 오는지

- **Run 선택** → `VITE_DATA_BASE` 또는 `static/wine3` 아래 `{run}/` 폴더.
- **dataLoader.ts**에서 JSON fetch:
  - `output_contributions.json` → Outcome별 기여도 (User/Assistant, Shaper/Executor, M_dir/M_ind/M_total 등)
  - `requirements_outputs_lists.json`, `requirement_output_dependency.json` → outcome–requirement 매핑
  - `outcome_action_map.json` → outcome 설명, 액션
  - `requirement_contributions.json` → **Requirement별** User/Assistant, Shaper/Executor 기여 (막대용)
  - `requirements_relation.json` (또는 유사) → Requirement history (ADD/MODIFY/MERGE/SPLIT/DELETE) → **RequirementGraph**용
- **+page.svelte**에서 `loadOutcomeContributions`, `loadRequirements`, `loadRequirementContributions` 등 호출 후 `OutcomeBoard`, `OutcomeHierarchyWithTimeline`, `RequirementGraph` 등에 props로 넘김.

---

## 2. Outcome Board – Contribution 막대 (비율 막대)

**파일:** `OutcomeBoard.svelte`

- **입력:** `contribution: OutcomeContribution | null`  
  - 한 Outcome에 대한 기여도. 구조: `speaker_contributions.user/assistant.total_influence`, `role_contributions.user/assistant.SHAPER|EXECUTOR.{ M_dir, M_ind, M_total }`.
- **비율 계산:**
  - `getBarRatio(c, 'overall')` → User vs Assistant **전체** 비율 (total_influence 기준).
  - `getBarRatio(c, 'role', 'SHAPER')` / `'EXECUTOR'` → 해당 역할에서 User vs Assistant 비율 (M_total 기준).
  - `getShaperFourWay(c)` → Shaper를 **4등분**: User 직접 / User 간접 / Assistant 직접 / Assistant 간접 (M_dir, M_ind 기준, 합 1로 정규화).
- **그리기:**
  - **Shaper:** `shaperFourWay`로 SVG `viewBox="0 0 8 28"` 안에 `<rect>` 4개를 **위에서 아래로** 쌓음.  
    높이 = `humanDirect*28`, `humanIndirect*28`, `modelDirect*28`, `modelIndirect*28`.  
    색: User=녹색(#4a9e7a), Assistant=노랑(#eab308), indirect는 opacity 0.4.
  - **Executor:** CSS만 사용. `meta-ratio-bar`에 `--u`, `--a` (0~1) 넘겨서 좌우 그라데이션으로 채움.
- **Rule-based 한줄 요약:** 같은 `contribution`으로 "User mostly shaped / Assistant mostly executed" 등 문장 생성 후 막대 오른쪽 박스에 표시.

---

## 3. Outcome Board – Requirement 행마다 막대 (Requirement 기여도)

**파일:** `OutcomeBoard.svelte`

- **입력:** `requirementContributionByReqId[reqId]`  
  - `user`, `assistant`, `userShaper`, `assistantShaper`, `userExecutor`, `assistantExecutor`, (선택) `userShaperDir/Ind`, `assistantShaperDir/Ind` 등.
- **비율 계산:** `getReqRoleRatios(reqId)`  
  - Shaper/Executor 각각 User vs Assistant 비율, Shaper 4등분(직접/간접) 등 반환.
- **그리기:**
  - Shaper 있으면: SVG로 4등분 세로 막대 (Outcome Shaper와 같은 방식).
  - Executor: CSS `--u`, `--a` 비율 막대.
  - 각 Requirement 행 왼쪽 또는 위에 작은 막대로 표시.

---

## 4. OutcomeHierarchyWithTimeline – Intent/Outcome 미니 라인 차트 ← **Outcome hierarchy에 있는 그래프**

**파일:** `OutcomeHierarchyWithTimeline.svelte`  
(왼쪽 패널 "Outcome hierarchy" 안에서 Intent/Outcome 각 행 오른쪽에 그려지는 작은 라인 차트가 바로 이거다.)

- **입력:** 턴별 카운트 `TurnCounts[]` (Intent별 `intentTimelineCounts`, Outcome별 `outcomeTimelineCounts` / `outcomeAggregateTimelineCounts`).  
  각 원소: `{ shaper, executor, user, assistant, userShaper, userExecutor, assistantShaper, assistantExecutor }` 등.
- **전처리:** `miniChartSeries(counts, bins)`  
  - 턴 구간을 `bins`개로 나누고, 구간별로 userShaper/assistantShaper, userExecutor/assistantExecutor 합산.  
  - 구간별 최대값으로 나눠서 0~1로 정규화.
- **경로 생성:** `linePath(values, width, height)`  
  - `values`는 0~1 배열.  
  - x = 인덱스에 비례, y = (1 - value) * height 로 **아래가 0, 위가 1**인 좌표계.  
  - 인접 점을 직선으로 잇는 SVG `path`의 `d` 문자열 반환 (M/L 명령).
- **그리기:**  
  - `<svg class="mini-chart" viewBox="0 0 80 12">` (또는 64x10 등) 안에  
  - `<path d={linePath(iseries.map(p => p.userShaper), 80, 12)} stroke="#4a9e7a" />`  
  - `<path d={linePath(iseries.map(p => p.assistantShaper), 80, 12)} stroke="#eab308" />`  
  - Shaper/Executor 각각 User(녹색)·Assistant(노랑) 라인 두 개.  
  - Intent 행에는 Intent별 시계열, Outcome 행에는 Outcome별(또는 집계) 시계열로 같은 방식 적용.

---

## 5. RequirementGraph – 요구사항 히스토리 D3 그래프

**파일:** `RequirementGraph.svelte` (D3), `graphBuilder.ts` (상태 생성)

- **입력:** `graphState: GraphState`  
  - `nodes: Map<id, GraphNode>`, `edges: { source, target, type }[]`.  
  - `buildGraphForOutcome(rows, outcomeReqIds, nodeAnalysis)`가 `requirements_relation` 같은 requirement 행들을 ADD/MODIFY/MERGE/SPLIT/DELETE로 해석해 노드·엣지 생성.
- **레이아웃:**  
  - 엣지 기준으로 노드에 `level` 부여 (들어오는 엣지 없으면 0, 있으면 1 + max(소스 level)).  
  - 같은 level끼리 세로로 나열, level마다 가로로 배치 (nodeWidth + hGap).  
  - 전체 bbox 구한 뒤 뷰포트 중앙에 맞춤.
- **그리기 (D3):**  
  - `svg.selectAll('*').remove()` 후 `container` g 추가, zoom 적용.  
  - **엣지:** `line` 요소, x1/y1/x2/y2 = source/target 좌표, marker-end로 화살표.  
  - **노드:** `g.node`에 `rect`(둥근 사각형), `text`(requirement_id, content).  
  - 색상은 operation_type (ADD/MODIFY/MERGE/SPLIT/DELETE)별로 고정.  
  - 클릭 시 `onNodeClick`, 선택 노드는 stroke 강조.

---

## 6. OverviewTimeline – 턴별 셀 + 바 스택

**파일:** `OverviewTimeline.svelte`

- **입력:** Outcome별 턴별 `counts` (각 턴의 shaper/executor 카운트).
- **그리기:**  
  - 각 턴을 `turn-cell`로 배치, `positionPercent(turnIdx)`로 가로 위치.  
  - 셀 안에 `bar-pair`:  
    - `cell.shaper > 0`이면 `bar-stack shaper-only`, `--scale: cell.shaper / maxCountPerTurn`.  
    - `cell.executor > 0`이면 `bar-stack executor-only`, `--scale: cell.executor / maxCountPerTurn`.  
  - CSS에서 `--scale`로 높이(또는 너비) 비율 적용해 막대처럼 보이게 함.

---

## 요약 표

| 위치 | 데이터 소스 | 비율/시계열 계산 | 그리기 방식 |
|------|-------------|------------------|-------------|
| OutcomeBoard Contribution | `output_contributions` → OutcomeContribution | getBarRatio, getShaperFourWay | SVG rect 4단 (Shaper), CSS 비율 막대 (Executor) |
| OutcomeBoard Requirement 행 | requirement_contributions.json | getReqRoleRatios | SVG 4단 + CSS 막대 (작은 버전) |
| OutcomeHierarchyWithTimeline | 턴별 Shaper/Executor 카운트 | miniChartSeries, linePath | SVG path 라인 (미니 라인 차트) |
| RequirementGraph | requirements_relation + graphBuilder | buildGraphForOutcome (level 레이아웃) | D3: line + rect + text, zoom |
| OverviewTimeline | 턴별 counts | maxCountPerTurn으로 정규화 | CSS bar (--scale) |

---

## 7. Outcome hierarchy (왼쪽 Intent / Outcome 목록) – 어떻게 되나요?

**위치:** `OutcomeHierarchyWithTimeline.svelte`, `+page.svelte` (데이터), `dataLoader.ts`  
**참고:** 이 패널 **안에 그려지는 미니 라인 차트**는 위 **§4**와 동일하다 (intentTimelineCounts / outcomeTimelineCounts → miniChartSeries → linePath → SVG).

### 7.1 Outcome 목록이 만들어지는 흐름

1. **트리/아웃컴 목록 (`tree.outcomes`)**
   - `loadOutcomeRequirementTree()`가 다음을 읽음:
     - `requirement_output_dependency.json` → `requirement_to_outcome` (req → outcome 매핑)
     - `requirements_outputs_lists.json` → `outputs` (output id → outcome id 변환)
   - Outcome ID = `requirement_to_outcome` 값들 + `outputs`에서 나온 ID들 (중복 제거, outcome_1, outcome_2 … 순 정렬).
   - 각 outcome에 대해: 소속 requirement 목록, 표시 이름(outcome_action_map.description 또는 output content), created_at/last_updated.

2. **의존 엣지 (부모–자식)**
   - `tree.outputs_dependency` (또는 `requirements_outputs_lists.outputs_dependency`)에서 `parent_id`, `child_id` (output id)를 가져옴.
   - `+page.svelte`의 `dependencyEdges`에서 output id → outcome id로 바꿔서 `{ parentId, childId }` 리스트 생성.
   - `OutcomeHierarchyWithTimeline`은 이걸 `dependencyEdges` prop으로 받음.

3. **Intent(의도) 라벨**
   - `loadOutcomeIntentionMap()`이 `intent_outcome_map.json`(또는 `step05b_output.json`)을 읽음.
   - `intentions[]` (intention_id → intention 문자열)와 `outcome_to_intention` (outcome_id → intention_id)로 **outcome_id → 의도 문장** 맵 생성 → `outcomeIntentionMap`.
   - 이 맵이 없으면 intent는 전부 `"Unmapped"`.

### 7.2 계층 그룹/순서

- **acyclicEdges:** `dependencyEdges`에서 DFS로 순환(back-edge) 제거한 엣지만 사용.
- **parentByOutcomeId / childrenByParentId:** 위 엣지로 부모/자식 맵 만듦.
- **orderedOutcomes:** 루트(부모 없는 outcome)부터 방문하고, 각 노드 다음에 자식들을 outcome 순서로 방문. 부모 없는 고아도 나중에 한 번씩 방문.
- **displayDepthByOutcomeId:** 같은 트리 순회로 각 outcome의 깊이(0=루트, 1=그 자식, …) 계산.
- **visibleOutcomes:** `orderedOutcomes` 중에서, 깊이 0이거나 “부모가 보이고 펼쳐져 있음(expandedParentIds)”인 것만 필터. → 접힌 상태 반영.

### 7.3 Intent별 그룹 (I1, I2, … + outcome 리스트)

- **hierarchyGroups:**  
  - `visibleOutcomes`를 **루트의 intent**로 묶음.  
  - `rootOf(oid)` = outcome_id에서 부모를 타고 올라가서 나온 루트 ID.  
  - `getIntentLabel(rootOf(oid))` = 그 루트의 `outcomeIntentionMap` 라벨 (없으면 "Unmapped").  
  - 같은 intent 라벨끼리 한 그룹으로 묶고, 그룹 내 outcome 순서는 `visibleOutcomes` 순서 유지.
- 화면: `{#each hierarchyGroups as group}` → Intent 헤더(I1, I2, … + 문장) + `{#each group.outcomes as outcome}` 로 각 outcome 행(번호, 제목, 접기/펼치기, 미니 차트 등) 렌더.

### 7.4 요약

| 단계 | 데이터 소스 | 결과 |
|------|-------------|------|
| Outcome 목록 | requirement_output_dependency, requirements_outputs_lists, outcome_action_map | tree.outcomes (id, 제목, requirements, created_at 등) |
| 부모–자식 | outputs_dependency (output id) → outcome id 변환 | dependencyEdges |
| Intent 라벨 | intent_outcome_map / step05b_output (outcome_to_intention, intentions) | outcomeIntentionMap |
| 순서/깊이 | dependencyEdges (순환 제거) | orderedOutcomes, displayDepthByOutcomeId, visibleOutcomes |
| Intent 그룹 | visibleOutcomes + outcomeIntentionMap(루트 기준) | hierarchyGroups → I1, I2, … 아래 outcome 리스트 |

즉, **outcome hierarchy는 “outcome 목록 + outcome 간 의존(부모/자식) + outcome별 intent 라벨”**로 만들어지고, **의도별로 그룹해 트리처럼 접기/펼치기**해서 보여줍니다.

---

이 문서는 chatvis4 기준이며, chatvis5도 동일한 구조를 사용합니다.
