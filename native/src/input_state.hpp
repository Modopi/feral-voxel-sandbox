#pragma once

#include "common.hpp"
#include <godot_cpp/classes/base_button.hpp>
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/variant/vector2.hpp>

namespace feral {

// A pointer is assigned one gameplay owner on its first down event and keeps that owner until
// release/cancel. This prevents a second finger from stealing movement or look while allowing an
// independent finger to press a HUD action at the same time.
struct TouchPointerState {
    enum class Owner { Move, Look, Button, Ignored } owner = Owner::Ignored;
    godot::Vector2 origin;
    godot::Vector2 position;
    uint64_t control_id = 0;
    std::string command;
    Json payload = Json::object();
    bool held_action = false;
    godot::Control::MouseFilter previous_mouse_filter = godot::Control::MOUSE_FILTER_STOP;
    godot::BaseButton* button = nullptr;
};

// The game reads a single state regardless of whether values came from touch, mouse or keyboard.
// Attack sources are separate so releasing one pointer cannot cancel a still-held attack source.
struct InputState {
    std::map<int, TouchPointerState> pointers;
    std::set<std::string> attack_sources;
    godot::Vector2 touch_move;
    godot::Vector2 resolved_move;
    bool jump_queued = false;
    uint64_t attack_count = 0;

    bool attack_held() const { return !attack_sources.empty(); }

    void set_attack_source(const std::string& source, bool held) {
        const bool was_held = attack_held();
        if (held) attack_sources.insert(source);
        else attack_sources.erase(source);
        if (!was_held && attack_held()) ++attack_count;
    }


    void clear() {
        pointers.clear();
        attack_sources.clear();
        touch_move = {};
        resolved_move = {};
        jump_queued = false;
    }
};

struct HudTouchBinding {
    godot::BaseButton* button = nullptr;
    std::string command;
    Json payload = Json::object();
    bool held_action = false;
};

} // namespace feral
