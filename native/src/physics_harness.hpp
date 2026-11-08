#pragma once

#include "actions.hpp"
#include "native_body.hpp"
#include <array>
#include <chrono>
#include <godot_cpp/classes/area3d.hpp>
#include <godot_cpp/classes/collision_object3d.hpp>
#include <godot_cpp/classes/node3d.hpp>
#include <godot_cpp/classes/rigid_body3d.hpp>
#include <godot_cpp/classes/static_body3d.hpp>

namespace feral {

// A real Godot/Jolt integration fixture. The root registers this class and selects it for
// --feral-physics-check; it builds its own isolated physics scene and exits after 1000 ticks.
class NativePhysicsHarness : public godot::Node3D {
    GDCLASS(NativePhysicsHarness, godot::Node3D)

    static constexpr int kScenarioSteps = 1000;

    godot::StaticBody3D* hole_compound_ = nullptr;
    godot::StaticBody3D* tree_ground_ = nullptr;
    godot::StaticBody3D* sensor_ground_ = nullptr;
    NativeBody* hole_faller_ = nullptr;
    std::array<NativeBody*,3> trees_{};
    NativeBody* collision_target_ = nullptr;
    NativeBody* collision_mover_ = nullptr;
    std::array<godot::RigidBody3D*,3> sensor_leaves_{};
    std::array<godot::Area3D*,3> leaf_sensors_{};
    std::array<bool,3> tree_had_external_contact_{};
    std::array<bool,3> tree_self_contact_{};
    std::array<bool,3> leaf_underground_observed_{};
    std::array<bool,3> leaf_area_ground_observed_{};

    Actions visible_actions_;
    Actions hidden_actions_;
    struct ActionMark { uint64_t attack=0; int frame=0; double damage=0; std::string profile; };
    std::vector<ActionMark> visible_action_marks_;
    std::vector<ActionMark> hidden_action_marks_;
    bool action_profiles_loaded_ = false;
    bool action_begin_failed_ = false;

    int physics_steps_ = 0;
    int direct_child_count_ = 0;
    int scene_node_count_ = 0;
    uint64_t physics_frames_start_ = 0;
    std::chrono::steady_clock::time_point wall_start_;
    std::chrono::steady_clock::time_point previous_physics_callback_;
    bool have_previous_callback_ = false;
    bool finish_pending_ = false;
    bool finished_ = false;
    bool passed_hole_ = false;
    bool hole_faller_hit_floor_ = false;
    bool collision_target_contact_ = false;
    bool contact_coordinates_valid_ = true;
    bool count_stable_ = true;
    bool tree_compounds_valid_ = true;
    bool hole_compound_valid_ = true;
    bool sensor_leaves_collision_disabled_ = true;
    uint64_t physics_interval_ns_total_ = 0;
    uint64_t physics_interval_ns_max_ = 0;
    uint64_t callback_ns_total_ = 0;
    uint64_t callback_ns_max_ = 0;
    double dt_min_ = 1e9;
    double dt_max_ = 0;
    double hole_faller_min_y_ = 1e9;
    int area_ground_overlap_observations_ = 0;
    std::string setup_error_;

    void build_test_world();
    godot::StaticBody3D* add_static(const std::string& name, uint32_t layer);
    NativeBody* add_native(const std::string& name, Vec3 position, double mass, uint32_t layer, uint32_t mask);
    void add_box_shape(godot::CollisionObject3D* body, Vec3 local_center, Vec3 size);
    void add_sphere_shape(godot::CollisionObject3D* body, double radius);
    void observe_previous_physics_contacts();
    void advance_action_comparison(double dt);
    void finish_and_write_report();
    Json build_report() const;
    bool action_marks_equal() const;
    bool renderer_is_software() const;
    int count_scene_nodes() const;

protected:
    static void _bind_methods() {}

public:
    NativePhysicsHarness() = default;
    void _ready() override;
    void _physics_process(double dt) override;
    void _process(double dt) override;
};

} // namespace feral
