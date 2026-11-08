#include "gameplay.hpp"
#include "simulation.hpp"
#include "world.hpp"

#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace feral;

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

Json read_json(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("simulation tests need exported native data: " + path);
    return Json::parse(file);
}

Content load_content() {
    Content content;
    content.data = read_json("native/data/content.json");
    content.data["runtimeModules"] = read_json("native/data/modules.json");
    content.assets = read_json("native/data/assets.json");
    content.index();
    return content;
}

Json make_config(const std::string& generator, Json modules = Json::array()) {
    return Json{{"schemaVersion", 1}, {"seed", "63026"},
        {"terrain", {{"generator", generator}}}, {"modules", std::move(modules)},
        {"rules", {{"survival", true}}}};
}

double number(const Json& value, const std::string& key, double fallback = 0.0) {
    if (!value.is_object() || !value.contains(key) || !value[key].is_number()) return fallback;
    return value[key].get<double>();
}

bool near(double a, double b, double epsilon = 1e-6) {
    return std::abs(a - b) <= epsilon;
}

Json invoke(Simulation& simulation, const std::string& name, Json args,
            World& world, Gameplay& gameplay) {
    Json result = simulation.command(name, std::move(args), world, gameplay);
    require(result.contains("ok"), name + " must return an ok field");
    return result;
}

const EntityPose& creature_pose(const Simulation& simulation, const std::string& id) {
    for (const EntityPose& pose : simulation.poses())
        if (pose.id == id && pose.kind == "creature") return pose;
    throw std::runtime_error("creature root pose missing: " + id);
}

bool intersects(Vec3 a_center, Vec3 a_size, Vec3 b_center, Vec3 b_size) {
    return std::abs(a_center.x - b_center.x) < (a_size.x + b_size.x) * .5 &&
           std::abs(a_center.y - b_center.y) < (a_size.y + b_size.y) * .5 &&
           std::abs(a_center.z - b_center.z) < (a_size.z + b_size.z) * .5;
}

Vec3 vector3(const Json& value) {
    if (value.is_array() && value.size() >= 3)
        return {value[0].get<double>(), value[1].get<double>(), value[2].get<double>()};
    if (value.is_object())
        return {number(value, "x"), number(value, "y"), number(value, "z")};
    return {};
}

Json vec_json(Vec3 value) { return Json::array({value.x, value.y, value.z}); }

Json damage_for(const std::string& id, const std::string& mode, Json cut,
                Vec3 local_point, Vec3 local_direction) {
    Json args{{"id", id}, {"partId", "head"}, {"amount", 20}, {"mode", mode},
        {"localPoint", vec_json(local_point)}, {"localDirection", vec_json(local_direction)}};
    if (!cut.is_null()) args["cuts"] = Json::array({std::move(cut)});
    return args;
}

Json fresh_cut(Vec3 center, Vec3 size = {.0625, .0625, .0625}) {
    return Json::array({center.x, center.y, center.z, size.x, size.y, size.z});
}

struct HeadCuts {
    Json shell_only;
    Json overlapping_bone;
    Vec3 bone_center;
    Vec3 bone_size;
};

HeadCuts find_head_cuts(const Content& content, const Json& geometry) {
    const Json& asset = content.asset("moss_deer");
    Json head;
    for (const Json& part : asset.at("parts"))
        if (part.value("id", std::string()) == "head") head = part;
    require(!head.empty() && head.at("boxes").is_array(), "moss deer head must have authored skin boxes");

    std::vector<std::pair<Vec3, Vec3>> bones;
    for (const Json& bone : geometry.at("boneBoxes"))
        if (bone.value("partId", std::string()) == "head")
            bones.emplace_back(vector3(bone.at("center")), vector3(bone.at("size")));
    require(!bones.empty(), "moss deer head anatomy must expose bone boxes");

    const Vec3 cut_size{.0625, .0625, .0625};
    Json exposed;
    for (const Json& skin : head.at("boxes")) {
        const Vec3 center = vector3(skin.at("center")), size = vector3(skin.at("size"));
        const Vec3 lo = center - size * .5, hi = center + size * .5;
        for (double x = std::ceil(lo.x / .03125) * .03125; x + cut_size.x * .5 <= hi.x + 1e-9; x += .03125) {
            for (double y = std::ceil(lo.y / .03125) * .03125; y + cut_size.y * .5 <= hi.y + 1e-9; y += .03125) {
                for (double z = std::ceil(lo.z / .03125) * .03125; z + cut_size.z * .5 <= hi.z + 1e-9; z += .03125) {
                    const Vec3 candidate{x, y, z};
                    bool bone_hit = false;
                    for (const auto& bone : bones)
                        bone_hit = bone_hit || intersects(candidate, cut_size, bone.first, bone.second);
                    if (!bone_hit) { exposed = fresh_cut(candidate); break; }
                }
                if (!exposed.is_null()) break;
            }
            if (!exposed.is_null()) break;
        }
        if (!exposed.is_null()) break;
    }
    require(!exposed.is_null(), "must find a head skin cut that misses every head bone box");

    const auto bone = bones.front();
    bool bone_overlap = false;
    for (const Json& skin : head.at("boxes"))
        bone_overlap = bone_overlap || intersects(bone.first, bone.second,
            vector3(skin.at("center")), vector3(skin.at("size")));
    require(bone_overlap, "head bone box must intersect authored head skin");
    return {exposed, fresh_cut(bone.first), bone.first, bone.second};
}

