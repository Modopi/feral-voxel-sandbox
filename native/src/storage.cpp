#include "storage.hpp"

#include <cerrno>
#include <atomic>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <limits>
#include <random>
#include <sstream>
#include <stdexcept>

namespace feral {
namespace {

bool starts_with(const std::string& text, const char* prefix) {
    const size_t length = std::char_traits<char>::length(prefix);
    return text.size() >= length && text.compare(0, length, prefix) == 0;
}

Json preserve_missing_fields(const Json& current, const Json& incoming) {
    if (!current.is_object() || !incoming.is_object()) return incoming;
    Json merged = incoming;
    for (auto it = current.begin(); it != current.end(); ++it) {
        const auto found = merged.find(it.key());
        if (found == merged.end()) merged[it.key()] = it.value();
        else if (it.value().is_object() && found->is_object()) merged[it.key()] = preserve_missing_fields(it.value(), *found);
    }
    return merged;
}

struct Generation {
    bool exists = false;
    bool valid = false;
    char slot = 0;
    uint64_t sequence = 0;
    Json payload;
    std::string error;
};

std::vector<uint16_t> utf8_to_utf16(const std::string& text) {
    std::vector<uint16_t> out;
    for (size_t i = 0; i < text.size();) {
        const auto first = static_cast<unsigned char>(text[i]);
        uint32_t cp = 0;
        size_t count = 0;
        if (first < 0x80) { cp = first; count = 1; }
        else if ((first & 0xe0) == 0xc0) { cp = first & 0x1f; count = 2; }
        else if ((first & 0xf0) == 0xe0) { cp = first & 0x0f; count = 3; }
        else if ((first & 0xf8) == 0xf0) { cp = first & 0x07; count = 4; }
        else throw std::runtime_error("invalid UTF-8 in saved text");
        if (i + count > text.size()) throw std::runtime_error("truncated UTF-8 in saved text");
        for (size_t j = 1; j < count; ++j) {
            const auto next = static_cast<unsigned char>(text[i + j]);
            if ((next & 0xc0) != 0x80) throw std::runtime_error("invalid UTF-8 continuation byte");
            cp = (cp << 6) | (next & 0x3f);
        }
        if ((count == 2 && cp < 0x80) || (count == 3 && cp < 0x800) ||
            (count == 4 && cp < 0x10000) || cp > 0x10ffff ||
            (cp >= 0xd800 && cp <= 0xdfff))
            throw std::runtime_error("invalid UTF-8 code point in saved text");
        if (cp <= 0xffff) out.push_back(static_cast<uint16_t>(cp));
        else {
            cp -= 0x10000;
            out.push_back(static_cast<uint16_t>(0xd800 + (cp >> 10)));
            out.push_back(static_cast<uint16_t>(0xdc00 + (cp & 0x3ff)));
        }
        i += count;
    }
    return out;
}

std::string utf16_to_utf8(const std::u16string& text) {
    std::string out;
    for (size_t i = 0; i < text.size(); ++i) {
        uint32_t cp = text[i];
        if (cp >= 0xd800 && cp <= 0xdbff) {
            if (i + 1 >= text.size() || text[i + 1] < 0xdc00 || text[i + 1] > 0xdfff)
                throw std::runtime_error("invalid UTF-16 surrogate in decompressed save");
            cp = 0x10000 + ((cp - 0xd800) << 10) + (text[++i] - 0xdc00);
        } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            throw std::runtime_error("invalid UTF-16 surrogate in decompressed save");
        }
        if (cp < 0x80) out.push_back(static_cast<char>(cp));
        else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xc0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xe0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        } else {
            out.push_back(static_cast<char>(0xf0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        }
    }
    return out;
}

std::string js_checksum(const std::string& text) {
    uint32_t hash = 2166136261u;
    for (const uint16_t unit : utf8_to_utf16(text)) hash = (hash ^ unit) * 16777619u;
    std::ostringstream out;
    out << std::hex << std::nouppercase << hash;
    return out.str();
}

std::string byte_checksum(const std::string& text) {
    uint32_t hash = 2166136261u;
    for (const unsigned char c : text) hash = (hash ^ c) * 16777619u;
    std::ostringstream out;
    out << std::hex << std::nouppercase << hash;
    return out.str();
}

std::u16string decompress_lz_utf16(const std::string& encoded) {
    const auto encoded_units = utf8_to_utf16(encoded);
    if (encoded_units.empty()) throw std::runtime_error("empty compressed save payload");
    if (encoded_units.size() > 128u * 1024u * 1024u) throw std::runtime_error("compressed save is too large");
    std::vector<uint16_t> input;
    input.reserve(encoded_units.size());
    for (const uint16_t c : encoded_units) {
        if (c < 32) throw std::runtime_error("invalid lz-string UTF-16 payload");
        input.push_back(static_cast<uint16_t>(c - 32));
    }

    size_t index = 1;
    uint32_t value = input[0];
    uint32_t position = 1u << 14;
    auto read_bits = [&](int count) -> uint32_t {
        uint32_t bits = 0;
        uint32_t power = 1;
        for (int i = 0; i < count; ++i) {
            const uint32_t bit = value & position;
            position >>= 1;
            if (position == 0) {
                position = 1u << 14;
                value = index < input.size() ? input[index++] : 0;
            }
            if (bit) bits |= power;
            power <<= 1;
        }
        return bits;
    };
    auto read_literal = [&](int width) -> char16_t {
        return static_cast<char16_t>(read_bits(width));
    };

    std::vector<std::u16string> dictionary(4);
    uint32_t enlarge_in = 4, dict_size = 4, num_bits = 3;
    std::u16string entry, result, w;
    const uint32_t first_code = read_bits(2);
    char16_t first_char = 0;
    if (first_code == 0) first_char = read_literal(8);
    else if (first_code == 1) first_char = read_literal(16);
    else if (first_code == 2) return {};
    else throw std::runtime_error("invalid lz-string stream header");
    dictionary[3].assign(1, first_char);
    w.assign(1, first_char);
    result = w;

    size_t steps = 0;
    for (;;) {
        if (index > input.size()) throw std::runtime_error("truncated lz-string save payload");
        if (++steps > 100000000u || result.size() > 512u * 1024u * 1024u)
            throw std::runtime_error("decompressed save exceeds the supported size");
        uint32_t code = read_bits(static_cast<int>(num_bits));
        if (code == 0 || code == 1) {
            const char16_t c = read_literal(code == 0 ? 8 : 16);
            if (dict_size >= 0x7fffffffu) throw std::runtime_error("lz-string dictionary is too large");
            if (dictionary.size() <= dict_size) dictionary.resize(dict_size + 1);
            dictionary[dict_size++].assign(1, c);
            code = dict_size - 1;
            if (--enlarge_in == 0) { enlarge_in = 1u << num_bits; ++num_bits; }
        } else if (code == 2) {
            return result;
        }

        if (enlarge_in == 0) { enlarge_in = 1u << num_bits; ++num_bits; }
        if (code < dictionary.size() && !dictionary[code].empty()) entry = dictionary[code];
        else if (code == dict_size) { entry = w; entry.push_back(w.front()); }
        else throw std::runtime_error("invalid lz-string dictionary reference code=" + std::to_string(code) +
            " dict=" + std::to_string(dict_size) + " index=" + std::to_string(index) +
            " length=" + std::to_string(input.size()));
        result += entry;
        if (dictionary.size() <= dict_size) dictionary.resize(dict_size + 1);
        dictionary[dict_size++] = w + entry.front();
        if (--enlarge_in == 0) { enlarge_in = 1u << num_bits; ++num_bits; }
        w = std::move(entry);
    }
}

Json read_json_file(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open storage file: " + file.string());
    std::ostringstream buffer;
    buffer << in.rdbuf();
    if (in.bad()) throw std::runtime_error("cannot read storage file: " + file.string());
    return Json::parse(buffer.str());
}

void atomic_write(const std::filesystem::path& file, const std::string& text, bool no_replace = false) {
    std::filesystem::create_directories(file.parent_path());
    if (no_replace && std::filesystem::exists(file)) return;
    static std::atomic<uint64_t> counter{0};
    std::random_device random;
    const auto suffix = std::to_string(random()) + "." + std::to_string(counter.fetch_add(1));
    const auto temp = file.parent_path() / (file.filename().string() + ".tmp." + suffix);
    try {
        {
            std::ofstream out(temp, std::ios::binary | std::ios::trunc);
            if (!out) throw std::runtime_error("cannot create temporary storage file: " + temp.string());
            out.write(text.data(), static_cast<std::streamsize>(text.size()));
            out.flush();
            if (!out) throw std::runtime_error("cannot write temporary storage file: " + temp.string());
        }
        if (no_replace && std::filesystem::exists(file)) {
            std::filesystem::remove(temp);
            return;
        }
        std::filesystem::rename(temp, file);
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove(temp, ignored);
        throw;
    }
}

Generation read_generation_slot(const std::filesystem::path& base, char slot) {
    Generation result;
    result.slot = slot;
    const auto file = base.parent_path() / (base.filename().string() + "." + slot + ".json");
    if (!std::filesystem::exists(file)) return result;
    result.exists = true;
    try {
        const Json envelope = read_json_file(file);
        if (!envelope.is_object() || envelope.value("format", std::string()) != "feral-native-json-v1" ||
            envelope.value("schema", 0) != STORAGE_FILE_SCHEMA || !envelope.contains("sequence") ||
            (!envelope["sequence"].is_number_unsigned() && !envelope["sequence"].is_number_integer()) ||
            !envelope.contains("payload") || !envelope.contains("checksum") || !envelope["checksum"].is_string())
            throw std::runtime_error("invalid native storage envelope");
        const int64_t sequence = envelope["sequence"].get<int64_t>();
        if (sequence < 1) throw std::runtime_error("invalid native storage sequence");
        const std::string serialized = envelope["payload"].dump();
        if (byte_checksum(serialized) != envelope["checksum"].get<std::string>())
            throw std::runtime_error("native storage checksum mismatch");
        result.sequence = static_cast<uint64_t>(sequence);
        result.payload = envelope["payload"];
        result.valid = true;
    } catch (const std::exception& e) { result.error = e.what(); }
    return result;
}

Json native_state(const std::string& world_id, const Json& config, const std::string& save_key,
                  const std::string& source_key, const std::string& raw, uint64_t sequence,
                  const Json& envelope, const Json& state, int save_schema,
                  const std::filesystem::path& archive_path) {
    return {
        {"schemaVersion", NATIVE_WORLD_SCHEMA},
        {"worldId", world_id},
        {"config", config},
        {"world", nullptr},
        {"gameplay", nullptr},
        {"simulation", nullptr},
        {"legacy", {
            {"format", "feral-webview-unified-v1"},
            {"saveKey", save_key},
            {"sourceKey", source_key},
            {"sequence", sequence},
            {"saveSchema", save_schema},
            {"raw", raw},
            {"envelope", envelope},
            {"unified", state},
            {"archive", archive_path.generic_string()}
        }}
    };
}

Json local_storage_map(const Json& export_data) {
    Json result = Json::object();
    const auto it = export_data.find("localStorage");
    if (it == export_data.end() || !it->is_object()) return result;
    for (auto entry = it->begin(); entry != it->end(); ++entry) {
        if (!starts_with(entry.key(), "feral.")) continue;
        if (entry.value().is_string()) result[entry.key()] = entry.value();
    }
    return result;
}

Json vault_rows_map(const Json& export_data) {
    Json result = Json::object();
    const auto vault_it = export_data.find("vault");
    if (vault_it == export_data.end() || !vault_it->is_object()) return result;
    const auto rows_it = vault_it->find("rows");
    if (rows_it == vault_it->end() || !rows_it->is_array()) return result;
    for (const Json& row : *rows_it) {
        if (!row.is_object() || !row.contains("key") || !row["key"].is_string() || !row.contains("value")) continue;
        const std::string key = row["key"].get<std::string>();
        if (key == "@meta") result["@meta"] = row["value"];
        else if (starts_with(key, "feral.") && key != "feral.vault.v1" && row["value"].is_string()) result[key] = row["value"];
    }
    const auto meta_it = vault_it->find("meta");
    if (meta_it != vault_it->end() && !result.contains("@meta")) result["@meta"] = *meta_it;
    return result;
}

bool has_legacy_payload(const Json& map) {
    for (auto it = map.begin(); it != map.end(); ++it)
        if (starts_with(it.key(), "feral.") && it.key() != "feral.vault.v1") return true;
    return false;
}

std::optional<double> finite_number(const Json& object, const char* key) {
    if (!object.is_object()) return std::nullopt;
    const auto it = object.find(key);
    if (it == object.end() || !it->is_number()) return std::nullopt;
    const double value = it->get<double>();
    if (!std::isfinite(value)) return std::nullopt;
    return value;
}

std::optional<double> saved_at(const Json& object) { return finite_number(object, "savedAt"); }

std::vector<Json> default_catalog_rows() {
    return {
        Json{{"id", "default"}, {"name", "기본 탐험 맵"}, {"type", "island"}, {"seed", 63026}},
        Json{{"id", "frontier"}, {"name", "개척 원정"}, {"type", "frontier"}, {"seed", 63026}},
        Json{{"id", "beta"}, {"name", "기계 베타 맵"}, {"type", "machine"}, {"seed", 63026}}
    };
}

} // namespace

Storage::Storage(std::filesystem::path root) : root_(std::move(root)) {
    if (root_.empty()) throw std::invalid_argument("storage root must not be empty");
}

std::filesystem::path Storage::worlds_dir() const { return root_ / "worlds"; }
std::filesystem::path Storage::catalog_base() const { return root_ / "catalog"; }
std::filesystem::path Storage::settings_base() const { return root_ / "settings"; }
std::filesystem::path Storage::migration_status_base() const { return root_ / "legacy" / "migration-status"; }
std::filesystem::path Storage::deleted_worlds_base() const { return root_ / "legacy" / "deleted-worlds"; }
std::filesystem::path Storage::world_base(const std::string& id) const {
    validate_world_id(id);
    return worlds_dir() / id;
}

void Storage::validate_world_id(const std::string& id) {
    if (id.empty() || id.size() > 80) throw std::invalid_argument("invalid world id");
    for (const unsigned char ch : id) {
        const bool allowed = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') || ch == '_' || ch == '-';
        if (!allowed) throw std::invalid_argument("invalid world id");
    }
}

Json Storage::load_generation(const std::filesystem::path& base, bool throw_if_corrupt) const {
    const Generation a = read_generation_slot(base, 'a');
    const Generation b = read_generation_slot(base, 'b');
    if (!a.valid && !b.valid) {
        if (a.exists || b.exists) {
            if (throw_if_corrupt) throw std::runtime_error("no valid generation for " + base.filename().string());
        }
        return nullptr;
    }
    if (a.valid && b.valid) return a.sequence >= b.sequence ? a.payload : b.payload;
    return a.valid ? a.payload : b.payload;
}

uint64_t Storage::save_generation(const std::filesystem::path& base, const Json& value) {
    const Generation a = read_generation_slot(base, 'a');
    const Generation b = read_generation_slot(base, 'b');
    if (!a.valid && !b.valid && (a.exists || b.exists))
        throw std::runtime_error("refusing to overwrite storage with no valid generation: " + base.filename().string());
    const Generation* latest = nullptr;
    if (a.valid && b.valid) latest = a.sequence >= b.sequence ? &a : &b;
    else if (a.valid) latest = &a;
    else if (b.valid) latest = &b;
    const uint64_t sequence = latest ? latest->sequence + 1 : 1;
    if (sequence > static_cast<uint64_t>(std::numeric_limits<int64_t>::max()))
        throw std::runtime_error("native storage sequence overflow");
    const char slot = latest ? (latest->slot == 'a' ? 'b' : 'a') : 'a';
    Json envelope = {
        {"format", "feral-native-json-v1"},
        {"schema", STORAGE_FILE_SCHEMA},
        {"sequence", sequence},
        {"checksum", byte_checksum(value.dump())},
        {"payload", value}
    };
    const auto file = base.parent_path() / (base.filename().string() + "." + slot + ".json");
    atomic_write(file, envelope.dump());
    return sequence;
}

Json Storage::load_catalog() const { return load_generation(catalog_base(), true); }
void Storage::save_catalog(const Json& catalog) {
    if (!catalog.is_array() && !catalog.is_object()) throw std::invalid_argument("catalogue must be an array or object");
    save_generation(catalog_base(), catalog);
}

Json Storage::load_settings() const { return load_generation(settings_base(), true); }
void Storage::save_settings(const Json& settings) {
    if (!settings.is_object()) throw std::invalid_argument("settings must be an object");
    Json next = settings;
    const Json current = load_settings();
    if (current.is_object() && current.contains("schemaVersion") && current["schemaVersion"].is_number_integer()) {
        const int64_t current_schema = current["schemaVersion"].get<int64_t>();
        const int64_t incoming_schema = next.value("schemaVersion", int64_t{0});
        if ((current_schema > NATIVE_WORLD_SCHEMA && incoming_schema < current_schema) ||
            (incoming_schema > 0 && incoming_schema < current_schema))
            throw std::runtime_error("refusing to overwrite newer native settings schema");
    }
    if (current.is_object()) next = preserve_missing_fields(current, next);
    if (current.is_object() && current.contains("legacy")) {
        if (!next.contains("legacy") || !next["legacy"].is_object()) next["legacy"] = current["legacy"];
        else for (const char* key : {"settingsRaw", "uiLayoutRaw", "unknownKeys", "archive"})
            if (current["legacy"].contains(key)) next["legacy"][key] = current["legacy"][key];
    }
    save_generation(settings_base(), next);
}

Json Storage::legacy_import_status() const {
    Json status = load_generation(migration_status_base(), true);
    return status.is_null() ? Json::object() : status;
}

std::set<std::string> Storage::deleted_world_ids() const {
    const Json tombstones = load_generation(deleted_worlds_base(), true);
    if (tombstones.is_null()) return {};
    if (!tombstones.is_object() || !tombstones.contains("worlds") || !tombstones["worlds"].is_array())
        throw std::runtime_error("deleted-world tombstones have an unsupported shape");
    std::set<std::string> ids;
    for (const Json& value : tombstones["worlds"]) {
        if (!value.is_string()) throw std::runtime_error("deleted-world tombstone has an invalid id");
        const std::string id = value.get<std::string>();
        validate_world_id(id);
        ids.insert(id);
    }
    return ids;
}

void Storage::mark_world_deleted(const std::string& id) {
    Json tombstones = load_generation(deleted_worlds_base(), true);
    if (tombstones.is_null()) tombstones = Json{{"schemaVersion", 1}, {"worlds", Json::array()}};
    if (!tombstones.is_object()) throw std::runtime_error("deleted-world tombstones have an unsupported shape");
    if (!tombstones.contains("worlds")) tombstones["worlds"] = Json::array();
    if (!tombstones["worlds"].is_array()) throw std::runtime_error("deleted-world tombstones have an unsupported shape");
    for (const Json& value : tombstones["worlds"]) {
        if (!value.is_string()) throw std::runtime_error("deleted-world tombstone has an invalid id");
        validate_world_id(value.get<std::string>());
        if (value == id) return;
    }
    tombstones["worlds"].push_back(id);
    save_generation(deleted_worlds_base(), tombstones);
}

void Storage::record_legacy_export_failure(const std::string& error) {
    Json status = legacy_import_status();
    // A completed migration already has an immutable archive and native save
    // snapshots. A later optional re-export failure must not block that data.
    if (status.value("complete", false) == true) return;
    status["statusVersion"] = 1;
    status["complete"] = false;
    status["exportFailed"] = true;
    status["exportError"] = error.substr(0, 1024);
    save_generation(migration_status_base(), status);
}

void Storage::mark_legacy_import_done() {
    Json status = legacy_import_status();
    if (!status.is_object() || status.value("archived", false) != true)
        throw std::runtime_error("legacy storage has not been archived");
    if (status.contains("blockedWorlds") && status["blockedWorlds"].is_array() && !status["blockedWorlds"].empty())
        throw std::runtime_error("legacy worlds are blocked pending save recovery");
    status["complete"] = true;
    save_generation(migration_status_base(), status);
}

Json Storage::list_worlds() const {
    Json catalog = load_catalog();
    if (catalog.is_null()) return Json::array();
    const Json* rows = nullptr;
    if (catalog.is_array()) rows = &catalog;
    else if (catalog.is_object() && catalog.contains("worlds") && catalog["worlds"].is_array()) rows = &catalog["worlds"];
    else throw std::runtime_error("native world catalogue has an unsupported shape");
    const std::set<std::string> deleted = deleted_world_ids();
    Json visible = Json::array();
    for (const Json& row : *rows) {
        if (row.is_object() && row.contains("id") && row["id"].is_string() &&
            deleted.count(row["id"].get<std::string>())) continue;
        visible.push_back(row);
    }
    return visible;
}

std::optional<Json> Storage::find_world(const std::string& id) const {
    for (const Json& row : list_worlds())
        if (row.is_object() && row.value("id", std::string()) == id) return row;
    return std::nullopt;
}

Json Storage::default_world_config(const Json& row) {
    if (!row.is_object()) throw std::invalid_argument("world row must be an object");
    const std::string type = row.value("type", std::string());
    if (!row.contains("seed") || !row["seed"].is_number_integer()) throw std::invalid_argument("world row has no integer seed");
    const Json& stored = row.value("config", Json());
    if (!stored.is_null() && (!stored.is_object() || stored.value("configVersion", 0) != 1))
        return stored; // preserve unknown/future config untouched
    std::string generator;
    Json rules = Json::object(), modules = Json::array();
    if (type == "island") {
        generator = "island";
        rules = {{"survival", false}, {"sandbox", true}, {"starterKit", true}, {"dropOnDeath", true}};
    } else if (type == "frontier") {
        generator = "frontier";
        rules = {{"survival", true}, {"dropOnDeath", false}};
        modules.push_back("first-signal");
    } else if (type == "machine") {
        generator = "machine-field";
        modules.push_back("machine-field");
    } else if (type == "expedition") {
        generator = "infinite";
        rules = {{"survival", true}, {"sandbox", false}, {"startStructures", true}, {"dropOnDeath", true}};
    } else throw std::invalid_argument("unsupported world preset: " + type);
    if (stored.is_object() && stored.value("configVersion", 0) == 1) {
        if (stored.value("preset", std::string()) != type || stored.value("seed", Json()) != row["seed"])
            throw std::runtime_error("world config does not match catalogue preset or seed");
        const Json saved_rules = stored.value("rules", Json::object());
        for (auto it = rules.begin(); it != rules.end(); ++it) {
            const auto saved = saved_rules.find(it.key());
            if (saved != saved_rules.end() && saved->is_boolean()) it.value() = *saved;
        }
    }
    Json normalized = {{"configVersion", 1}, {"preset", type}, {"seed", row["seed"]},
                       {"terrain", {{"generator", generator}}}, {"rules", rules}, {"modules", modules}};
    return stored.is_object() ? preserve_missing_fields(stored, normalized) : normalized;
}

Json Storage::world_config(const std::string& id) const {
    const auto row = find_world(id);
    if (!row) return nullptr;
    return default_world_config(*row);
}

void Storage::upsert_world(const Json& row) {
    if (!row.is_object() || !row.contains("id") || !row["id"].is_string())
        throw std::invalid_argument("world row needs a string id");
    const std::string id = row["id"].get<std::string>();
    validate_world_id(id);
    if (deleted_world_ids().count(id)) throw std::runtime_error("world id has been deleted");
    Json catalog = load_catalog();
    if (catalog.is_null()) catalog = Json::array();
    Json* rows = nullptr;
    if (catalog.is_array()) rows = &catalog;
    else if (catalog.is_object() && catalog.contains("worlds") && catalog["worlds"].is_array()) rows = &catalog["worlds"];
    else throw std::runtime_error("native world catalogue has an unsupported shape");
    for (Json& existing : *rows) {
        if (existing.is_object() && existing.value("id", std::string()) == id) {
            existing = preserve_missing_fields(existing, row);
            save_catalog(catalog);
            return;
        }
    }
    rows->push_back(row);
    save_catalog(catalog);
}

bool Storage::remove_world(const std::string& id) {
    validate_world_id(id);
    Json catalog = load_catalog();
    if (catalog.is_null()) return false;
    Json* rows = nullptr;
    if (catalog.is_array()) rows = &catalog;
    else if (catalog.is_object() && catalog.contains("worlds") && catalog["worlds"].is_array()) rows = &catalog["worlds"];
    else throw std::runtime_error("native world catalogue has an unsupported shape");
    const bool found = std::any_of(rows->begin(), rows->end(), [&](const Json& row) {
        return row.is_object() && row.value("id", std::string()) == id;
    });
    if (!found) return false;
    // Write the tombstone first. If the catalogue commit fails, the original
    // save and archive remain intact, while imports and launcher reads cannot
    // make this world reappear.
    mark_world_deleted(id);
    for (auto it = rows->begin(); it != rows->end();) {
        if (it->is_object() && it->value("id", std::string()) == id) it = rows->erase(it);
        else ++it;
    }
    save_catalog(catalog);
    return true;
}

std::optional<Json> Storage::load_world(const std::string& id) const {
    const Json value = load_generation(world_base(id), true);
    if (value.is_null()) return std::nullopt;
    return value;
}

uint64_t Storage::save_world(const std::string& id, Json snapshot) {
    validate_world_id(id);
    if (!snapshot.is_object()) throw std::invalid_argument("world snapshot must be an object");
    const auto current = load_world(id);
    if (current && current->contains("schemaVersion") && current->at("schemaVersion").is_number_integer()) {
        const int64_t current_schema = current->at("schemaVersion").get<int64_t>();
        const int64_t incoming_schema = snapshot.value("schemaVersion", int64_t{0});
        if ((current_schema > NATIVE_WORLD_SCHEMA && incoming_schema < current_schema) ||
            (incoming_schema > 0 && incoming_schema < current_schema))
            throw std::runtime_error("refusing to overwrite a newer native world schema");
    }
    if (current) snapshot = preserve_missing_fields(*current, snapshot);
    // The migration record is an immutable recovery source. Callers can add
    // native subsystem snapshots without accidentally dropping it.
    if (current && current->contains("legacy")) {
        if (!snapshot.contains("legacy") || !snapshot["legacy"].is_object()) snapshot["legacy"] = (*current)["legacy"];
        else if ((*current)["legacy"].is_object()) {
            const Json& old_legacy = (*current)["legacy"];
            for (const char* key : {"raw", "envelope", "unified", "sourceKey", "saveKey", "saveSchema", "archive"})
                if (old_legacy.contains(key)) snapshot["legacy"][key] = old_legacy[key];
        }
    }
    return save_generation(world_base(id), snapshot);
}

LegacySaveEnvelope Storage::decode_legacy_envelope(const std::string& raw) {
    const Json envelope = Json::parse(raw);
    if (!envelope.is_object() || !envelope.contains("payload") || !envelope["payload"].is_string() ||
        !envelope.contains("checksum") || !envelope["checksum"].is_string())
        throw std::runtime_error("invalid legacy save envelope");
    const std::string payload = envelope["payload"].get<std::string>();
    if (js_checksum(payload) != envelope["checksum"].get<std::string>())
        throw std::runtime_error("legacy save checksum mismatch");
    if (envelope.contains("encoding") && !envelope["encoding"].is_null() &&
        (!envelope["encoding"].is_string() || envelope["encoding"] != "lz-string-utf16-v1"))
        throw std::runtime_error("unsupported legacy save encoding");
    std::string json = payload;
    if (envelope.contains("encoding") && !envelope["encoding"].is_null()) {
        const auto decoded = decompress_lz_utf16(payload);
        json = utf16_to_utf8(decoded);
        const auto expected = envelope.find("originalLength");
        if (expected == envelope.end() || !expected->is_number_integer() || expected->get<int64_t>() < 0 ||
            utf8_to_utf16(json).size() != static_cast<size_t>(expected->get<int64_t>()))
            throw std::runtime_error("legacy save decompressed length mismatch");
    }
    const Json value = Json::parse(json);
    if (!value.is_object() || value.value("schema", 0) != 1)
        throw std::runtime_error("unsupported legacy unified save schema");
    if (!envelope.contains("sequence") || !envelope["sequence"].is_number_integer())
        throw std::runtime_error("invalid legacy save sequence");
    const int64_t sequence = envelope["sequence"].get<int64_t>();
    if (sequence < 0 || sequence > 9007199254740991LL) throw std::runtime_error("invalid legacy save sequence");
    const Json player = value.value("player", Json());
    for (const char* key : {"x", "y", "z", "hp"})
        if (!finite_number(player, key)) throw std::runtime_error("invalid legacy player save fields");
    return {static_cast<uint64_t>(sequence), value, envelope};
}

std::string Storage::legacy_save_key(const Json& row) {
    if (!row.is_object()) throw std::invalid_argument("world row must be an object");
    const std::string id = row.value("id", std::string());
    const std::string type = row.value("type", std::string());
    validate_world_id(id);
    if (id == "default") return "feral.world.v1";
    if (id == "beta") return "feral.machine.v1";
    (void)type;
    return "feral.slot." + id;
}

ImportReport Storage::import_legacy_export(const Json& export_data) {
    if (!export_data.is_object()) throw std::invalid_argument("legacy export must be an object");
    ImportReport report;
    const Json local = local_storage_map(export_data);
    const Json vault = vault_rows_map(export_data);
    const Json vault_container = export_data.value("vault", Json::object());
    Json meta = vault.value("@meta", Json());
    if (meta.is_null() && vault_container.is_object() && vault_container.contains("meta")) meta = vault_container["meta"];
    const std::string local_stamp_raw = local.value("feral.vault.v1", std::string());
    Json local_stamp;
    if (!local_stamp_raw.empty()) { try { local_stamp = Json::parse(local_stamp_raw); } catch (...) {} }
    const bool has_meta = meta.is_object() && saved_at(meta).has_value();
    const bool local_has_data = has_legacy_payload(local);
    const bool vault_has_data = has_legacy_payload(vault);
    const auto meta_time = saved_at(meta);
    const auto stamp_time = saved_at(local_stamp);
    report.used_vault = has_meta && vault_has_data &&
        (!local_has_data || (stamp_time && meta_time && *meta_time > *stamp_time));
    const Json selected = report.used_vault ? vault : local;

    const std::string archive_text = export_data.dump(2);
    const std::string archive_hash = byte_checksum(archive_text);
    const auto archive_rel = std::filesystem::path("legacy") / "imports" / (archive_hash + ".json");
    const auto archive_full = root_ / archive_rel;
    if (!std::filesystem::exists(archive_full)) {
        atomic_write(archive_full, archive_text, true);
        report.archived = std::filesystem::exists(archive_full);
    } else {
        report.archived = read_json_file(archive_full) == export_data;
        if (!report.archived) throw std::runtime_error("legacy archive checksum collision or corruption");
    }
    if (!report.archived) throw std::runtime_error("failed to preserve legacy WebView export");
    report.archive_path = archive_rel;

    for (auto it = local.begin(); it != local.end(); ++it) report.preserved_keys.push_back(it.key());
    for (auto it = vault.begin(); it != vault.end(); ++it) if (it.key() != "@meta") report.preserved_keys.push_back(it.key());

    if (load_settings().is_null()) {
        Json preferences = {{"schemaVersion", NATIVE_WORLD_SCHEMA}};
        Json unknown_keys = Json::object();
        for (auto it = selected.begin(); it != selected.end(); ++it) {
            if (it.key() == "feral.settings" || it.key() == "feral.ui.layout.v1" ||
                it.key() == "feral.worlds.v1" || it.key() == "feral.vault.v1" ||
                it.key() == "feral.world.v1" || it.key() == "feral.world.v1.a" || it.key() == "feral.world.v1.b" ||
                it.key() == "feral.machine.v1" || it.key() == "feral.machine.v1.a" || it.key() == "feral.machine.v1.b" ||
                starts_with(it.key(), "feral.slot.")) continue;
            unknown_keys[it.key()] = it.value();
        }
        const auto settings_it = selected.find("feral.settings");
        if (settings_it != selected.end() && settings_it->is_string()) {
            try { preferences["settings"] = Json::parse(settings_it->get<std::string>()); }
            catch (...) { preferences["settings"] = Json::object(); }
        } else preferences["settings"] = Json::object();
        const auto layout_it = selected.find("feral.ui.layout.v1");
        if (layout_it != selected.end() && layout_it->is_string()) {
            try { preferences["uiLayout"] = Json::parse(layout_it->get<std::string>()); }
            catch (...) { preferences["uiLayout"] = Json::object(); }
        } else preferences["uiLayout"] = Json::object();
        Json raw_source = Json::object();
        if (settings_it != selected.end()) raw_source["settingsRaw"] = settings_it.value();
        if (layout_it != selected.end()) raw_source["uiLayoutRaw"] = layout_it.value();
        const bool has_unknown_keys = !unknown_keys.empty();
        raw_source["unknownKeys"] = std::move(unknown_keys);
        raw_source["archive"] = archive_rel.generic_string();
        preferences["legacy"] = std::move(raw_source);
        if ((settings_it != selected.end() || layout_it != selected.end() || has_unknown_keys) && load_settings().is_null())
            save_settings(preferences);
    }

    Json catalog;
    Json catalog_rows;
    bool catalog_valid = false;
    const auto cat = selected.find("feral.worlds.v1");
    if (cat != selected.end() && cat->is_string()) {
        try {
            catalog = Json::parse(cat->get<std::string>());
            if (catalog.is_array()) { catalog_valid = true; catalog_rows = catalog; }
            else if (catalog.is_object() && catalog.contains("worlds") && catalog["worlds"].is_array()) {
                catalog_valid = true; catalog_rows = catalog["worlds"];
            }
            else report.warnings.push_back("legacy world catalogue has an unsupported shape; its exact source is archived");
        } catch (const std::exception&) {
            report.warnings.push_back("legacy world catalogue is unreadable; its exact source is archived");
        }
    }
    if (!catalog_valid) {
        Json fallback_rows = Json::array();
        for (const Json& row : default_catalog_rows()) fallback_rows.push_back(row);
        catalog_rows = fallback_rows;
        // The synthetic catalogue is used only to associate known legacy save
        // keys. It is not persisted as if it were the user's saved catalogue.
    }
    const std::set<std::string> deleted_ids = deleted_world_ids();
    std::vector<Json> rows;
    for (const Json& row : catalog_rows) {
        if (row.is_object() && row.contains("id") && row["id"].is_string() &&
            row.contains("type") && row["type"].is_string() && row.contains("seed")) rows.push_back(row);
    }
    std::map<std::string, std::string> blocked;
    std::vector<std::string> source_world_ids;
    auto block_world = [&](const std::string& id, const std::string& warning) {
        if (load_world(id)) return;
        blocked[id] = warning;
        report.warnings.push_back("world " + id + " is blocked: " + warning);
    };
    bool found_legacy_world_save = false;
    for (Json row : rows) {
        std::string id;
        try { id = row["id"].get<std::string>(); validate_world_id(id); }
        catch (...) { report.warnings.push_back("world catalogue contains an invalid id; source retained"); continue; }
        if (deleted_ids.count(id)) {
            report.warnings.push_back("world " + id + " was previously deleted; source remains in the immutable archive");
            continue;
        }
        std::string save_key;
        try { save_key = legacy_save_key(row); }
        catch (...) { continue; }
        Json config;
        try { config = default_world_config(row); }
        catch (const std::exception& e) { report.warnings.push_back("world " + id + " configuration kept for review: " + e.what()); config = row.value("config", Json::object()); }

        source_world_ids.push_back(id);
        bool found_invalid_generation = false;
        std::string invalid_generation_reason;
        std::vector<std::pair<std::string, LegacySaveEnvelope>> generations;
        for (const char slot : {'a', 'b'}) {
            const std::string key = save_key + "." + slot;
            const auto raw_it = selected.find(key);
            if (raw_it == selected.end() || !raw_it->is_string()) continue;
            try { generations.emplace_back(key, decode_legacy_envelope(raw_it->get<std::string>())); }
            catch (const std::exception& e) {
                found_invalid_generation = true;
                invalid_generation_reason = e.what();
                report.warnings.push_back("ignored invalid legacy generation " + key + ": " + e.what());
            }
        }
        if (!generations.empty() || found_invalid_generation) found_legacy_world_save = true;
        if (!generations.empty()) {
            const auto best = std::max_element(generations.begin(), generations.end(), [](const auto& a, const auto& b) {
                return a.second.sequence < b.second.sequence;
            });
            const auto raw_it = selected.find(best->first);
            LegacyWorldImport imported;
            imported.world_id = id;
            imported.save_key = save_key;
            imported.source_key = best->first;
            imported.sequence = best->second.sequence;
            imported.config = config;
            imported.state = best->second.value;
            const int save_schema = meta.is_object() && meta.value("schema", 0) > 0 ? meta.value("schema", 0) : 4;
            imported.native_state = native_state(id, config, save_key, best->first, raw_it->get<std::string>(),
                best->second.sequence, best->second.envelope, best->second.value, save_schema, archive_rel);
            if (!load_world(id)) {
                save_world(id, imported.native_state);
                report.imported_worlds.push_back(id);
            }
            continue;
        }

        const auto direct_it = selected.find(save_key);
        if (direct_it == selected.end() || !direct_it->is_string()) {
            if (found_invalid_generation) block_world(id, "invalid_save_envelope: " + invalid_generation_reason);
            continue;
        }
        found_legacy_world_save = true;
        try {
            const std::string raw = direct_it->get<std::string>();
            const Json state = Json::parse(raw);
            if (!state.is_object()) throw std::runtime_error("legacy save is not an object");
            Json old_envelope = Json::object();
            uint64_t sequence = 0;
            const int save_schema = meta.is_object() && meta.value("schema", 0) > 0 ? meta.value("schema", 0) : 0;
            Json native = native_state(id, config, save_key, save_key, raw, sequence, old_envelope, state, save_schema, archive_rel);
            if (!load_world(id)) {
                save_world(id, native);
                report.imported_worlds.push_back(id);
            }
        } catch (const std::exception& e) {
            report.warnings.push_back("legacy save " + save_key + " was preserved but not loaded: " + e.what());
            block_world(id, "invalid_legacy_save: " + std::string(e.what()));
        }
    }

    auto apply_import_flags = [&](Json& destination) {
        Json* destination_rows = nullptr;
        if (destination.is_array()) destination_rows = &destination;
        else if (destination.is_object() && destination.contains("worlds") && destination["worlds"].is_array())
            destination_rows = &destination["worlds"];
        if (!destination_rows) return false;
        bool changed = false;
        for (auto item_it = destination_rows->begin(); item_it != destination_rows->end();) {
            Json& item = *item_it;
            if (item.is_object() && item.contains("id") && item["id"].is_string() &&
                deleted_ids.count(item["id"].get<std::string>())) {
                item_it = destination_rows->erase(item_it);
                changed = true;
                continue;
            }
            if (!item.is_object() || !item.contains("id") || !item["id"].is_string()) {
                ++item_it;
                continue;
            }
            const std::string id = item["id"].get<std::string>();
            const auto blocked_it = blocked.find(id);
            if (blocked_it != blocked.end()) {
                if (!item.contains("legacyImportBlocked") || item["legacyImportBlocked"] != true ||
                    item.value("legacyImportWarning", std::string()) != blocked_it->second) changed = true;
                item["legacyImportBlocked"] = true;
                item["legacyImportWarning"] = blocked_it->second;
            } else if (std::find(source_world_ids.begin(), source_world_ids.end(), id) != source_world_ids.end() &&
                       item.value("legacyImportBlocked", false) == true) {
                item["legacyImportBlocked"] = false;
                item["legacyImportWarning"] = "";
                changed = true;
            }
            ++item_it;
        }
        return changed;
    };

    // Defaults above are only a lookup aid for old implicit save keys. Do not
    // materialize them on a fresh install where the export contains no saved
    // world data. If we did import or block a real legacy save, persist the
    // fallback rows so that the imported world remains reachable.
    const bool have_legacy_world_data = found_legacy_world_save || !blocked.empty() || !report.imported_worlds.empty();
    if (catalog_valid || have_legacy_world_data) {
        Json current_catalog = load_catalog();
        if (current_catalog.is_null()) {
            Json to_save = catalog_valid ? catalog : Json::array();
            if (!catalog_valid) for (Json& row : rows) to_save.push_back(row);
            apply_import_flags(to_save);
            save_catalog(to_save);
            report.catalog_imported = catalog_valid;
        } else if (apply_import_flags(current_catalog)) {
            // On retry, update only the recovery marker in matching native rows.
            // The user's current catalogue and every unrelated field stay put.
            save_catalog(current_catalog);
        }
    }

    Json status = {
        {"statusVersion", 1}, {"archived", true}, {"complete", false},
        {"archive", archive_rel.generic_string()}, {"sourceHash", archive_hash},
        {"usedVault", report.used_vault}, {"importedWorlds", report.imported_worlds},
        {"blockedWorlds", Json::array()}, {"warnings", report.warnings}
    };
    for (const auto& entry : blocked) {
        report.blocked_worlds.push_back(entry.first);
        status["blockedWorlds"].push_back({{"id", entry.first}, {"warning", entry.second}});
    }
    const Json previous_status = legacy_import_status();
    if (previous_status.is_object() && previous_status.value("complete", false) == true &&
        previous_status.value("sourceHash", std::string()) == archive_hash && blocked.empty()) status["complete"] = true;
    save_generation(migration_status_base(), status);
    return report;
}

} // namespace feral
