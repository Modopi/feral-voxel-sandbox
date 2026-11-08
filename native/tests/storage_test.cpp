#include "storage.hpp"

#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

using namespace feral;

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

Json read_fixture(const std::string& name) {
    std::ifstream file(std::filesystem::path("native/tests/fixtures") / name, std::ios::binary);
    if (!file) throw std::runtime_error("missing fixture " + name);
    return Json::parse(file);
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("cannot read " + path.string());
    std::ostringstream out;
    out << file.rdbuf();
    return out.str();
}

std::filesystem::path temporary_root() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::filesystem::temp_directory_path() / ("feral-storage-test-" + std::to_string(now));
}

void legacy_decode_and_import() {
    const Json fixture = read_fixture("legacy-webview-schema4.json");
    std::string encoded;
    for (const Json& row : fixture["vault"]["rows"])
        if (row.value("key", std::string()) == "feral.world.v1.a") encoded = row["value"].get<std::string>();
    const LegacySaveEnvelope decoded = Storage::decode_legacy_envelope(encoded);
    require(decoded.sequence == 8, "compressed legacy envelope sequence should decode");
    require(decoded.value["schema"] == 1, "legacy save.js envelope schema should be decoded");
    require(decoded.value["discoveredLandmarks"][0] == "잊힌 관측소", "UTF-16 compressed Unicode JSON should round trip");

    const auto root = temporary_root();
    try {
        Storage storage(root);
        const ImportReport report = storage.import_legacy_export(fixture);
        require(report.archived, "the full WebView export must be archived before import");
        require(report.used_vault, "newer complete IndexedDB vault must win as in the old launcher");
        require(report.catalog_imported, "legacy catalogue should be imported once");
        require(report.imported_worlds.size() == 4, "all four world presets should import");
        require(storage.list_worlds().size() == 4, "all catalogue rows should be retained");
        require(storage.world_config("default")["preset"] == "island", "island preset config should survive");
        require(storage.world_config("frontier")["modules"][0] == "first-signal", "frontier module should survive");
        require(storage.world_config("beta")["terrain"]["generator"] == "machine-field", "machine preset should survive");
        require(storage.world_config("expedition_1")["terrain"]["generator"] == "infinite", "expedition preset should survive");
        require(storage.find_world("default")->value("customWorldNote", std::string()) == "keep-island", "unknown catalogue fields should survive");
        const Json preferences = storage.load_settings();
        require(preferences["settings"]["futureSetting"]["keep"] == true, "global settings should migrate losslessly");
        require(preferences["uiLayout"]["futureLayout"]["keep"] == "yes", "UI layout should migrate losslessly");

        const auto island = storage.load_world("default");
        require(island.has_value(), "island save should be present");
        require((*island)["legacy"]["sequence"] == 9, "newest valid generation should win");
        require((*island)["legacy"]["saveSchema"] == 4, "legacy save schema 4 metadata should be retained");
        require((*island)["legacy"]["unified"]["player"]["x"] == 11.5, "decoded current state should be accessible to native loaders");
        require((*island)["legacy"]["unified"]["atlas"]["edits"].size() == 3, "terrain edits should be passed through intact");
        require((*island)["legacy"]["unified"]["creatures"]["entities"][0]["unknownEntityField"] == "keep", "unknown entity data should remain available");
        std::string selected_envelope;
        for (const Json& row : fixture["vault"]["rows"])
            if (row.value("key", std::string()) == "feral.world.v1.b") selected_envelope = row["value"].get<std::string>();
        require((*island)["legacy"]["raw"].get<std::string>() == selected_envelope, "exact selected envelope should be retained");

        const Json archive = Json::parse(read_text(root / report.archive_path));
        require(archive["localStorage"]["feral.settings"].get<std::string>().find("legacySource") != std::string::npos,
                "local storage source must remain in the immutable archive even when vault wins");
        require(archive["vault"]["rows"].size() == fixture["vault"]["rows"].size(), "all IndexedDB rows must remain archived");

        Json future = *island;
        future["schemaVersion"] = 42;
        future["newNativeSubsystem"] = {{"queue", Json::array({1, 2, 3})}, {"unknown", "future"}};
        future["gameplay"] = {{"schemaVersion", 6}, {"newField", true}};
        storage.save_world("default", future);
        const Json roundtrip = *storage.load_world("default");
        require(roundtrip["schemaVersion"] == 42, "future native world schema must be preserved");
        require(roundtrip["newNativeSubsystem"]["queue"].size() == 3, "future subsystem fields must be preserved");
        require(roundtrip["gameplay"]["newField"] == true, "native subsystem snapshots must round trip");
        require(roundtrip["legacy"]["unified"] == (*island)["legacy"]["unified"], "native saves must retain the immutable source state");
        storage.save_world("default", {{"schemaVersion", 42}, {"world", {{"known", true}}}});
        const Json partial = *storage.load_world("default");
        require(partial["newNativeSubsystem"]["queue"].size() == 3, "partial saves must retain unknown future subsystem fields");
        bool refused_downgrade = false;
        try { storage.save_world("default", {{"schemaVersion", 1}, {"world", Json::object()}}); }
        catch (const std::exception&) { refused_downgrade = true; }
        require(refused_downgrade, "older code must not overwrite a future native schema");
        bool refused_missing_schema = false;
        try { storage.save_world("default", {{"world", Json::object()}}); }
        catch (const std::exception&) { refused_missing_schema = true; }
        require(refused_missing_schema, "older writers without a schema marker must not overwrite future data");

        storage.save_settings({{"schemaVersion", 1}, {"settings", {{"quality", "low"}}}});
        require(storage.load_settings()["settings"]["futureSetting"]["keep"] == true,
                "partial settings writes must retain unknown settings fields");

        // A repeated bridge callback cannot replace native progress with the
        // older WebView state or move the catalogue backwards.
        const ImportReport retry = storage.import_legacy_export(fixture);
        require(retry.imported_worlds.empty(), "re-import must not overwrite an existing native world");
        require(storage.load_world("default")->at("schemaVersion") == 42, "native progress must win on retry");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void direct_legacy_source_and_generation_recovery() {
    const Json fixture = read_fixture("legacy-island-direct.json");
    const auto root = temporary_root();
    try {
        Storage storage(root);
        const ImportReport imported = storage.import_legacy_export(fixture);
        require(imported.archived && !imported.used_vault, "pre-vault direct saves should import from localStorage");
        require(imported.imported_worlds.size() == 1, "direct original island save should be retained");
        require(storage.list_worlds().size() == 1,
                "the exact user's existing catalogue should remain authoritative");
        const Json original = *storage.load_world("default");
        require(original["legacy"]["unified"]["version"] == 2, "old direct schema should remain lossless");
        require(original["legacy"]["unified"]["world"]["edits"][0][3] == 3, "old island terrain edits should remain available for native conversion");
        require(original["legacy"]["unified"]["inventory"]["slots"][0]["id"] == "wood", "old inventory should remain available for native conversion");

        // Two complete generations: if the newest file is damaged, the older
        // complete generation must still load and be the base for the next save.
        storage.save_world("default", {{"schemaVersion", 1}, {"world", {{"marker", "one"}}}});
        storage.save_world("default", {{"schemaVersion", 1}, {"world", {{"marker", "two"}}}});
        const auto newest = root / "worlds" / "default.a.json";
        {
            std::ofstream corrupt(newest, std::ios::binary | std::ios::trunc);
            corrupt << "truncated";
        }
        require(storage.load_world("default")->at("world").at("marker") == "one", "corrupt latest generation must fall back to previous valid state");

        // Make the inactive target unreplaceable. The failed save must leave the
        // active complete generation readable, then permit a later retry.
        const auto blocked = root / "worlds" / "default.a.json";
        std::filesystem::remove(blocked);
        std::filesystem::create_directory(blocked);
        bool failed = false;
        try { storage.save_world("default", {{"schemaVersion", 1}, {"world", {{"marker", "failed"}}}}); }
        catch (const std::exception&) { failed = true; }
        require(failed, "blocked atomic replace should report save failure");
        require(storage.load_world("default")->at("world").at("marker") == "one", "failed save must leave active generation intact");
        std::filesystem::remove_all(blocked);
        storage.save_world("default", {{"schemaVersion", 1}, {"world", {{"marker", "three"}}}});
        require(storage.load_world("default")->at("world").at("marker") == "three", "save retry should commit after failure clears");
        require(storage.load_world("default")->contains("legacy"), "failed saves and native rewrites must retain legacy backup");

        // The direct original stays archived after successful native writes.
        const Json archive = Json::parse(read_text(root / imported.archive_path));
        require(archive["localStorage"]["feral.world.v1"] == fixture["localStorage"]["feral.world.v1"], "native writes must not delete the original WebView key");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void missing_catalog_defaults_are_persisted() {
    Json fixture = read_fixture("legacy-island-direct.json");
    fixture["localStorage"].erase("feral.worlds.v1");
    const auto root = temporary_root();
    try {
        Storage storage(root);
        const ImportReport imported = storage.import_legacy_export(fixture);
        require(imported.imported_worlds.size() == 1 && storage.load_world("default").has_value(),
                "known default world save should still import without the old implicit catalogue key");
        const Json rows = storage.list_worlds();
        require(rows.size() == 3 && rows[0].at("id") == "default" && rows[1].at("id") == "frontier" && rows[2].at("id") == "beta",
                "missing catalogue should persist the real legacy launcher defaults so imported saves remain reachable");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void world_removal_keeps_backup_and_does_not_resurrect() {
    const Json fixture = read_fixture("legacy-island-direct.json");
    const auto root = temporary_root();
    try {
        Storage storage(root);
        const ImportReport imported = storage.import_legacy_export(fixture);
        const Json original = *storage.load_world("default");
        require(storage.remove_world("default"), "existing world should be removable");
        require(storage.list_worlds().empty(), "removed world should disappear from the launcher catalogue");
        require(storage.load_world("default") == original,
                "native world snapshot should remain as private recovery data after removal");
        require(!storage.remove_world("default"), "removing an absent catalogue row should be idempotently false");
        bool refused_recreate = false;
        try {
            storage.upsert_world({{"id", "default"}, {"name", "recreated"}, {"type", "island"}, {"seed", 707}});
        } catch (const std::runtime_error&) { refused_recreate = true; }
        require(refused_recreate, "explicit tombstone should prevent a deleted ID from being reintroduced");

        Storage reopened(root);
        const ImportReport retry = reopened.import_legacy_export(fixture);
        require(retry.imported_worlds.empty() && reopened.list_worlds().empty(),
                "a repeated WebView export must not resurrect a deleted launcher row");
        require(reopened.load_world("default").has_value(),
                "a deleted world's native snapshot remains available as a private backup");
        const Json archive = read_fixture("legacy-island-direct.json");
        require(Json::parse(read_text(root / imported.archive_path)) == archive,
                "world removal must leave the exact original WebView archive untouched");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void failed_catalogue_removal_commit_stays_hidden() {
    const auto root = temporary_root();
    try {
        Storage storage(root);
        const Json row = {{"id", "default"}, {"name", "Default"}, {"type", "island"}, {"seed", 707}};
        storage.save_catalog(Json::array({row}));
        std::filesystem::create_directory(root / "catalog.b.json");
        bool failed = false;
        try { storage.remove_world("default"); } catch (const std::exception&) { failed = true; }
        require(failed, "unreplaceable catalogue generation should report an atomic removal failure");
        require(storage.list_worlds().empty(),
                "the tombstone must keep a row hidden if the catalogue commit fails");
        require(storage.load_catalog().size() == 1,
                "failed catalogue removal must leave the previous complete generation intact");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void catalogue_unknown_fields_and_corruption() {
    const auto root = temporary_root();
    try {
        Storage storage(root);
        Json catalog = {{"version", 12}, {"worlds", Json::array({
            Json{{"id", "alpha"}, {"name", "A"}, {"type", "expedition"}, {"seed", 3},
                 {"config", Json{{"configVersion", 1}, {"preset", "expedition"}, {"seed", 3},
                                 {"rules", Json{{"survival", false}, {"futureRule", true}}},
                                 {"futureConfig", "preserve"}}},
                 {"future", {{"x", 1}}}}
        })}, {"futureRoot", "preserve"}};
        storage.save_catalog(catalog);
        Json updated = *storage.find_world("alpha");
        updated["name"] = "Renamed";
        storage.upsert_world(updated);
        const Json after = storage.load_catalog();
        require(after["futureRoot"] == "preserve", "future catalogue root fields should survive upsert");
        require(after["worlds"][0]["future"]["x"] == 1, "future world fields should survive upsert");
        require(after["worlds"][0]["name"] == "Renamed", "known catalogue edits should be applied");
        const Json config = storage.world_config("alpha");
        require(config["terrain"]["generator"] == "infinite" && config["modules"].empty(),
                "partial schema-1 configs should inherit the same preset defaults as the old launcher");
        require(config["rules"]["survival"] == false && config["futureConfig"] == "preserve" &&
                config["rules"]["futureRule"] == true, "config overrides and unknown fields should survive normalization");

        const auto a = root / "catalog.a.json";
        const auto b = root / "catalog.b.json";
        require(std::filesystem::exists(a) && std::filesystem::exists(b), "catalogue should retain two complete generations");
        std::filesystem::remove(a);
        std::filesystem::remove(b);
        std::filesystem::create_directory(a);
        std::filesystem::create_directory(b);
        bool rejected = false;
        try { storage.save_catalog(Json::array()); } catch (const std::exception&) { rejected = true; }
        require(rejected, "storage must refuse to replace two invalid catalogue generations");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void world_id_validation() {
    const auto root = temporary_root();
    try {
        Storage storage(root);
        Json row = {{"id", "-native-smoke_1"}, {"name", "valid"}, {"type", "expedition"}, {"seed", 3}};
        storage.upsert_world(row);
        require(storage.find_world("-native-smoke_1").has_value(),
                "world IDs may use ASCII letters, digits, underscore and hyphen");
        row["id"] = "native/smoke";
        bool rejected = false;
        try { storage.upsert_world(row); } catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "world IDs must reject path separators without constructing a regex");
        row["id"] = std::string(81, 'x');
        rejected = false;
        try { storage.upsert_world(row); } catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "world IDs must be limited to 80 ASCII characters");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void failed_import_is_persistently_blocked() {
    Json broken = read_fixture("legacy-island-direct.json");
    broken["localStorage"]["feral.world.v1"] = "{truncated";
    const Json valid = read_fixture("legacy-island-direct.json");
    const auto root = temporary_root();
    try {
        Storage storage(root);
        require(storage.legacy_import_status().is_object() &&
                !storage.legacy_import_status().value("complete", false),
                "missing migration status must be safe for startup checks");
        const ImportReport failed = storage.import_legacy_export(broken);
        require(failed.blocked_worlds.size() == 1 && failed.blocked_worlds[0] == "default",
                "invalid legacy save should be reported as a blocked world");
        require(storage.find_world("default")->value("legacyImportBlocked", false),
                "blocked status must persist in the native catalogue");
        require(!storage.load_world("default"), "invalid legacy save must not become an empty native snapshot");
        bool refused = false;
        try { storage.mark_legacy_import_done(); } catch (const std::exception&) { refused = true; }
        require(refused, "migration must not be marked complete while a world is blocked");

        const ImportReport repaired = storage.import_legacy_export(valid);
        require(repaired.blocked_worlds.empty() && repaired.imported_worlds.size() == 1,
                "a later valid source should recover the blocked world");
        require(storage.find_world("default")->value("legacyImportBlocked", true) == false,
                "successful retry should clear the persistent blocker");
        storage.mark_legacy_import_done();
        require(storage.legacy_import_status().value("complete", false),
                "migration completion should only be recorded after successful import");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

void failed_webview_export_is_persistently_blocked_until_retry() {
    const Json valid = read_fixture("legacy-island-direct.json");
    const auto root = temporary_root();
    try {
        Storage storage(root);
        storage.record_legacy_export_failure("IndexedDB export failed");
        const Json failed_status = Storage(root).legacy_import_status();
        require(failed_status.value("exportFailed", false),
                "WebView export failure must persist before any world is imported");
        require(failed_status.value("exportError", std::string()) == "IndexedDB export failed",
                "the export failure reason should be available to the native launcher");

        const ImportReport retry = storage.import_legacy_export(valid);
        require(retry.imported_worlds.size() == 1 && retry.blocked_worlds.empty(),
                "a later complete WebView export should be importable");
        require(!storage.legacy_import_status().value("exportFailed", false),
                "successful import should clear the persistent export blocker");
        storage.mark_legacy_import_done();
        storage.record_legacy_export_failure("stale callback after success");
        require(storage.legacy_import_status().value("complete", false),
                "a stale export error after successful migration must not re-block saved worlds");
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        throw;
    }
    std::filesystem::remove_all(root);
}

} // namespace

int main() {
    try {
        legacy_decode_and_import();
        direct_legacy_source_and_generation_recovery();
        missing_catalog_defaults_are_persisted();
        world_removal_keeps_backup_and_does_not_resurrect();
        failed_catalogue_removal_commit_stays_hidden();
        catalogue_unknown_fields_and_corruption();
        world_id_validation();
        failed_import_is_persistently_blocked();
        failed_webview_export_is_persistently_blocked_until_retry();
    } catch (const std::exception& e) {
        std::cerr << "native storage test failed: " << e.what() << '\n';
        return 1;
    }
    std::cout << "native storage tests passed\n";
    return 0;
}
