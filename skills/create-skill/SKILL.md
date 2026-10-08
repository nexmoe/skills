---
name: create-skill
description: Create, revise, or simplify Agent Skills and prompts, adding supporting Bun scripts when useful. Use when the requested deliverable is a skill or prompt.
---

# Create Skills That Support Independent Judgment

A useful scenario-specific skill combines an agent's strategy philosophy, a minimal complete toolset, and necessary factual context.

Help the agent make better decisions in the target scenario. Assume the model already has general capabilities; add only information that changes its decisions. Preserve the user's intent, requested deliverable, and existing authorization. When the user asks for a prompt, deliver a prompt without automatically expanding it into a skill package.

Use the user's scenario examples to understand the design intent and extract relevant reasoning. Include their specific tools, observations, or facts only when the target scenario needs them. Examples do not establish requirements for skill creation.

## A Closed Reasoning Loop

Use this framework to guide the design process. The resulting skill's strategy should fit its own scenario; it need not repeat this section. A reasoning loop does not require a fixed execution sequence.

- **Anchor the task in success criteria.** Define completion through the information obtained, actions completed, observable outcome, and evidence sufficient to confirm it. Ask only for missing information that changes those criteria. Using a particular tool is not itself success.
- **Start with the most promising direct approach.** Choose a starting point based on the goal, known mechanisms, and available capabilities, then validate that choice with evidence. Avoid a fixed hierarchy of tools.
- **Treat intermediate results as evidence.** Results reveal whether current assumptions hold, beyond signaling success or failure. Update judgments from the evidence and distinguish actual constraints from untested explanations. Further attempts should have a reason to obtain new information or advance the goal.
- **Stop when success is established.** Deliver once sufficient evidence confirms completion. If the task remains incomplete, distinguish testable hypotheses from confirmed gaps and report those gaps accurately. Do not present partial success as completion or continue merely to perfect the process.

Identify habitual misjudgments in the target scenario and supply the reasoning needed to correct them. Avoid turning a correction from one case into a universal operating rule.

## A Minimal Complete Toolset

Identify the atomic capabilities the task requires. Describe their capabilities, limitations, inputs, outputs, and prerequisites, allowing the agent to choose an implementation that fits the scenario.

Reuse existing tools. Add scripts or other resources when the environment lacks a necessary capability, the same deterministic logic would otherwise be rewritten repeatedly, or automation materially reduces errors. Create resources for a concrete purpose rather than filling out directories. Keep domain judgment out of mechanical scoring.

**Prefer Bun and TypeScript when a checking script is useful.** They suit mechanical validation, format conversion, and structured data processing. Use another suitable runtime when it fits the existing environment better or Bun is unavailable. A skill focused on strategy or writing may need no script.

Document a script's inputs, outputs, dependencies, exit codes, and side effects. Make checkers read-only by default; passing a checker establishes only the properties it covers. Run generated scripts against representative valid inputs and failure boundaries. Add regression tests when concerns such as batch processing, file overwrites, or format parsing justify them.

## Identify Knowledge the Model May Not Recall

Use real tasks, demonstrated failures, or user-provided material to identify facts, methods, and boundaries the model may repeatedly overlook. Ask what a capable agent would likely misjudge without this information, and whether supplying it changes tool selection, evidence interpretation, or stopping decisions. If there is no clear answer, the information usually does not belong in the skill.

Distinguish three kinds of content:

| Content | How to include it |
| --- | --- |
| Verifiable technical facts or methods | Provide applicable conditions, mechanisms, and sources where needed as material for reasoning |
| Unconfirmed conclusions from experience | Retain as hypotheses to validate rather than universal rules |
| User preferences or environmental constraints | State their scope instead of making them requirements for every scenario |

Let the evidence determine the scope of facts and methods. Success in one example does not justify generalization to other scenarios. Prescribe a single feasible path only when verified mechanisms or interface constraints actually rule out alternatives.

Verify changing APIs, quotas, formats, or platform behavior against the target version or current authoritative sources, and state conditions that affect applicability. Familiar, stable knowledge does not need repeated citations. Remove unsupported claims or explicitly preserve their uncertainty.

When the target scenario involves actual risks, supply the specific boundaries, mechanisms, and operational effects that change decisions. Choose this material for the actual task rather than expanding examples into generic safety checklists.

## Organize the Deliverable

Respect the user's chosen location and existing project organization. In a skills repository, use its skill directory layout. For a new skill, match the directory name to `name`, using at most 64 lowercase letters, digits, and single hyphens.

Include at least `name` and `description` in the YAML frontmatter of `SKILL.md`. Describe the capability and when it applies, adding boundaries when they prevent likely confusion. Avoid catchall descriptions that attract unrelated tasks. Keep shared strategy, necessary facts, and resource entry points in the body without requiring this document's section structure.

Place needed resources according to their purpose: deterministic capabilities in `scripts/`, conditional details in `references/`, and material used in outputs in `assets/`. Explain when to read or run relevant resources. Scripts are not necessarily executed automatically, and referenced files are not necessarily loaded automatically.

`agents/openai.yaml` provides optional interface metadata; supported fields and automatic discovery depend on the environment. Do not treat one client's conventions as universal agent requirements. Use explicit environment variables or configuration entry points for credentials rather than storing actual secrets.

Before changing an existing skill, understand related resources and how they are used. Preserve capabilities the user still needs. Move substantial conditional content into references when useful; a short skill does not need to be split merely for structure.

## Validate and Deliver

For skill packages, use this skill's read-only checker when useful. Script paths below are relative to this skill's directory; use the actual script path when running elsewhere. The target directory may be an absolute path.

```bash
bun run scripts/check-skill.ts /path/to/target-skill
bun run scripts/check-skill.ts /path/to/target-skill --json
bun run scripts/check-skill.ts --help
bun test scripts/check-skill.test.ts
```

The checker uses Bun's built-in YAML parser with no external dependencies and requires a runtime providing `Bun.YAML.parse`. It checks frontmatter, naming, non-empty instructions, unfinished scaffold placeholders, and ordinary local Markdown resource links. It does not execute target scripts, access the network, verify external dependencies, or assess semantic quality. Complex Markdown links still need manual review.

Exit codes: `0` for no errors, `1` for an invalid artifact, and `2` for argument, runtime, or I/O failures. Resources outside the package produce warnings to review against declared environmental dependencies. `--json` outputs the same diagnostics in JSON.

Review semantics against realistic tasks: Are success criteria observable? Do tools cover the necessary capabilities? Are facts supported and relevant to decisions? Do reasonable alternative approaches remain available? Can the agent adjust from evidence and stop when it encounters inconclusive results, constraints, or established success? Review simple scenarios in the current context; use isolated examples for complex scenarios when warranted.

Deliver the artifact location, necessary usage instructions, and actual validation results. Correct gaps supported by evidence rather than accumulating rules for hypothetical cases.
