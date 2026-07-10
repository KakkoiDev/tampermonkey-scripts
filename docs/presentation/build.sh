#!/bin/sh
# Build the slides: render deck.md to deck.html with Marp.
# Uses a local `marp` if installed, else npx @marp-team/marp-cli (no install needed).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"

if command -v marp >/dev/null 2>&1; then
    marp "$here/deck.md" -o "$here/deck.html"
else
    npx --yes @marp-team/marp-cli "$here/deck.md" -o "$here/deck.html"
fi
echo "built $here/deck.html"
