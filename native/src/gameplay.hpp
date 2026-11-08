#pragma once

#include "common.hpp"

namespace feral {

// Authoritative, renderer-independent economy and progression state. The JSON
// backing store intentionally keeps authored catalog records and unknown save
// fields intact while the command surface remains a stable native API.
class Gameplay {
public:
    explicit Gameplay(const Content& content);

    void configure(Json config);
    void load(Json state);
    Json save() const;
    Json initialize_new_world();
    void tick(double dt);
    Json command(const std::string& name, Json args = Json::object());
    Json view() const;
    double count(const std::string& id) const;
    Json grant(Json items, std::string claim = "");
    Json spend(Json items, std::string claim = "");
    Json grant_resources(Json items, Json energy, double work_credits, std::string claim);
    bool has_claim(const std::string& claim) const;

    // Simulation bridge. It supplies authoritative positions and event facts;
    // gameplay records campaign evidence and never invents a world outcome.
    Json set_player_state(Json player);
    Json record_event(Json event);
    const Json& player_state() const;
    const Json& fixtures() const;
    Json dynamic_fixtures() const;
    Json sync_fixture_body(const std::string& id, Json pose);
    uint64_t placement_revision() const;
    uint64_t placement_geometry_revision() const;
    Json held_attack() const;
    Json drain_events();

private:
    const Content& content_;
    std::vector<Json> energy_source_catalog_;
    std::vector<Json> conversion_catalog_;
    std::vector<Json> recipe_catalog_;
    Json config_ = Json::object();
    Json state_ = Json::object();
    Json progression_ = Json::object();
    Json placements_ = Json::object();
    Json community_ = Json::object();
    Json faith_ = Json::object();
    Json campaign_ = Json::object();
    Json armaments_ = Json::object();
    Json player_ = Json::object();
    Json deaths_ = Json::array();
    Json events_ = Json::array();
    Json unknown_ = Json::object();
    bool new_world_initialized_ = false;
    bool state_loaded_ = false;

    const Json& entry(const std::string& id) const;
    std::vector<Json> list(const std::string& kind = {}) const;
    bool valid_claim(const std::string& id) const;
    bool has_items(const Json& items) const;
    bool valid_items(const Json& items) const;
    bool has_energy(const Json& energy) const;
    double energy_available(const std::string& type) const;
    Json transaction(Json items, Json energy, const std::string& claim);
    void take_items(const Json& items);
    void put_items(const std::string& id, double amount);
    void add_claim(const std::string& claim);
    double energy_capacity(const std::string& type) const;
    Json store_energy(const std::string& type, double amount);
    Json grant_reward(Json payload, const std::string& claim);
    Json start_research(const std::string& id);
    Json discover_blueprint(const std::string& blueprint, const std::string& origin, const std::string& claim);
    Json queue_craft(const std::string& recipe_id, int amount = 1, bool auto_install = false, const std::string& fixture_id = {});
    Json harvest(const std::string& source_id, const Json& args);
    Json place_component(const std::string& id, const Json& args);
    Json component_status(const std::string& id) const;
    Json component_condition(const std::string& instance_id, const Json& args);
    Json material_status(const std::string& id, const Json& args) const;
    Json synchronize_fixtures(const Json& records, const Json& access, const Json& community_stations);
    Json fixture_command(const std::string& name, const Json& args);
    Json step_fixture_energy(double dt, const std::string& consumer, const Json& rates, double seconds, bool manual);
    void tick_progression(double dt, const Json& options = Json::object());
    void finish_job(const Json& job);
    Json recipe_status(const std::string& id) const;
    Json research_status(const std::string& id) const;
    bool station_available(const std::string& id) const;
    Json progression_status() const;
    Json fixture_energy_status() const;
    Json placement_status() const;
    Json asset_geometry(const std::string& id) const;
    Json faith_status(const std::string& instance_id = {}) const;
    void refresh_faith_quests();
    Json community_status() const;
    Json campaign_status() const;
    Json command_inventory(const std::string& name, const Json& args);
    Json command_survival(const std::string& name, const Json& args);
    Json command_progression(const std::string& name, const Json& args);
    Json command_energy(const std::string& name, const Json& args);
    Json command_placement(const std::string& name, const Json& args);
    Json command_community(const std::string& name, const Json& args);
    Json command_faith(const std::string& name, const Json& args);
    Json command_campaign(const std::string& name, const Json& args);
    Json command_armaments(const std::string& name, const Json& args);
    Json armament_quote(const std::string& pattern_id, const std::string& material_id) const;
    void tick_armaments(double dt);
    void validate_loaded_state();
};

} // namespace feral
