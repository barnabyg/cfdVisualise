# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. When it is available,
prefer the connected GitHub app for supported repository, issue, pull-request,
comment, and label operations. Use the `gh` CLI when an operation is not
supported by the app or a workflow specifically requires it.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Prefer
  `--body-file <path>` for multi-line bodies so the command is shell-neutral.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply/remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`—`gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>`.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, retaining external contributors.
- **Comment/label/close**: `gh pr comment`, `gh pr edit`, and `gh pr close`.

GitHub shares one number space across issues and PRs, so resolve ambiguous references by trying `gh pr view <number>` and then `gh issue view <number>`.

## When a skill says “publish to the issue tracker”

Create a GitHub issue.

## When a skill says “fetch the relevant ticket”

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, and Fog.
- **Child ticket**: a GitHub sub-issue linked to the map. If sub-issues are unavailable, link it through the map’s task list and add `Part of #<map>` to the child. Use a `wayfinder:<type>` label.
- **Blocking**: use GitHub’s native issue dependencies. If unavailable, add a `Blocked by: #<n>` line to the child.
- **Frontier query**: select the first open, unblocked, and unassigned child in map order.
- **Claim**: assign the ticket to the current user.
- **Resolve**: comment with the answer, close the ticket, and append a context pointer to the map’s Decisions-so-far.
