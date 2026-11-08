#pragma once

#include <memory>
#include <optional>
#include <tuple>
#include <initializer_list>
#include <limits>
#include "common.hpp"

namespace feral {

struct MeshData {
    std::vector<Vec3> vertices;
    std::vector<Vec3> normals;
    std::vector<Vec3> colors;
    std::vector<uint32_t> indices;
    // One material id per exposed quad, in the same order as its six indices.
    std::vector<std::string> face_materials;
};

struct FluidState {
    double volume_m3=0;
    double acid_m3=0;
    double thermal_eu=0;
    bool present() const { return volume_m3>1e-9; }
};

struct FluidForce { Vec3 force_n,world_point; };
struct BuoyancyResult {
    std::vector<FluidForce> forces;
    Vec3 drag_force_n;
    double submerged_volume_m3=0,total_volume_m3=0;
};

struct RegionSite {std::string id,name;double x=0,z=0;int faction=0;};
struct RegionInfo {
    std::string key,name;
    int x=0,z=0,seed=0,tier=1,biome=0,terrain_version=3;
    std::vector<RegionSite> villages;
    RegionSite boss,dungeon;
};

struct SurfaceSample {
    std::string environment_id;
    std::string base_environment_id;
    int tier=1;
    double height=0;
    double water_level=0;
    bool has_water=false;
    bool safe_bypass=false;
    bool hostile_spawns_allowed=false;
    std::string reserved_by;
    std::string water_type;
};

/** Sparse, deterministic 0.5 m voxel world. Sections are signed coordinates in 4 m units. */
class World {
public:
    explicit World(const Content& content);
    void configure(Json config);
    void update_rules(Json rules);
    void load(Json state);
    Json save() const;
    bool sandbox_enabled() const { return config_.value("rules",Json::object()).value("sandbox",false); }

    std::string block(Cell cell) const;
    bool set_block(Cell cell,const std::string& block_id);
    double surface_height(double x,double z) const;
    void stream(Vec3 player,int radius=2);
    uint64_t stream_revision() const { return stream_revision_; }
    Contact raycast(Vec3 origin,Vec3 direction,double reach) const;
    Contact raycast_terrain(Vec3 origin,Vec3 direction,double reach) const;
    Json damage(Contact contact,double amount);
    std::vector<std::string> detach(Cell cell);

    std::map<std::string,BodyState>& bodies(){return bodies_;}
    const std::map<std::string,BodyState>& bodies() const{return bodies_;}
    std::vector<Box> terrain_boxes(Cell section) const;
    MeshData mesh(Cell section) const;
    MeshData fluid_mesh(Cell section) const;
    uint64_t terrain_revision(Cell section) const;
    uint64_t fluid_revision(Cell section) const;
    std::vector<Cell> dirty_sections();
    std::vector<Cell> loaded_sections() const;

    // Runtime integration extensions: environmental state is independent of rendering cadence.
    std::string generator_id() const { return generator_id_; }
    std::string seed() const { return seed_; }
    std::optional<RegionInfo> region_info(int rx,int rz) const;
    Json harvest_nodes_around(Vec3 center,double radius=64) const;
    SurfaceSample surface_sample(double x,double z) const;
    void tick(double dt);
    FluidState fluid_at(Cell cell) const;
    Json fluid_at(Vec3 point) const;
    BuoyancyResult buoyancy_for_compound(Vec3 position,Quat rotation,Vec3 velocity,double mass_kg,
                                         const std::vector<Box>& boxes,double dt) const;
    double pour(Vec3 point,double volume_m3,double acid_fraction=0,double temperature_c=20);
    Json take_fluid(Vec3 point,double volume_m3);
    void require_terrain(Vec3 center,Vec3 size);
    bool set_anchor(Cell cell,bool anchored=true);
    bool remove_body(const std::string& id);
    double apply_thermal_energy(Cell cell,double energy_eu);
    double temperature_at_cell(Cell cell) const;
    bool ignite_cell(Cell cell);

private:
    struct BlockInfo;
    struct Column;
    struct TreeInfo {double x=0,z=0,height_m=0;int height_cells=0;std::string log_block;bool present=false;};
    struct Patch {int cx=0,cz=0,tier=0;double x=0,z=0,radius=0,priority=0;std::string id;bool forced=false;};
    struct LegacyWorld;
    struct StreamBodyCache {
        uint64_t revision=0;
        Cell min_section{},max_section{};
        bool valid=false;
        std::vector<Cell> sections;
    };
    struct BodyRayCache {
        uint64_t revision=0;
        bool valid=false;
        Vec3 min_local{},max_local{};
        std::unordered_map<Cell,std::string,CellHash> voxels;
    };
    struct DamageState {std::string block_id;double damage_hp=0;};
    struct ThermalState {double energy_eu=0,updated_at=0;};
    struct FireState {std::string block_id;double remaining_s=0,rate_eu_s=0;};

