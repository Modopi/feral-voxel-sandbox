# Third-party notices

This native runtime includes or links the components below. Full license texts
are kept in the repository paths listed here.

| Component | Version / use | License and copy |
| --- | --- | --- |
| Godot Engine | 4.6.3 stable; the pinned editor, export templates, and Android runtime used by this project. The version and download hashes are in `tools/native/toolchain.lock`; the Android plugin also declares `org.godotengine:godot:4.6.3.stable`. | Godot's MIT license and the upstream third-party notices for that release are reproduced in [`licenses/Godot-COPYRIGHT.txt`](licenses/Godot-COPYRIGHT.txt). |
| Jolt Physics | The Godot 4.6.3 third-party Jolt implementation, selected by [`project.godot`](project.godot)'s `3d/physics_engine="Jolt Physics"` setting. | MIT license; upstream copy is [`licenses/Jolt-LICENSE.txt`](licenses/Jolt-LICENSE.txt). |
| godot-cpp | Pinned source revision `27d9dd23c83871e0619fca5dc2cddfbfd69e926a`, used to compile the GDExtension. | MIT license; copy is [`licenses/godot-cpp-LICENSE.md`](licenses/godot-cpp-LICENSE.md). |
| nlohmann/json | Version 3.12.0, the vendored single header at `third_party/nlohmann/json.hpp`. | MIT license; copy is [`licenses/nlohmann-json-LICENSE.txt`](licenses/nlohmann-json-LICENSE.txt). |
| Noto Sans CJK KR | The bundled font `fonts/FeralKorean.otf` (internal family name “Noto Sans CJK KR”). | SIL Open Font License 1.1; the copyright and license copy is [`fonts/LICENSE`](fonts/LICENSE). |
| AndroidX and Android support runtime | The migration/update plugin uses `androidx.core:core:1.13.1` for `FileProvider`, declared in `android/feral-migration/build.gradle` and the Godot export plug-in. The Gradle `releaseRuntimeClasspath` also resolves the Godot Android library's AndroidX, Kotlin, JetBrains, JSpecify, and Guava ListenableFuture support artifacts. | Apache License 2.0; copy is [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt). AndroidX, Kotlin, JetBrains, and JSpecify artifact metadata identify Apache-2.0; the ListenableFuture compatibility module follows Guava's Apache-2.0 license. |

The complete Godot `COPYRIGHT.txt` is included because the exported engine
contains additional upstream components beyond the Jolt backend. Toolchain
packages used only to build the project are not listed as application runtime
dependencies here.
