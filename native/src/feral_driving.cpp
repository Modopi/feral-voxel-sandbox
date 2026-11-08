#include "feral_game.hpp"

#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/capsule_shape3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_shape_query_parameters3d.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/world3d.hpp>

#include <algorithm>
#include <cmath>

namespace feral {
using namespace godot;
namespace {

bool healthy_controller(const Json& machine, const Json** controller_out = nullptr) {
    if (!machine.is_object() || !machine.contains("components") || !machine["components"].is_array() ||
        !machine.contains("voxels") || !machine["voxels"].is_array()) return false;
    const Json& voxels = machine["voxels"];
    for (const Json& component : machine["components"]) {
        if (component.value("componentId", std::string()) != "controller" ||
            !component.value("active", true)) continue;
        const std::string voxel_id = component.value("voxelId", std::string());
        for (const Json& voxel : voxels) {
            if (voxel.value("id", std::string()) != voxel_id) continue;
            if (voxel.value("hp", 0.0) > 0 && voxel.value("maxHp", 0.0) > 0) {
                if (controller_out) *controller_out = &component;
                return true;
            }
        }
    }
    return false;
}

double yaw_from_quat(Quat q) {
    const double length = std::sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);
    if (length <= 1e-12) return 0;
    q.x /= length; q.y /= length; q.z /= length; q.w /= length;
    return std::atan2(2.0 * (q.w*q.y + q.x*q.z), 1.0 - 2.0 * (q.y*q.y + q.x*q.x));
}

Quat vehicle_camera_rotation(Quat vehicle) {
    // Machine physics defines forward as local +Z while Godot's player camera looks along -Z.
    // Rotate the seated camera half a turn in vehicle-local space so driving and aim agree.
    return {-vehicle.z, vehicle.w, vehicle.x, -vehicle.y};
}

} // namespace

void FeralGame::apply_player_stance() {
    if (!player_) return;
    const double height = stance_ == "crawl" ? .5 : stance_ == "crouch" ? 1.0 : 1.8;
    const double radius = stance_ == "crawl" ? .23 : .28;
    const PackedInt32Array owners = player_->get_shape_owners();
    for (int i = 0; i < owners.size(); ++i) {
        const uint32_t owner = owners[i];
        for (int shape_index = 0; shape_index < player_->shape_owner_get_shape_count(owner); ++shape_index) {
            Ref<Shape3D> shape = player_->shape_owner_get_shape(owner, shape_index);
            if (auto* capsule = Object::cast_to<CapsuleShape3D>(shape.ptr())) {
                capsule->set_height(height);
                capsule->set_radius(radius);
                player_->shape_owner_set_transform(owner, Transform3D(Basis(), Vector3(0, height*.5, 0)));
                break;
            }
        }
    }
    player_->set_floor_snap_length(stance_ == "crawl" ? .06 : stance_ == "crouch" ? .16 : .3);
    if (camera_) camera_->set_position({0, real_t(height*.86), 0});
    if (gameplay_) gameplay_->set_player_state({{"height", height}, {"radius", radius}, {"stance", stance_}});
}

bool FeralGame::request_stance(const std::string& target) {
    if (target != "stand" && target != "crouch" && target != "crawl") return false;
    if (target == stance_) { stance_blocked_ = false; return true; }
    if (target == "stand") {
        const Ref<World3D> scene_world = get_world_3d();
        PhysicsDirectSpaceState3D* space = scene_world.is_valid() ? scene_world->get_direct_space_state() : nullptr;
        if (!space || !player_) return false;
        Ref<CapsuleShape3D> capsule;
        capsule.instantiate();
        capsule->set_height(1.8);
        capsule->set_radius(.28);
        Ref<PhysicsShapeQueryParameters3D> query;
        query.instantiate();
        query->set_shape(capsule);
        query->set_transform(Transform3D(Basis(), player_->get_global_position() + Vector3(0, .9, 0)));
        query->set_collision_mask(1 | 4 | 8);
        query->set_margin(0);
        TypedArray<RID> exclude;
        exclude.push_back(player_->get_rid());
        query->set_exclude(exclude);
        if (!space->intersect_shape(query, 1).is_empty()) {
            stance_blocked_ = true;
            notice("천장이 낮아 일어설 수 없습니다. 밖으로 이동하세요.");
            return false;
        }
    }
    stance_ = target;
    stance_blocked_ = false;
    apply_player_stance();
    return true;
}

