#!/usr/bin/env bash
# approve-release-runs.sh BRANCH
#
# The release pull request is opened by github-actions[bot] (release-please,
# with the built-in GITHUB_TOKEN), and GitHub holds the pull_request runs of
# CI and Security for it as "action_required" until they are approved. Branch
# protection reads the check runs of those pull_request runs, so this script
# approves them. It waits until both workflows have a pull_request run on the
# branch's head commit, approves each one that waits for approval, and fails
# when a workflow has no run on that commit by the deadline: no run is no
# evidence, and the pull request could then never be merged green.
#
# A run counts only when it is the workflow's own, of THIS repository (not a
# fork's), on this branch, and started by github-actions[bot]; only a run
# whose conclusion is action_required is approved.
#
# Needs GH_TOKEN (actions: write) and GH_REPO. APPROVE_WAIT_S bounds the wait
# (default 180 s), APPROVE_POLL_S the pause between reads (default 10 s).
# Exit 0 approved or nothing to approve, 1 no run by the deadline, 2 a usage
# error or a branch that is not release-please's.
set -euo pipefail

branch=${1:?usage: approve-release-runs.sh BRANCH}
[[ $branch == release-please--* ]] || { echo "FAIL: '$branch' is not a release-please branch" >&2; exit 2; }
: "${GH_REPO:?GH_REPO must name the repository}"
deadline=$((SECONDS + ${APPROVE_WAIT_S:-180}))

sha=$(gh api "repos/$GH_REPO/branches/$branch" --jq .commit.sha)
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "FAIL: no head commit for $branch" >&2; exit 2; }
echo "release branch $branch at $sha"

for wf in CI Security; do
  while :; do
    runs=$(gh api "repos/$GH_REPO/actions/runs?event=pull_request&head_sha=$sha&per_page=100" |
      jq --arg wf "$wf" --arg repo "$GH_REPO" --arg branch "$branch" \
        '[.workflow_runs[] | select(.name == $wf and .head_repository.full_name == $repo and .head_branch == $branch and .actor.login == "github-actions[bot]") | {id, status, conclusion}]')
    [[ $(jq length <<<"$runs") -gt 0 ]] && break
    (( SECONDS < deadline )) || { echo "FAIL: no pull_request run of $wf on $sha by the deadline" >&2; exit 1; }
    sleep "${APPROVE_POLL_S:-10}"
  done
  for id in $(jq -r '.[] | select(.conclusion == "action_required") | .id' <<<"$runs"); do
    gh api -X POST "repos/$GH_REPO/actions/runs/$id/approve" >/dev/null
    echo "approved $wf run $id"
  done
  jq -r --arg wf "$wf" '.[] | "\($wf) run \(.id): \(.status) \(.conclusion // "")"' <<<"$runs"
done