const Json& damage_part(const Json& result, const std::string& part) {
    for (const Json& row : result.at("structuralDamage"))
        if (row.value("partId", std::string()) == part) return row;
    throw std::runtime_error("expected structural damage for " + part + ": " + result.dump());
}

double sum_box_volume(const Json& boxes) {
    double total = 0;
    if (!boxes.is_array()) return total;
    for (const Json& box : boxes) {
        const Vec3 size = vector3(box.at("size"));
        total += size.x * size.y * size.z;
    }
    return total;
}

void creature_strike_geometry_and_reentry(const Content& content) {
    const Json config = make_config("infinite");
    World world(content); world.configure(config);
    Gameplay gameplay(content); gameplay.configure(config);
    Simulation simulation(content); simulation.configure(config);
    const Vec3 player{0, world.surface_height(0, 0), 0};

    const Json spawned = invoke(simulation, "creature.spawn", {{"id", "creature:test:shell"},
        {"speciesId", "moss_deer"}, {"position", vec_json({0, 10, 0})}}, world, gameplay);
    require(spawned.value("ok", false), "moss deer should spawn through Simulation");
    invoke(simulation, "creature.spawn", {{"id", "creature:test:slash"}, {"speciesId", "moss_deer"},
        {"position", vec_json({4, 10, 0})}}, world, gameplay);
    invoke(simulation, "creature.spawn", {{"id", "creature:test:pierce"}, {"speciesId", "moss_deer"},
        {"position", vec_json({8, 10, 0})}}, world, gameplay);
    invoke(simulation, "creature.spawn", {{"id", "creature:test:impact"}, {"speciesId", "moss_deer"},
        {"position", vec_json({12, 10, 0})}}, world, gameplay);
    invoke(simulation, "creature.spawn", {{"id", "creature:test:air"}, {"speciesId", "moss_deer"},
        {"position", vec_json({16, 10, 0})}}, world, gameplay);
    simulation.tick(0, player, world, gameplay);

    const HeadCuts cuts = find_head_cuts(content, *creature_pose(simulation, "creature:test:shell").anatomy_geometry);
    const Json shell_hit = invoke(simulation, "creature.damage", damage_for("creature:test:shell", "slash",
        cuts.shell_only, {}, {0, 0, 1}), world, gameplay);
    require(shell_hit.value("ok", false) && shell_hit.at("structuralDamage").size() == 1,
            "a slash through head skin away from bone should hit shell only");
    require(damage_part(shell_hit, "shell").value("damage", 0.0) > 0,
            "exposed head cut should reduce shell structure");

    simulation.tick(0, player, world, gameplay);
    const EntityPose& wounded_pose = creature_pose(simulation, "creature:test:shell");
    const auto wounded_geometry = wounded_pose.anatomy_geometry;
    require(wounded_geometry && wounded_pose.animation.value("woundRevision", 0) == 1,
            "wound revision and immutable geometry must update after a slash");
    const double original_volume = [&]() {
        for (const Json& part : content.asset("moss_deer").at("parts"))
            if (part.value("id", std::string()) == "head") return sum_box_volume(part.at("boxes"));
        return 0.0;
    }();
    require(sum_box_volume(wounded_geometry->at("partBoxes").at("head")) < original_volume - 1e-9,
            "slash wound must remove the exact authored geometry from the head skin");
    simulation.tick(0, player, world, gameplay);
    require(creature_pose(simulation, "creature:test:shell").anatomy_geometry == wounded_geometry,
            "unchanged wound geometry should keep the same shared immutable snapshot while visible");

    const Json slash_bone = invoke(simulation, "creature.damage", damage_for("creature:test:slash", "slash",
        cuts.overlapping_bone, cuts.bone_center, {0, 0, 1}), world, gameplay);
    require(slash_bone.value("ok", false) && slash_bone.at("structuralDamage").size() == 2,
            "slash intersecting head bone should damage shell and bone");
    const double slash_shell = damage_part(slash_bone, "shell").value("damage", 0.0);
    const double slash_head = damage_part(slash_bone, "head").value("damage", 0.0);
    require(slash_shell > 0 && slash_head > 0 && near(slash_shell / (slash_shell + slash_head), .5),
            "bone-overlapping slash should split structural damage equally");

    const Vec3 pierce_direction{0, 0, 1};
    const Vec3 pierce_origin{cuts.bone_center.x, cuts.bone_center.y,
        cuts.bone_center.z - cuts.bone_size.z * .5 - .15};
    const Json pierce = invoke(simulation, "creature.damage", damage_for("creature:test:pierce", "pierce",
        fresh_cut(pierce_origin, {.0625, .0625, .3}), pierce_origin, pierce_direction), world, gameplay);
    require(pierce.value("ok", false) && pierce.at("structuralDamage").size() == 2,
            "piercing from just outside the head bone should reach shell and bone");
    const double pierce_shell = damage_part(pierce, "shell").value("damage", 0.0);
    const double pierce_head = damage_part(pierce, "head").value("damage", 0.0);
    require(pierce_shell > 0 && pierce_head > 0 && near(pierce_shell / (pierce_shell + pierce_head), .3),
            "pierce should allocate 30 percent to shell and 70 percent to bone");

    const Vec3 impact_origin{cuts.bone_center.x, cuts.bone_center.y,
        cuts.bone_center.z - cuts.bone_size.z * .5 - .15};
    const Json impact = invoke(simulation, "creature.damage", damage_for("creature:test:impact", "impact",
        Json(), impact_origin, {0, 0, 1}), world, gameplay);
    require(impact.value("ok", false) && impact.at("structuralDamage").size() == 1 &&
            damage_part(impact, "head").value("damage", 0.0) > 0,
            "impact ray that crosses the head bone should damage that bone only");
    const Json impact_state = simulation.view().at("creatures").at("creature:test:impact");
    require(impact_state.at("wounds").empty(), "impact attacks must not create slash/pierce skin wounds");

    const Json air_impact = invoke(simulation, "creature.damage", damage_for("creature:test:air", "impact",
        Json(), {1, 1, 1}, {0, 0, 1}), world, gameplay);
    require(air_impact.value("ok", false) && air_impact.at("structuralDamage").empty(),
            "impact in empty space must not damage a logical bone without a geometric hit");

    simulation.tick(0, player, world, gameplay);
    const Json saved = simulation.save();
    Simulation restored(content); restored.configure(config); restored.load(saved);
    restored.tick(0, player, world, gameplay);
    const EntityPose& restored_pose = creature_pose(restored, "creature:test:shell");
    const auto restored_geometry = restored_pose.anatomy_geometry;
    require(restored_pose.anatomy_geometry && restored_pose.anatomy_geometry->at("partBoxes") ==
            wounded_geometry->at("partBoxes"),
            "saved living creature wound must rebuild the same remaining collision/render geometry after re-entry");
    require(restored_pose.animation.value("woundRevision", 0) == 1,
            "wound geometry revision must survive a Simulation save/load");
    restored.tick(0, player, world, gameplay);
    require(creature_pose(restored, "creature:test:shell").anatomy_geometry == restored_geometry,
            "re-entered wound geometry should again reuse its shared immutable pointer");
}

