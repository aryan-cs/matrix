# PLAN.md — Multi-Agent Society Simulation Platform (v1)

## Summary
- Build a single-tenant prototype where users submit a free-text simulation prompt, review/edit generated demographic personas and assumptions, run a 50-200 agent simulation on Modal, and receive dual native reports (Markdown + LaTeX, plus compiled PDF).
- Core behavior: domain-agnostic scenarios, free-form agent conversation over a segmented social graph, per-agent Supermemory, async job workflow, and recommendation-oriented outputs with hard uncertainty disclosures.
- Platform constraints: `<5 min` target turnaround, `$10-$30` target run cost, full run traceability, 30-day data retention, no auth in v1.
- Skill note: no Codex skill applied because this request is product planning, not skill creation or skill installation.

## Scope
- In scope: prompt ingestion, planning/research, persona synthesis, human approval/edit loop, simulation orchestration, results aggregation, report generation, artifacts API, and observability.
- In scope: Exa-first retrieval with fallback web search, open-source mid-tier models running on Modal, hard dependency on Modal + Supermemory.
- Out of scope: multi-tenant SaaS, enterprise RBAC, category-specific risk blocking, long-term benchmark corpus management, deterministic replay guarantees across changing web/model states.

## Success Criteria
- 95%+ simulation job success rate across normal load.
- P95 end-to-end runtime under 5 minutes for default 100-agent runs.
- Default run cost stays within `$10-$30`.
- 100% reports include uncertainty statements, source list, segmented outcomes, and recommendation rationale.
- 100% runs preserve full trace artifacts (planner outputs, evidence, transcripts, metrics).

## Architecture
1. Frontend: React + CSS app for prompt submission, planning review/edit, job monitoring, and report viewing/download.
2. Backend API: Python FastAPI service coordinating planner, simulation, artifact generation, and run state machine.
3. Orchestration: Modal jobs for planner tasks and agent simulation workers.
4. Memory: Supermemory namespaces per agent, scoped to run ID + agent ID.
5. Retrieval: Exa primary provider; fallback to standard web search provider when Exa fails/timeouts.
6. Storage: relational DB for run metadata + object storage for artifacts/transcripts/trace blobs.
7. Report engine: Markdown generator and independent LaTeX generator; PDF compilation from LaTeX.
8. Metrics/observability: structured logs, run-level telemetry, cost estimation, and quality metrics store.

## End-to-End Workflow
1. User submits free-text prompt.
2. Planner performs retrieval-based research, infers demographic dimensions, and proposes population breakdown + assumptions with citations/confidence.
3. Persona generator creates representative profiles mapped to the target `n` with exact allocation.
4. User reviews, edits, and regenerates planning artifacts until approved.
5. Backend launches simulation job: free-form dialogue turns on segmented social graph with per-agent memory.
6. Simulation ends by fixed cap, convergence trigger, or manual stop.
7. Aggregator computes segmented sentiment shifts, argument clusters, recommendation options, and uncertainty scores.
8. Report service emits Markdown, LaTeX, and PDF artifacts.
9. UI/API expose outputs, trace, and downloadable artifacts.

## Public APIs, Interfaces, and Types

### REST Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/simulations` | Create run from prompt and config. |
| GET | `/api/simulations/{run_id}` | Get run status, stage, and summary metrics. |
| GET | `/api/simulations/{run_id}/plan` | Fetch current planner artifacts (splits, personas, assumptions, evidence). |
| POST | `/api/simulations/{run_id}/plan/regenerate` | Regenerate planner output with optional edit constraints. |
| POST | `/api/simulations/{run_id}/plan/approve` | Approve planner output and enqueue simulation. |
| POST | `/api/simulations/{run_id}/control/stop` | Manual stop request for active run. |
| GET | `/api/simulations/{run_id}/trace` | Full trace metadata and artifact pointers. |
| GET | `/api/simulations/{run_id}/report?format=md|tex|pdf` | Download report artifact. |
| GET | `/api/simulations/{run_id}/events` | SSE stream for async progress updates. |

