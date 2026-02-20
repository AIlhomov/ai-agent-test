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


function requireEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

function runCapture(cmd) {
    log(cmd);
    try {
        return execSync(cmd, { encoding: "utf8" });
    } catch (e) {
        const stdout = e?.stdout?.toString?.() ?? "";
        const stderr = e?.stderr?.toString?.() ?? "";
        return (stdout + "\n" + stderr).trim();
    }
}

// Keep context small (free models have smaller limits)
function readRepoContext() {
    const files = [
        "test/utils.js",
        "test/utils.test.js",
        "package.json",
    ];

    let out = "";
    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        out += `\n--- FILE: ${f} ---\n` + fs.readFileSync(f, "utf8") + "\n";
    }
    return out.trim();
}

function callClaude(messages, model = "claude-sonnet-4-6") {
    requireEnv("ANTHROPIC_API_KEY"); // validate it exists early

    // Anthropic API has a top-level system field, not a message role
    let system;
    const userMessages = messages.filter(m => {
        if (m.role === "system") { system = m.content; return false; }
        return true;
    });

    const payload = { model, max_tokens: 2048, messages: userMessages };
    if (system) payload.system = system;

    // Write payload to file so the key never appears in the command string
    fs.writeFileSync("agent_payload.json", JSON.stringify(payload));

    const raw = sh(
        `curl -sS --fail-with-body https://api.anthropic.com/v1/messages ` +
        `-H "x-api-key: $ANTHROPIC_API_KEY" ` +
        `-H "anthropic-version: 2023-06-01" ` +
        `-H "content-type: application/json" ` +
        `--data @agent_payload.json`
    );

    let json;
    try {
        json = JSON.parse(raw);
    } catch {
        throw new Error(`Anthropic API returned non-JSON:\n${raw}`);
    }

    const text = json?.content?.[0]?.text;
    if (!text) throw new Error(`Anthropic API empty response:\n${raw}`);
    return text;
}

// We ask the model for a unified diff and apply it with git
function applyUnifiedDiff(diffText) {
    const m = diffText.match(/```diff\s*([\s\S]*?)```/);
    const patch = (m ? m[1] : diffText).trim();

    fs.writeFileSync("agent.patch", patch + "\n");
    // --reject makes failures visible; --whitespace=nowarn avoids trivial whitespace issues
    run("git apply --reject --whitespace=nowarn agent.patch");
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
        log("Tests failed. Asking Claude for a patch...");

        const testOutput = runCapture("npm test");
        const context = readRepoContext();

        const issueText = `${issue.title}\n\n${issue.body || ""}`.trim();

        const messages = [
            {
                role: "system",
                content:
                    "You are an autonomous code-fixing agent. " +
                    "Return ONLY a unified diff in a ```diff code block```. " +
                    "Do not include explanations.",
            },
            {
                role: "user",
                content:
                    `Issue:\n${issueText}\n\n` +
                    `Test output:\n${testOutput}\n\n` +
                    `Repo context:\n${context}\n\n` +
                    `Task: Produce a minimal patch that makes tests pass.`,
            },
        ];

        const diff = callClaude(messages);
        log("Applying patch from OpenRouter...");
        applyUnifiedDiff(diff);

        log("Re-running tests after AI patch...");
        ok = testsPass();
    }

    if (!ok) {
        log("AI patch didn't pass tests. One retry with updated output...");

        const testOutput2 = runCapture("npm test");
        const context2 = readRepoContext();
        const issueText = `${issue.title}\n\n${issue.body || ""}`.trim();

        const messages2 = [
            {
                role: "system",
                content:
                    "Return ONLY a unified diff in a ```diff code block```. " +
                    "Fix the remaining failing tests. Minimal changes.",
            },
            {
                role: "user",
                content:
                    `Issue:\n${issueText}\n\n` +
                    `New test output:\n${testOutput2}\n\n` +
                    `Repo context:\n${context2}\n\n` +
                    `Patch the repo so tests pass.`,
            },
        ];

        const diff2 = callClaude(messages2);
        log("Applying retry patch...");
        applyUnifiedDiff(diff2);

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
