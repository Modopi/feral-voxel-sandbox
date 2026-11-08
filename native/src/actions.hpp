#pragma once

#include "common.hpp"

namespace feral {

// The simulation supplies the actor transform. The displayed equipment pose is never fed back into
// hit queries, so hiding or skipping a rendered frame cannot change combat.
struct ActorPose {
    Vec3 origin;
    Quat rotation;
};

struct ActionIntent {
    std::string profile_id;
    ActorPose actor;
};

enum class HitQueryKind { Point, Sweep };

struct HitQuery {
    HitQueryKind kind = HitQueryKind::Point;
    std::string profile_id;
    uint64_t attack_id = 0;
    int simulation_frame = 0;
    // Point: ray endpoints from actor origin to max reach; the adapter anchors the finite-radius
    // impact volume at the first struck surface. Sweep: endpoints of this moving sphere segment.
    Vec3 from;
    Vec3 to;
    double radius = 0;
    Vec3 actor_origin;
    Vec3 aim_direction;
    double max_reach = 0;
    double minimum_aim_dot = -1;
    int max_contacts = 1;
    std::string damage_shape;
};

// The world adapter resolves a query against entities/cells in nearest-first order and reports
// whether each candidate is blocked by an obstruction. Actions owns temporal rules; the adapter
// owns world geometry. Sweep queries may return multiple visible targets.
struct ContactResult {
    Contact contact;
    bool occluded = false;
};

struct ContactEvent {
    uint64_t attack_id = 0;
    std::string profile_id;
    int simulation_frame = 0;
    Contact contact;
    double damage = 0;
    double mining_reference_damage = 20;
    double energy_remaining = 0;
    std::string damage_shape;
    HitQueryKind query_kind = HitQueryKind::Point;
};

using ContactResolver = std::function<std::vector<ContactResult>(const HitQuery&)>;
using ContactSink = std::function<void(const ContactEvent&)>;

struct VisualPose {
    bool active = false;
    std::string profile_id;
    double timeline_frame = 0;
    Vec3 local_position;
    Quat local_rotation;
};

// `configure` accepts native/data/action_profiles.json. Each profile contains independent visual
// pose keys and collision hitbox tracks. `advance` runs the authoritative 60 Hz combat clock;
// `sample_visual` is read-only and may be called zero or many times per simulation step.
class Actions {
public:
    void configure(const Json& data);
    bool begin(const ActionIntent& intent);
    void cancel();
    void reset();
    void advance(double dt, const ActorPose& actor, const ContactResolver& resolve,
                 const ContactSink& emit);

    VisualPose sample_visual(double interpolation = 1.0) const;
    bool active() const { return active_; }
    int simulation_frame() const { return simulation_frame_; }
    uint64_t current_attack_id() const { return attack_id_; }
    double remaining_energy() const { return remaining_energy_; }

private:
    struct HitKeyframe {
        double frame = 0;
        Vec3 position;
    };
    struct HitboxProfile {
        HitQueryKind kind = HitQueryKind::Point;
        int hit_frame = 1;
        int active_start = 1;
        int active_end = 1;
        double radius = 0.1;
        int max_contacts = 8;
        std::vector<HitKeyframe> keys;
    };
    struct VisualKeyframe {
        double frame = 0;
        Vec3 position;
        Quat rotation;
    };
    struct Profile {
        std::string id;
        int duration_frames = 1;
        int cooldown_frames = 1;
        double reach = 1;
        double aim_cone_degrees = 180;
        double damage = 1;
        double mining_reference_damage = 1;
        double energy_budget = 1;
        std::string damage_shape = "point";
        std::vector<HitboxProfile> hitboxes;
        std::vector<VisualKeyframe> visual;
    };

    std::map<std::string, Profile> profiles_;
    const Profile* current_profile_ = nullptr;
    bool active_ = false;
    bool have_actor_pose_ = false;
    bool have_fixed_actor_pose_ = false;
    ActorPose previous_actor_pose_;
    ActorPose last_sample_actor_pose_;
    int simulation_frame_ = 0;
    int started_frame_ = 0;
    int next_start_frame_ = 0;
    double accumulator_ = 0;
    double remaining_energy_ = 0;
    uint64_t attack_id_ = 0;
    uint64_t next_attack_id_ = 1;
    int max_sweep_subdivisions_ = 8;
    double max_angular_step_degrees_ = 12;
    std::set<std::string> contacted_;

    void fixed_step(const ActorPose& actor, const ContactResolver& resolve, const ContactSink& emit);
    void query_contact(const HitQuery& query, const ContactResolver& resolve, const ContactSink& emit);
    std::string contact_key(const Contact& contact) const;
    static Vec3 hit_position(const HitboxProfile& hitbox, double frame);
    static VisualPose interpolate_visual(const Profile& profile, double frame);
};

} // namespace feral
