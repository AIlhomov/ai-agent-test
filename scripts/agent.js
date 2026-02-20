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

function readRepoContext() {
    let out = "";
    if (fs.existsSync("test")) {
        for (const f of fs.readdirSync("test").sort()) {
            if (!f.endsWith(".js")) continue;
            const filePath = `test/${f}`;
            out += `\n--- FILE: ${filePath} ---\n` + fs.readFileSync(filePath, "utf8") + "\n";
        }
    }
    if (fs.existsSync("package.json")) {
        out += `\n--- FILE: package.json ---\n` + fs.readFileSync("package.json", "utf8") + "\n";
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

// Ask Claude to return complete fixed files; parse and write them directly.
// Format expected: === FILE: path === ... === END ===
function applyFixedFiles(response) {
    const pattern = /===\s*FILE:\s*(.+?)\s*===\n([\s\S]*?)\n===\s*END\s*===/g;
    let match;
    let applied = false;

    while ((match = pattern.exec(response)) !== null) {
        const filePath = match[1].trim();
        const content = match[2];
        if (!fs.existsSync(filePath)) {
            log(`Skipping unknown file: ${filePath}`);
            continue;
        }
        fs.writeFileSync(filePath, content + "\n");
        log(`Rewrote ${filePath}`);
        applied = true;
    }

    if (!applied) {
        throw new Error(
            `Could not parse fixed files from Claude response.\nResponse was:\n${response}`
        );
    }
}


function safeWrite(path, content) {
    fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(path, content);
}

function ensureTestsFirst(issue) {
    if (!fs.existsSync("test")) {
        log("No test/ directory found, skipping test generation.");
        return;
    }

    const sourceFiles = fs.readdirSync("test")
        .filter(f => f.endsWith(".js") && !f.endsWith(".test.js"));

    const missingTests = sourceFiles.filter(
        f => !fs.existsSync(`test/${f.replace(".js", ".test.js")}`)
    );

    if (missingTests.length === 0) {
        log("All source files already have tests.");
        return;
    }

    log(`Generating tests with Claude for: ${missingTests.join(", ")}`);

    for (const srcFile of missingTests) {
        const srcPath = `test/${srcFile}`;
        const testPath = `test/${srcFile.replace(".js", ".test.js")}`;
        const src = fs.readFileSync(srcPath, "utf8");
        const issueText = `${issue.title}\n\n${issue.body || ""}`.trim();

        const messages = [
            {
                role: "system",
                content:
                    "You are a test-writing agent for Node.js. " +
                    "Write tests using node:test and node:assert/strict. " +
                    "Return ONLY the test file content. No explanations. No markdown fences.",
            },
            {
                role: "user",
                content:
                    `Issue:\n${issueText}\n\n` +
                    `Source file (${srcPath}):\n${src}\n\n` +
                    `Write a test file that tests the CORRECT expected behavior. ` +
                    `Import from "./${srcFile}". Use node:test and node:assert/strict.`,
            },
        ];

        const testCode = callClaude(messages);
        const m = testCode.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
        const code = (m ? m[1] : testCode).trim();

        safeWrite(testPath, code + "\n");
        log(`Tests written to ${testPath}`);
    }
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

    run(`git push --force-with-lease -u origin ${b}`);
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
    ensureTestsFirst(issue);

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
                    "Return the complete fixed content for every file that needs changes. " +
                    "For each file use exactly this format:\n" +
                    "=== FILE: path/to/file ===\n" +
                    "<complete file content>\n" +
                    "=== END ===\n" +
                    "No explanations. No markdown fences.",
            },
            {
                role: "user",
                content:
                    `Issue:\n${issueText}\n\n` +
                    `Test output:\n${testOutput}\n\n` +
                    `Repo context:\n${context}\n\n` +
                    `Return the complete fixed file(s) so tests pass.`,
            },
        ];

        const response = callClaude(messages);
        log("Applying fix from Claude...");
        applyFixedFiles(response);

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
                    "You are an autonomous code-fixing agent. " +
                    "Return the complete fixed content for every file that still needs changes. " +
                    "For each file use exactly this format:\n" +
                    "=== FILE: path/to/file ===\n" +
                    "<complete file content>\n" +
                    "=== END ===\n" +
                    "No explanations. No markdown fences.",
            },
            {
                role: "user",
                content:
                    `Issue:\n${issueText}\n\n` +
                    `New test output:\n${testOutput2}\n\n` +
                    `Repo context:\n${context2}\n\n` +
                    `Return the complete fixed file(s) so all tests pass.`,
            },
        ];

        const response2 = callClaude(messages2);
        log("Applying retry fix from Claude...");
        applyFixedFiles(response2);

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
