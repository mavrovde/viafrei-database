#!/usr/bin/env bash
# Is IMAGE:VERSION still unreleased? A release is never rebuilt or re-tagged,
# so the release workflow asks this before it builds and again before it tags.
#
#   scripts/ghcr-not-released.sh ghcr.io/<owner>/<name> <version>
#
# The registry's answer decides:
#   * the manifest exists                   → exit 1 (released already)
#   * "not found" / "manifest unknown"      → exit 0 (not released)
#   * "denied" / "unauthorized"             → GHCR answers so for a PACKAGE
#     that does not exist yet (the first release), and also for one this
#     token may not read. The packages API then decides, for this package
#     under this owner (GET users|orgs/<owner>/packages/container/<name>):
#       200  the package exists                         → exit 1 (cannot tell)
#       404  no such package: the first release         → exit 0 (not released)
#       403  the token may not read it: the job lacks packages: read, or the
#            package exists and is not linked to this repository (its
#            settings, "Manage Actions access")         → exit 1 (refuse)
#       401, 5xx, no answer                             → exit 1 (refuse)
#     The 404 is the only "not released" here, and only for the package path
#     after the owner itself was read; every other answer fails closed.
#   * anything else                         → exit 1 (cannot tell, so refuse)
#
# DOCKER and GH name the two programs (the self-test stubs them).
set -uo pipefail

IMAGE="${1:-}"
VERSION="${2:-}"
DOCKER="${DOCKER:-docker}"
GH="${GH:-gh}"
[[ $IMAGE =~ ^ghcr\.io/([a-z0-9-]+)/([a-z0-9._-]+)$ ]] || { echo "::error::usage: ghcr-not-released.sh ghcr.io/<owner>/<name> <version>"; exit 2; }
owner="${BASH_REMATCH[1]}"
name="${BASH_REMATCH[2]}"
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::usage: the version must be X.Y.Z"; exit 2; }

if out="$("$DOCKER" buildx imagetools inspect "$IMAGE:$VERSION" 2>&1)"; then
  echo "::error::$IMAGE:$VERSION already exists; a release image is never rebuilt or moved"
  exit 1
fi
case "$out" in
  *"not found"* | *"manifest unknown"* | *MANIFEST_UNKNOWN*)
    echo "$IMAGE:$VERSION is not released yet"
    exit 0
    ;;
  *denied* | *DENIED* | *unauthorized* | *UNAUTHORIZED*) ;;
  *)
    echo "::error::cannot tell whether $IMAGE:$VERSION exists: $(printf '%s' "$out" | head -n 1)"
    exit 1
    ;;
esac

# Denied: true for a package that does not exist yet, and for one we may not read.
kind="$("$GH" api "users/$owner" --jq .type 2>/dev/null)" || { echo "::error::the registry denied $IMAGE:$VERSION and the owner $owner cannot be read"; exit 1; }
case "$kind" in
  User) path="users/$owner/packages/container/$name" ;;
  Organization) path="orgs/$owner/packages/container/$name" ;;
  *) echo "::error::the registry denied $IMAGE:$VERSION and $owner is neither a user nor an organization ($kind)"; exit 1 ;;
esac
if api="$("$GH" api "$path" --jq .name 2>&1)"; then
  echo "::error::the registry denied $IMAGE:$VERSION but the package $name exists ($api) — cannot tell whether the version does, so refusing"
  exit 1
fi
case "$api" in
  *"HTTP 404"*)
    echo "$IMAGE:$VERSION is not released yet (the package $name does not exist: the first release)"
    exit 0
    ;;
  *"HTTP 403"*)
    echo "::error::the registry denied $IMAGE:$VERSION and the packages API answered 403 for $name: this token may not read it (the job lacks packages: read, or the package is not linked to this repository) — cannot tell whether the version exists, so refusing"
    exit 1
    ;;
  *)
    echo "::error::the registry denied $IMAGE:$VERSION and the packages API did not answer 404: $(printf '%s' "$api" | head -n 1)"
    exit 1
    ;;
esac