void machine_field_and_real_energy_flow(const Content& content) {
    const Json config = make_config("machine-field", Json::array({"machine-field"}));
    World world(content); world.configure(config);
    Gameplay gameplay(content); gameplay.configure(config);
    Simulation simulation(content); simulation.configure(config);
    const Vec3 player{0, world.surface_height(0, 0), 0};
    simulation.tick(0, player, world, gameplay);

    const Json inventory = gameplay.view().at("progression").at("inventory");
    for (const auto& [id, amount] : std::vector<std::pair<std::string, double>>{
             {"wood", 640}, {"scrap_iron", 256}, {"raw_timber", 64},
             {"heat_engine", 1}, {"transmission", 4}, {"controller", 1}})
        require(near(number(inventory, id), amount), "machine-field must grant its exact authored kit item " + id);
    const Json research = gameplay.view().at("progression").at("research");
    auto has_research = [&](const std::string& id) {
        return research.is_array() && std::find(research.begin(), research.end(), Json(id)) != research.end();
    };
    require(has_research("power") && has_research("mechanisms"),
            "machine-field must unlock the engine and transmission/controller research receipts");

    std::string example_id;
    const Json initial_simulation_view = simulation.view();
    for (const auto& [id, machine] : initial_simulation_view.at("machines").items())
        if (machine.value("fieldExample", false)) { require(example_id.empty(), "machine-field should create one example"); example_id = id; }
    require(!example_id.empty(), "machine-field must create a runnable authored example machine");
    const Json example = simulation.view().at("machines").at(example_id);
    bool has_engine = false, has_controller = false, has_wheels = false;
    int wheel_count = 0;
    std::string engine_id;
    for (const Json& component : example.at("components")) {
        const std::string component_id = component.value("componentId", std::string());
        if (component_id == "heat_engine") { has_engine = true; engine_id = component.value("id", std::string());
            require(component.value("fuelItems", 0) == 8, "field example starts with its authored eight fuel items"); }
        if (component_id == "controller") has_controller = true;
        if (component_id == "transmission" && component.value("legacyType", std::string()) == "wheel") ++wheel_count;
    }
    has_wheels = wheel_count == 4;
    require(has_engine && has_controller && has_wheels,
            "example must contain an engine, live controller and four actual wheel transmissions");
    require(simulation.save().at("modules").at("machine-field").value("equipped", false),
            "successful field kit transaction must persist its equipped receipt");

    const Json game_before_reload = gameplay.save();
    const Json sim_before_reload = simulation.save();
    const double fuel_before_reload = number(simulation.view().at("machines").at(example_id).at("metrics"), "generated");
    World restored_world(content); restored_world.configure(config);
    Gameplay restored_gameplay(content); restored_gameplay.configure(config); restored_gameplay.load(game_before_reload);
    Simulation restored_simulation(content); restored_simulation.configure(config); restored_simulation.load(sim_before_reload);
    restored_simulation.tick(0, player, restored_world, restored_gameplay);
    require(restored_gameplay.view().at("progression").at("inventory") == game_before_reload.at("progression").at("inventory"),
            "re-entering a saved field must not grant the machine kit again");
    int examples = 0;
    const Json restored_initial_view = restored_simulation.view();
    for (const auto& [id, machine] : restored_initial_view.at("machines").items())
        if (machine.value("fieldExample", false)) ++examples;
    require(examples == 1 && restored_simulation.save().at("modules").at("machine-field").value("equipped", false),
            "machine-field example and one-time module receipt must survive save/reload");
    require(near(number(restored_simulation.view().at("machines").at(example_id).at("metrics"), "generated"), fuel_before_reload),
            "save/reload must retain accumulated fuel/energy metrics");

    Json throttle = invoke(restored_simulation, "machine.control", {{"id", example_id}, {"throttle", 1.0}},
                           restored_world, restored_gameplay);
    require(throttle.value("ok", false), "machine controller must accept throttle through the native command path");
    restored_simulation.tick(1.0, player, restored_world, restored_gameplay);
    const Json machine_after = restored_simulation.view().at("machines").at(example_id);
    const Json metrics = machine_after.at("metrics");
    require(number(metrics, "generated") > fuel_before_reload &&
            near(number(metrics, "generated"), number(metrics, "consumed") + number(metrics, "loss"), 1e-5),
            "heat-engine fuel must account for every generated energy unit as useful work or loss");
    require(!restored_simulation.pending_forces().empty(), "powered machine should emit real force commands");
    double drive_force = 0;
    for (const ForceCommand& force : restored_simulation.pending_forces())
        if (force.body_id == example_id && force.source == "machine-drive") drive_force += force.force_newtons.length();
    require(drive_force > 1, "fuel and mounted transmissions should produce positive machine-drive force");
    const Json engine = *std::find_if(machine_after.at("components").begin(), machine_after.at("components").end(),
        [&](const Json& row) { return row.value("id", std::string()) == engine_id; });
    require(engine.value("fuelItems", 8) < 8 && number(engine, "fuel") < 400,
            "running example must consume its saved fuel items instead of creating energy");

    Json empty_energy = restored_simulation.save();
    Json& saved_machine = empty_energy["machines"]["machines"];
    bool zeroed = false;
    for (Json& row : saved_machine) if (row.value("id", std::string()) == example_id) {
        for (Json& component : row["components"]) if (component.value("id", std::string()) == engine_id) {
            component["fuel"] = 0; component["fuelItems"] = 0; zeroed = true;
        }
        row["metrics"] = {{"generated", 0}, {"consumed", 0}, {"loss", 0}};
        row["velocity"] = vec_json({});
    }
    require(zeroed, "machine save should expose the fuel state under its subsystem envelope");
    Simulation empty_machine(content); empty_machine.configure(config); empty_machine.load(empty_energy);
    Gameplay empty_game(content); empty_game.configure(config); empty_game.load(restored_gameplay.save());
    invoke(empty_machine, "machine.control", {{"id", example_id}, {"throttle", 1.0}}, restored_world, empty_game);
    empty_machine.tick(.1, player, restored_world, empty_game);
    const Json depleted = empty_machine.view().at("machines").at(example_id);
    require(near(number(depleted.at("metrics"), "generated"), 0) && near(number(depleted, "lastPower"), 0),
            "an engine with no fuel or stored energy must not generate machine power");

    // A controller must drive the actual steering force path once the body is moving.
    const auto& body = restored_simulation.machine_bodies().at(example_id);
    require(restored_simulation.sync_machine_body(example_id, body.position, body.rotation, {0, 0, -2}, {}),
            "field example body must accept physics feedback");
    invoke(restored_simulation, "machine.control", {{"id", example_id}, {"throttle", 1.0}, {"steer", 1.0}},
           restored_world, restored_gameplay);
    restored_simulation.tick(.1, player, restored_world, restored_gameplay);
    bool steering = false;
    for (const ForceCommand& force : restored_simulation.pending_forces())
        steering = steering || (force.body_id == example_id && force.source == "machine-steering");
    require(steering, "mounted controller and ground wheels should generate real steering forces");
}

