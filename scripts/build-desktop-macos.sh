#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
. "$project_root/scripts/use-project-environment.sh"

platform="${1:-}"
case "$platform" in
  darwin-arm64)
    cargo_target="aarch64-apple-darwin"
    ;;
  darwin-x64)
    cargo_target="x86_64-apple-darwin"
    ;;
  *)
    echo "Usage: $0 darwin-arm64|darwin-x64" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS desktop builds require a macOS host" >&2
  exit 1
fi

node_binary=""
while IFS= read -r candidate; do
  if "$candidate" --version >/dev/null 2>&1; then
    node_binary="$candidate"
    break
  fi
done < <(type -aP node || true)
if [[ -z "$node_binary" ]]; then
  echo "A working Node.js executable must be available on PATH" >&2
  exit 1
fi
PATH="${node_binary%/*}:$PATH"
export PATH

if ! command -v pnpm >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  echo "pnpm and cargo must be available on PATH" >&2
  exit 1
fi

if ! git -C "$project_root" diff --quiet HEAD -- native/YourAllIn1Helper; then
  echo "Commit native/frontend sources before creating a traceable desktop build" >&2
  exit 1
fi

target_dir="$project_root/build/rust/macos/$platform/target"
export CARGO_TARGET_DIR="$target_dir"
export CARGO_BUILD_BUILD_DIR="$project_root/build/rust/macos/$platform/intermediates"
mkdir -p "$CARGO_TARGET_DIR" "$CARGO_BUILD_BUILD_DIR"

pnpm --dir "$project_root/native/YourAllIn1Helper/src-ui" run build
cargo build \
  --manifest-path "$project_root/native/YourAllIn1Helper/Cargo.toml" \
  -p all-in-one-host \
  --bin all-in-one-desktop \
  --features tauri/custom-protocol \
  --release \
  --locked \
  --offline \
  --target "$cargo_target" \
  -j2

(
  cd "$project_root/native/YourAllIn1Helper"
  node src-ui/node_modules/@tauri-apps/cli/tauri.js bundle \
    --bundles app --target "$cargo_target" --ci --no-sign --no-binary-patching
)
binary="$CARGO_TARGET_DIR/$cargo_target/release/bundle/macos/All-in-One Toolbox.app/Contents/MacOS/all-in-one-desktop"
# Rust signs the Mach-O, but a complete app also needs its resource seal.
app_bundle="${binary%/Contents/MacOS/all-in-one-desktop}"
codesign --force --deep --sign - --timestamp=none "$app_bundle"
codesign --verify --deep --strict "$app_bundle"
node "$project_root/scripts/bundle-desktop-macos.mjs" "$platform" "$binary"
