#!/usr/bin/env bash
# Vendor the Mole cleanup engine into src-tauri/resources/mole/.
#
# Mole is GPL-3.0-or-later. We ship it verbatim (sources are fetched from the
# upstream tag below) alongside its LICENSE; see THIRD_PARTY.md for the offer of
# source. Do NOT vendor from a Homebrew Cellar: the formula rewrites the
# entrypoint's SCRIPT_DIR to an absolute path, which breaks relocation into an
# .app bundle. The upstream `mole` script resolves SCRIPT_DIR from BASH_SOURCE,
# so the tree works from wherever we put it.
#
# Upstream ships no prebuilt Go binaries at the tag, so analyze-go/status-go are
# built here, once per arch, then lipo'd into universal binaries.

set -euo pipefail

MOLE_VERSION="1.48.1"
MOLE_TAG="V${MOLE_VERSION}"
# Same digest Homebrew pins for this tag; treated as the trusted baseline.
MOLE_SHA256="374dcdc981d0581cdf5007311fb5bf4cfe326ad5fe2a7735ffc44a3f7c91b049"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/src-tauri/resources/mole"
STAMP="$DEST/VERSION"

if [[ "${1:-}" != "--force" && -f "$STAMP" && "$(cat "$STAMP")" == "$MOLE_VERSION" ]]; then
    echo "mole $MOLE_VERSION already vendored, use --force to rebuild"
    exit 0
fi

command -v go > /dev/null || { echo "go is required (brew install go)" >&2; exit 1; }
command -v lipo > /dev/null || { echo "lipo is required (Xcode command line tools)" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Fetching Mole $MOLE_TAG"
curl -fsSL "https://github.com/tw93/Mole/archive/refs/tags/${MOLE_TAG}.tar.gz" -o "$WORK/mole.tar.gz"

actual="$(shasum -a 256 "$WORK/mole.tar.gz" | cut -d' ' -f1)"
if [[ "$actual" != "$MOLE_SHA256" ]]; then
    echo "checksum mismatch for $MOLE_TAG" >&2
    echo "  expected $MOLE_SHA256" >&2
    echo "  actual   $actual" >&2
    exit 1
fi
echo "    checksum ok"

tar -xzf "$WORK/mole.tar.gz" -C "$WORK"
SRC="$WORK/Mole-${MOLE_VERSION}"
[[ -d "$SRC" ]] || { echo "unexpected tarball layout: $(ls "$WORK")" >&2; exit 1; }

echo "==> Applying MkCleaner patches"
python3 "$REPO_ROOT/scripts/mole-patches.py" "$SRC"

echo "==> Building universal Go binaries"
LDFLAGS="-s -w -X main.Version=${MOLE_VERSION}"
for cmd in analyze status; do
    for arch in arm64 amd64; do
        # gopsutil needs cgo on darwin. The Xcode SDK is universal, so clang can
        # target the other arch by flag; Go only needs to be told via CC.
        case "$arch" in
            arm64) cc="clang -arch arm64" ;;
            amd64) cc="clang -arch x86_64" ;;
        esac
        ( cd "$SRC" && CGO_ENABLED=1 GOOS=darwin GOARCH="$arch" CC="$cc" \
            go build -trimpath -ldflags "$LDFLAGS" -o "$WORK/${cmd}-${arch}" "./cmd/${cmd}" )
    done
    lipo -create -output "$SRC/bin/${cmd}-go" "$WORK/${cmd}-arm64" "$WORK/${cmd}-amd64"
    echo "    ${cmd}-go: $(lipo -archs "$SRC/bin/${cmd}-go")"
done

echo "==> Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/mole" "$DEST/mole"
cp -R "$SRC/bin" "$DEST/bin"
cp -R "$SRC/lib" "$DEST/lib"
cp "$SRC/LICENSE" "$DEST/LICENSE"

# lib/manage/{update,remove}.sh stay: bin/mole sources them unconditionally at
# startup, so removing them breaks every subcommand. They are only reachable via
# `mo update` / `mo remove`, which the GUI never invokes — a bundled copy must
# not rewrite or delete itself inside .app or the code signature breaks.

chmod +x "$DEST/mole" "$DEST"/bin/*
printf '%s' "$MOLE_VERSION" > "$STAMP"

echo "==> Verifying"
"$DEST/mole" --version | head -3

echo "done"
