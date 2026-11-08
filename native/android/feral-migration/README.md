# FERAL WebView save migration plugin

The Android plugin is a one-shot, read-only bridge for data written by the
`com.kgb.feral` WebView app. It loads a small migration document at the prior
`https://appassets.androidplatform.net` origin, exports `feral.*` localStorage
keys and the complete `feral-vault` IndexedDB `keys` store, and writes the JSON
in order-checked chunks to an app-private file. The original WebView stores are
never changed or deleted. Gameplay and launcher code are not loaded in this
WebView.

Godot exposes the singleton `FeralMigration`. Call `start_import()` and wait for
`completed(path: String, error: String)`. A nonempty path means only that the
export file was synced; native C++ must parse and archive it with
`Storage::import_legacy_export()` before declaring migration successful. A
nonempty error means export failed and the old stores remain untouched.

The same AAR exposes `FeralUpdates`. `check_latest()` verifies the signed public
stable manifest and returns APK metadata, `download_latest_apk()` downloads and
verifies the APK hash, package, version and existing test signer, and
`open_installer()` hands the verified APK to Android's installer after a native
UI action. If Android needs permission for this app as an install source,
`open_install_permission_settings()` opens the system setting; the app does not
install or restart itself.

This is a Godot Android plugin v2. The Godot project registers it through an
`@tool EditorExportPlugin` that packages the AAR and the v2 manifest metadata;
the deprecated `.gdap` path is not used.

Build the Android library and stage it into the Godot add-on with:

```sh
bash tools/native/build-migration-plugin.sh
```

The build uses the pinned Gradle/Android toolchain and stages the AAR at
`native/addons/FeralMigration/bin/release/feral-migration-release.aar`. The AAR
manifest declares `REQUEST_INSTALL_PACKAGES` and a private `FileProvider` for
verified APK handoff. The app module needs no added dependency. The module
targets the app's existing minSdk 26 and Godot Android library 4.6.3.stable.
