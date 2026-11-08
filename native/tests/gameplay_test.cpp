#include "gameplay.hpp"

#include <cassert>
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace feral;

namespace {

Content load_content() {
    Content content;
    std::ifstream catalog("native/data/content.json");
    std::ifstream assets("native/data/assets.json");
    if (!catalog || !assets) throw std::runtime_error("gameplay tests need exported native content and assets");
    catalog >> content.data;
    assets >> content.assets;
    content.index();
    return content;
}

void require(bool value, const std::string& message) {
    if (!value) throw std::runtime_error(message);
}

bool contains(const Json& values, const std::string& expected) {
    if (!values.is_array()) return false;
    return std::any_of(values.begin(), values.end(), [&](const Json& value) {
        return value.is_string() && value.get<std::string>() == expected;
    });
}

Json invoke(Gameplay& game, const std::string& command, Json args = Json::object()) {
    Json result = game.command(command, std::move(args));
    require(result.contains("ok"), command + " must return an ok field");
    return result;
}

void catalog_and_search_contract(const Content& content) {
    Gameplay game(content);
    const Json view = game.view();
    require(view.value("catalogCount", 0) == 380, "native view must retain the complete authored progression catalog");
    require(view["catalogByKind"]["recipes"].size() == 145, "all recipes must be visible");
    require(view["catalogByKind"]["research"].size() == 39, "all research entries must be visible");
    Json page = invoke(game, "progression.list", {{"kind", "research"}, {"query", "observation"}, {"offset", 0}, {"limit", 20}});
    require(page["rows"].size() == 1 && page["rows"][0]["id"] == "observation", "searchable catalog list must filter by ID");
    require(page["total"] == 39, "catalog pagination must expose the unfiltered kind total");
}

void discovery_without_active_research_job_is_safe(const Content& content) {
    Gameplay game(content);
    const Json result = invoke(game, "research.discover", {
        {"blueprintId", "blueprint:observation"}, {"origin", "discovery"}, {"claim", "test:observation-discovery"}
    });
    require(result.value("ok", false), "simulation blueprint discovery must handle an empty research job slot");
    require(contains(game.save()["progression"]["research"], "observation"),
            "discovery should unlock its authored research entry");
}

void new_world_initialization_is_exact_and_one_shot(const Content& content) {
    Gameplay game(content);
    game.configure({{"terrain", {{"generator", "frontier"}}}, {"rules", {{"starterKit", true}}}});
    Json first = game.initialize_new_world();
    require(first.value("ok", false) && first.value("granted", false), "new frontier world should receive its authored starter kit");
    require(game.count("stone_pick") == 1 && game.count("raw_timber") == 4 && game.count("loose_stone") == 4 && game.count("seed") == 4,
            "starter kit must exactly match the browser runtime without extra grants");
    Json repeated = game.initialize_new_world();
    require(repeated.value("ok", false) && repeated.value("duplicate", false), "new-world initialization must be idempotent");
    require(game.count("stone_pick") == 1 && game.count("raw_timber") == 4, "repeated initialization must not duplicate the kit");

    Gameplay restored(content);
    restored.load(game.save());
    require(restored.initialize_new_world().value("duplicate", false), "saved initialization receipt must survive reload");
    require(restored.count("seed") == 4, "reload must preserve the original starter kit");

    Gameplay existing(content);
    existing.configure({{"rules", {{"starterKit", true}}}});
    existing.load(Json::object());
    require(existing.initialize_new_world().value("reason", std::string()) == "world_already_initialized",
            "loading an existing save, even an empty legacy object, must never grant new-world items");
    require(existing.count("stone_pick") == 0, "existing world must remain without an unsolicited kit");
}

void ten_tier_gear_recipes_use_real_commands(const Content& content) {
    // This command-path test starts from a valid mid-campaign save fixture so it
    // can cover all authored gear recipes without faking recipe completion.
    // Inputs are reserved by craft.queue, work advances through Gameplay::tick,
    // outputs come from the authored recipe, and every tier uses equipment.equip.
    Gameplay seed(content);
    Json state = seed.save();
    Json& progression = state["progression"];
    progression["research"] = Json::array();
    for (const auto& row : content.data["progression"]["entries"]) if (row.value("kind", std::string()) == "research") progression["research"].push_back(row["id"]);
    progression["inventory"] = Json::object();
    progression["stations"] = Json::object();
    for (int tier = 1; tier <= 10; ++tier) {
        const std::string recipe_id = "make_gear_baseline_t" + std::to_string(tier);
        const Json& recipe = content.find(recipe_id);
        require(!recipe.empty() && recipe.value("kind", std::string()) == "recipe", "each gear tier must have an authored craft recipe");
        for (const auto& item : recipe["inputs"].items())
            progression["inventory"][item.key()] = progression["inventory"].value(item.key(), Json(0.0)).get<double>() + item.value().get<double>();
        if (recipe.value("station", std::string("hand")) != "hand") progression["stations"][recipe["station"].get<std::string>()] = 1;
    }
    Gameplay game(content);
    game.load(state);
    for (int tier = 1; tier <= 10; ++tier) {
        const std::string recipe_id = "make_gear_baseline_t" + std::to_string(tier);
        const std::string gear_id = "gear_baseline_t" + std::to_string(tier);
        const Json& recipe = content.find(recipe_id);
        require(invoke(game, "progression.recipe_status", {{"id", recipe_id}}).value("ok", false), "tier recipe should report available with its authored gates satisfied");
        Json before = Json::object();
        for (const auto& item : recipe["inputs"].items()) before[item.key()] = game.count(item.key());
        Json queued = invoke(game, "craft.queue", {{"recipeId", recipe_id}, {"count", 1}});
        require(queued.value("ok", false), "tier recipe should enter the native work queue");
        for (const auto& item : recipe["inputs"].items())
            require(std::abs(game.count(item.key()) - (before[item.key()].get<double>() - item.value().get<double>())) < 1e-7,
                    "tier recipe must reserve each authored ingredient before work begins");
        game.tick(recipe.value("seconds", 0.0));
        require(game.count(gear_id) == 1, "completed tier recipe must yield the requested gear item");
        Json equipped = invoke(game, "equipment.equip", {{"id", gear_id}});
        require(equipped.value("ok", false) && equipped["loadout"].value("tier", 0) == tier,
                "each crafted tier must equip with matching authored loadout tier");
        if (tier == 5) {
            Gameplay restored(content);
            restored.load(game.save());
            require(restored.view()["progression"]["equipped"] == gear_id && restored.count(gear_id) == 1,
                    "mid-path save/reload must preserve the active tier and crafted item");
        }
    }
}

void atomic_grants_research_and_crafting(const Content& content) {
    Gameplay empty(content);
    require(invoke(empty, "research.start", {{"id", "observation"}}).value("reason", std::string()) == "samples_required",
            "research should not start before its authored samples are paid");
    Gameplay game(content);
    Json grant = game.grant({{"raw_timber", 1}, {"loose_stone", 1}}, "test:research-samples");
    require(grant.value("ok", false), "starter research samples should be grantable by an authorized test receipt");
    require(game.grant({{"raw_timber", 1}, {"loose_stone", 1}}, "test:research-samples").value("duplicate", false), "grant receipt must be idempotent");
    require(game.count("raw_timber") == 1 && game.count("loose_stone") == 1, "duplicate grant must not duplicate inventory");
    require(invoke(game, "research.start", {{"id", "observation"}}).value("ok", false), "observation should start after paying its exact samples");
    game.tick(10.0);
    require(contains(game.view()["progression"]["research"], "observation"), "research should complete from work time");
    require(invoke(game, "research.start", {{"id", "material:wood"}}).value("reason", std::string()) == "prerequisite_required", "unmet research prerequisites should remain an explicit gate");

    require(game.grant({{"raw_timber", 1}, {"plant_fiber", 1}}, "test:cup-inputs").value("ok", false), "craft inputs should be grantable");
    Json queued = invoke(game, "craft.queue", {{"recipeId", "make_bark_cup"}, {"count", 1}});
    require(queued.value("ok", false) && game.count("raw_timber") == 0 && game.count("plant_fiber") == 0, "queue must reserve inputs before work begins");
    game.tick(10.0);
    require(game.count("bark_cup") == 1, "finished craft should put authored outputs in inventory");
}

void payment_rollback_and_reward_wallet(const Content& content) {
    Gameplay game(content);
    require(game.grant({{"raw_timber", 5}}, "test:wallet-timber").value("ok", false), "wallet seed item grant should succeed");
    require(game.grant_resources(Json::object(), {{"divine", 4}}, 0, "test:wallet-energy").value("ok", false), "wallet seed energy should succeed");
    require(invoke(game, "simulation.reward", {{"items", {{"relic", 2}, {"knowledge", 3}, {"food", 1}}}, {"claim", "test:wallet-reward"}}).value("ok", false), "frontier reward should convert relic and knowledge to native wallet entries");
    const double timber = game.count("raw_timber"), divine = game.view()["progression"]["energy"]["amounts"]["divine"].get<double>();
    const double work = game.view()["campaign"]["workCredits"].get<double>();
    const double cores = game.view()["campaign"]["cores"].get<double>();
    Json failed = invoke(game, "simulation.pay", {{"items", {{"wood", 2}}}, {"energy", {{"divine", 5}}}, {"workCredits", 1}, {"cores", 3}, {"claim", "test:must-rollback"}});
    require(!failed.value("ok", true), "one insufficient payment leg must reject the whole wallet debit");
    require(game.count("raw_timber") == timber, "failed multi-currency payment must not debit items");
    require(game.view()["progression"]["energy"]["amounts"]["divine"] == divine, "failed payment must not debit energy");
    require(game.view()["campaign"]["workCredits"] == work && game.view()["campaign"]["cores"] == cores, "failed payment must not debit work or relic cores");
    Json paid = invoke(game, "simulation.pay", {{"items", {{"wood", 2}}}, {"energy", {{"divine", 1}}}, {"workCredits", 5}, {"cores", 1}, {"claim", "test:wallet-paid"}});
    require(paid.value("ok", false), "wallet debit should succeed when every account covers the cost");
    require(invoke(game, "simulation.pay", {{"items", {{"wood", 2}}}, {"energy", {{"divine", 1}}}, {"workCredits", 5}, {"cores", 1}, {"claim", "test:wallet-paid"}}).value("duplicate", false), "wallet debits need idempotent claim receipts");
}

void energy_capacity_and_failure_atomicity(const Content& content) {
    Gameplay game(content);
    require(game.grant({{"battery", 1}}, "test:battery").value("ok", false), "battery can be granted for an isolated progression fixture");
    Json saved = game.save();
    saved["progression"]["research"].push_back("power");
    saved["progression"]["stations"]["field_bench"] = 1;
    Gameplay powered(content);
    powered.load(saved);
    Json placed = invoke(powered, "components.place", {{"id", "battery"}, {"scale", 1}});
    require(placed.value("ok", false), "researched component assembly should consume its real item");
    Json stored = invoke(powered, "energy.store", {{"type", "electrical"}, {"amount", 300}});
    require(stored.value("ok", false) && std::abs(powered.view()["progression"]["energy"]["amounts"]["electrical"].get<double>() - 270) < 1e-7,
            "catalogued battery capacity and 90% electrical storage efficiency should govern stored energy");
    Json failed = invoke(powered, "energy.consume", {{"type", "electrical"}, {"amount", 300}, {"claim", "test:too-much-energy"}});
    require(!failed.value("ok", true), "energy consumption over the store must fail");
    require(std::abs(powered.view()["progression"]["energy"]["amounts"]["electrical"].get<double>() - 270) < 1e-7,
            "failed energy payment must leave the account unchanged");
    Json worn = invoke(powered, "components.condition", {{"instanceId", placed["instanceId"]}, {"health", .5}});
    require(worn.value("ok", false), "component condition update should be accepted");
    require(std::abs(powered.view()["progression"]["energy"]["amounts"]["electrical"].get<double>() - 200) < 1e-7,
            "lost component capacity must dissipate only the excess energy");
}

void legacy_energy_source_controls_are_reachable(const Content& content) {
    Gameplay game(content);
    require(game.grant({{"raw_timber", 1}}, "test:fire-fuel").value("ok", false), "abstract fire source should use real inventory fuel");
    Json active = invoke(game, "source.active", {{"id", "wood_fire"}, {"active", true}});
    require(active.value("ok", false), "non-fixture progression needs a command to toggle authored abstract energy sources");
    require(game.view()["progression"]["activeSources"]["wood_fire"] == true, "source toggle must appear in the progression view");
    game.tick(.2);
    require(game.view()["progression"]["energy"]["metrics"]["generated"]["thermal"].get<double>() > 0,
            "enabled wood fire must consume actual fuel and generate authored thermal energy");
    require(game.view()["progression"]["sourceFuel"]["wood_fire"].get<double>() < 20,
            "source fuel duration must be saved and consumed during work ticks");
    require(invoke(game, "source.active", {{"id", "ambient_mana"}, {"active", true}}).value("reason", std::string()) == "component_required",
            "required-component energy sources must stay gated by an assembled condenser");
}

void stored_energy_reaches_a_physical_craft_consumer(const Content& content) {
    Gameplay seed(content);
    Json state = seed.save();
    Json& progression = state["progression"];
    progression["research"] = Json::array({"power", "inertia", "material:steel", "material:inertial_alloy"});
    progression["inventory"] = {{"battery",1},{"inertial_cell",1},{"physics_station_t6",1},
        {"steel",2},{"nickel",1},{"scrap_iron",1},{"wood",1}};
    progression["energy"]["electrical"] = 200.0;
    progression["energy"]["mechanical"] = 500.0;
    Gameplay game(content);
    game.load(state);
    Json battery = invoke(game, "placement.place", {{"assetId","battery"},{"position",{{"x",-3.0},{"y",1.0},{"z",0.0}}},{"worldContext",{{"supported",true}}}});
    Json inertia = invoke(game, "placement.place", {{"assetId","inertial_cell"},{"position",{{"x",3.0},{"y",1.0},{"z",0.0}}},{"worldContext",{{"supported",true}}}});
    Json bench = invoke(game, "placement.place", {{"assetId","physics_station_t6"},{"position",{{"x",0.0},{"y",1.0},{"z",0.0}}},{"worldContext",{{"supported",true}}}});
    require(battery.value("ok",false)&&inertia.value("ok",false)&&bench.value("ok",false), "physical stores and a powered craft station should place from real inventory items");
    const std::string battery_id=battery["id"].get<std::string>(), inertia_id=inertia["id"].get<std::string>(), bench_id=bench["id"].get<std::string>();
    require(invoke(game,"placement.access",{{"position",{{"x",0.0},{"y",1.0},{"z",0.0}}},{"communityStations",Json::array()}}).value("ok",false),
            "player access synchronization should make the physical consumers reachable");
    require(game.view()["progression"]["energy"]["fixtures"]["enabled"].get<bool>(), "placing world fixtures must enable physical energy logistics");
    require(invoke(game,"energy.charge",{{"ownerId",battery_id},{"type","electrical"},{"amount",200.0},{"fromLegacyEscrow",true},{"claim","test:charge-battery"}}).value("ok",false),
            "battery should receive pre-existing electrical escrow through the real charge command");
    require(invoke(game,"energy.charge",{{"ownerId",inertia_id},{"type","mechanical"},{"amount",500.0},{"fromLegacyEscrow",true},{"claim","test:charge-inertia"}}).value("ok",false),
            "inertial cell should receive pre-existing mechanical escrow through the real charge command");
    require(invoke(game,"energy.link",{{"from",battery_id},{"to",bench_id},{"type","electrical"},{"claim","test:electrical-link"}}).value("ok",false),
            "electrical storage should link to the station's authored input port");
    Json mechanical_link=invoke(game,"energy.link",{{"from",inertia_id},{"to",bench_id},{"type","mechanical"},{"claim","test:mechanical-link"}});
    require(mechanical_link.value("ok",false), "mechanical storage should link to the station's authored input port: "+mechanical_link.dump());
    Json queued=invoke(game,"craft.queue",{{"recipeId","make_inertial_alloy"},{"fixtureId",bench_id}});
    require(queued.value("ok",false), "physical station should reserve inputs for its powered recipe");
    game.tick(100.0);
    require(game.count("inertial_alloy")==1 && game.view()["progression"]["jobs"].empty(),
            "the physical consumer should complete after drawing energy from both finite storage nodes");
    const Json energy_metrics=game.view()["progression"]["energy"]["fixtures"]["metrics"]["consumed"];
    require(std::abs(energy_metrics["electrical"].get<double>()-200.0)<1e-4 &&
            std::abs(energy_metrics["mechanical"].get<double>()-500.0)<1e-4,
            "storage-to-consumer flow must account for exact recipe energy without JSON numeric append errors: "+energy_metrics.dump());
}

void custom_weapon_progression_and_roundtrip(const Content& content) {
    Gameplay seed(content);
    Json state = seed.save();
    state["futureGameplayField"] = {{"mustSurvive", true}};
    state["progression"]["inventory"] = {{"wood", 2}, {"plant_fiber", 1}};
    state["progression"]["research"] = Json::array({"material:wood"});
    state["progression"]["stations"]["field_bench"] = 1;
    Gameplay game(content);
    game.load(state);
    Json quote = invoke(game, "weapon.quote", {{"patternId", "weapon_slash"}, {"materialId", "wood"}});
    require(quote.value("ok", false) && quote["hitDamage"].get<double>() > 0 && quote["inputs"]["wood"] == .65,
            "weapon quote should combine the chosen material volume with pattern-specific inputs and authored tier stats");
    Json forged = invoke(game, "weapon.forge", {{"patternId", "weapon_slash"}, {"materialId", "wood"}});
    require(forged.value("ok", false), "weapon forge should atomically reserve its material and create a timed job");
    game.tick(25.0);
    Json equipped = invoke(game, "weapon.equip", {{"id", forged["outputId"]}});
    require(equipped.value("ok", false), "completed personal weapon should be equipable");
    const Json attack = game.held_attack();
    require(attack["assetId"] == "weapon_slash" && attack["profileId"] == "sword", "held attack data should expose the weapon shape and action profile to the native adapter");
    Json hit = invoke(game, "weapon.attack", {{"distanceM", 1.0}, {"at", 25.0}, {"claim", "test:weapon-hit"}});
    require(hit.value("ok", false) && hit["durability"] == attack["durability"].get<int>() - 1, "confirmed hit should wear exactly one durability point");
    Json duplicate = invoke(game, "weapon.attack", {{"distanceM", 1.0}, {"at", 25.0}, {"claim", "test:weapon-hit"}});
    require(duplicate.value("duplicate", false) && duplicate["durability"] == hit["durability"], "attack receipt replay must not wear the weapon twice");
    Json snapshot = game.save();
    Gameplay restored(content);
    restored.load(snapshot);
    require(restored.count("wood") == game.count("wood") && restored.view()["armaments"]["weapons"].size() == 1,
            "save/reload must retain inventory and crafted weapon records");
    require(restored.save()["futureGameplayField"]["mustSurvive"] == true, "unknown save fields must remain lossless across native writes");
}

void survival_death_cache_and_faith_records(const Content& content) {
    Gameplay game(content);
    game.configure({{"rules", {{"survival", true}, {"dropOnDeath", true}}}});
    require(game.grant({{"food", 1}, {"raw_timber", 1}}, "test:death-inventory").value("ok", false), "death-cache inputs should exist");
    game.set_player_state({{"position", {{"x", 1.0}, {"y", 2.0}, {"z", 3.0}}}, {"x",1.0},{"y",2.0},{"z",3.0}});
    Json death = game.record_event({{"type", "player_damage"}, {"amount", 200}, {"source", "test"}});
    require(death.value("ok", false) && death.value("dead", false) && game.count("food") == 0,
            "lethal damage in survival must make a death cache and drop carried items");
    require(invoke(game, "player.respawn", {{"position", {{"x",1.0},{"y",2.0},{"z",3.0}}}}).value("ok", false), "death recovery command should restore a live player");
    game.tick(.1);
    require(game.count("food") == 1 && game.view()["deaths"][0]["recovered"] == true, "nearby recovery should return cache contents and persist its completion");

    Gameplay faithful(content);
    faithful.configure({{"rules", {{"survival", true}, {"dropOnDeath", false}}}});
    faithful.set_player_state({{"position", {{"x",0.0},{"y",0.0},{"z",0.0}}},{"x",0.0},{"y",0.0},{"z",0.0}});
    require(invoke(faithful, "inventory.grant", {{"items", {{"food",4},{"wood",2}}}, {"claim", "test:faith-supplies"}}).value("ok", false), "faith supplies should be granted through the inventory API");
    require(invoke(faithful, "faith.sync_shrines", {{"shrines", Json::array({{{"instanceId","shrine:test"},{"templateId","communal_archive"},{"position",{{"x",0.0},{"y",0.0},{"z",0.0}}}}})}}).value("ok", false), "faith shrine context should validate");
    require(faithful.view()["faith"]["shrines"].size() == 1 && faithful.view()["faith"]["shrines"][0]["instanceId"] == "shrine:test",
            "faith status view must expose live shrine IDs for target selection");
    require(invoke(faithful, "faith.interact", {{"instanceId","shrine:test"},{"actionId","faith:join"}}).value("ok", false), "faith membership should be optional and functional");
    require(invoke(faithful, "faith.interact", {{"instanceId","shrine:test"},{"actionId","faith:accept:provisions"}}).value("ok", false), "quest should be explicitly accepted");
    require(invoke(faithful, "faith.interact", {{"instanceId","shrine:test"},{"actionId","faith:deliver:provisions"}}).value("ok", false), "delivery quest should atomically debit its specified inputs");
    require(invoke(faithful, "faith.interact", {{"instanceId","shrine:test"},{"actionId","faith:claim:provisions"}}).value("ok", false), "ready quest should grant its authored divine-energy reward");
    require(faithful.command("energy.status")["energy"]["divine"] == 10, "faith reward should share the actual divine energy account");
}

void placed_dynamic_fixture_bridge(const Content& content) {
    Gameplay game(content);
    require(game.grant({{"field_bench", 1}}, "test:fixture-place").value("ok", false), "field bench item should be available for placement test");
    Json placed = invoke(game, "placement.place", {{"assetId", "field_bench"}, {"position", {{"x", 1.0}, {"y", 2.0}, {"z", 3.0}}},
        {"worldContext", {{"supported", true}}}});
    require(placed.value("ok", false), "supported authored station should become a fixture record");
    const std::string id = placed["id"].get<std::string>();
    const uint64_t before_dynamic = game.placement_geometry_revision();
    require(invoke(game, "placement.mark_dynamic", {{"id", id}}).value("ok", false), "support loss should switch a fixture to dynamic mode");
    const uint64_t geometry_revision = game.placement_geometry_revision();
    require(geometry_revision == before_dynamic + 1, "dynamic mode must invalidate geometry once");
    Json bodies = game.dynamic_fixtures();
    require(bodies.size() == 1 && bodies[0]["id"] == id && bodies[0]["massKg"].get<double>() > 0 && !bodies[0]["boxes"].empty(),
            "dynamic body bridge must expose authored compound boxes and recipe-derived material mass");
    const int row_revision = game.fixtures()[0].value("revision", 0);
    Json feedback = game.sync_fixture_body(id, {{"position", {{"x", 2.0}, {"y", 2.5}, {"z", 3.0}}},
        {"rotation", {{"x", 0.0}, {"y", 0.0}, {"z", 0.0}, {"w", 1.0}}},
        {"velocity", {{"x", 1.0}, {"y", 0.0}, {"z", 0.0}}}, {"settled", false}});
    require(feedback.value("ok", false), "physics pose feedback should be accepted for dynamic fixtures");
    require(game.placement_geometry_revision() == geometry_revision && game.fixtures()[0].value("revision", 0) == row_revision,
            "pose feedback must not trigger geometry or render mesh rebuild revisions");
    require(game.fixtures()[0]["position"]["x"] == 2.0 && game.dynamic_fixtures()[0]["velocity"]["x"] == 1.0,
            "dynamic fixture pose and velocity must persist in gameplay state");
    Gameplay restored(content);
    restored.load(game.save());
    require(restored.placement_geometry_revision() == geometry_revision && restored.dynamic_fixtures().size() == 1,
            "dynamic fixture geometry revision and body state must survive save/reload");
}

void destroyed_fixtures_fall_and_every_placeable_has_physics_mass(const Content& content) {
    Gameplay game(content);
    require(game.grant({{"field_bench", 1}}, "test:destroyed-fixture").value("ok", false), "fixture item grant should succeed");
    Json placed = invoke(game, "placement.place", {{"assetId", "field_bench"}, {"position", {{"x", 0.0}, {"y", 1.0}, {"z", 0.0}}},
        {"worldContext", {{"supported", true}}}});
    require(placed.value("ok", false), "fixture must be placeable before testing its destruction path");
    const auto before = game.placement_geometry_revision();
    Json broken = invoke(game, "placement.damage", {{"id", placed["id"]}, {"amount", 1e6}});
    require(broken.value("ok", false) && broken.value("broken", false), "lethal fixture damage should be recorded");
    require(game.placement_geometry_revision() == before + 1 && game.fixtures()[0]["motion"]["mode"] == "dynamic",
            "destroyed fixed fixture must immediately transition to a dynamic physics body");

    Json state = Gameplay(content).save();
    Json fixtures = Json::array(); int serial = 1;
    for (const auto& asset : content.data["progression"]["entries"]) {
        const std::string kind = asset.value("kind", std::string());
        if (kind != "station" && kind != "component") continue;
        fixtures.push_back({{"id", "fixture:" + std::to_string(serial)}, {"assetId", asset.value("id", std::string())}, {"kind", kind},
            {"position", {{"x", double(serial * 20)}, {"y", 0.0}, {"z", 0.0}}}, {"hp", 10.0}, {"maxHp", 10.0}, {"revision", 1},
            {"motion", {{"mode", "dynamic"}, {"rotation", {{"x", 0.0}, {"y", 0.0}, {"z", 0.0}, {"w", 1.0}}},
                {"velocity", {{"x", 0.0}, {"y", 0.0}, {"z", 0.0}}}, {"angularVelocity", {{"x", 0.0}, {"y", 0.0}, {"z", 0.0}}}, {"settled", false}}}});
        ++serial;
    }
    state["placements"]["fixtures"] = fixtures;
    state["placements"]["nextId"] = serial;
    state["placements"]["geometryRevision"] = 1;
    Gameplay all_assets(content); all_assets.load(state);
    const Json bodies = all_assets.dynamic_fixtures();
    require(bodies.size() == fixtures.size() && bodies.size() == 41, "every authored station/component must have a physics descriptor");
    for (const auto& body : bodies) {
        require(body.value("massKg", 0.0) > 0 && body.value("boxes", Json::array()).size() > 0,
                "each placeable asset needs positive recipe mass and a nonempty compound collider");
        for (const auto& box : body["boxes"]) require(box.value("solid", false) && box.value("massKg", 0.0) > 0,
                "dynamic fixture boxes must expose solid collision and distributed mass");
    }
}

} // namespace

int main() {
    const Content content = load_content();
    catalog_and_search_contract(content);
    discovery_without_active_research_job_is_safe(content);
    new_world_initialization_is_exact_and_one_shot(content);
    ten_tier_gear_recipes_use_real_commands(content);
    atomic_grants_research_and_crafting(content);
    payment_rollback_and_reward_wallet(content);
    energy_capacity_and_failure_atomicity(content);
    legacy_energy_source_controls_are_reachable(content);
    stored_energy_reaches_a_physical_craft_consumer(content);
    custom_weapon_progression_and_roundtrip(content);
    survival_death_cache_and_faith_records(content);
    placed_dynamic_fixture_bridge(content);
    destroyed_fixtures_fall_and_every_placeable_has_physics_mass(content);
    std::cout << "gameplay native tests passed\n";
}
