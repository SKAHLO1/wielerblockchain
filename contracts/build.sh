#!/usr/bin/env bash
# Builds both contracts to wasm (run inside WSL / Linux). Output: contracts/res/*.wasm
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/wieler-target}"
mkdir -p res
for c in token raid; do
  cargo near build non-reproducible-wasm --manifest-path "$c/Cargo.toml" --no-abi
done
cp "$CARGO_TARGET_DIR"/near/wieler_token/wieler_token.wasm res/ 2>/dev/null || find "$CARGO_TARGET_DIR/near" -name 'wieler_token.wasm' -exec cp {} res/ \;
cp "$CARGO_TARGET_DIR"/near/wieler_raid/wieler_raid.wasm res/ 2>/dev/null || find "$CARGO_TARGET_DIR/near" -name 'wieler_raid.wasm' -exec cp {} res/ \;
ls -la res
