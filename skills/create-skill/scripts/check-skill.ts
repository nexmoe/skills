#!/usr/bin/env bun

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

type Diagnostic = {
  level: "error" | "warning";
  code: string;
  file: string;
  line?: number;
  message: string;
};

const help = `Usage: bun run check-skill.ts <skill-directory> [--json]

Read-only checks: YAML frontmatter, name, description, body, scaffold placeholders,
and ordinary local Markdown links, including links in referenced Markdown files.
No required headings, mandatory scripts, script execution, or network access.
External package paths are warnings; URL contents and Markdown anchors are unchecked.
Requires Bun.YAML.parse. Complex Markdown syntax still needs manual review.

Options:
  --json       Print a JSON report
  -h, --help   Show help
  --           Treat following arguments as positional paths

Exit codes: 0 no errors (warnings may remain); 1 invalid skill; 2 usage/runtime/I/O error.
Passing checks does not establish strategy quality, factual accuracy, or tool availability.`;

function isWithin(root: string, path: string) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function isMissing(error: unknown) {
  return ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");
}

// Mask code rather than interpreting examples as the skill's live instructions.
// Preserve offsets so diagnostics still point at the original Markdown lines.
function proseOnly(markdown: string) {
  let marker = "";
  let length = 0;
  return markdown.split("\n").map((line) => {
    const fence = line.match(/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (!marker) {
        marker = fence[1]![0]!;
        length = fence[1]!.length;
      } else if (fence[1]![0] === marker && fence[1]!.length >= length && !fence[2]!.trim()) {
        marker = "";
      }
      return " ".repeat(line.length);
    }
    if (marker) return " ".repeat(line.length);
    return line.replace(/(`+)(.*?)\1/g, (code) => " ".repeat(code.length));
  }).join("\n");
}

export function checkSkill(directory: string) {
  if (typeof Bun.YAML?.parse !== "function") {
    throw new Error("This checker requires a Bun runtime with Bun.YAML.parse.");
  }
  const root = realpathSync(resolve(directory));
  if (!statSync(root).isDirectory()) throw new Error("The target must be a skill directory.");

  const diagnostics: Diagnostic[] = [];
  const add = (level: Diagnostic["level"], code: string, file: string, message: string, line?: number) => {
    diagnostics.push({ level, code, file: relative(root, file) || ".", ...(line ? { line } : {}), message });
  };
  const entry = resolve(root, "SKILL.md");
  let content: string;
  try {
    content = readFileSync(entry, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  } catch (error) {
    if (!isMissing(error)) throw error;
    add("error", "missing-skill", entry, "SKILL.md is missing.");
    return { directory: root, ok: false, diagnostics };
  }

  const frontmatter = content.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  let body = content;
  let bodyOffset = 0;
  if (!frontmatter) {
    add("error", "frontmatter", entry, "Start SKILL.md with YAML frontmatter delimited by ---.", 1);
  } else {
    body = content.slice(frontmatter[0].length);
    bodyOffset = frontmatter[0].split("\n").length - 1;
    let metadata: unknown;
    try {
      metadata = Bun.YAML.parse(frontmatter[1]!);
    } catch {
      add("error", "yaml", entry, "Frontmatter is not valid YAML.", 1);
    }
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      if (!diagnostics.some(({ code }) => code === "yaml")) {
        add("error", "metadata", entry, "Frontmatter must be a YAML mapping.", 1);
      }
    } else {
      const { name, description } = metadata as Record<string, unknown>;
      if (typeof name !== "string" || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        add("error", "name", entry, "name must be 1–64 lowercase letters/digits separated by single hyphens.");
      } else if (name !== basename(root)) {
        add("error", "directory-name", entry, "name must match the skill directory name.");
      }
      if (typeof description !== "string" || !description.trim()) {
        add("error", "description", entry, "description must be a non-empty string.");
      } else if (description.length > 1024 || /[<>]/.test(description)) {
        add("error", "description", entry, "Keep description within 1024 characters and without angle brackets.");
      } else if (/^\[TODO:/i.test(description.trim())) {
        add("error", "placeholder", entry, "description contains an unfinished scaffold placeholder.");
      }
      // Additional metadata is platform-specific; do not impose a universal allowlist.
    }
  }
  if (!body.trim()) add("error", "body", entry, "Skill instructions must not be empty.");

  const visited = new Set<string>([realpathSync(entry)]);
  function inspect(markdown: string, file: string, offset = 0) {
    const prose = proseOnly(markdown);
    prose.split("\n").forEach((line, index) => {
      if (/^\s*\[TODO:[^\n]*\]\s*$/i.test(line)) {
        add("error", "placeholder", file, "Remove the unfinished scaffold placeholder.", index + offset + 1);
      }
    });

    // Ordinary inline links and reference definitions; intentionally not a Markdown parser.
    const patterns = [
      /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s()\n]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?\s*\)/g,
      /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|\S+)/gm,
    ];
    for (const pattern of patterns) {
      for (const match of prose.matchAll(pattern)) {
        const line = prose.slice(0, match.index).split("\n").length + offset;
        let target = match[1]!.replace(/^<|>$/g, "");
        if (target.startsWith("#") || target.startsWith("//")) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          if (/^file:/i.test(target)) add("warning", "external-resource", file, "File URL is an external dependency; review portability.", line);
          continue;
        }
        try {
          target = decodeURIComponent(target.split(/[?#]/, 1)[0]!);
        } catch {
          add("error", "link-encoding", file, "Local link has invalid percent encoding.", line);
          continue;
        }
        if (!target) continue;
        const path = resolve(dirname(file), target);
        if (isAbsolute(target) || !isWithin(root, path)) {
          add("warning", "external-resource", file, `Link depends on a path outside the skill: ${target}`, line);
          continue;
        }
        let actual: string;
        try {
          actual = realpathSync(path);
        } catch (error) {
          if (!isMissing(error)) throw error;
          add("error", "missing-resource", file, `Local resource does not exist: ${target}`, line);
          continue;
        }
        if (!isWithin(root, actual)) {
          add("warning", "external-resource", file, `Resource resolves outside the skill: ${target}`, line);
          continue;
        }
        if (/\.md$/i.test(path) && statSync(actual).isFile() && !visited.has(actual)) {
          visited.add(actual);
          inspect(readFileSync(actual, "utf8").replace(/\r\n?/g, "\n"), path);
        }
      }
    }
  }
  inspect(body, entry, bodyOffset);
  return { directory: root, ok: !diagnostics.some(({ level }) => level === "error"), diagnostics };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let json = false;
  try {
    let positional = false;
    let showHelp = false;
    const paths: string[] = [];
    for (const arg of args) {
      if (positional) paths.push(arg);
      else if (arg === "--") positional = true;
      else if (arg === "--json") json = true;
      else if (arg === "--help" || arg === "-h") showHelp = true;
      else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
      else paths.push(arg);
    }
    if (showHelp) console.log(help);
    else {
      if (paths.length !== 1 || !paths[0]!.trim()) throw new Error("Provide one skill directory. Use --help for usage.");
      const report = checkSkill(paths[0]!);
      if (json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`${report.ok ? "PASS" : "FAIL"}: ${report.directory}`);
        for (const item of report.diagnostics) {
          console.log(`${item.level.toUpperCase()} ${item.file}${item.line ? `:${item.line}` : ""} [${item.code}] ${item.message}`);
        }
        console.log("Mechanical checks only; strategy and facts still need review.");
      }
      process.exitCode = report.ok ? 0 : 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json || args.includes("--json")) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exitCode = 2;
  }
}
