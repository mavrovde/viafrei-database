/**
 * The public documents: every relative link resolves (a heading anchor
 * included), every link into GitHub names a public ViaFrei project, and no
 * document names a project or a host this repository does not publish.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

// A project is named here only once a stranger can see it.
export const PUBLIC_PROJECTS = ["viafrei-database", "viafrei-mcp", "viafrei-api"] as const;
/** Names and words a public document never carries: other projects, and where ViaFrei runs. */
export const NOT_PUBLIC = /viafrei-(?!database\b|mcp\b|api\b|db\b)[a-z]+|github\.com\/mavrovde\/(?!viafrei-(?:database|mcp|api)\b)[\w.-]+|hetzner|contabo|hostinger|nürnberg|nuremberg|\b(?:admin|status)\.viafrei\.de/i;

const DOCS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", ...readdirSync(join(REPO, "docs")).filter((n) => n.endsWith(".md")).map((n) => `docs/${n}`)];

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

export function anchors(md: string): Set<string> {
  return new Set([...md.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1] ?? "")));
}

/** Every link target of a Markdown text (inline links and images), outside code. */
export function links(md: string): string[] {
  const text = md.replace(/```[^]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? "");
}

/** The faults of one document: a relative link to nothing, an anchor that is no heading, a link or a name that is not public. */
export function docFaults(name: string, md: string, exists: (p: string) => boolean, read: (p: string) => string): string[] {
  const faults: string[] = [];
  for (const l of links(md)) {
    if (/^https?:\/\//.test(l)) {
      const gh = /^https:\/\/github\.com\/mavrovde\/([\w.-]+)/.exec(l);
      if (gh !== null && !(PUBLIC_PROJECTS as readonly string[]).includes(gh[1] ?? "")) faults.push(`${name}: links ${l}, which is not a public project`);
      continue;
    }
    if (/^mailto:/.test(l)) continue;
    const [path = "", anchor] = l.split("#");
    const target = path === "" ? name : join(dirname(name), path);
    if (path !== "" && !exists(target)) {
      faults.push(`${name}: links ${l}, which does not exist`);
      continue;
    }
    if (anchor !== undefined && target.endsWith(".md") && !anchors(read(target)).has(anchor)) faults.push(`${name}: links ${l}, and ${target} has no such heading`);
  }
  const bad = NOT_PUBLIC.exec(md);
  if (bad !== null) faults.push(`${name}: names '${bad[0]}', which is not public`);
  return faults;
}

describe("the public documents", () => {
  const read = (p: string): string => readFileSync(join(REPO, p), "utf8");
  const exists = (p: string): boolean => existsSync(join(REPO, p));

  it("reads every document it names (a check over nothing is not a pass)", () => {
    for (const d of DOCS) expect(exists(d), d).toBe(true);
    expect(DOCS.reduce((n, d) => n + links(read(d)).length, 0)).toBeGreaterThan(20);
  });

  it("every link resolves and every name is public", () => {
    expect(DOCS.flatMap((d) => docFaults(d, read(d), exists, read))).toEqual([]);
  });

  it("the projects table names exactly the public projects", () => {
    const readme = read("README.md");
    const at = readme.indexOf("\n## The ViaFrei projects\n");
    const table = readme.slice(at, readme.indexOf("\n## ", at + 1));
    const named = [...table.matchAll(/^\| (?:\[([\w-]+)\]|\*\*([\w-]+)\*\*)/gm)].map((m) => m[1] ?? m[2] ?? "");
    expect(named).toEqual(["viafrei-mcp", "viafrei-api", "viafrei-database"]);
  });

  it("the check can say no", () => {
    const yes = (): boolean => true;
    const none = (): string => "# Only\n";
    expect(docFaults("README.md", "[x](missing.md)", () => false, none)).toEqual(["README.md: links missing.md, which does not exist"]);
    expect(docFaults("README.md", "[x](docs/a.md#nope)", yes, none)).toEqual(["README.md: links docs/a.md#nope, and docs/a.md has no such heading"]);
    expect(docFaults("README.md", "[x](https://github.com/mavrovde/another-project)", yes, none)).toEqual([
      "README.md: links https://github.com/mavrovde/another-project, which is not a public project",
      "README.md: names 'github.com/mavrovde/another-project', which is not public",
    ]);
    expect(docFaults("README.md", "runs on hetzner", yes, none)).toEqual(["README.md: names 'hetzner', which is not public"]);
    expect(docFaults("README.md", "see viafrei-web", yes, none)).toEqual(["README.md: names 'viafrei-web', which is not public"]);
    expect(docFaults("README.md", "see viafrei-example", yes, none)).toEqual(["README.md: names 'viafrei-example', which is not public"]);
    expect(docFaults("README.md", "[x](#only) [y](docs/a.md#only) viafrei-db lint", yes, none)).toEqual([]);
  });
});
