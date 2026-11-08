@tool
extends EditorPlugin

var android_export_plugin: EditorExportPlugin

func _enter_tree() -> void:
	android_export_plugin = FeralMigrationExport.new()
	add_export_plugin(android_export_plugin)

func _exit_tree() -> void:
	remove_export_plugin(android_export_plugin)
	android_export_plugin = null

class FeralMigrationExport extends EditorExportPlugin:
	func _get_name() -> String:
		return "FeralMigration"

	func _supports_platform(platform: EditorExportPlatform) -> bool:
		return platform is EditorExportPlatformAndroid

	func _get_android_libraries(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["res://addons/FeralMigration/bin/release/feral-migration-release.aar"])

	func _get_android_dependencies(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["androidx.core:core:1.13.1"])

	func _get_android_dependencies_maven_repos(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["https://maven.google.com"])