std::string component_instance(const Json& machine, const std::string& component_id) {
    for (const Json& row : machine.at("components"))
        if (row.value("componentId", std::string()) == component_id)
            return row.value("id", std::string());
    throw std::runtime_error("missing machine component instance " + component_id);
}

Json simple_machine_design(const std::string& second_component, Json links = Json::array(), int engine_fuel_items = 0) {
    return Json{{"name", "atomic design validation"}, {"gridM", .5},
        {"position", Json::array({0, 10, 0})},
        {"voxels", Json::array({
            Json{{"cell", Json::array({0, 0, 0})}, {"materialId", "wood"}},
            Json{{"cell", Json::array({1, 0, 0})}, {"materialId", "wood"}}
        })},
        {"components", Json::array({
            Json{{"cell", Json::array({0, 0, 0})}, {"componentId", "heat_engine"}, {"fuelItems", engine_fuel_items}},
            Json{{"cell", Json::array({1, 0, 0})}, {"componentId", second_component}}
        })}, {"links", std::move(links)}};
}

void machine_design_failures_do_not_debit_inventory(const Content& content) {
    const Json config = make_config("infinite");
    World world(content); world.configure(config);
    Gameplay gameplay(content); gameplay.configure(config);
    Simulation simulation(content); simulation.configure(config);
    require(gameplay.grant({{"wood", 300}, {"heat_engine", 1}, {"motor", 1}},
        "test:machine-invalid-design-stock").value("ok", false),
        "invalid design fixture should have enough material/component inventory");
    require(gameplay.count("wood") >= 250, "invalid-link test must have enough wood to pay if the link were valid");
    const Json before_invalid_link = gameplay.view().at("progression").at("inventory");
    const Json bad_link = simple_machine_design("motor", Json::array({
        Json{{"from", 0}, {"to", 1}, {"type", "mechanical"}}
    }));
    const Json rejected_link = invoke(simulation, "machine.create", bad_link, world, gameplay);
    require(!rejected_link.value("ok", true) && rejected_link.value("reason", std::string()) == "invalid_design_link",
            "incompatible energy link should reject the whole machine design before payment");
    require(gameplay.view().at("progression").at("inventory") == before_invalid_link,
            "invalid energy link must not consume voxel materials or either component");

    Gameplay insufficient(content); insufficient.configure(config);
    require(insufficient.grant({{"wood", 300}, {"heat_engine", 1}},
        "test:machine-insufficient-stock").value("ok", false),
        "insufficient-component fixture should grant all costs except the second component");
    require(insufficient.count("wood") >= 250 && insufficient.count("heat_engine") == 1 && insufficient.count("controller") == 0,
            "insufficient-component fixture must isolate only the missing controller");
    const Json before_insufficient = insufficient.view().at("progression").at("inventory");
    const Json missing_mount = simple_machine_design("controller");
    const Json rejected_mount = invoke(simulation, "machine.create", missing_mount, world, insufficient);
    require(!rejected_mount.value("ok", true) && rejected_mount.value("reason", std::string()) == "insufficient_or_unknown_item",
            "missing mounted component should reject an otherwise valid assembly atomically");
    require(insufficient.view().at("progression").at("inventory") == before_insufficient,
            "insufficient component payment must leave already-affordable wood and engine inventory untouched");

    Gameplay fueled(content); fueled.configure(config);
    require(fueled.grant({{"wood", 300}, {"raw_timber", 3}, {"heat_engine", 1}, {"controller", 1}},
        "test:machine-fuel-stock").value("ok", false),
        "fuel transaction fixture should have enough wood, timber and both mounted components");
    const Json before_fuel = fueled.view().at("progression").at("inventory");
    const Json fuelled_design = simple_machine_design("controller", Json::array(), 3);
    const Json built = invoke(simulation, "machine.create", fuelled_design, world, fueled);
    require(built.value("ok", false), "valid engine design with prepaid fuel should assemble: " + built.dump());
    const Json after_fuel = fueled.view().at("progression").at("inventory");
    require(near(number(before_fuel, "raw_timber") - number(after_fuel, "raw_timber"), 3) &&
            near(number(before_fuel, "wood") - number(after_fuel, "wood"), 250) &&
            near(number(before_fuel, "heat_engine") - number(after_fuel, "heat_engine"), 1) &&
            near(number(before_fuel, "controller") - number(after_fuel, "controller"), 1),
            "machine assembly must atomically debit fuel items, voxel material and mounted components");
    const Json built_machine = simulation.view().at("machines").at(built.at("machineId").get<std::string>());
    require(built_machine.at("components")[0].value("fuelItems", 0) == 3,
            "paid raw-timber fuel units must enter the assembled heat engine");

    Gameplay no_fuel(content); no_fuel.configure(config);
    require(no_fuel.grant({{"wood", 300}, {"heat_engine", 1}, {"controller", 1}},
        "test:machine-no-fuel-stock").value("ok", false),
        "fuel failure fixture should have every assembly cost except raw-timber fuel");
    const Json before_no_fuel = no_fuel.view().at("progression").at("inventory");
    const Json rejected_fuel = invoke(simulation, "machine.create", fuelled_design, world, no_fuel);
    require(!rejected_fuel.value("ok", true) && rejected_fuel.value("reason", std::string()) == "insufficient_or_unknown_item",
            "assembly must reject prepaid fuel if no raw timber is available");
    require(no_fuel.view().at("progression").at("inventory") == before_no_fuel,
            "missing prepaid fuel must not debit the otherwise affordable shell or components");
}

