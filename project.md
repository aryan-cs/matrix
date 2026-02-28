# Project Name

**Option 1: Simulacra** — *A living AI society where beliefs spread, memories accumulate, and every agent has a face.*

**Option 2: Echosphere** — *Watch how ideas, rumors, and trust ripple through a synthetic community in real time.*

**Option 3: Nexus Society** — *Multi-agent social simulation powered by persistent memory and embodied AI personas.*

---

# TL;DR

- We built a reactive artificial society: dozens of LLM agents live in a shared world, form dynamic social neighborhoods, and communicate across the group — not just 1:1.
- Every agent has a persistent memory layer (via Supermemory) that accumulates beliefs, relationships, and learned events across simulated "days."
- Users can inject events (rumors, news, crises), speak directly to any agent via a HeyGen embodied avatar, and watch how information spreads through the society.
- Modal powers all parallel inference — each agent thinks concurrently, sandboxed, at scale — and manages the long-running simulation loop.
- Supermemory is the cognitive backbone: per-agent memory storage, contextual retrieval at decision time, memory compaction, and a post-simulation memory diffusion report.
- This is not a toy chatbot demo — it's a credible research and communication-training tool dressed in an interactive, judge-ready product.

---

# Problem & Why It Matters

## Primary Use Case: Misinformation and Belief Contagion in Communities

**The pain:** Public health agencies, comms teams, and researchers need to understand how false or incomplete information spreads through social networks before committing to a real-world intervention. Today, this requires either expensive human studies, oversimplified graph simulations (SIR models), or slow academic agent-based models that can't capture nuanced language, relationship dynamics, or memory.

**Current tools fall short:**
- Graph-based diffusion models (NetworkX, Gephi) model topology, not cognition. They don't capture *why* an agent believes something or *how* social trust modulates message acceptance.
- LLM sandboxes like AutoGen or CrewAI focus on task completion pipelines, not persistent social memory or emergent belief formation across time.
- Existing social sims (NetLogo, Mesa) are rule-based and cannot reason in natural language or adapt to novel injected events.

**What's missing:** A system where agents have genuine memory, form opinions through conversation, update beliefs when new evidence arrives, and can be interrogated as if they were real people — so teams can test messaging strategies, observe misinformation persistence, and identify the most influential nodes before deploying anything in the real world.

---

# The Big Idea

## What We Built

Simulacra is a society of LLM agents that live, talk, remember, and evolve. Each agent has a persistent identity: a name, backstory, personality traits, and a growing memory of everything they've experienced. Agents are grouped into dynamic neighborhoods — clusters of socially proximate peers — and every simulated "day," each agent holds conversations with their neighborhood, forms or updates beliefs, and writes new memories to Supermemory.

## What "Reactive" Means

The simulation is reactive in two ways:
1. **Event injection:** A user (researcher, judge, curious person) can inject a world event mid-simulation — e.g., "a health agency announces a new vaccine is 90% effective" — and agents begin reacting based on their existing beliefs, relationships, and trust levels.
2. **User intervention:** A user can *talk directly to any agent* via a HeyGen avatar. That conversation is real. The agent retrieves its memory, responds in character, and the conversation is written back to Supermemory — changing what that agent knows and potentially what it tells its neighbors next cycle.

## What the User Experiences

The user sees a living map of agents, their neighborhoods, and belief states. They can pause the sim, inject events, choose an agent to "talk to" (launching a HeyGen avatar session), and watch belief propagation unfold across the network in near real time. After N days, they receive a Supermemory-generated report showing memory diffusion, belief stability, and knowledge recall across every agent.

---

# User Experience (Product Design)

## UI Flow

**Screen 1 — Setup / World Builder**
- User names the simulation, sets the number of agents (default: 12), and chooses a scenario template (e.g., "Vaccine Rumor Spread," "Campus Election," "Brand Crisis").
- Each agent is auto-generated with a name, age, occupation, and starting belief set.
- User can optionally edit any agent's profile before starting.
- One-click: **Launch Simulation.**

**Screen 2 — Live Simulation Dashboard**
- Force-directed graph shows agents as nodes, neighborhood edges as lines, and belief intensity as node color (e.g., red = high misinformation acceptance, green = accurate belief).
- Day counter ticks forward. Each "day" triggers a conversation round.
- Sidebar shows a live event log: "Agent Maya told Agent Ravi: 'I heard the new vaccine causes headaches.'"
- **Inject Event button** (top right): user types or selects a world event; it propagates next cycle.