void FeralGame::cycle_stance() {
    if (!playing_ || paused_ || !driving_.empty()) return;
    const std::string target = stance_ == "stand" ? "crouch" : stance_ == "crouch" ? "crawl" : "stand";
    request_stance(target);
}

Json FeralGame::enter_machine(const std::string& id) {
    if (!playing_ || !simulation_ || !gameplay_ || !world_ || !player_) return fail("world_not_ready");
    if (id.empty()) return fail("unknown_machine");
    const Json machines = simulation_->view().value("machines", Json::object());
    if (!machines.is_object() || !machines.contains(id)) return fail("unknown_machine");
    const Json& machine = machines.at(id);
    const Vec3 position = machine.value("position", Json::object()).get<Vec3>();
    if ((position - fv(player_->get_global_position())).length() > 5.0) return fail("machine_too_far");
    if (!healthy_controller(machine)) return fail("no_healthy_controller");

    if (machine.value("anchored", false)) {
        Json unanchor = simulation_->command("machine.anchor", {{"id", id}, {"anchored", false}}, *world_, *gameplay_);
        if (!unanchor.value("ok", false)) return unanchor;
    }
    Json neutral = simulation_->command("machine.control", {{"id", id}, {"throttle", 0}, {"steer", 0},
        {"pitch", 0}, {"push", 0}, {"brake", false}}, *world_, *gameplay_);
    if (!neutral.value("ok", false)) return neutral;

    driving_ = id;
    gripped_.clear();
    clear_input_state();
    actions_.cancel();
    // The seated player is a camera/interaction anchor. Excluding its layer keeps the Jolt body
    // from colliding with the very machine that carries it while preserving terrain/entity queries.
    player_->set_collision_layer(0);
    player_->set_collision_mask(1 | 8);
    player_->set_velocity({});
    sync_dynamics(true);
    return Json{{"ok", true}, {"machineId", id}};
}

void FeralGame::exit_machine() {
    if (driving_.empty()) return;
    const std::string id = driving_;
    const MachineBody* body = nullptr;
    if (simulation_) {
        const auto it = simulation_->machine_bodies().find(id);
        if (it != simulation_->machine_bodies().end()) body = &it->second;
    }
    Vec3 dismount = player_ ? fv(player_->get_global_position()) : Vec3{};
    Vec3 inherited_velocity{};
    Quat body_rotation{};
    if (body) {
        inherited_velocity = body->velocity;
        body_rotation = body->rotation;
        const Vec3 center = body->position + feral::rotate(body->rotation, body->center_of_mass);
        double radius = 0;
        double top = body->position.y;
        for (const auto& shape : body->shapes) {
            const Box& box = shape.local_box;
            const Vec3 delta = box.center - body->center_of_mass;
            radius = std::max(radius, std::hypot(delta.x, delta.z) + .5 * std::hypot(box.size.x, box.size.z));
            for (int x : {-1, 1}) for (int y : {-1, 1}) for (int z : {-1, 1}) {
                const Vec3 local = box.center + Vec3{box.size.x*x, box.size.y*y, box.size.z*z}*.5;
                top = std::max(top, body->position.y + feral::rotate(body->rotation, local).y);
            }
        }
        radius += .8;
        auto clear_at = [&](Vec3 feet, const std::string& ignored_body) {
            const Ref<World3D> scene_world = get_world_3d();
            if (!scene_world.is_valid()) return true;
            Ref<CapsuleShape3D> capsule;
            capsule.instantiate();
            const double height = stance_ == "crawl" ? .5 : stance_ == "crouch" ? 1.0 : 1.8;
            const double capsule_radius = stance_ == "crawl" ? .23 : .28;
            capsule->set_height(height);
            capsule->set_radius(capsule_radius);
            Ref<PhysicsShapeQueryParameters3D> query;
            query.instantiate();
            query->set_shape(capsule);
            query->set_transform(Transform3D(Basis(), gv(feet + Vec3{0, height*.5, 0})));
            query->set_collision_mask(1 | 4 | 8);
            query->set_margin(0);
            TypedArray<RID> exclude;
            if (player_) exclude.push_back(player_->get_rid());
            if (auto found = dynamics_.find(ignored_body); found != dynamics_.end() && found->second.body)
                exclude.push_back(found->second.body->get_rid());
            query->set_exclude(exclude);
            PhysicsDirectSpaceState3D* space = scene_world->get_direct_space_state();
            return !space || space->intersect_shape(query, 1).is_empty();
        };
        const double feet_y = std::max(world_ ? world_->surface_height(center.x, center.z) : center.y, center.y);
        const std::array<Vec3, 4> sides = {{{radius,0,0}, {-radius,0,0}, {0,0,radius}, {0,0,-radius}}};
        bool found = false;
        for (Vec3 offset : sides) {
            const Vec3 rotated = feral::rotate(body->rotation, offset);
            Vec3 candidate{center.x + rotated.x, feet_y, center.z + rotated.z};
            if (world_) candidate.y = std::max(candidate.y, world_->surface_height(candidate.x, candidate.z));
            if (clear_at(candidate, id)) { dismount = candidate; found = true; break; }
        }
        if (!found) {
            dismount = {center.x, top + .15, center.z};
            for(int attempt=0;attempt<16&&!clear_at(dismount,id);++attempt)dismount.y+=.5;
        }
    }

    if (simulation_ && world_ && gameplay_)
        simulation_->command("machine.control", {{"id", id}, {"throttle", 0}, {"steer", 0},
            {"pitch", 0}, {"push", 0}, {"brake", true}}, *world_, *gameplay_);
    driving_.clear();
    if (player_) {
        player_->set_collision_layer(2);
        player_->set_collision_mask(1 | 4 | 8);
        player_->set_position(gv(dismount));
        player_->set_velocity(gv(inherited_velocity));
        const Quat camera_rotation=vehicle_camera_rotation(body_rotation);
        player_->set_quaternion(gq(camera_rotation));
    }
    if (body) yaw_ = yaw_from_quat(vehicle_camera_rotation(body_rotation));
    fall_speed_ = std::max(0.0, -inherited_velocity.y);
    input_state_.jump_queued = false;
}

