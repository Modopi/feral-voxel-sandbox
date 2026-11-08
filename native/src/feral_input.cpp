#include "feral_game.hpp"

#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/os.hpp>
#include <godot_cpp/classes/viewport.hpp>

namespace feral {
using namespace godot;

void FeralGame::register_hud_touch_button(BaseButton* button, const std::string& command,
                                           Json payload, bool held_action) {
    if (!button) return;
    hud_touch_bindings_.push_back({button, command, std::move(payload), held_action});
}

bool FeralGame::button_contains(BaseButton* button, const Vector2& position) const {
    if (!button || !button->is_visible_in_tree() || button->is_disabled()) return false;
    const Transform2D canvas_transform = button->get_global_transform_with_canvas();
    const Vector2 local_position = canvas_transform.affine_inverse().xform(position);
    return Rect2(Vector2(), button->get_size()).has_point(local_position);
}

bool FeralGame::touch_button_at(const Vector2& position, HudTouchBinding& binding) const {
    for (auto it = hud_touch_bindings_.rbegin(); it != hud_touch_bindings_.rend(); ++it) {
        if (!it->button || !button_contains(it->button, position)) continue;
        const uint64_t id = uint64_t(it->button->get_instance_id());
        bool already_owned = false;
        for (const auto& [pointer_id, pointer] : input_state_.pointers) {
            (void)pointer_id;
            if (pointer.owner == TouchPointerState::Owner::Button && pointer.control_id == id) {
                already_owned = true;
                break;
            }
        }
        if (already_owned) {
            binding = *it;
            binding.button = nullptr;
            return true;
        }
        binding = *it;
        return true;
    }
    return false;
}

void FeralGame::update_touch_movement() {
    input_state_.touch_move = {};
    const auto found = std::find_if(input_state_.pointers.begin(), input_state_.pointers.end(),
        [](const auto& row) { return row.second.owner == TouchPointerState::Owner::Move; });
    if (found == input_state_.pointers.end()) return;
    Vector2 movement = (found->second.position - found->second.origin) / 90.0;
    if (movement.length() > 1.0) movement = movement.normalized();
    input_state_.touch_move = movement;
}

void FeralGame::clear_input_state(bool reset_key_edges) {
    for (auto& [pointer_id, pointer] : input_state_.pointers) {
        if (pointer.owner != TouchPointerState::Owner::Button || !pointer.button) continue;
        if (pointer.held_action)
            input_state_.set_attack_source("touch:" + std::to_string(pointer_id), false);
        pointer.button->set_pressed_no_signal(false);
        pointer.button->set_mouse_filter(pointer.previous_mouse_filter);
    }
    input_state_.clear();
    for (const auto& binding : hud_touch_bindings_) {
        if (binding.button) binding.button->set_pressed_no_signal(false);
    }
    if (reset_key_edges) {
        space_down_ = crouch_key_down_ = crawl_key_down_ = false;
    } else {
        const Input* input = Input::get_singleton();
        space_down_ = input->is_physical_key_pressed(KEY_SPACE);
        crouch_key_down_ = input->is_physical_key_pressed(KEY_C);
        crawl_key_down_ = input->is_physical_key_pressed(KEY_Z);
    }
}

void FeralGame::handle_screen_touch(const Ref<InputEvent>& event) {
    const Ref<InputEventScreenTouch> touch(event);
    if (!touch.is_valid() || !playing_ || paused_ || !panel_.empty()) return;
    const int pointer_id = touch->get_index();
    const Vector2 position = touch->get_position();
    const bool canceled = touch->is_canceled();

    if (!touch->is_pressed() || canceled) {
        const auto found = input_state_.pointers.find(pointer_id);
        if (found == input_state_.pointers.end()) return;
        TouchPointerState pointer = found->second;
        input_state_.pointers.erase(found);
        if (pointer.owner == TouchPointerState::Owner::Button && pointer.button) {
            pointer.button->set_pressed_no_signal(false);
            pointer.button->set_mouse_filter(pointer.previous_mouse_filter);
            if (pointer.held_action) {
                input_state_.set_attack_source("touch:" + std::to_string(pointer_id), false);
            } else if (!canceled && button_contains(pointer.button, position)) {
                ui_command(gs(pointer.command), gs(pointer.payload.dump()));
            }
        }
        update_touch_movement();
        if (get_viewport()) get_viewport()->set_input_as_handled();
        return;
    }

    if (input_state_.pointers.count(pointer_id)) return;
    TouchPointerState pointer;
    pointer.origin = position;
    pointer.position = position;

    HudTouchBinding binding;
    if (touch_button_at(position, binding)) {
        if (!binding.button) {
            pointer.owner = TouchPointerState::Owner::Ignored;
            input_state_.pointers.emplace(pointer_id, std::move(pointer));
            if (get_viewport()) get_viewport()->set_input_as_handled();
            return;
        }
        pointer.owner = TouchPointerState::Owner::Button;
        pointer.button = binding.button;
        pointer.control_id = uint64_t(binding.button->get_instance_id());
        pointer.previous_mouse_filter = binding.button->get_mouse_filter();
        pointer.command = binding.command;
        pointer.payload = binding.payload;
        pointer.held_action = binding.held_action;
        // This finger is handled by the explicit pointer map. Stop Godot's single emulated mouse
        // pointer from invoking the same button or an in-world mouse action a second time.
        binding.button->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
        binding.button->set_pressed_no_signal(true);
        if (binding.held_action)
            input_state_.set_attack_source("touch:" + std::to_string(pointer_id), true);
        input_state_.pointers.emplace(pointer_id, std::move(pointer));
        if (get_viewport()) get_viewport()->set_input_as_handled();
        return;
    }

    const Rect2 visible = get_viewport()->get_visible_rect();
    const bool movement_side = settings_.value("leftHand", false)
        ? position.x > visible.size.x * .62
        : position.x < visible.size.x * .38;
    const auto occupied = [&](TouchPointerState::Owner owner) {
        return std::any_of(input_state_.pointers.begin(), input_state_.pointers.end(),
            [owner](const auto& row) { return row.second.owner == owner; });
    };
    if (movement_side && !occupied(TouchPointerState::Owner::Move)) {
        pointer.owner = TouchPointerState::Owner::Move;
        input_state_.pointers.emplace(pointer_id, std::move(pointer));
        update_touch_movement();
    } else if (!movement_side && !occupied(TouchPointerState::Owner::Look)) {
        pointer.owner = TouchPointerState::Owner::Look;
        input_state_.pointers.emplace(pointer_id, std::move(pointer));
    } else {
        pointer.owner = TouchPointerState::Owner::Ignored;
        input_state_.pointers.emplace(pointer_id, std::move(pointer));
    }
    // Claim even an unused touch so its emulated mouse event cannot attack or interact.
    if (get_viewport()) get_viewport()->set_input_as_handled();
}

void FeralGame::_input(const Ref<InputEvent>& event) {
    if (playing_ && !paused_ && panel_.empty() && event->get_device() == InputEvent::DEVICE_ID_EMULATION) {
        if (Object::cast_to<InputEventMouseButton>(event.ptr()) ||
            Object::cast_to<InputEventMouseMotion>(event.ptr())) {
            if (get_viewport()) get_viewport()->set_input_as_handled();
            return;
        }
    }
    const Ref<InputEventMouseButton> mouse_button(event);
    if (mouse_button.is_valid() && mouse_button->get_device() != InputEvent::DEVICE_ID_EMULATION &&
        mouse_button->get_button_index() == MOUSE_BUTTON_LEFT &&
        (!mouse_button->is_pressed() || mouse_button->is_canceled())) {
        input_state_.set_attack_source("mouse", false);
    }
    if (Object::cast_to<InputEventScreenTouch>(event.ptr())) {
        handle_screen_touch(event);
        return;
    }
    const Ref<InputEventScreenDrag> drag(event);
    if (!drag.is_valid() || !playing_ || paused_ || !panel_.empty()) return;
    const auto found = input_state_.pointers.find(drag->get_index());
    if (found == input_state_.pointers.end()) return;
    TouchPointerState& pointer = found->second;
    pointer.position = drag->get_position();
    if (pointer.owner == TouchPointerState::Owner::Move) {
        update_touch_movement();
    } else if (pointer.owner == TouchPointerState::Owner::Look) {
        const Vector2 relative = drag->get_relative();
        const double sensitivity = settings_.value("sensitivity", .0025) * 1.6;
        yaw_ -= relative.x * sensitivity;
        pitch_ = std::clamp(pitch_ - relative.y * sensitivity, -1.5, 1.5);
    }
    if (get_viewport()) get_viewport()->set_input_as_handled();
}

godot::String FeralGame::interaction_state() const {
    Json owners = Json::array();
    for (const auto& [id, pointer] : input_state_.pointers) {
        const char* owner = pointer.owner == TouchPointerState::Owner::Move ? "move"
            : pointer.owner == TouchPointerState::Owner::Look ? "look"
            : pointer.owner == TouchPointerState::Owner::Button ? "button" : "ignored";
        owners.push_back({{"id", id}, {"owner", owner}, {"control", pointer.command}});
    }
    Json position = Json::array({0, 0, 0});
    if (player_) {
        const Vector3 point = player_->get_global_position();
        position = Json::array({double(point.x), double(point.y), double(point.z)});
    }
    return gs(Json({
        {"panel", panel_}, {"playing", playing_}, {"paused", paused_}, {"worldId", world_id_},
        {"position", position}, {"yaw", yaw_}, {"pitch", pitch_}, {"stance", stance_},
        {"tickClock", clock_}, {"actionActive", actions_.active()},
        {"actionSequence", actions_.current_attack_id()}, {"attackHeld", input_state_.attack_held()},
        {"attackCount", input_state_.attack_count}, {"hitCount", hit_count_},
        {"move", Json::array({double(input_state_.resolved_move.x), double(input_state_.resolved_move.y)})},
        {"touchMove", Json::array({double(input_state_.touch_move.x), double(input_state_.touch_move.y)})},
        {"jumpQueued", input_state_.jump_queued}, {"driving", driving_},
        {"pointerOwners", owners}, {"pointerCount", input_state_.pointers.size()}
    }).dump());
}

} // namespace feral