### Core Types (contract-first)
| Type | Required fields |
|---|---|
| `SimulationConfig` | `agent_count`, `max_rounds`, `convergence_threshold`, `time_limit_sec`, `token_budget`, `cost_budget_usd` |
| `PlannerArtifact` | `demographic_breakdown`, `assumptions`, `confidence_scores`, `sources`, `generated_at` |
| `PersonaProfile` | `persona_id`, `segment_labels`, `bio`, `values`, `policy_prior`, `communication_style` |
| `AgentRuntimeConfig` | `agent_id`, `system_prompt`, `neighbors`, `memory_namespace`, `model_id`, `token_limits` |
| `TurnRecord` | `run_id`, `round_idx`, `speaker_agent_id`, `message`, `citations`, `timestamp` |
| `SegmentOutcome` | `segment_key`, `support_pct`, `oppose_pct`, `neutral_pct`, `top_rationales`, `quote_snippets` |
| `RunTrace` | `planner_steps`, `retrieval_events`, `simulation_events`, `aggregation_events`, `artifact_refs` |
| `ReportBundle` | `markdown_url`, `latex_url`, `pdf_url`, `generated_at`, `version` |

## Simulation Design Decisions
- Agent count default `100`, allowed range `50-200`.
- Interaction topology default segmented social graph with configurable inter-segment edge ratio.
- Conversation mode is free-form, but bounded by global round/token/time limits.
- Stop logic supports three paths: fixed caps, convergence detection, and manual stop.
- Memory is strictly per-agent; no shared memory channel in v1.
- Model runtime is open-source mid-tier models on Modal; default model constant is pinned in config and used across planner/sim/report stages.
- Recommendations are required output, accompanied by rationale and uncertainty sections.

## Quality, Safety, and Uncertainty Controls
- Every planner claim must include source URLs and confidence score.
- Every report must include uncertainty bands and explicit non-determinism notice.
- Source quality scoring uses freshness, source type, and corroboration count.
- Full trace retention for 30 days with deletion job enforcement.
- No category-specific extra gate in v1; single approval flow applies to all prompts.
- Full-text retrieval is allowed per current product choice.

## Testing and Acceptance Criteria

### Test Cases
1. Prompt-to-plan test: free-text prompt yields demographic split, assumptions, and citations.
2. Plan edit/regenerate test: user edits segment weights and receives valid rebalanced personas.
3. Allocation integrity test: persona counts always sum exactly to `n`.
4. Modal orchestration test: agent workers launch, exchange messages, and terminate on each stop mode.
5. Supermemory isolation test: no cross-agent memory leakage across namespaces.
6. Retrieval fallback test: Exa failure triggers fallback provider and run still succeeds.
7. Aggregation test: segmented sentiment outputs match transcript-derived labels.
8. Report generation test: Markdown, LaTeX, and PDF all produced and downloadable.
9. Trace completeness test: planner/retrieval/simulation/report events all present in run trace.
10. Retention policy test: artifacts deleted after 30 days.

### Acceptance Scenarios
1. Illinois bill scenario: 100 agents, segmented outcomes, recommendations, and uncertainty in under 5 minutes.
2. Cross-domain scenario: non-policy prompt still produces coherent planning and personas.
3. Manual stop scenario: user stops active run and receives partial-results report with stop reason.
4. Convergence scenario: run exits early when sentiment change falls below threshold.
5. Budget guard scenario: run halts or degrades gracefully when cost/token cap is reached.

### Operational Metrics
- `run_success_rate >= 0.95`
- `p95_runtime_seconds < 300`
- `default_run_cost_usd <= 30`
- `citation_coverage_ratio >= 0.90`
- `trace_completeness_ratio = 1.0`

## Delivery Phases
1. Phase 1: API skeleton, run state machine, planner artifact schema, and React intake/review screens.
2. Phase 2: Retrieval integration, persona synthesis, approval/edit/regenerate loop.
3. Phase 3: Modal simulation engine, social graph routing, Supermemory integration.
4. Phase 4: Aggregation pipeline, dual report generators, PDF compilation.
5. Phase 5: Trace/audit pipeline, metrics dashboards, retention/deletion jobs, performance tuning to SLOs.

## Assumptions and Defaults
- Default deployment is single-tenant prototype with no auth.
- Reproducibility is moderate: configs/prompts/logs pinned, but live retrieval/model drift accepted.
- Hard dependencies on Modal and Supermemory are intentional for v1.
- Frontend stack is React + CSS; backend stack is Python.
- Retrieval is Exa-first with fallback web search.
- Validation priority is automated metrics, not fixed benchmark suites or expert rubric reviews.
- Reports include quotes + argument clusters, and produce raw `.tex` plus compiled PDF.
