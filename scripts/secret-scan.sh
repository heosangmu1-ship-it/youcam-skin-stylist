#!/bin/sh
# Fails (exit 1) when a secret-looking string is in a tracked file or any commit.
# Prints file:line only, never the matched value. Placeholders (YOUCAM_API_KEY=your-key-here) are allowed.
P='sk-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,}|YOUCAM_API_KEY=[^ ]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|(ghp_|gho_|glpat-|xox[bp]-)[A-Za-z0-9_-]{16,}'
cd "$(git rev-parse --show-toplevel)" || exit 2
out=$(mktemp) || exit 2
trap 'rm -f "$out"' EXIT

scan() { # args: optional rev; prints "[rev:]file:line" per hit
  git grep -InEo -e "$P" "$@" | grep -v 'YOUCAM_API_KEY=your-key-here' | cut -d: -f1-"$FIELDS"
}
FIELDS=2 scan >>"$out"
for c in $(git rev-list --all); do FIELDS=3 scan "$c" | sed "s/^$c/history:$(echo "$c" | cut -c1-8)/" >>"$out"; done
{ git ls-files; git log --all --name-only --format= ; } | grep -E '(^|/)\.env(\.local)?$' | sort -u | sed 's/^/env file committed: /' >>"$out"

if [ -s "$out" ]; then
  echo "secret-scan: possible secrets (values hidden):" >&2
  sort -u "$out" >&2
  exit 1
fi
echo "secret-scan: clean"
