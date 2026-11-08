#pragma once
#include "common.hpp"
#include <limits>
#include <memory>

namespace feral {

class World;
class Gameplay;

// Render and physics adapter contracts. asset_id always names an authored model
// from Content::assets; part_id is the authored part / voxel owner key.
struct EntityPose {
    std::string id;
    std::string kind;
    std::string asset_id;
    std::string owner_id;
    std::string part_id;
    Vec3 position;
    Quat rotation;
    Vec3 scale{1,1,1};
    Json animation=Json::object();
    // Immutable authored-local skin/bone geometry. The adapter retains this
    // pointer while an entity is culled and applies it on creation/revision.
    std::shared_ptr<const Json> anatomy_geometry;
    bool visible=true;
};

struct MachineShape {
    std::string part_id;
    std::string material_id;
    Box local_box;
    double hp=0;
    double max_hp=0;
    double mass_kg=0;
};

struct MachineBody {
    std::string id;
    std::string asset_id;
    Vec3 position, velocity, angular_velocity;
    Quat rotation;
    Vec3 center_of_mass;
    double mass_kg=0;
    bool anchored=false;
    uint64_t revision=0;
    uint64_t mass_revision=0;
    std::vector<MachineShape> shapes;
};

struct ForceCommand {
    std::string body_id;
    Vec3 force_newtons;
    Vec3 world_point;
    std::string source;
};

struct CreatureHit {
    std::string entity_id;
    std::string part_id;
    double amount=0;
    double energy_eu=0;
    std::string mode="strike"; // strike, pierce, impact
    std::string attack_id;
    Vec3 point;
};

class Simulation {
public:
    explicit Simulation(const Content& content);
    void configure(Json config);
    void load(Json state);
    Json save() const;
    void tick(double dt, Vec3 player, World& world, Gameplay& gameplay);
    Json command(const std::string& name, Json args, World& world, Gameplay& gameplay);
    Json view() const;

    const std::vector<EntityPose>& poses() const { return poses_; }
    const std::vector<Json>& events() const { return events_; }
    std::vector<Json> consume_events();
    const std::map<std::string,MachineBody>& machine_bodies() const { return machine_bodies_; }
    const Json* machine_state(const std::string& id) const {
        const auto it=machines_.find(id);return it==machines_.end()?nullptr:&it->second;
    }
    const std::vector<ForceCommand>& pending_forces() const { return forces_; }
    std::vector<ForceCommand> consume_forces();
    // Godot's single physics world feeds its authoritative result back here.
    bool sync_machine_body(const std::string& id, Vec3 position, Quat rotation,
                           Vec3 velocity, Vec3 angular_velocity);
    // Root's single physics world can feed authoritative kinematic pose back to
    // creature/boss/dungeon actors. The next AI step then plans from contact-corrected state.
    bool sync_entity_pose(const std::string& id, Vec3 position, Quat rotation);
    // Optional authoritative player state (hp, survival, yaw, radius, height).
    // `tick` itself remains usable with only the contract's player position.
    void set_player_state(Json state);

private:
    const Content& content_;
    Json config_=Json::object(), unknown_state_=Json::object();
    Json player_state_=Json::object();
    std::map<std::string,Json> creatures_, regions_, corpses_, dungeons_, bosses_, machines_;
    Json modules_=Json::object();
    Json signal_objects_=Json::array();
    Json harvest_nodes_=Json::array();
    std::map<std::string,Json> harvest_states_;
    std::map<std::string,std::pair<int,Json>> wound_geometry_cache_;
    std::map<std::string,Json> bone_geometry_cache_;
    std::map<std::string,std::shared_ptr<const Json>> anatomy_geometry_cache_;
    std::map<std::string,MachineBody> machine_bodies_;
    std::vector<ForceCommand> forces_;
    std::vector<Json> events_;
    std::vector<EntityPose> poses_;
    double time_=0, ai_remainder_=0, machine_remainder_=0, structure_scan_at_=0;
    int harvest_bucket_x_=std::numeric_limits<int>::min(), harvest_bucket_z_=std::numeric_limits<int>::min();
    uint64_t next_id_=1;
    Vec3 player_{};
    std::string seed_="feral";
    bool survival_=true;

    const Json& entry(const std::string& id) const;
    std::string make_id(const std::string& type);
    void rebuild_views();
    void step_creatures(double dt, Vec3 player, World& world, Gameplay& gameplay);
    void step_bosses(double dt, Vec3 player, World& world, Gameplay& gameplay);
    void step_ecology(double dt);
    void step_machines(double dt, World& world, Gameplay& gameplay);
    void step_first_signal(double dt, Vec3 player, World& world, Gameplay& gameplay);
    Json command_first_signal(const std::string& name, Json args, World& world, Gameplay& gameplay);
    void ensure_world_structures(Vec3 player, World& world);
    Json spawn_creature(const Json& args, World& world);
    Json damage_creature(const Json& args, Gameplay& gameplay);
    Json spawn_boss(const Json& args);
    Json damage_boss(const Json& args, Gameplay& gameplay);
    Json ensure_dungeon(const Json& args, World& world);
    Json create_machine(const Json& args, Gameplay& gameplay, bool imported=false);
    Json attach_machine_voxel(const Json& args, Gameplay& gameplay);
    Json install_machine_component(const Json& args, Gameplay& gameplay);
    Json harvest_resource(const Json& args, World& world, Gameplay& gameplay);
    Json grant_signal(Json items, const std::string& claim, Gameplay& gameplay, Json& signal,
                      Json energy=Json::object());
    void rebuild_machine(const std::string& id);
    void refresh_machine_mass(const std::string& id);
    void emit_event(Gameplay& gameplay, Json event);
    void queue_event(Json event);
    void apply_player_hit(Gameplay& gameplay, Json event);
    double surface(World& world, double x, double z) const;
    bool solid(World& world, Vec3 p) const;
};

}
