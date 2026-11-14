# Source this file from zsh/bash before local builds or tests.
if [ -n "${ZSH_VERSION:-}" ]; then
  toolbox_project_root="$(cd "$(dirname "${(%):-%x}")/.." && pwd)"
else
  toolbox_project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
mkdir -p "$toolbox_project_root/.tmp" "$toolbox_project_root/build/rust/target" "$toolbox_project_root/runtime/dsh-dev" "$toolbox_project_root/vendor"
export TMPDIR="$toolbox_project_root/.tmp" TEMP="$toolbox_project_root/.tmp" TMP="$toolbox_project_root/.tmp"
export NODE_COMPILE_CACHE="$toolbox_project_root/.tmp/node-compile-cache"
export CARGO_TARGET_DIR="$toolbox_project_root/build/rust/target"
export CARGO_BUILD_BUILD_DIR="$toolbox_project_root/build/rust/intermediates"
export DSH_HOME="$toolbox_project_root/runtime/dsh-dev"
export DSH_TOOLBOX_WORKSPACE="$toolbox_project_root"
toolbox_harness_runtime='/Applications/DeepSeek Harness.app/Contents/Resources/runtime'
if [ -x "$toolbox_harness_runtime/primary-runtime/dependencies/node/bin/node" ]; then
  export PATH="$toolbox_harness_runtime/primary-runtime/dependencies/node/bin:$toolbox_harness_runtime/cli/bin:$PATH"
fi
unset toolbox_harness_runtime toolbox_project_root
