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
    try {
        return execSync(cmd, { stdio: "inherit" });
    } catch (e) {
        log(`Command failed: ${cmd}`);
        if (e?.message) log(e.message);
        throw e;
    }
}


function safeWrite(path, content) {
    fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(path, content);
}

function ensureTestsFirst() {
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
    const target = "test/utils.js";
    if (!fs.existsSync(target)) throw new Error(`Missing ${target}`);

    const src = fs.readFileSync(target, "utf8");
    const lines = src.split(/\r?\n/);

    let changed = false;

    for (let i = 0; i < lines.length; i++) {
        // If the line defines sub(...) and it contains "return a + b"
        if (lines[i].includes("export function sub") && lines[i].includes("return a + b")) {
            lines[i] = lines[i].replace("return a + b", "return a - b");
            changed = true;
        }
    }

    if (!changed) {
        log("sub() fix did not match. Printing file for debugging:");
        console.log("----- test/utils.js -----");
        console.log(src);
        console.log("-------------------------");
        return;
    }

    fs.writeFileSync(target, lines.join("\n"));
    log("Applied fix to sub().");
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
    run(`git checkout -B ${b}`);

    run(`git add -A`);
    try {
        run(`git commit -m "Agent: ${title} (issue #${num})"`);
    } catch {
        log("Nothing to commit, continuing.");
    }

    run(`git push -u origin ${b}`);
    return b;
}

function openPR(repo, num, title, branch) {
    // If a PR already exists for this branch, skip
    try {
        sh(`gh pr view ${branch} -R ${repo} --json number -q .number`);
        log("PR already exists for this branch, skipping PR creation.");
        return;
    } catch { }

    run(
        `gh pr create -R ${repo} --head ${branch} --title "Agent: ${title}" --body "Auto-generated PR for issue #${num}.\n\n- Added/updated tests first\n- Applied fix\n- Ran tests\n"`
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

    run('git config user.name "github-actions[bot]"');
    run('git config user.email "github-actions[bot]@users.noreply.github.com"');


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
