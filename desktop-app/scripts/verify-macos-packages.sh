#!/bin/sh
set -eu

# Verify the app as shipped inside each DMG, including nested Electron frameworks.
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
mount_dir=$(mktemp -d)
mounted=false
cleanup() {
    if [ "$mounted" = true ]; then
        hdiutil detach "$mount_dir" -quiet
    fi
    rmdir "$mount_dir"
}
trap cleanup EXIT

for arch in x64 arm64; do
    dmg="release/ANIdesktop-$version-mac-$arch.dmg"
    hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_dir" -quiet
    mounted=true
    app="$mount_dir/ANIdesktop.app"
    codesign --verify --deep --strict --verbose=2 "$app"

    expected_arch="$arch"
    if [ "$arch" = x64 ]; then expected_arch=x86_64; fi
    actual_arch=$(lipo -archs "$app/Contents/MacOS/ANIdesktop")
    if [ "$actual_arch" != "$expected_arch" ]; then
        echo "Expected $expected_arch in $dmg, found $actual_arch" >&2
        exit 1
    fi
    echo "Verified signature and architecture: $dmg"
    hdiutil detach "$mount_dir" -quiet
    mounted=false
done
