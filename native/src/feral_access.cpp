#include "feral_game.hpp"
#include <godot_cpp/classes/time.hpp>

namespace feral {

void FeralGame::refresh_access() {
    if (!playing_ || !gameplay_ || !player_) return;

    const godot::Vector3 godot_position = player_->get_global_position();
    const Vec3 position{double(godot_position.x), double(godot_position.y), double(godot_position.z)};
    const uint64_t now = godot::Time::get_singleton()->get_ticks_msec();
    const uint64_t placement_revision = gameplay_->placement_revision();

    const Vec3 displacement = position - access_position_;
    const bool moved = displacement.x * displacement.x + displacement.y * displacement.y + displacement.z * displacement.z >= 0.25;
    const bool elapsed = !access_initialized_ || now - access_last_update_msec_ >= 500;
    const bool fixtures_changed = !access_initialized_ || placement_revision != access_placement_revision_;
    if (access_initialized_ && !moved && !elapsed && !fixtures_changed) return;

    // First Signal currently publishes social service anchors, not catalog
    // production stations. Keep this list empty until Simulation has authored
    // station-kind IDs to provide; gameplay filters arbitrary IDs by catalog.
    const Json result = gameplay_->command("placement.access", {
        {"position", {{"x", position.x}, {"y", position.y}, {"z", position.z}}},
        {"communityStations", Json::array()}
    });
    if (!result.value("ok", false)) return;

    access_position_ = position;
    access_last_update_msec_ = now;
    access_placement_revision_ = placement_revision;
    access_initialized_ = true;
}

} // namespace feral
