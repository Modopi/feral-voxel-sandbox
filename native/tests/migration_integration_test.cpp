#include "gameplay.hpp"
#include "simulation.hpp"
#include "storage.hpp"
#include "world.hpp"

#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

using namespace feral;

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

Json read_json(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("missing JSON fixture or content: " + path.string());
    return Json::parse(file);
}

std::filesystem::path temporary_root() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::filesystem::temp_directory_path() / ("feral-migration-integration-" + std::to_string(now));
}

bool near(double actual, double expected, double epsilon = 1e-7) {
    return std::abs(actual - expected) <= epsilon;
}

void verify_world(const Content& content, Storage& storage, const Json& fixture,
                  const std::string& world_id, const std::string& expected_generator,
                  const Json& original_archive) {
    const auto stored = storage.load_world(world_id);
    require(stored.has_value(), world_id + " native migration record should load");
    require(stored->at("legacy").at("unified").at("schema") == 1,
            world_id + " should expose the decoded runtime snapshot to subsystem loaders");

    const Json& legacy = stored->at("legacy");
    const std::string source_key = legacy.at("sourceKey").get<std::string>();
    std::string original_raw;
    for (const Json& row : fixture.at("vault").at("rows"))
        if (row.value("key", std::string()) == source_key) original_raw = row.at("value").get<std::string>();
    require(!original_raw.empty(), world_id + " source envelope should exist in the legacy export");
    require(legacy.at("raw") == original_raw, world_id + " exact compressed source envelope should remain retained");
    require(legacy.at("envelope").at("encoding") == "lz-string-utf16-v1",
            world_id + " should have been produced by the shipped compressed save path");
    require(legacy.at("unified") == Storage::decode_legacy_envelope(original_raw).value,
            world_id + " imported snapshot should match the decoded JavaScript payload exactly");
    require(original_archive.at("localStorage") == fixture.at("localStorage"),
            "the complete original localStorage map should remain archived");
    require(original_archive.at("vault").at("rows") == fixture.at("vault").at("rows"),
            "the complete original IndexedDB vault rows should remain archived");

    const Json unified = legacy.at("unified");
    const Json config = storage.world_config(world_id);
    World world(content);
    Gameplay gameplay(content);
    Simulation simulation(content);
    world.configure(config);
    gameplay.configure(config);
    simulation.configure(config);
    world.load(unified);
    gameplay.load(unified);
    simulation.load(unified);

    require(world.generator_id() == expected_generator,
            world_id + " native terrain generator should match its source preset");
    require(world.block({220, 120, 220}) == "plank",
            world_id + " atlas edit should be visible in the native world loader");
    require(world.block({200, 120, 200}).empty(),
            world_id + " explicit empty atlas edit should survive native loading");
    require(world.bodies().size() == 1,
            world_id + " detached physics object should enter the native World");
    const BodyState& object = world.bodies().begin()->second;
    require(near(object.position.x, 4.25) && near(object.position.y, 3.75) && near(object.position.z, 7.5),
            world_id + " detached object position should remain public native state");
    require(near(object.velocity.x, 1.25) && near(object.velocity.y, 2.5) && near(object.velocity.z, -0.75),
            world_id + " detached object velocity should remain public native state");
    require(near(object.angular_velocity.x, 0.1) && near(object.angular_velocity.y, -0.2) && near(object.angular_velocity.z, 0.3),
            world_id + " detached object angular velocity should remain public native state");
    require(near(object.rotation.y, std::sin(0.2)) && near(object.rotation.w, std::cos(0.2)),
            world_id + " detached object rotation should remain public native state");

    const auto gameplay_view_started = std::chrono::steady_clock::now();
    const Json gameplay_view = gameplay.view();
    const auto gameplay_view_elapsed = std::chrono::steady_clock::now() - gameplay_view_started;
    require(gameplay_view_elapsed < std::chrono::seconds(2),
            world_id + " native Gameplay view should stay responsive after save migration");
    std::cout << world_id << " Gameplay::view: "
              << std::chrono::duration<double, std::milli>(gameplay_view_elapsed).count() << " ms\n";
    const Json progression = gameplay_view.at("progression");
    require(progression.at("inventory").at("raw_timber").get<double>() >= 20,
            world_id + " seeded inventory should be visible to Gameplay");
    require(progression.at("research").is_array() &&
            std::find(progression.at("research").begin(), progression.at("research").end(), "observation") != progression.at("research").end(),
            world_id + " completed research should be visible to Gameplay");
    require(near(progression.at("researchProgress").at("joinery").at("work").get<double>(), 5.75) &&
            progression.at("researchJob").at("id") == "joinery",
            world_id + " paid partial research progress should be resumable");
    require(progression.at("jobs").size() == 1 && progression.at("jobs")[0].at("recipeId") == "cook_meat_food" &&
            near(progression.at("jobs")[0].at("status").at("progress").get<double>(), 2.75),
            world_id + " partial craft job should be visible to Gameplay");

    const std::string creature_id = "creature:migration-fixture:" + world_id;
    const Json sim_view = simulation.view();
    require(sim_view.at("creatures").contains(creature_id), world_id + " seeded creature should be visible to Simulation");
    const Json wounds = sim_view.at("creatures").at(creature_id).at("wounds");
    require(wounds.at("head").size() == 1 && near(wounds.at("head")[0][3].get<double>(), 0.08),
            world_id + " creature wound should survive as native simulation state");

    require(simulation.machine_bodies().size() == 1,
            world_id + " assembled machine should produce a native simulation body");
    const MachineBody& machine_body = simulation.machine_bodies().begin()->second;
    require(near(machine_body.position.x, 8) && near(machine_body.position.y, 12) && near(machine_body.position.z, 16),
            world_id + " machine position should remain visible native state");
    require(near(machine_body.velocity.x, 3.5) && near(machine_body.velocity.y, -0.5) && near(machine_body.velocity.z, 7),
            world_id + " machine linear velocity should remain visible native state");
    require(near(machine_body.angular_velocity.x, 0.15) && near(machine_body.angular_velocity.y, 0.25) && near(machine_body.angular_velocity.z, -0.35),
            world_id + " machine angular velocity should remain visible native state");
    require(machine_body.shapes.size() == 2, world_id + " machine voxels should rebuild from the saved assembly");
    require(sim_view.at("machines").at("machine:1").at("components").size() == 1,
            world_id + " mounted machine component should survive native loading");

    if (world_id == "frontier") {
        const Json gameplay_signal = gameplay_view.at("campaign").at("firstSignal");
        require(gameplay_signal.at("reputation")[0] == 17 && gameplay_signal.at("cores") == 2,
                "first-signal campaign progress should be visible to Gameplay");
        require(sim_view.at("firstSignal").at("reputation")[0] == 17 && sim_view.at("firstSignal").at("cores") == 2,
                "first-signal module progress should be visible to Simulation");
    }
    if (world_id == "beta")
        require(simulation.save().at("modules").at("machine-field").value("equipped", false),
                "machine-field module progress should survive native Simulation loading");

    // The same source envelope is an immutable recovery copy after native
    // subsystems produce their first saved snapshots.
    storage.save_world(world_id, Json{
        {"schemaVersion", 1}, {"config", config}, {"world", world.save()},
        {"gameplay", gameplay.save()}, {"simulation", simulation.save()}
    });
    const Json rewritten = *storage.load_world(world_id);
    require(rewritten.at("legacy").at("raw") == original_raw,
            world_id + " native save should retain the exact original WebView envelope");
    require(rewritten.at("legacy").at("unified") == unified,
            world_id + " native save should retain the exact decoded legacy snapshot");
}