void fluid_and_cargo_mass_are_conserved(const Content& content) {
    const Json config = make_config("infinite");
    World world(content); world.configure(config);
    Gameplay gameplay(content); gameplay.configure(config);
    Simulation simulation(content); simulation.configure(config);
    require(gameplay.grant({{"liquid_mana", 5}, {"raw_timber", 4}}, "test:fluid-cargo").value("ok", false),
            "test fluids and cargo should enter through an authorized native grant receipt");

    Json voxels = Json::array();
    Json components = Json::array({
        Json{{"cell", {0, 0, 0}}, {"componentId", "heat_engine"}, {"fuelItems", 1}},
        Json{{"cell", {1, 0, 0}}, {"componentId", "pump"}},
        Json{{"cell", {2, 0, 0}}, {"componentId", "fluid_container"}},
        Json{{"cell", {3, 0, 0}}, {"componentId", "fluid_container"}}
    });
    for (int x = 0; x < 4; ++x)
        voxels.push_back(Json{{"cell", Json::array({x, 0, 0})}, {"materialId", "wood"}});
    const Json design{{"name", "fluid conservation test"}, {"gridM", .5},
        {"position", Json::array({0, 20, 0})}, {"voxels", voxels}, {"components", components},
        {"links", Json::array({Json{{"from", 0}, {"to", 1}, {"type", "mechanical"}}})}};
    const Json created = invoke(simulation, "machine.import_design", design, world, gameplay);
    require(created.value("ok", false), "native import path should assemble the pump test machine: " + created.dump());
    const std::string id = created.at("machineId").get<std::string>();
    Json machine = simulation.view().at("machines").at(id);
    const std::string pump = component_instance(machine, "pump");
    const std::string source = component_instance(machine, "fluid_container");
    std::string target;
    for (const Json& row : machine.at("components"))
        if (row.value("componentId", std::string()) == "fluid_container" && row.value("id", std::string()) != source)
            target = row.value("id", std::string());
    require(!target.empty(), "test machine must expose a second independent fluid container");

    require(invoke(simulation, "machine.fluid.fill", {{"id", id}, {"componentInstanceId", source},
        {"fluid", "liquid_mana"}, {"liters", 4.5}, {"claim", "test:fluid-fill"}}, world, gameplay).value("ok", false),
        "source container should fill from the real fluid inventory");
    require(invoke(simulation, "machine.fluid.connect", {{"id", id}, {"sourceComponentInstanceId", source},
        {"pumpComponentInstanceId", pump}, {"targetComponentInstanceId", target}}, world, gameplay).value("ok", false),
        "pump route should connect two distinct authored containers");
    machine = simulation.view().at("machines").at(id);
    const double before_fluid_mass = simulation.machine_bodies().at(id).mass_kg;
    simulation.tick(1, {0, 0, 0}, world, gameplay);
    machine = simulation.view().at("machines").at(id);
    const Json* source_row = nullptr; const Json* target_row = nullptr; const Json* engine_row = nullptr;
    for (const Json& row : machine.at("components")) {
        if (row.value("id", std::string()) == source) source_row = &row;
        if (row.value("id", std::string()) == target) target_row = &row;
        if (row.value("componentId", std::string()) == "heat_engine") engine_row = &row;
    }
    require(source_row && target_row && engine_row, "fluid route components must remain in the native assembly");
    const double source_liters = number(source_row->at("fluids"), "liquid_mana");
    const double target_liters = number(target_row->at("fluids"), "liquid_mana");
    require(target_liters > 0 && near(source_liters + target_liters, 4.5, 1e-5),
            "powered fluid link must transfer liquid without creating or deleting liters");
    const double fuel_mass_after = engine_row->value("fuelItems", 0) * .6 + number(*engine_row, "fuel") / 400.0 * .6;
    require(near(simulation.machine_bodies().at(id).mass_kg, before_fluid_mass - .6 + fuel_mass_after, 1e-5),
            "fluid transfer must preserve fluid mass while fuel burn updates machine mass");
    require(engine_row->value("fuelItems", 1) == 0 && number(*engine_row, "fuel") > 0,
            "pump operation must consume one actual heat-engine fuel item");

    const double base_mass = simulation.machine_bodies().at(id).mass_kg;
    require(invoke(simulation, "machine.cargo.load", {{"id", id}, {"items", {{"raw_timber", 3}}},
        {"claim", "test:cargo-load"}}, world, gameplay).value("ok", false),
        "machine should load cargo through Gameplay's real inventory debit");
    const double loaded_mass = simulation.machine_bodies().at(id).mass_kg;
    require(near(loaded_mass - base_mass, 3 * number(content.find("raw_timber").value("properties", Json::object()), "densityKgM3") / 1000.0, 1e-5) ||
            near(loaded_mass - base_mass, 3 * number(content.find("raw_timber"), "massKgPerUnit"), 1e-5),
            "machine body mass must include authored cargo item mass");
    require(invoke(simulation, "machine.cargo.unload", {{"id", id}, {"items", {{"raw_timber", 3}}},
        {"claim", "test:cargo-unload"}}, world, gameplay).value("ok", false),
        "machine should unload cargo through Gameplay's real inventory credit");
    require(near(simulation.machine_bodies().at(id).mass_kg, base_mass, 1e-6),
            "unloading cargo must restore the previous machine mass");
    require(near(gameplay.count("raw_timber"), 4), "cargo load/unload should preserve the player's item balance");
}