    const Content& content_;
    Json config_=Json::object(), unknown_state_=Json::object(), unknown_atlas_=Json::object();
    std::string generator_id_="infinite",seed_="63026";
    std::unordered_map<std::string,Json> block_data_,environment_data_;
    Json world_rules_=Json::object(),default_world_rules_=Json::object();
    std::unordered_map<Cell,std::string,CellHash> edits_;
    std::unordered_map<Cell,DamageState,CellHash> damage_;
    std::unordered_map<Cell,DamageState,CellHash> environmental_damage_;
    std::unordered_map<Cell,FluidState,CellHash> fluids_;
    std::unordered_set<Cell,CellHash> fluid_active_;
    std::vector<Cell> fluid_order_;
    std::unordered_map<Cell,ThermalState,CellHash> thermal_;
    std::vector<Cell> thermal_order_;
    std::unordered_map<Cell,double,CellHash> fuel_remaining_;
    std::unordered_map<Cell,FireState,CellHash> burning_;
    std::vector<Cell> burning_order_;
    std::unordered_set<Cell,CellHash> anchors_;
    std::map<std::string,BodyState> bodies_;
    std::map<std::string,Json> body_source_;
    std::unordered_set<Cell,CellHash> loaded_sections_,dirty_sections_;
    std::unordered_map<Cell,uint64_t,CellHash> terrain_section_revisions_,fluid_section_revisions_;
    std::vector<Cell> player_stream_sections_;
    Cell player_stream_section_{};
    int player_stream_radius_=-1;
    bool player_stream_cache_valid_=false;
    std::unordered_map<std::string,StreamBodyCache> body_stream_cache_;
    mutable std::unordered_map<std::string,BodyRayCache> body_ray_cache_;
    std::vector<Json> reservations_;
    std::unordered_map<Cell,int,CellHash> region_terrain_;
    std::vector<std::pair<Vec3,Vec3>> terrain_requests_;
    std::vector<Cell> terrain_request_key_,cached_terrain_request_sections_;
    uint64_t next_body_id_=1,revision_=0,terrain_revision_counter_=0,fluid_revision_counter_=0;
    uint64_t stream_revision_=0;
    double simulation_time_=0,simulation_accumulator_=0;
    Vec3 focus_{};
    double focus_radius_=std::numeric_limits<double>::infinity();
    size_t flow_cursor_=0,thermal_cursor_=0;
    Json reactions_=Json::object();
    mutable std::unordered_map<Cell,std::shared_ptr<Column>,CellHash> columns_;
    mutable std::unordered_map<Cell,TreeInfo,CellHash> trees_;
    mutable std::unordered_map<std::string,double> random_cache_;
    mutable std::unordered_map<Cell,std::shared_ptr<LegacyWorld>,CellHash> legacy_worlds_;
    mutable std::unordered_map<std::string,std::vector<Patch>> patch_groups_;
    mutable std::unordered_map<std::string,std::unordered_map<Cell,std::string,CellHash>> ore_maps_;

    const Json& block_info(const std::string& id) const;
    const Json& environment(const std::string& id) const;
    bool solid(const std::string& id) const;
    double durability(const std::string& id) const;
    double mass(const std::string& id) const;
    std::string base_block(Cell cell) const;
    std::shared_ptr<const Column> column(int hx,int hz) const;
    SurfaceSample sample(double x,double z) const;
    int base_tier(double x,double z) const;
    int anchor_tier(int cx,int cz) const;
    const Patch* patch_for_region(int cx,int cz) const;
    const std::unordered_map<Cell,std::string,CellHash>& ore_map(int ecx,int ecz) const;
    const TreeInfo& tree_info(int tx,int tz) const;
    double noise(double x,double z,double scale,const std::string& channel) const;
    double deterministic(std::initializer_list<Json> parts) const;
    std::pair<double,double> vertical_bounds(Cell section) const;
    std::shared_ptr<LegacyWorld> legacy_world(int rx,int rz) const;
    void build_frontier(LegacyWorld& world,int rx,int rz,int seed) const;
    std::string legacy_block(Cell cell) const;
    FluidState fluid_state(Cell cell) const;
    void store_fluid(Cell cell,FluidState state);
    void touch_cell(Cell cell,bool terrain=true,bool fluid=false);
    std::vector<Box> boxes_for_voxels(const std::vector<Voxel>& voxels,bool local) const;
    void rebuild_body(BodyState& body);
    void split_body(const std::string& id);
    std::vector<std::string> detach_components(Cell origin);
    void flow_step(double dt);
    void fire_step(double dt);
    void thermal_step(double dt);
    bool damage_cell(Cell cell,double amount_hp,std::vector<std::string>* detached=nullptr);
    bool valid_cell(Cell c) const;
};

} // namespace feral
