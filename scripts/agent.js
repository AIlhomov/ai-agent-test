import { execSync } from "node:child_process";
import fs from "node:fs";

function sh(cmd, opts = {}) {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

function log(msg) {
    console.log(`[agent] ${msg}`);
}

function run(cmd) {
    log(cmd);
    return execSync(cmd, { stdio: "inherit" });
}

function safeWrite(path, content) {
    fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(path, content);
}

function ensureTestsFirst() {
    // If no tests exist, create one for utils.js.
    const testPath = "test/utils.test.js";
    if (fs.existsSync(testPath)) {
        log("Tests already exist.");
        return;
    }

    log("Creating tests first...");
    safeWrite(
        testPath,
        `import test from "node:test";
import assert from "node:assert/strict";
import { add, sub } from "./utils.js";

test("add works", () => {
  assert.equal(add(5, 2), 7);
});

test("sub works", () => {
  assert.equal(sub(5, 2), 3);
  assert.equal(sub(2, 5), -3);
});
`
    );
}

function attemptFixFromIssueText(issueText) {
    // Super simple “solver” for now:
    // If it mentions sub() and utils.js, fix obvious bug pattern.
    const target = "test/utils.js";
    if (!fs.existsSync(target)) {
        throw new Error(`Missing ${target}`);
    }
    const src = fs.readFileSync(target, "utf8");

    // Fix the common bug: sub returns a + b
    // Keep it minimal and only adjust sub().
    const fixed = src.replace(
        /export function sub\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s*a\s*\+\s*b\s*;\s*\}/g,
        "export function sub(a, b) { return a - b }"
    );

    if (fixed === src) {
        log("No direct pattern match. Leaving file unchanged (placeholder solver).");
    } else {
        log("Applied fix to sub().");
        fs.writeFileSync(target, fixed);
    }
}

function testsPass() {
    try {
        run("npm test");
        return true;
    } catch {
        return false;
    }
}

function getRepoInfo() {
    const repo = process.env.REPO || sh("gh repo view --json nameWithOwner -q .nameWithOwner");
    return repo;
}

function getIssueNumber() {
    // For schedule runs, ISSUE_NUMBER may be empty; we’ll scan for open labeled issues.
    return process.env.ISSUE_NUMBER || "";
}

function getTriggerLabel() {
    return process.env.TRIGGER_LABEL || "copilot";
}

function listOpenLabeledIssues(repo, label) {
    // Returns issue numbers as strings
    const out = sh(`gh issue list -R ${repo} --label "${label}" --state open --json number -q ".[].number"`);
    if (!out) return [];
    return out.split("\n").map(String);
}

function readIssue(repo, num) {
    const title = sh(`gh issue view ${num} -R ${repo} --json title -q .title`);
    const body = sh(`gh issue view ${num} -R ${repo} --json body -q .body`);
    return { title, body };
}

function branchName(num) {
    return `agent/issue-${num}`;
}

function createBranchAndCommit(num, title) {
    const b = branchName(num);
    run(`git checkout -b ${b}`);
    run(`git add -A`);
    run(`git commit -m "Agent: ${title} (issue #${num})"`);
    run(`git push -u origin ${b}`);
    return b;
}

function openPR(repo, num, title, branch) {
    // If a PR already exists, this will fail; that’s okay for a first iteration.
    run(
        `gh pr create -R ${repo} --head ${branch} --title "Agent: ${title}" --body "Auto-generated PR for issue #${num}.\n\n- Added/updated tests first\n- Applied fix\n- Ran tests\n" `
    );
}

function main() {
    const repo = getRepoInfo();
    const label = getTriggerLabel();

    // Decide which issue(s) to process
    let issues = [];
    const num = getIssueNumber();
    if (num) {
        issues = [String(num)];
    } else {
        issues = listOpenLabeledIssues(repo, label);
    }

    if (issues.length === 0) {
        log(`No open issues with label '${label}'. Exiting.`);
        return;
    }

    // Process one issue at a time (simpler + safer)
    const issueNumber = issues[0];
    const issue = readIssue(repo, issueNumber);
    log(`Working on issue #${issueNumber}: ${issue.title}`);

    // Fresh branch from default branch
    run("git fetch origin");
    run("git checkout main || git checkout master");
    run("git pull");

    // Always tests first
    ensureTestsFirst();

    // Attempt 1
    attemptFixFromIssueText(issue.title + "\n" + issue.body);
    let ok = testsPass();

    // Attempt 2 (one more iteration)
    if (!ok) {
        log("Tests failed. Second attempt (single retry)...");
        // Placeholder: you can plug in Copilot-based patching here later.
        attemptFixFromIssueText(issue.title + "\n" + issue.body);
        ok = testsPass();
    }

    if (!ok) {
        throw new Error("Tests still failing after one retry. Stopping.");
    }

    const branch = createBranchAndCommit(issueNumber, issue.title);
    openPR(repo, issueNumber, issue.title, branch);

    log("Done.");
}

main();
