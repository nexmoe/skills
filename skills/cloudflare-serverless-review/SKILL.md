---
name: cloudflare-serverless-review
description: >-
  Read-only review of Cloudflare Workers and Pages projects for runaway execution
  and billing risk. Use when asked to audit serverless costs or review a PR for
  unbounded alarms, polling, Cron jobs, D1 queries, Queue or Worker cycles,
  per-request KV or Durable Object writes, retries, or AI loops. Report code
  evidence, trigger rates, worst-case monthly cost scenarios, and suggested fixes.
---

# Cloudflare Serverless Review

Act as a Cloudflare billing-risk auditor. Follow actual execution paths to determine which work keeps generating charges, how it amplifies, and where it stops. A review is complete when all eight risk categories have a conclusion, every finding includes traceable evidence, frequency and cost estimates, and a concrete fix, and unresolved evidence gaps are explicit.

## Review Boundaries

- Read code, configuration, migrations, existing tests, and user-provided usage data. Produce a report without modifying project files.
- Do not deploy, trigger alarms, Cron jobs, Queues, or AI calls, or query remote databases. Inspect existing tests without automatically executing project code or tests that might access live services.
- When traffic, object counts, table sizes, models, or plans are unknown, continue the code review and use scenarios with explicit assumptions. Do not make live calls just to obtain numbers.
- Verify API behavior, platform retry defaults, limits, and prices against current official documentation, following the project's documentation lookup conventions. Do not send project code or credentials in queries. If documentation is unavailable, explain the limitation, retain formulas, and do not invent prices.
- The alarm prohibitions and 60-second minimum in this skill are review rules required by the user, not inherent Cloudflare API restrictions.

## Establish Trigger Chains and Evidence

Start with `rg --files` to locate Worker/Pages applications, frontend code, Wrangler configuration, database migrations, and tests. Read actual bindings and configuration for the target environment, including `triggers.crons`, `durable_objects`, `services`, `queues`, `d1_databases`, `kv_namespaces`, AI bindings, and variables controlling frequency or attempts. Binding names are clues; confirm the product and callers behind them.

For a specified PR or diff, read the changes first, then trace related entry points, callers, callees, failure handling, configuration, and tests. Do not describe a diff-only review as a repository-wide audit. Mark inaccessible external Workers, deployment configuration, or runtime variables as needing confirmation.

Use searches such as these to locate candidates, then inspect complete functions and wrappers. A keyword match does not establish a risk, and the absence of a match does not establish safety:

```bash
rg -n 'setAlarm|getAlarm|deleteAlarm|\balarm\b|\bscheduled\b' .
rg -n 'setInterval|setTimeout|refetchInterval|refreshInterval|visibilitychange|retry|backoff' .
rg -n 'max_retries|dead_letter_queue|retry_delay|retryAll|sendBatch|waitUntil' .
rg -n -i '\b(select|update|delete|where|create\s+index)\b' .
rg -n '\.put\(|\.fetch\(|\.run\(|maxSteps|maxTurns|maxIterations|while\s*\(' .
```

Exclude dependencies and build output as appropriate for the repository. Also inspect equivalent calls in ORMs, schedulers, client libraries, task frameworks, and other languages. For each chain, record `entry -> execution/read/write -> failure or successor work -> re-entry -> stopping condition`, including its interval, object/user counts, fan-out, retry layers, and whether state is persistent.

## Eight Review Categories

### 1. Durable Object Alarm Rescheduling