**Screen 3 — Agent Inspection Panel**
- Click any agent node to open their profile: current beliefs, recent memories, relationship trust scores, neighborhood list.
- Button: **Talk to [Agent Name]** — launches HeyGen avatar modal.

**Screen 4 — HeyGen Avatar Conversation**
- A photorealistic avatar (matched to the agent's profile) appears in a video panel.
- User types or speaks; the agent responds in character, drawing from Supermemory.
- Session ends: conversation is logged to that agent's Supermemory context.

**Screen 5 — End-of-Simulation Report**
- After N days (or when user stops sim): Supermemory report renders.
- Sections: Knowledge Diffusion Map, Belief Stability Chart (described), Top Misinformation Vectors, Memory Recall Scores per agent.

## The "Aha Moment"

The judge injects the event: *"A news story claims the water supply is contaminated."* Within two simulated days, they watch three skeptical agents (green) flip to alarmed (red), trace the exact conversation chain that caused it, then click the most resistant agent and watch a HeyGen avatar calmly explain *why* it still doesn't believe the rumor — citing a memory of a previous false alarm. That's the moment.

## Accessibility & Clarity
- Color coding is supplemented by icons and labels (not color-only).
- All text panels are readable at 14px+.
- Simulation speed is adjustable (slow/normal/fast) so judges can follow along.
- Every panel has a one-line tooltip explaining what it shows.

## Demo Script (60–90 seconds)

> "We built a reactive AI society. Watch — these 12 agents are living in a simulated community. Each one has a name, a personality, and a real memory. [Point to graph.] Right now they're in Day 3. Let me inject an event — a rumor that the local water supply is contaminated. [Click inject.] Watch what happens on Day 4. [Fast-forward.] You can see the belief spreading — three agents went red. Let me click on Maya — she's one of the skeptics who resisted. [Open HeyGen.] Hi Maya, did you hear about the water? [Agent responds in character, citing memory of past false alarms.] That conversation just got written back to her memory. Tomorrow she'll tell her neighbors. [Close modal.] And here's the report — memory diffusion score, belief stability, which agent was the super-spreader. This is what it looks like to understand how information moves through a community — before it happens in real life."

---

# System Architecture (Execution & Technical Quality)

## Components

| Component | Role |
|---|---|
| **Simulation Engine** | Orchestrates days, triggers agent turns, manages event queue |
| **Agent Runtime** | Per-agent LLM call: retrieve memory → compose prompt → generate response → write memory |
| **Neighborhood Manager** | Computes social proximity; assigns agents to neighborhoods each day |
| **Message Router** | Delivers messages from agent to agent within a neighborhood round |
| **Supermemory Client** | Reads/writes per-agent memory, runs retrieval queries, triggers summarization |
| **HeyGen Bridge** | Converts agent state to persona config, manages avatar sessions, writes conversation back |
| **Event Bus** | Accepts user-injected events, queues them for next simulation cycle |
| **Frontend (Next.js)** | Dashboard, graph viz (D3 or react-force-graph), agent panels, report view |
| **Modal Backend** | Hosts all inference, simulation loop, storage |

## Key Abstractions

- **Agent:** `{id, name, traits, neighborhood_id, belief_vector, supermemory_user_id}`
- **Neighborhood:** `{id, agent_ids[], computed_by: proximity_function, day_formed}`
- **Memory:** Supermemory document — typed as `interaction | belief | event | relationship | user_conversation`
- **Event:** `{id, description, injected_at_day, source: user|system}`
- **Simulation Day:** One complete round of neighborhood assignment → message passing → memory writes → belief update

## Data Flow

```
User injects event
       |
       v
Event Bus → Simulation Engine (Day N+1 trigger)
       |
       v
Neighborhood Manager → assign agents to clusters
       |
       v
For each neighborhood (parallel via Modal):
   Agent A: Supermemory.retrieve(query) → build prompt → LLM call → response
   Agent B: same
   Message Router: A's response → B's context, B's response → A's context
   Each agent: Supermemory.write(new memories)
       |
       v
Belief states updated → Frontend receives SSE update → Graph re-renders
       |
       v
(If user talks to agent)
HeyGen Bridge: agent state → avatar session → user conversation → Supermemory.write
       |
       v
End of sim: Supermemory report generated → rendered in UI
```

## ASCII Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                    │
│   [Graph View]  [Agent Panel]  [HeyGen Modal]  [Report]     │
└────────────────────────┬────────────────────────────────────┘
                         │ REST / SSE
┌────────────────────────▼────────────────────────────────────┐
│                   Modal API Gateway                          │
│   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│   │  Simulation  │   │  Neighborhood│   │  Event Bus    │  │
│   │  Engine      │──▶│  Manager     │   │  (queue)      │  │
│   └──────┬───────┘   └──────────────┘   └───────┬───────┘  │
│          │ (per-neighborhood parallel jobs)      │          │
│   ┌──────▼───────────────────────────────────┐   │          │
│   │  Agent Runtime Pool (Modal Functions)    │◀──┘          │
│   │  Agent-1  Agent-2  Agent-3  ...          │              │
│   │   ↕ retrieve/write  ↕           ↕        │              │
│   └──────────────┬───────────────────────────┘              │
│                  │                                           │
│   ┌──────────────▼────────────┐  ┌──────────────────────┐  │
│   │   Supermemory API         │  │  HeyGen Bridge       │  │
│   │   (per-agent memory)      │  │  (avatar sessions)   │  │
│   └───────────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Message Routing Between Agents

Within a neighborhood round, the Message Router operates as a small pub-sub system:
- Each agent's output message is tagged with `{from_agent_id, to_neighborhood_id, content, day}`.
- The router fans the message out to all other agents in the neighborhood as a new context item.
- Agents do NOT all run simultaneously in strict lockstep — they run in two half-rounds per day: odd-indexed agents speak first, even-indexed agents receive and respond. This prevents circular deadlocks and models realistic conversation sequencing.

## Concurrency Model

- **Neighborhood-level parallelism:** Each neighborhood is a separate Modal Function invocation. 12 agents in 3 neighborhoods = 3 parallel jobs.
- **Within a neighborhood:** Agents run sequentially in half-rounds (avoids race conditions on shared neighborhood state).
- **Simulation loop:** Managed as a Modal Cron Job or long-running Web Endpoint with internal tick control.
- **User interactions (HeyGen):** Independent Modal Function, does not block the simulation loop.

---

# Modal Implementation Plan

## Why Modal

Modal gives us sandboxed, serverless parallel inference with GPU access, persistent volumes, and a clean Python API — exactly what a multi-agent simulation needs.

## What Runs Where

| Modal Construct | What It Does |
|---|---|
| `@modal.function` | Per-neighborhood agent inference round (parallel invocations) |
| `@modal.function` | HeyGen bridge (avatar session setup, conversation handling) |
| `@modal.function` | Supermemory report generation (end-of-sim analytics) |
| `@modal.web_endpoint` | REST API consumed by the Next.js frontend |
| `@modal.cron` or loop inside `@modal.function` | Simulation tick loop (advances days on a schedule or on-demand) |
| `modal.Volume` | Stores simulation state snapshots, agent configs, day logs |
| `modal.Dict` / `modal.Queue` | Event bus for user-injected events; inter-function coordination |

## Parallelism Strategy

```python
# Pseudocode
@modal.function(gpu="any")  # GPU for faster inference
def run_neighborhood_round(neighborhood: Neighborhood, day: int):
    for agent in neighborhood.agents:
        context = supermemory.retrieve(agent.id, query=build_query(day))
        prompt = build_prompt(agent, context, neighborhood.messages)
        response = llm.generate(prompt)
        supermemory.write(agent.id, new_memory(response, day))
        neighborhood.messages.append(response)

# Dispatched in parallel:
modal.map(run_neighborhood_round, neighborhoods, kwargs={"day": current_day})
```

- `modal.map` across neighborhoods = true parallelism with no shared state conflicts.
- Each function call is stateless; all state lives in Supermemory + Modal Volume.

## Long-Running Simulations

- The simulation loop runs inside a `@modal.function` with `timeout=3600`.
- Day ticks are controlled by an internal `asyncio` loop with configurable sleep between ticks (1–10 seconds for demo speed).
- Users can pause/resume via a `modal.Dict` flag checked at the top of each tick.
- Simulation state (current day, agent belief vectors, neighborhood assignments) is checkpointed to `modal.Volume` after every day.

## Storage

| Data | Where |
|---|---|
| Simulation configs + agent profiles | `modal.Volume` (JSON) |
| Per-day message logs | `modal.Volume` (JSONL) |
| Agent memory (long-term) | Supermemory API |
| Live belief state (fast reads) | `modal.Dict` (in-memory, TTL) |

## Latency Management

- Pre-warm the inference function before demo with `modal.Function.keep_warm(1)`.
- Cache neighborhood assignment results in `modal.Dict` — recomputed only when social proximity changes.
- Streaming SSE from the Modal web endpoint to frontend means users see updates as each agent finishes, not waiting for the full round.

## GPU vs CPU

| Workload | Compute |
|---|---|
| LLM inference per agent | GPU (A10G or T4) |
| Neighborhood proximity function (LLM-based embedding + cosine sim) | GPU |
| Report generation (structured output, smaller model) | CPU (cheaper) |
| HeyGen API calls, Supermemory API calls | CPU (I/O bound) |

---

# Supermemory Implementation Plan

## Why Supermemory

Supermemory provides managed, per-user memory storage with semantic retrieval — exactly the cognitive layer multi-agent social simulation requires. Each agent maps to one Supermemory user profile.

## What Is Stored Per Agent

Every memory document is typed and tagged:

| Memory Type | Example Content | Tags |
|---|---|---|
| `interaction` | "Ravi told me the vaccine is unsafe. I'm not sure I believe him." | `day:3, source:ravi, topic:vaccine` |
| `belief` | "I believe the water supply is safe based on official reports." | `day:1, topic:water, confidence:0.8` |
| `relationship` | "I trust Maya more than Ravi. She's been right before." | `agent:maya, trust:0.85` |
| `event` | "Heard about water contamination rumor spreading in the neighborhood." | `day:4, event_id:ev_003` |
| `user_conversation` | "A researcher asked me about my vaccine beliefs. I explained my skepticism." | `day:5, source:user` |

All writes include `{agent_id, day, type, content, metadata}`.

## Retrieval Strategy at Decision Time

Before each agent generates a response, we query Supermemory with a structured retrieval call:

```python
context = supermemory.retrieve(
    user_id=agent.supermemory_id,
    query=f"What do I know about {topic} and what do I think of {neighborhood_agents}?",
    filters={"tags": ["belief", "relationship", "event"]},
    top_k=8
)
```

The retrieved chunks are injected into the agent's prompt as episodic context. This means the agent's response is grounded in what it has *actually experienced* in the simulation — not just its base LLM weights.

## Memory Summarization / Compaction

After every 5 simulated days:
- We call Supermemory's summarization endpoint (or run a compaction function) to compress older `interaction` memories into consolidated `belief` documents.
- Example: 10 individual "heard about vaccine" interactions → one belief document: "By Day 10, I believe vaccines are moderately safe. Trust in official sources: 0.7."
- This keeps retrieval efficient as the simulation grows long.

## User Profiles (Human Users)

When a user talks to an agent via HeyGen, we optionally store:
- What the user said, what they claimed to believe.
- Which agent they spoke to and on which day.
- This lets an agent "remember" the researcher across sessions: "A researcher visited on Day 5 and tried to convince me vaccines are safe."

## End-of-Simulation Memory Report

We query Supermemory across all agents to generate:

| Metric | Definition |
|---|---|
| **Knowledge Diffusion Score** | % of agents who have a memory containing injected event X by Day N |
| **Belief Stability Index** | Variance in an agent's belief confidence across days (low = stable, high = volatile) |
| **Misinformation Persistence Rate** | % of agents still holding false belief after a correction event was injected |
| **Relationship Drift Score** | Change in average trust weight across agent pairs from Day 1 to Day N |
| **Memory Recall Score** | Per-agent: how many distinct facts from Day 1 can be retrieved on Day N (semantic similarity test) |
| **Super-Spreader Index** | Agent whose memories appear most frequently in other agents' interaction logs |

These metrics are computed by cross-querying Supermemory and rendered as a table + described chart in the report view.

## Inspecting Agent Memory (Judge-Friendly Artifacts)

From the Agent Inspection Panel, judges can:
- View a timeline of an agent's memories sorted by day.
- See a belief evolution table: belief topic | Day 1 value | Day N value | drift.
- Export a JSON dump of all memories for a selected agent.
- View a "who told who what" relationship graph derived from `interaction` memory tags.

---

# HeyGen Embodiment Layer

## Converting Agent State to a Persona Script

Before launching a HeyGen session for Agent Maya, we:
1. Retrieve Maya's top-K memories from Supermemory (beliefs, recent interactions, relationships).
2. Construct a system prompt: personality traits + current emotional tone (derived from belief volatility and recent interactions) + a summary of what she knows.
3. Set HeyGen avatar parameters: avatar ID matched to Maya's profile image, voice style matched to her demographic/personality.

```python
persona_prompt = f"""
You are {agent.name}, a {agent.traits} person living in {world.name}.
Your current beliefs: {agent.belief_summary}
Recent memories: {retrieved_context}
Your emotional tone today: {agent.emotional_state}
Respond naturally. Stay in character. Do not break the fourth wall.
"""
```

## Maintaining Continuity

- Every HeyGen session is seeded from the *current* Supermemory state — so Maya on Day 7 remembers Day 3 conversations.
- After the session ends, the full conversation transcript is written back to Supermemory as a `user_conversation` memory.
- Next time the user talks to Maya (or Maya talks to her neighbors), she carries that conversation forward.

## Writing Conversations Back to Memory

```python
supermemory.write(
    user_id=agent.supermemory_id,
    content=heygen_session.transcript,
    type="user_conversation",
    tags=[f"day:{current_day}", "source:human_user"]
)
```

This makes user interactions first-class citizens in the simulation — the researcher *becomes part of the world*.

## Safety Considerations

- System prompt includes a hard stop: "Do not generate content that is hateful, violent, or sexually explicit."
- Agent beliefs are synthetically generated — no real person is modeled or defamed.
- HeyGen avatar selection uses generic stock avatars, not real likenesses.
- User-injected events are filtered through a lightweight moderation check before entering the event bus.

---

# What Makes This Different

## vs. Basic Multi-Agent Chat (AutoGen, CrewAI)

| Feature | Basic Multi-Agent | Simulacra |
|---|---|---|
| Memory | Session-only | Persistent across days via Supermemory |
| Communication topology | 1:1 or hub-and-spoke | Dynamic neighborhood clusters (N:N) |
| Social proximity | None | LLM-computed proximity function, changes over time |
| Embodiment | Text only | HeyGen photorealistic avatars |
| Time | Single session | Multi-day simulation with compounding memory |
| User role | Task assigner | World-shaper + social participant |
| Output | Task result | Diffusion maps, belief reports, memory timelines |

## vs. Classic Agent-Based Models (NetLogo, Mesa)

- Rule-based agents vs. LLM agents that *reason in natural language*.
- No memory in classical ABMs vs. Supermemory-backed episodic recall.
- No embodiment in classical ABMs vs. HeyGen avatar conversations.
- Static topology vs. dynamic neighborhoods recomputed each day.

## The Core Novelty

The combination of **neighborhood-based social structure + long-term persistent memory + embodied avatar interaction** has not been shipped as a single hackathon product. The memory layer is not cosmetic — it is the mechanism by which belief formation, trust drift, and knowledge diffusion actually happen.

---

# Impact & Intent

## Who Uses This

- **Public health researchers:** Simulate how vaccine misinformation spreads before deploying a correction campaign.
- **Crisis communication teams:** Test messaging strategies on a synthetic population before going live.
- **Political scientists:** Model polarization dynamics in synthetic communities.
- **Educators and students:** Interactive sandbox for understanding social contagion, network effects, and information theory.
- **AI safety researchers:** Study emergent collective behavior in LLM agent societies.

## Why It's Meaningful

The cost of misinformation in the real world is measurable: vaccine hesitancy costs lives, financial misinformation costs savings, political misinformation costs elections. Simulation tools that are both cognitively realistic and accessible lower the barrier for researchers and communicators to test interventions. Simulacra is the first tool that makes this accessible without a PhD in computational social science.

## Beyond the Hackathon

- Connect to real social graph data (Twitter/X API, Reddit) to initialize agent networks from real topology.
- Fine-tune agents on domain-specific personas (e.g., political demographics).
- Build a SaaS product for comms agencies: "test your message on 1000 synthetic citizens before your campaign launches."
- Academic publication: emergent collective memory in LLM agent societies.
- Open-source the simulation engine as a research framework.

---

# Evaluation Plan

## Experiment 1: Event Injection and Belief Diffusion

**Setup:** 12 agents, 3 neighborhoods, 5 simulated days. No prior events. Inject on Day 3: *"A local news outlet reports that a new supplement causes memory loss."*

**What we show:** Day-by-day belief state graph. Count agents who hold the belief on Day 3, 4, and 5. Show the conversation chain that caused diffusion (extracted from Supermemory interaction logs).

**Success criteria:** At least 50% of agents in the source neighborhood hold the belief by Day 4. At least one cross-neighborhood transfer happens by Day 5.

---

## Experiment 2: User Intervention and Downstream Effect

**Setup:** Same society. One agent (Maya) holds the false supplement belief strongly. User opens HeyGen, speaks to Maya, presents counter-evidence. Conversation is written to Supermemory. Simulation continues for 2 more days.

**What we show:** Maya's belief confidence before and after conversation (Supermemory belief document comparison). Whether Maya's neighbors' beliefs shift in subsequent days (downstream effect visible on graph).

**Success criteria:** Maya's belief confidence drops by ≥0.2 after conversation. At least one neighbor updates belief within 2 days.

---

## Experiment 3: Memory Report After X Days

**Setup:** Run simulation for 7 days with 2 injected events. Generate end-of-simulation Supermemory report.

**What we show:** Knowledge Diffusion Score for each event. Top-3 super-spreader agents. Belief Stability Index for 3 selected agents. Memory recall: query each agent for "what happened on Day 1" and show semantic similarity to actual Day 1 events.

**Success criteria:** Report renders in <10 seconds. At least one event shows >70% diffusion. At least one agent shows measurable belief drift across 7 days.

---

# Scope for 36 Hours

## MVP (Ship No Matter What)

- [ ] 8–12 agents with static initial profiles and belief vectors
- [ ] Neighborhood assignment via LLM embedding + cosine similarity (recomputed each day)
- [ ] Agent-to-agent message passing within neighborhoods (one round per day)
- [ ] Supermemory integration: write and retrieve per-agent memories
- [ ] User event injection via UI
- [ ] Live belief state graph (D3 force graph, color-coded nodes)
- [ ] One HeyGen avatar session (single agent, working end-to-end)
- [ ] Conversation written back to Supermemory
- [ ] End-of-sim report: diffusion score + belief table (even if text-only)
- [ ] Modal deployment: simulation loop + agent inference running on Modal

## Stretch Goals (If Ahead of Schedule)

- [ ] All agents embodied with distinct HeyGen avatars
- [ ] Dynamic neighborhood recomputation (neighborhoods shift as trust changes)
- [ ] Memory compaction / summarization after Day 5
- [ ] Full Supermemory report with all 6 metrics
- [ ] Relationship trust graph visualization
- [ ] Simulation speed control (slow/normal/fast)
- [ ] Export agent memory as JSON

## How We Avoid Overbuilding

- Fake the report rendering with hardcoded metrics on Day 1 if Supermemory queries are slow — replace with live queries once infra is stable.
- Use OpenAI or Claude API for LLM calls first; switch to Modal GPU inference only if time allows.
- Use one HeyGen avatar for the demo; generalize to N avatars only as stretch.
- No auth, no database — all state in Modal Volume + Supermemory. No user accounts.

---

# Risks & Mitigations

## Technical Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Modal cold start latency makes demo feel slow | Medium | `keep_warm(1)` on key functions; pre-run sim before judges arrive |
| Supermemory API rate limits hit during parallel writes | Medium | Batch writes; add 100ms sleep between agent write calls |
| HeyGen avatar session fails / lags | Medium | Pre-record a fallback video of one agent conversation |
| LLM outputs break JSON schema (malformed belief update) | High | Structured output / function calling with retry logic |
| Neighborhood proximity function produces degenerate clusters (all in one) | Low | Hard cap: max 4 agents per neighborhood, min 2 |
| Memory retrieval returns irrelevant context (low quality) | Medium | Tag-based filtering + top_k=6 cap; manual prompt tuning in first 4 hours |

## Product / Demo Risks

| Risk | Mitigation |
|---|---|
| Demo graph is confusing to judges | Practice demo script 3x; add legend + tooltip to every element |
| Simulation runs too slowly to show diffusion live | Pre-run 5 days before judging; show replay, then do live injection for Day 6 |
| HeyGen avatar feels uncanny or robotic | Choose a natural voice + avatar style; keep conversation short and punchy |
| Judges don't understand why memory matters | Explicitly show before/after: agent with memory vs. agent without — different responses |

---

# Team Responsibilities

## Person 1 — Simulation Engine + Modal

- Build the day tick loop, event bus, and neighborhood manager.
- Deploy all Modal functions; configure parallelism.
- Own the `modal.Volume` state management and simulation checkpointing.
- **Deliverable:** Simulation runs 5 days end-to-end on Modal by Hour 18.

## Person 2 — Supermemory Integration + Agent Runtime

- Implement Supermemory client (write, retrieve, summarize).
- Build the per-agent prompt construction pipeline (memory retrieval → prompt → LLM call → memory write).
- Generate the end-of-simulation report using Supermemory queries.
- **Deliverable:** Single agent with working memory loop by Hour 12; full report by Hour 30.

## Person 3 — Frontend + Product

- Build Next.js dashboard: force graph, agent panel, event injection UI, report view.
- Wire up SSE from Modal web endpoint.
- Own the demo script and UI polish.
- **Deliverable:** Working graph with live agent state by Hour 20; full demo flow by Hour 32.

## Person 4 — HeyGen + Integration Lead

- Build HeyGen bridge: agent state → persona prompt → avatar session.
- Write conversation transcripts back to Supermemory.
- Handle end-to-end integration testing (Supermemory ↔ Agent Runtime ↔ HeyGen ↔ Frontend).
- Own risk mitigation (fallback video, error handling).
- **Deliverable:** Working HeyGen session for one agent by Hour 24; integrated by Hour 30.

---

# What We Will Show Judges (Checklist)

**Live Demo Checklist:**
- [ ] Open dashboard — 12 agents visible on graph, neighborhoods highlighted
- [ ] Point out belief state coloring and explain what it means (30 sec)
- [ ] Show agent inspection panel — click one agent, show their Supermemory memories (30 sec)
- [ ] Inject event live — show graph update on next day tick (60 sec)
- [ ] Open HeyGen avatar session — have a 3-turn conversation with one agent (60 sec)
- [ ] Show that conversation appeared in agent's Supermemory log (15 sec)
- [ ] Fast-forward 2 more days — show belief diffusion changed (30 sec)
- [ ] Open end-of-simulation report — walk through 2–3 metrics (45 sec)
- [ ] Call out: "This runs entirely on Modal — parallel inference, long-running sim, all serverless."
- [ ] Call out: "Every agent's memory lives in Supermemory — retrieval, compaction, cross-agent analytics."

**Artifacts to Have Ready:**
- [ ] Pre-run 5-day simulation (replay mode ready)
- [ ] Supermemory report screenshot (backup)
- [ ] Fallback HeyGen recording (backup)
- [ ] Architecture diagram open in a tab

---

# Why We Will Win

**Idea & Creativity:** A reactive artificial society with embodied avatars, dynamic social neighborhoods, and persistent multi-day memory is a genuinely novel combination. No existing hackathon or research project has shipped all three together in a working product. The misinformation diffusion framing gives it immediate real-world relevance that judges can relate to.

**Product Design:** The UX flow is clean and judge-legible: a force graph that changes color, an avatar you can talk to, a report that shows you what happened. The "aha moment" — injecting a rumor and watching it spread, then interrogating a resistant agent — is visceral and memorable in 90 seconds.

**Execution & Technical Quality:** Every component is real, not mocked. Modal runs the actual parallel inference. Supermemory stores and retrieves actual agent memories. HeyGen renders an actual avatar. The architecture is clean, modular, and scalable. The concurrency model is thought through. This is not a demo with a backend full of hardcoded strings.

**Impact & Intent:** Misinformation diffusion is a genuine, documented social harm. A simulation tool that makes it testable — without running experiments on real humans — is genuinely useful to researchers, public health teams, and communicators. We're not building a toy; we're building a tool someone would actually use next week.

**Modal Track:** We use Modal as the core compute backbone — parallel agent inference, long-running simulation loop, serverless storage, GPU acceleration. Modal is not a deployment afterthought; it is structurally necessary for the parallelism that makes the simulation feasible.

**Supermemory Prize:** Supermemory is the cognitive layer without which this system is just a chatbot. Per-agent episodic memory, semantic retrieval at decision time, memory compaction, relationship tracking, and a cross-agent diffusion report are all direct applications of Supermemory's core capabilities — and we produce judge-inspectable artifacts that make the memory layer visible and legible.

We are not building a demo. We are building the first version of a research tool — and we are shipping it in 36 hours.
