# pulse

**A health monitor for AI coding agents.**

Pulse reads the session transcripts Claude Code already writes to disk and shows you whether your agent is getting more or less efficient over time — turns per task, file revisit rate, cache efficiency, memory utilization. No cloud. No accounts. No API keys.

```
pulse — quick stats

  Project                    Sessions  Health  Turns  Revisit  CacheEff
  ─────────────────────────────────────────────────────────────────────
  data-pipeline                     2      95    38.5      20%      100%
  ai-agent                          1      70    24.0      20%      100%
  context-engine                    4      59    22.3      14%       75%
  signal-processor                 12      56    25.2      22%       92%
  content-platform                 21      50    23.5      29%       95%
  workflow-automation               3      34    81.3      70%      100%  ⚠
```

---

## The problem

You can see your Anthropic bill. You cannot see:

- Whether session 30 on a project is slower than session 5
- Whether your agent re-reads the same files over and over (context thrashing)
- Whether the memory files you've been building are actually being used
- Which projects are running efficiently and which are burning turns

Pulse surfaces all four in under a second, against session data you already have.

---

## Install

```bash
git clone https://github.com/michaewahl/pulse
cd pulse
npm install
```

No global install required. Runs directly with `npx tsx`.

---

## Usage

```bash
# Quick terminal summary — all projects
npx tsx src/cli.ts stats

# Generate full HTML dashboard
npx tsx src/cli.ts analyze

# Generate and open in browser
npx tsx src/cli.ts analyze --open

# Scope to one project
npx tsx src/cli.ts analyze --project /path/to/your/project

# Open last report
npx tsx src/cli.ts report
```

Pulse reads from `~/.claude/projects/` — the directory Claude Code uses to store session transcripts and memory files. No configuration needed.

---

## The 4 metrics

### Turns to Resolution
How many times you had to message the agent per session. Trending up means the agent is getting less efficient — more back-and-forth to complete the same kinds of tasks. Could be memory bloat, context pollution, or task complexity increasing.

### File Revisit Rate
`(duplicate file reads / total file reads)` per session. High rate = the agent re-read files it already had in context — token waste and a signal it couldn't hold state between tool calls. **workflow-automation in the screenshot above: 70%.** The agent re-read the same files 7 times out of 10.

### Context Efficiency
`cache_read_input_tokens / total input tokens`. Higher is better — it means the agent is reusing cached context from earlier in the session rather than reprocessing everything from scratch each turn. Consistently low values mean you're paying for tokens you've already paid for.

### Memory Utilization
`memory files read / total memory files stored`. Low ratio = the agent isn't using its own memory. Possible causes: too many memory entries (bloat), entries that don't match current task types, or stale entries that haven't been pruned.

---

## What it found on real data

Running Pulse against 73 sessions across 23 projects revealed patterns that weren't visible before:

**workflow-automation — 70% file revisit rate, 81 avg turns.** The agent was re-reading the same files on nearly every turn. 81 turns average per session is a metabolic disorder — the same project type runs in 15–25 turns elsewhere. This is the kind of signal that was completely invisible before Pulse.

**api-service — 34 turns, 43% revisit rate.** The agent was churning. Comparing to data-pipeline (38.5 turns but only 20% revisit) shows the revisit rate is the real problem, not just turn count.

**data-pipeline — health score 95.** Short sessions, 100% cache efficiency, low revisit. This is what a healthy agent metabolism looks like. The contrast against the bottom of the list makes the pathology visible.

**context-engine — 75% cache efficiency** vs everything else at 92–100%. This project routes some requests through a local model which bypasses Claude's cache. That's the cause — visible immediately in the metric.

---

## How it works

Claude Code writes a JSONL file for every session to `~/.claude/projects/<project-slug>/<session-id>.jsonl`. Each line is a JSON event — user messages, assistant responses, tool calls, token counts. Pulse parses these files, filters out tool result callbacks (which inflate turn counts), and computes the four metrics per session.

The HTML dashboard is a single self-contained file with Chart.js for trend lines and sparklines. No server, no build step.

---

## Data stays local

Pulse never sends data anywhere. It reads files on your disk and writes a report to your disk. The HTML file has no analytics, no telemetry, no external requests (Chart.js loads from CDN for the dashboard — remove it for fully offline use).

---

## Roadmap

Pulse is product 1 of a planned three-product stack:

- **Pulse** — observe the problem ← *you are here*
- **ContextIQ** — fix it (selective attention engine that curates context before sessions start)
- **AgentKit** — build agents that maintain themselves (memory consolidation, drift detection, background maintenance)

---

## Contributing

Issues and PRs welcome. If you run Pulse against your own projects and find interesting patterns, open an issue — real-world data is the best way to improve the metrics.

---

*Built with Claude Code. The irony is intentional.*
