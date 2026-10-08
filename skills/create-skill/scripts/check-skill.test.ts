import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSkill } from "./check-skill";

const temporary: string[] = [];
const script = fileURLToPath(new URL("./check-skill.ts", import.meta.url));

function fixture(body = "# 场景\n\n以找到可验证的原始资料为完成标准。", frontmatter = "name: sample-skill\ndescription: 创建场景产物。") {
  const parent = mkdtempSync(join(tmpdir(), "create-skill-"));
  temporary.push(parent);
  const root = join(parent, "sample-skill");
  mkdirSync(root);
  writeFileSync(join(root, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  return root;
}

function resource(root: string, path: string, content: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("a small strategy-only skill can pass without prescribed headings or scripts", () => {
  const root = fixture();
  expect(checkSkill(root)).toMatchObject({ ok: true, diagnostics: [] });
  expect(existsSync(join(root, "scripts"))).toBe(false);
});

test("multiline YAML, platform-specific metadata, BOM and CRLF remain usable", () => {
  const root = fixture(undefined, "name: sample-skill\ndescription: >-\n  为明确的场景\n  创建可交付的结果。\nplatform-specific: true");
  const path = join(root, "SKILL.md");
  writeFileSync(path, "\uFEFF" + `---\r\nname: sample-skill\r\ndescription: >-\r\n  为明确的场景\r\n  创建可交付的结果。\r\nplatform-specific: true\r\n---\r\n有明确结果。`);
  expect(checkSkill(root).ok).toBe(true);
});

test("referenced documents are checked relative to their own location, including cycles", () => {
  const root = fixture("阅读 [机制](references/facts.md)。");
  resource(root, "references/facts.md", "[返回](../SKILL.md)\n[数据](../assets/input%20data.json)\n[损坏链接](missing.md)");
  resource(root, "assets/input data.json", "{}");
  const report = checkSkill(root);
  expect(report.ok).toBe(false);
  expect(report.diagnostics).toEqual([
    expect.objectContaining({ code: "missing-resource", file: "references/facts.md", line: 3 }),
  ]);
});

test("inline, reference-style and angle-bracket links find actual missing resources", () => {
  const root = fixture('[脚本](scripts/missing.ts "检查")\n[资料][facts]\n[facts]: <references/facts with spaces.md>');
  expect(checkSkill(root).diagnostics.filter(({ code }) => code === "missing-resource")).toHaveLength(2);
});

test("examples, inline code, anchors and remote links are not read as local resources", () => {
  const root = fixture([
    "# 判断", "", "~~~/example", "[TODO: 示例]", "[示例](missing.md)", "~~~",
    "`[TODO: 占位语法]`", "`[路径](other-missing.md)`",
    "[章节](#判断)", "[资料](https://example.com/facts)", "[资料](//example.com/facts)",
    "[括号路径属于复杂语法](folder(a)/facts.md)",
  ].join("\n"));
  expect(checkSkill(root)).toMatchObject({ ok: true, diagnostics: [] });
});

test("external environment dependencies are warnings, including symlinked files", () => {
  const root = fixture("[环境数据](../external.md)\n[链接文件](references/outside.md)");
  const outside = join(dirname(root), "external.md");
  writeFileSync(outside, "[不应读取](missing.md)");
  mkdirSync(join(root, "references"));
  symlinkSync(outside, join(root, "references/outside.md"));
  const report = checkSkill(root);
  expect(report.ok).toBe(true);
  expect(report.diagnostics).toHaveLength(2);
  expect(report.diagnostics.every(({ level, code }) => level === "warning" && code === "external-resource")).toBe(true);
});

test("invalid metadata and empty instructions fail as artifact errors", () => {
  for (const metadata of ["name: [unterminated", "- not-a-mapping", "name: other\ndescription: ''", "name: sample--skill\ndescription: 123"]) {
    expect(checkSkill(fixture("", metadata)).ok).toBe(false);
  }
  const result = run(fixture("", "name: sample-skill\ndescription: 有触发场景。"), "--json");
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "body" })] });
});

test("live scaffold placeholders and malformed local link encodings fail", () => {
  const root = fixture("[TODO: 补充必要事实]\n[资源](references/%ZZ.md)");
  expect(checkSkill(root).diagnostics.map(({ code }) => code)).toEqual(["placeholder", "link-encoding"]);
});

test("missing SKILL.md is an artifact error; missing directories and bad arguments are input errors", () => {
  const root = fixture();
  rmSync(join(root, "SKILL.md"));
  expect(run(root, "--json").status).toBe(1);
  for (const args of [[], [join(root, "missing"), "--json"], [root, "--unknown", "--json"], [root, root]]) {
    expect(run(...args).status).toBe(2);
  }
  expect(run("--help").status).toBe(0);
});

test("checking a linked script never executes it and JSON output is parseable", () => {
  const root = fixture("[检查能力](scripts/check.ts)");
  const marker = join(root, "executed.txt");
  resource(root, "scripts/check.ts", `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  const result = run(root, "--json");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, diagnostics: [] });
  expect(existsSync(marker)).toBe(false);
});