void FeralGame::sync_driving(double dt, Vector2 move) {
    if (driving_.empty() || !simulation_ || !player_) return;
    const auto found = simulation_->machine_bodies().find(driving_);
    const Json* machine_state = simulation_->machine_state(driving_);
    if (found == simulation_->machine_bodies().end() || !machine_state) {
        exit_machine();
        notice("조종 장치를 찾을 수 없어 내렸습니다.");
        return;
    }
    const MachineBody& body = found->second;
    const Json& machine = *machine_state;
    const Json* controller = nullptr;
    if (!healthy_controller(machine, &controller) || !controller) {
        exit_machine();
        notice("조종 장치가 손상되어 내렸습니다.");
        return;
    }

    const auto input = Input::get_singleton();
    const bool up = input_state_.jump_queued || input->is_physical_key_pressed(KEY_SPACE);
    const bool down = input->is_physical_key_pressed(KEY_SHIFT) || input->is_physical_key_pressed(KEY_Q);
    const bool brake = input->is_physical_key_pressed(KEY_CTRL);
    const double throttle = std::clamp(-double(move.y), -1.0, 1.0);
    const double steer = std::clamp(-double(move.x), -1.0, 1.0);
    const double pitch = double(up) - double(down);
    const Json current_command = machine.value("command", Json::object());
    const bool changed = std::abs(current_command.value("throttle", 0.0)-throttle) > .01 ||
                         std::abs(current_command.value("steer", 0.0)-steer) > .01 ||
                         std::abs(current_command.value("pitch", 0.0)-pitch) > .01 ||
                         std::abs(current_command.value("push", 0.0)) > .01 ||
                         current_command.value("brake", false) != brake;
    if (changed && world_ && gameplay_) {
        simulation_->command("machine.control", {{"id", driving_}, {"throttle", throttle}, {"steer", steer},
            {"pitch", pitch}, {"push", 0}, {"brake", brake}}, *world_, *gameplay_);
    }
    input_state_.jump_queued = false;
    (void)dt;

    const Json cell = [&]() {
        const std::string voxel_id = controller->value("voxelId", std::string());
        for (const Json& voxel : machine.value("voxels", Json::array()))
            if (voxel.value("id", std::string()) == voxel_id) return voxel.value("cell", Json::array());
        return Json::array({0,0,0});
    }();
    const double grid = machine.value("gridM", .5);
    const Vec3 local{(cell[0].get<double>()+.5)*grid, (cell[1].get<double>()+1)*grid+.08,
                     (cell[2].get<double>()+.5)*grid};
    const Vec3 seat = body.position + feral::rotate(body.rotation, local);
    player_->set_position(gv(seat));
    player_->set_velocity(gv(body.velocity));
    const Quat camera_rotation=vehicle_camera_rotation(body.rotation);
    player_->set_quaternion(gq(camera_rotation));
    yaw_ = yaw_from_quat(camera_rotation);
}

} // namespace feral
