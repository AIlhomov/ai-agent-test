
#COMMANDS
gh run list --workflow copilot-agent.yml --limit 5 --json databaseId,status,conclusion,displayTitle

gh run view <run-id> --log