void first_signal_harvest_and_travel(const Content& content) {
    const Json config = make_config("frontier", Json::array({"first-signal"}));
    World world(content); world.configure(config);
    Gameplay gameplay(content); gameplay.configure(config);
    Simulation simulation(content); simulation.configure(config);
    const double camp_y = world.surface_height(77.5, 84.5);
    simulation.set_player_state({{"position", {{"x", 77.5}, {"y", camp_y}, {"z", 84.5}}}});
    simulation.tick(0, {77.5, camp_y, 84.5}, world, gameplay);
    Json signal = simulation.save().at("modules").at("first-signal");
    require(signal.value("supplied", false), "first-signal module must initialize its one-time start supplies");
    require(gameplay.count("food") == 10 && gameplay.count("plant_fiber") == 6 &&
            gameplay.count("raw_timber") == 8 && gameplay.count("loose_stone") == 8 &&
            gameplay.count("mana_crystal_ore") == 2,
            "camp initialization must map and grant the exact authored first-signal supplies once");

    const double berry_y = world.surface_height(74, 87);
    simulation.set_player_state({{"position", {{"x", 74}, {"y", berry_y}, {"z", 87}}}});
    const Json harvested = invoke(simulation, "first_signal.harvest", {{"siteId", "berry:0"}}, world, gameplay);
    require(harvested.value("ok", false), "player at the camp berry site should be able to harvest: " + harvested.dump());
    require(number(simulation.save().at("modules").at("first-signal").at("journey"), "harvests") == 1,
            "successful camp harvest should advance first-signal journey progress");

    const Json travel = invoke(simulation, "first_signal.travel", {{"dx", 1}, {"dz", 0}}, world, gameplay);
    require(travel.value("ok", false), "player at camp should be able to travel to adjacent generated region: " + travel.dump());
    signal = simulation.save().at("modules").at("first-signal");
    require(signal.value("x", -1) == 1 && signal.value("z", -1) == 0,
            "first-signal travel must update its persistent region coordinates");
    require(number(travel.at("position"), "x") >= 320 && number(travel.at("position"), "x") < 400,
            "travel command must move the actual player to the destination camp");
    require(gameplay.count("food") == 9 && gameplay.count("berry") == 3 && gameplay.count("seed") == 1,
            "harvest reward and travel food debit must both reach native Gameplay inventory");

    simulation.set_player_state({{"position", travel.at("position")}});
    simulation.tick(0, vector3(travel.at("position")), world, gameplay);
    signal = simulation.save().at("modules").at("first-signal");
    require(signal.at("regions").contains("1,0"), "travelled-to region state must initialize and persist on arrival");
    const Json saved = simulation.save();
    Simulation restored(content); restored.configure(config); restored.load(saved);
    restored.set_player_state({{"position", travel.at("position")}});
    restored.tick(0, vector3(travel.at("position")), world, gameplay);
    require(restored.save().at("modules").at("first-signal").at("journey").value("harvests", 0) == 1 &&
            restored.save().at("modules").at("first-signal").value("x", -1) == 1,
            "harvest count and travel region must survive Simulation save/reload and re-entry");
}

} // namespace

int main() {
    try {
        const Content content = load_content();
        machine_field_and_real_energy_flow(content);
        machine_design_failures_do_not_debit_inventory(content);
        fluid_and_cargo_mass_are_conserved(content);
        creature_strike_geometry_and_reentry(content);
        first_signal_harvest_and_travel(content);
        std::cout << "native simulation integration checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "native simulation integration check failed: " << error.what() << '\n';
        return 1;
    }
}
