#pragma once

#include "common.hpp"
#include <filesystem>
#include <optional>
#include <set>

namespace feral {

// The native storage file envelope has its own version so world state can grow
// independently from the filesystem commit format.
constexpr int STORAGE_FILE_SCHEMA = 1;
constexpr int NATIVE_WORLD_SCHEMA = 1;

struct LegacySaveEnvelope {
    uint64_t sequence = 0;
    Json value;
    Json envelope;
};

struct LegacyWorldImport {
    std::string world_id;
    std::string save_key;
    std::string source_key;
    uint64_t sequence = 0;
    Json config;
    Json state;
    Json native_state;
};

struct ImportReport {
    bool archived = false;
    bool used_vault = false;
    bool catalog_imported = false;
    std::filesystem::path archive_path;
    std::vector<std::string> imported_worlds;
    std::vector<std::string> blocked_worlds;
    std::vector<std::string> preserved_keys;
    std::vector<std::string> warnings;
};

class Storage {
public:
    explicit Storage(std::filesystem::path root);

    // Catalogue rows are returned as JSON unchanged, including fields this
    // version does not know. Missing catalogues return null; they do not make
    // an empty world list that could hide old data.
    Json load_catalog() const;
    void save_catalog(const Json& catalog);
    Json load_settings() const;
    void save_settings(const Json& settings);
    Json list_worlds() const;
    std::optional<Json> find_world(const std::string& id) const;
    Json world_config(const std::string& id) const;
    void upsert_world(const Json& row);
    // Removes the launcher row atomically and records a durable tombstone.
    // Native snapshots and the immutable WebView export remain as recovery data.
    bool remove_world(const std::string& id);

    // A snapshot is a complete native world JSON object. Unknown top-level
    // fields survive a load/save cycle. Native save generations are checksummed
    // and alternate, so the last valid generation remains available on error.
    std::optional<Json> load_world(const std::string& id) const;
    uint64_t save_world(const std::string& id, Json snapshot);

    // Import shape: {"localStorage": {key: raw string}, "vault": {"available": bool,
    // "rows": [{"key": ..., "value": ...}]}}. Both complete sources are
    // archived before any migration. Repeated imports never replace an
    // existing native catalogue or world snapshot.
    ImportReport import_legacy_export(const Json& export_data);
    Json legacy_import_status() const;
    void record_legacy_export_failure(const std::string& error);
    void mark_legacy_import_done();

    static LegacySaveEnvelope decode_legacy_envelope(const std::string& raw);
    static std::string legacy_save_key(const Json& world_row);
    static Json default_world_config(const Json& world_row);

    const std::filesystem::path& root() const { return root_; }

private:
    std::filesystem::path root_;
    std::filesystem::path worlds_dir() const;
    std::filesystem::path catalog_base() const;
    std::filesystem::path settings_base() const;
    std::filesystem::path migration_status_base() const;
    std::filesystem::path deleted_worlds_base() const;
    std::filesystem::path world_base(const std::string& id) const;
    std::set<std::string> deleted_world_ids() const;
    void mark_world_deleted(const std::string& id);

    Json load_generation(const std::filesystem::path& base, bool throw_if_corrupt) const;
    uint64_t save_generation(const std::filesystem::path& base, const Json& value);
    static void validate_world_id(const std::string& id);
};

} // namespace feral