Inspect every `setAlarm` call and wrapper, covering constructors, `alarm()`, early returns, `catch`, `finally`, and cancellation/resumption entry points. A persistent alarm wakes the object when due without an external request. Alarm invocations and the storage operations used to schedule alarms are metered; see [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) and [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Report these violations of this skill's rules:

- Calling `setAlarm` in a constructor, including indirect scheduling through helpers.
- Calling `setAlarm` at every exit from `alarm()`, especially when no work remains, after failure, or in `finally`.
- Continually extending a deadline, lease, or TTL by refreshing shortly before expiry so the same chain never ends.
- Rescheduling itself at intervals shorter than 60 seconds unless the user explicitly requests that frequency and documents an enforceable cap, such as a maximum count, deadline, or budget. A short interval in configuration does not establish this exception.

Every chain must satisfy these requirements:

- When no work remains, return immediately without another `setAlarm`.
- Before rescheduling, state and enforce a stopping condition: a maximum count, fixed deadline, or persistent `active` flag. Do not reset counts or deadlines each round. An `active` flag needs a reachable deactivation path, and constructors or failure paths must not reactivate it after shutdown.
- Existing tests must cover "an alarm with no work does not schedule another alarm." Also inspect stopping behavior when inactive, past the deadline, out of attempts, or persistently failing. Report missing tests separately rather than treating them as proof of an infinite loop.
- The commit/PR description must explain how the chain stops. If that description is unavailable, mark it as needing confirmation and provide a suggested stopping explanation in the report.

Distinguish bounded platform retries for one failed alarm from application calls to `setAlarm` that create successor alarms. Do not misreport finite platform retries as infinite, or assume they terminate application rescheduling. At-least-once alarm execution requires idempotent work; `deleteAlarm` alone cannot replace stopping checks inside the handler.

### 2. Frontend Polling

Inspect timers, client query libraries, and component lifecycles for duplicate registrations, overlapping requests, requests continuing in hidden pages, and failure to stop on unmount or task completion. Browser throttling does not replace explicit pausing while hidden.

Check successful polling intervals and stopping conditions separately from failure backoff. Recommend reducing frequency based on state and pausing/stopping when the page is hidden, the component unmounts, the user cancels, or the task completes. Avoid a burst of accumulated requests on resumption. Use bounded backoff with jitter for errors and limit in-flight requests. When continuous polling is required, state user counts and request budgets; `setInterval` alone does not prove runaway behavior.

### 3. Scheduled Jobs

Inspect Cron jobs, scheduled handlers, and background synchronization for full reads on every run, repeated rewrites of the same data, stable pagination cursors, persistent progress, per-run batch limits, idempotency keys or conditional writes, and exclusion of overlapping runs.

Trace cursor rollback after failure, repeated replay of unfinished batches, and any derived Queue messages or alarms. Recommend incremental processing, writing only changed data, and idempotency for replay. A fixed, small dataset may reasonably be processed in full; establish a scale and frequency problem rather than requiring a cursor for every Cron job.

### 4. D1 Queries and Write Scope

Read SQL/ORM generation, parameter sources, schemas, and migrations. Inspect frequent queries with missing or unusable indexes, unbounded full scans, and `UPDATE`/`DELETE` statements without effective `WHERE` constraints. Check `WHERE 1=1`, optional predicates, and nonselective conditions too. A `LIMIT` or small result set does not prove a small scan.

Check index column order, existing primary-key indexes, expressions, and predicate compatibility. Use existing query plans or `meta.rows_read/rows_written` as evidence. Otherwise label scan counts as estimates and do not claim an index is effective. Include additional writes from triggers, cascades, and index maintenance. Recommend selective predicates, appropriate indexes, bounded batches, and change detection. Assess controlled one-off migrations or explicitly requested full-table operations by their purpose and scale; a missing `WHERE` alone does not establish runaway execution.

### 5. Queue and Worker Call Cycles

Map Service Bindings, RPC, target URLs, Queue producers/consumers, and DLQ relationships. Confirm whether `A -> B -> A` or `producer -> consumer -> producer` is actually reachable.

Check hop/attempt/deadline limits, task identity and counters preserved across republishing, idempotency, and failure exits for each cycle. For Queues, inspect effective `max_retries`, `retry_delay`, and `dead_letter_queue`, including whether the DLQ automatically feeds back into the original chain. If `max_retries` is omitted, verify the platform default first. Without a DLQ, report the failure terminal state and recovery gap; do not infer infinite retries from its absence.

Pay particular attention to sending a new message or calling the producer after failure: a new message's delivery counter does not cap the old task. For batch retries, check acknowledgment of completed messages so one failure does not replay the entire batch. Recommend bounded retries, task-level counters, and a DLQ or failure terminal state that does not automatically feed back. For Worker cycles, distinguish limits on a single invocation from cycles spanning new events.

### 6. Per-Request KV or Durable Object Writes in Hot Paths

Trace per-request counters, logs, heartbeats, session refreshes, and state writes from frequent HTTP/RPC entry points. Distinguish a DO invocation from an actual DO storage write, and record keys, rows, and write counts per request.

For statistics, access records, and noncritical logs, recommend sampling, combining counters, and flushing by time or batch threshold. Bulk APIs writing the same number of keys/rows generally still meter those keys/rows; batching calls does not automatically reduce write charges. Preserve required per-request persistence for transactions, authorization, or quota state, and explain its costs and bounds. Do not move critical state solely into volatile memory. Aggregation flush scheduling must also pass categories 1 and 3.

### 7. Unbounded Retries After Failure

Cover recursion, `while` loops, Promise chains, timer callbacks, client-library defaults, and layered calls. Check maximum attempts, total duration, per-attempt timeouts, retryable errors, backoff, and effective cancellation.

Backoff reduces rate but does not guarantee termination; a maximum backoff interval is not a maximum attempt count. Outer restarts must not reset the task budget. Calculate multiplicative amplification from nested retries. Recommend bounded exponential backoff with jitter, error classification, respect for `Retry-After`, and explicit failure terminal states. Record evidence when the platform or SDK already enforces effective bounds.

### 8. AI Call Loops

Inspect `env.AI.run`, external model calls, agent/tool loops, recursive evaluation, and "repeat until satisfied" logic. Trace model self-invocation, tool callbacks re-entering the workflow, failure retries, and subagent fan-out.

Require task-level limits on rounds/tool calls, total tokens or cost, an overall deadline, and a cancellation exit. A per-response token limit does not cap total rounds. Confirm that framework stopping defaults actually apply and budgets survive resumption. Recommend returning a usable result or explicit failure at the cap. Include growing context, each model's input/output usage, and tool side effects in cost estimates.

## Estimate and Deliver

For findings, read [Billing Model and Platform Boundaries](references/billing-and-limits.md). Estimate trigger frequency and metered usage first, then convert them using the current plan. State a 30-day stress scenario and its assumptions, accounting for enforced stopping limits. If code does not establish a finite upper bound, explicitly state "No upper bound enforced by the code" and provide conditional scenarios. Do not present assumed traffic as the actual worst case.

Respond in the user's language with:

1. Review scope, target environment, documentation verification date, and uncovered callers or runtime information.
2. An eight-category coverage table with the category, `Finding / Not found / Needs confirmation`, and evidence or reason. For unused products, write "Not found (not applicable: this project does not use the product)." Explicitly write "Not found" when sufficient inspection finds no issue. For inaccessible code or configuration, write "Needs confirmation" instead.
3. Findings ordered by risk, each containing all fields below. Link a chain spanning several categories to one finding ID and count its cost once.

| Field | Requirement |
| --- | --- |
| Location and evidence | `file:line`, function/configuration key, minimal snippet, and the actually reachable trigger chain |
| Risk and confidence | Established loop, amplification, or rule violation; list inferred elements and prerequisites separately |
| Trigger frequency | Interval/rate, object/user/task counts, and retry or fan-out factors, with sources |
| Worst-case monthly cost scale | Conditional amount/range, currency, metered usage, plan/rate/date/source; use formulas for unknowns and explain gaps |
| Suggested fix | Bounds at the specific entry point, failure path, or write location while preserving required business behavior |
| Stopping and verification | How work stops, why a restart cannot revive it, needed boundary tests, and a commit-description note for alarm chains |

Prioritize sustained self-triggering, republishing, or large unbounded writes, followed by bounded but frequent amplification and verification gaps. Separate review-rule violations from proven runaway billing. Deliver after covering all eight categories and tracing relevant calls; do not automatically proceed to fixes, deployment, or live validation.