void integration_import_and_resume() {
    const Json fixture = read_json("native/tests/fixtures/legacy-webview-runtime.json");
    const auto root = temporary_root();
    try {
        Content content;
        content.data = read_json("native/data/content.json");
        content.data["runtimeModules"] = read_json("native/data/modules.json");
        content.assets = read_json("native/data/assets.json");
        content.index();

        Storage storage(root);
        const ImportReport imported = storage.import_legacy_export(fixture);
        require(imported.archived && imported.used_vault, "migration should archive and select the latest WebView vault copy");
        require(imported.imported_worlds.size() == 4, "all four shipped launcher presets should import");
        require(imported.blocked_worlds.empty(), "valid runtime fixtures must not block any world");
        require(storage.list_worlds().size() == 4, "native catalogue should retain all four worlds");
        const Json archive = read_json(root / imported.archive_path);

        verify_world(content, storage, fixture, "default", "island", archive);
        verify_world(content, storage, fixture, "frontier", "frontier", archive);
        verify_world(content, storage, fixture, "beta", "machine-field", archive);
        verify_world(content, storage, fixture, "expedition_1", "infinite", archive);

        const Json settings = storage.load_settings();
        require(settings.at("settings").at("visualAnimation") == false,
                "global WebView settings should import alongside runtime saves");
        require(settings.at("uiLayout").at("migrationFixture") == true,
                "global UI layout should import alongside runtime saves");
        require(!storage.legacy_import_status().value("complete", false),
                "fixture import remains pending until the runtime explicitly marks native loader success");
        storage.mark_legacy_import_done();
        require(storage.legacy_import_status().value("complete", false),
                "migration completion should be persistent after the resume checks pass");
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
        integration_import_and_resume();
        std::cout << "native migration integration tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "native migration integration tests failed: " << error.what() << '\n';
        return 1;
    }
}
