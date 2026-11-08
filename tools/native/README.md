# Native Godot build

This toolchain builds the Godot 4.6.3 C++ extension for Linux x86_64 and Android arm64, then exports the signed Android package. It keeps downloaded compilers, generated Godot API bindings, Android NDK files, and export templates in the sibling `toolchain/` directory by default. Set `FERAL_TOOLCHAIN_DIR` to move that cache.

Run `tools/native/bootstrap.sh` once on a clean machine. It installs SCons for the current user and downloads pinned Godot, godot-cpp, Gradle, Android NDK, and Godot export templates. The Android SDK must provide platform 35 and Build Tools 35.0.0 through `ANDROID_HOME` or `ANDROID_SDK_ROOT`; the build needs a JDK 17 or newer.

Run `FERAL_BUILD_JOBS=4 tools/native/build.sh` to produce:

- `native/bin/libferal.linux.template_debug.x86_64.so`
- `native/bin/libferal.linux.template_release.x86_64.so`
- `native/bin/libferal.android.template_debug.arm64.so`
- `native/bin/libferal.android.template_release.arm64.so`

The shared libraries use hidden visibility and a version script that exports only `feral_library_init`, avoiding C++ standard-library symbol interposition inside the Godot process. The build snapshots and hashes `native/src`, `native/third_party`, and `feral.exports` into the external toolchain cache, then uses that same immutable snapshot for all four targets. It runs `tools/native/check-exports.py` on all outputs and fails if any other dynamic symbol is visible.

`tools/native/export-apk.sh` builds those libraries, builds and stages the Android v2 migration/update plugin AAR, then exports and verifies `build/Feral-<nativeVersion>-android.apk`. It reads `nativeVersion` and `nativeCode` from `version.json` and refuses to export while `nativeCode` is at the shipped baseline 303. The export uses `signing/prototype.keystore` with alias `feral`; this is the shared prototype signing key.

Run `tools/native/test.sh` for the focused C++ tests and the Godot/Jolt physics and startup smoke checks. It also builds all four native extension targets. The GitHub release workflow runs this gate before publishing either the stable release or a versioned branch build.

The Android bridge is packaged through `native/addons/FeralMigration/export_plugin.gd`. That editor-only script supplies the AAR and its AndroidX dependency to Godot’s Gradle export. Gameplay remains in the C++ GDExtension.
