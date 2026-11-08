#pragma once

#include "gameplay.hpp"
#include "simulation.hpp"
#include "world.hpp"

#include <functional>
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/classes/check_button.hpp>
#include <godot_cpp/classes/grid_container.hpp>
#include <godot_cpp/classes/h_box_container.hpp>
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <godot_cpp/classes/option_button.hpp>
#include <godot_cpp/classes/spin_box.hpp>
#include <godot_cpp/classes/v_box_container.hpp>

namespace feral {

// Native machine assembly editor. IDs stay in option metadata/callback state; the player only
// chooses named machines, materials and components through controls and the 9 x 9 voxel grid.
class MachinePanel : public godot::VBoxContainer {
    GDCLASS(MachinePanel, godot::VBoxContainer)

public:
    using Dispatch = std::function<Json(const std::string&, Json)>;
    using SyncDynamics = std::function<void()>;
    using DriveMachine = std::function<Json(const std::string&)>;

    enum ToolMode { TOOL_SELECT, TOOL_ADD, TOOL_REMOVE, TOOL_REPAIR };

private:
    const Content* content_ = nullptr;
    Simulation* simulation_ = nullptr;
    Gameplay* gameplay_ = nullptr;
    World* world_ = nullptr;
    Dispatch dispatch_;
    SyncDynamics sync_dynamics_;
    DriveMachine drive_machine_;
    Vec3 player_position_{};
    double player_yaw_ = 0;
    bool machine_field_module_ = false;

    std::string selected_machine_id_;
    std::string selected_voxel_id_;
    std::string selected_material_id_ = "wood";
    std::string selected_component_id_;
    std::string selected_variant_;
    std::string link_source_id_;
    std::string link_target_id_;
    std::string link_energy_type_ = "mechanical";
    std::string grid_machine_id_;
    std::string machine_name_ = "나의 구조물";
    std::string status_text_;
    ToolMode tool_mode_ = TOOL_SELECT;
    double grid_m_ = 0.1;
    int layer_y_ = 0;
    int grid_x_origin_ = -4;
    int grid_z_origin_ = -4;

    godot::Label* status_label_ = nullptr;
    godot::LineEdit* machine_name_input_ = nullptr;
    godot::OptionButton* machine_picker_ = nullptr;
    godot::OptionButton* grid_size_picker_ = nullptr;
    godot::OptionButton* material_picker_ = nullptr;
    godot::OptionButton* component_picker_ = nullptr;
    godot::OptionButton* variant_picker_ = nullptr;
    godot::OptionButton* link_source_picker_ = nullptr;
    godot::OptionButton* link_target_picker_ = nullptr;
    godot::OptionButton* link_energy_picker_ = nullptr;
    godot::OptionButton* fluid_source_picker_ = nullptr;
    godot::OptionButton* fluid_pump_picker_ = nullptr;
    godot::OptionButton* fluid_target_picker_ = nullptr;
    godot::SpinBox* layer_picker_ = nullptr;
    godot::SpinBox* throttle_picker_ = nullptr;
    godot::SpinBox* steer_picker_ = nullptr;
    godot::SpinBox* pitch_picker_ = nullptr;
    godot::SpinBox* push_picker_ = nullptr;
    godot::CheckButton* brake_picker_ = nullptr;

    Json current_machines_ = Json::object();
    Json selected_machine_ = Json::object();

    void clear_contents();
    void render();
    void render_machine_selector();
    void render_create_machine();
    void render_field_controls();
    void render_selected_machine();
    void render_assembly_grid();
    void render_selected_voxel();
    void render_components();
    void render_fluid_links();
    void render_cargo();
    void render_energy_links();
    void render_machine_controls();

    godot::Label* add_label(godot::Node* parent, const std::string& text, int size = 18);
    godot::Button* add_button(godot::Node* parent, const std::string& text,
                              const godot::Callable& callback, bool disabled = false,
                              godot::Vector2 minimum = godot::Vector2(0, 48));
    godot::HBoxContainer* add_row(godot::Node* parent);
    void add_option(godot::OptionButton* option, const std::string& label, const std::string& value);
    void select_option(godot::OptionButton* option, const std::string& value);
    std::vector<Json> owned_entries(const std::string& kind, double minimum_count = 0) const;
    std::string name_of(const std::string& id) const;
    std::string localized_reason(const Json& result) const;
    Json machine_view() const;
    Json execute(const std::string& command, Json args, bool refresh = true);
    void set_selected_machine(const std::string& id);
    void initialize_grid_for_machine(const Json& machine);
    void install_selected_component();
    void handle_grid_cell(int x, int y, int z);

    void on_machine_selected(int index);
    void on_drive_machine();
    void on_machine_name_changed(godot::String value);
    void on_grid_size_selected(int index);
    void on_material_selected(int index);
    void on_component_selected(int index);
    void on_variant_selected(int index);
    void on_link_source_selected(int index);
    void on_link_target_selected(int index);
    void on_link_energy_selected(int index);
    void on_layer_changed(double value);
    void on_tool_selected(int mode);
    void on_grid_cell_pressed(int x, int y, int z);
    void on_grid_shift_x(int direction);
    void on_grid_shift_z(int direction);
    void on_create_machine();
    void on_install_component();
    void on_remove_component(godot::String component_id);
    void on_toggle_component(godot::String component_id, bool active);
    void on_refuel(godot::String component_id);
    void on_anchor();
    void on_example(bool heavy);
    void on_return_to_pad();
    void on_control_machine();
    void on_component_power(godot::String component_id, godot::String energy_type, bool fill);
    void on_component_fluid(godot::String component_id, godot::String fluid_id, bool fill);
    void on_connect_components();
    void on_connect_fluid();
    void on_disconnect_fluid(godot::String fluid_link_id);
    void on_cargo_transfer(godot::String item_id, bool loading);

protected:
    static void _bind_methods();

public:
    MachinePanel() = default;

    void configure(const Content* content, Simulation* simulation, Gameplay* gameplay, World* world,
                   Dispatch dispatch, SyncDynamics sync_dynamics, Vec3 player_position,
                   double player_yaw, bool machine_field_module,
                   const std::string& preferred_machine_id = {}, DriveMachine drive_machine = {});
    void refresh();
    void refresh(Vec3 player_position, double player_yaw, bool machine_field_module);

    static Json command_coverage();
};

} // namespace feral
