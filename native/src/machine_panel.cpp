#include "machine_panel.hpp"
#include "native_geometry.hpp"

#include <godot_cpp/classes/style_box_flat.hpp>
#include <godot_cpp/core/class_db.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <set>

namespace feral {
using namespace godot;
namespace {

constexpr int kGridEdge = 9;

std::string number_text(double value, int decimals = 1) {
    if (!std::isfinite(value)) return "0";
    if (std::abs(value - std::round(value)) < 0.001) return std::to_string(static_cast<int>(std::round(value)));
    char buffer[48];
    std::snprintf(buffer, sizeof(buffer), "%.*f", decimals, value);
    return buffer;
}

Vec3 read_vec(const Json& value) {
    if (value.is_array() && value.size() >= 3)
        return {value[0].get<double>(), value[1].get<double>(), value[2].get<double>()};
    if (value.is_object()) return {value.value("x", 0.0), value.value("y", 0.0), value.value("z", 0.0)};
    return {};
}

std::string cell_text(const Json& cell) {
    if (!cell.is_array() || cell.size() < 3) return "0, 0, 0";
    return std::to_string(cell[0].get<int>()) + ", " + std::to_string(cell[1].get<int>()) + ", " +
           std::to_string(cell[2].get<int>());
}

std::string string_value(const Json& object, const char* key, const std::string& fallback = {}) {
    if (!object.is_object() || !object.contains(key) || !object[key].is_string()) return fallback;
    return object[key].get<std::string>();
}

Color material_color(const std::string& id) {
    if (id == "wood") return Color::html("#96724D");
    if (id == "stone") return Color::html("#8A9088");
    if (id == "scrap_iron") return Color::html("#7B7770");
    if (id == "steel") return Color::html("#849A9B");
    if (id == "titanium") return Color::html("#B2C1C8");
    if (id == "nickel") return Color::html("#A8A58C");
    if (id.find("wood") != std::string::npos) return Color::html("#657F63");
    if (id.find("mana") != std::string::npos) return Color::html("#718CA9");
    if (id.find("holy") != std::string::npos || id.find("consecrated") != std::string::npos)
        return Color::html("#D5C98E");
    return Color::html("#8B8E9F");
}

const std::map<std::string, std::vector<std::pair<std::string, std::string>>>& variants() {
    static const std::map<std::string, std::vector<std::pair<std::string, std::string>>> values = {
        {"joint", {{"hull", "고정 접합"}, {"wing", "날개"}}},
        {"transmission", {{"wheel", "바퀴"}, {"propeller", "프로펠러"}, {"rotor", "양력 로터"}}},
        {"motor", {{"motor", "전동기"}}},
        {"controller", {{"elevator", "승강 조종"}, {"rudder", "방향 조종"}}}
    };
    return values;
}

std::string energy_name(const std::string& id) {
    static const std::map<std::string, std::string> names = {
        {"mechanical", "역학"}, {"electrical", "전기"}, {"thermal", "열"},
        {"chemical", "화학"}, {"magic", "마법"}, {"divine", "신성"}
    };
    const auto it = names.find(id);
    return it == names.end() ? id : it->second;
}

std::string variant_name(const std::string& id) {
    for (const auto& [component, rows] : variants())
        for (const auto& [variant, label] : rows) if (variant == id) return label;
    return id;
}

} // namespace

void MachinePanel::_bind_methods() {
    ClassDB::bind_method(D_METHOD("on_machine_selected", "index"), &MachinePanel::on_machine_selected);
    ClassDB::bind_method(D_METHOD("on_drive_machine"), &MachinePanel::on_drive_machine);
    ClassDB::bind_method(D_METHOD("on_machine_name_changed", "value"), &MachinePanel::on_machine_name_changed);
    ClassDB::bind_method(D_METHOD("on_grid_size_selected", "index"), &MachinePanel::on_grid_size_selected);
    ClassDB::bind_method(D_METHOD("on_material_selected", "index"), &MachinePanel::on_material_selected);
    ClassDB::bind_method(D_METHOD("on_component_selected", "index"), &MachinePanel::on_component_selected);
    ClassDB::bind_method(D_METHOD("on_variant_selected", "index"), &MachinePanel::on_variant_selected);
    ClassDB::bind_method(D_METHOD("on_link_source_selected", "index"), &MachinePanel::on_link_source_selected);
    ClassDB::bind_method(D_METHOD("on_link_target_selected", "index"), &MachinePanel::on_link_target_selected);
    ClassDB::bind_method(D_METHOD("on_link_energy_selected", "index"), &MachinePanel::on_link_energy_selected);
    ClassDB::bind_method(D_METHOD("on_layer_changed", "value"), &MachinePanel::on_layer_changed);
    ClassDB::bind_method(D_METHOD("on_tool_selected", "mode"), &MachinePanel::on_tool_selected);
    ClassDB::bind_method(D_METHOD("on_grid_cell_pressed", "x", "y", "z"), &MachinePanel::on_grid_cell_pressed);
    ClassDB::bind_method(D_METHOD("on_grid_shift_x", "direction"), &MachinePanel::on_grid_shift_x);
    ClassDB::bind_method(D_METHOD("on_grid_shift_z", "direction"), &MachinePanel::on_grid_shift_z);
    ClassDB::bind_method(D_METHOD("on_create_machine"), &MachinePanel::on_create_machine);
    ClassDB::bind_method(D_METHOD("on_install_component"), &MachinePanel::on_install_component);
    ClassDB::bind_method(D_METHOD("on_remove_component", "component_id"), &MachinePanel::on_remove_component);
    ClassDB::bind_method(D_METHOD("on_toggle_component", "component_id", "active"), &MachinePanel::on_toggle_component);
    ClassDB::bind_method(D_METHOD("on_refuel", "component_id"), &MachinePanel::on_refuel);
    ClassDB::bind_method(D_METHOD("on_anchor"), &MachinePanel::on_anchor);
    ClassDB::bind_method(D_METHOD("on_example", "heavy"), &MachinePanel::on_example);
    ClassDB::bind_method(D_METHOD("on_return_to_pad"), &MachinePanel::on_return_to_pad);
    ClassDB::bind_method(D_METHOD("on_control_machine"), &MachinePanel::on_control_machine);
    ClassDB::bind_method(D_METHOD("on_component_power", "component_id", "energy_type", "fill"), &MachinePanel::on_component_power);
    ClassDB::bind_method(D_METHOD("on_component_fluid", "component_id", "fluid_id", "fill"), &MachinePanel::on_component_fluid);
    ClassDB::bind_method(D_METHOD("on_connect_components"), &MachinePanel::on_connect_components);
    ClassDB::bind_method(D_METHOD("on_connect_fluid"), &MachinePanel::on_connect_fluid);
    ClassDB::bind_method(D_METHOD("on_disconnect_fluid", "fluid_link_id"), &MachinePanel::on_disconnect_fluid);
    ClassDB::bind_method(D_METHOD("on_cargo_transfer", "item_id", "loading"), &MachinePanel::on_cargo_transfer);
}

void MachinePanel::configure(const Content* content, Simulation* simulation, Gameplay* gameplay, World* world,
                             Dispatch dispatch, SyncDynamics sync_dynamics, Vec3 player_position,
                             double player_yaw, bool machine_field_module,
                             const std::string& preferred_machine_id, DriveMachine drive_machine) {
    content_ = content;
    simulation_ = simulation;
    gameplay_ = gameplay;
    world_ = world;
    dispatch_ = std::move(dispatch);
    sync_dynamics_ = std::move(sync_dynamics);
    drive_machine_ = std::move(drive_machine);
    player_position_ = player_position;
    player_yaw_ = player_yaw;
    machine_field_module_ = machine_field_module;
    if (!preferred_machine_id.empty()) selected_machine_id_ = preferred_machine_id;
    refresh();
}

void MachinePanel::refresh(Vec3 player_position, double player_yaw, bool machine_field_module) {
    player_position_ = player_position;
    player_yaw_ = player_yaw;
    machine_field_module_ = machine_field_module;
    refresh();
}

void MachinePanel::clear_contents() {
    for (int i = get_child_count() - 1; i >= 0; --i) {
        if (Node* child = get_child(i)) child->queue_free();
    }
}

Label* MachinePanel::add_label(Node* parent, const std::string& text, int size) {
    auto* label = memnew(Label);
    label->set_text(gs(text));
    label->add_theme_font_size_override("font_size", size);
    if(Object::cast_to<HBoxContainer>(parent)){
        label->set_autowrap_mode(TextServer::AUTOWRAP_OFF);
        label->set_custom_minimum_size({145,0});
        label->set_h_size_flags(Control::SIZE_SHRINK_BEGIN);
    }else label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
    parent->add_child(label);
    return label;
}

Button* MachinePanel::add_button(Node* parent, const std::string& text, const Callable& callback,
                                bool disabled, Vector2 minimum) {
    auto* button = memnew(Button);
    button->set_text(gs(text));
    button->set_custom_minimum_size(minimum);
    button->set_disabled(disabled);
    if (callback.is_valid()) button->connect("pressed", callback);
    parent->add_child(button);
    return button;
}

HBoxContainer* MachinePanel::add_row(Node* parent) {
    auto* row = memnew(HBoxContainer);
    row->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    parent->add_child(row);
    return row;
}

void MachinePanel::add_option(OptionButton* option, const std::string& label, const std::string& value) {
    option->add_item(gs(label));
    option->set_item_metadata(option->get_item_count() - 1, gs(value));
}

void MachinePanel::select_option(OptionButton* option, const std::string& value) {
    for (int i = 0; i < option->get_item_count(); ++i) {
        if (fs(option->get_item_metadata(i)) == value) {
            option->select(i);
            return;
        }
    }
    if (option->get_item_count() > 0) option->select(0);
}

std::vector<Json> MachinePanel::owned_entries(const std::string& kind, double minimum_count) const {
    std::vector<Json> result;
    if (!content_ || !gameplay_) return result;
    const Json entries = content_->data.value("progression", Json::object()).value("entries", Json::array());
    if (!entries.is_array()) return result;
    for (const Json& entry : entries) {
        if (entry.value("kind", std::string()) != kind) continue;
        const std::string id = entry.value("id", std::string());
        const double count = gameplay_->count(id);
        if (!id.empty() && count + 1e-9 >= minimum_count) result.push_back(entry);
    }
    return result;
}

std::string MachinePanel::name_of(const std::string& id) const {
    if (content_ && !id.empty()) {
        const Json& entry = content_->find(id);
        if (entry.is_object() && entry.contains("name")) return entry.value("name", id);
    }
    return id.empty() ? "없음" : id;
}

std::string MachinePanel::localized_reason(const Json& result) const {
    if (result.value("ok", false)) return result.value("message", std::string("변경했습니다"));
    const std::string reason = result.value("reason", std::string("command_failed"));
    static const std::map<std::string, std::string> labels = {
        {"occupied", "그 칸은 이미 차 있습니다."},
        {"attachment_required", "기존 복셀의 면에 붙여 주세요."},
        {"insufficient_resources", "가방에 필요한 재료가 부족합니다."},
        {"remove_component_first", "먼저 장착한 부품을 회수하세요."},
        {"already_full", "이미 수리된 복셀입니다."},
        {"unknown_machine", "기계를 찾지 못했습니다."},
        {"unknown_voxel", "복셀을 찾지 못했습니다."},
        {"mount_occupied", "이 복셀에는 이미 부품이 있습니다."},
        {"invalid_material", "사용할 수 없는 재료입니다."},
        {"invalid_component", "사용할 수 없는 부품입니다."},
        {"unsupported_variant", "이 부품에 사용할 수 없는 형식입니다."},
        {"invalid_design", "기계 설계를 확인해 주세요."},
        {"machine_field_required", "기계 시험장 모듈에서만 사용할 수 있습니다."},
        {"empty_component_first", "연료와 저장 에너지를 비운 뒤 회수하세요."},
        {"invalid_fuel", "이 부품에는 연료를 넣을 수 없습니다."},
        {"invalid_control", "조종 값을 확인해 주세요."},
        {"no_machine", "먼저 기계를 선택하세요."},
        {"no_voxel", "격자에서 복셀을 선택하세요."},
        {"no_material", "가방에 사용할 재료가 없습니다."},
        {"no_component", "가방에 장착할 부품이 없습니다."},
        {"module_disabled", "이 세계에서 사용할 수 없는 기능입니다."}
    };
    const auto it = labels.find(reason);
    return it == labels.end() ? "실패 · " + reason : it->second;
}

Json MachinePanel::machine_view() const {
    if (!simulation_) return Json::object();
    return simulation_->view().value("machines", Json::object());
}

Json MachinePanel::execute(const std::string& command, Json args, bool should_refresh) {
    if (!dispatch_) {
        status_text_ = "명령을 전달할 수 없습니다.";
        if (should_refresh) refresh();
        return Json{{"ok", false}, {"reason", "dispatch_unavailable"}};
    }
    if (!args.contains("id") && !selected_machine_id_.empty()) args["id"] = selected_machine_id_;
    const Json result = dispatch_(command, std::move(args));
    if (result.value("ok", false)) {
        const std::string machine_id = result.value("machineId", std::string());
        if (!machine_id.empty()) set_selected_machine(machine_id);
        status_text_ = localized_reason(result);
        if (sync_dynamics_) sync_dynamics_();
    } else {
        status_text_ = localized_reason(result);
    }
    if (should_refresh) refresh();
    return result;
}

void MachinePanel::set_selected_machine(const std::string& id) {
    if (selected_machine_id_ == id) return;
    selected_machine_id_ = id;
    selected_voxel_id_.clear();
    selected_component_id_.clear();
    grid_machine_id_.clear();
}

void MachinePanel::initialize_grid_for_machine(const Json& machine) {
    if (grid_machine_id_ == selected_machine_id_) return;
    int low_x = 0, high_x = 0, low_z = 0, high_z = 0, low_y = 0;
    bool first = true;
    for (const Json& voxel : machine.value("voxels", Json::array())) {
        const Json cell = voxel.value("cell", Json::array());
        if (!cell.is_array() || cell.size() < 3) continue;
        const int x = cell[0], y = cell[1], z = cell[2];
        if (first) { low_x = high_x = x; low_y = y; low_z = high_z = z; first = false; }
        else { low_x = std::min(low_x, x); high_x = std::max(high_x, x); low_y = std::min(low_y, y); low_z = std::min(low_z, z); high_z = std::max(high_z, z); }
    }
    grid_x_origin_ = static_cast<int>(std::floor((low_x + high_x) * 0.5)) - kGridEdge / 2;
    grid_z_origin_ = static_cast<int>(std::floor((low_z + high_z) * 0.5)) - kGridEdge / 2;
    layer_y_ = low_y;
    selected_voxel_id_.clear();
    selected_component_id_.clear();
    grid_machine_id_ = selected_machine_id_;
}

void MachinePanel::refresh() {
    clear_contents();
    status_label_ = nullptr;
    machine_name_input_ = nullptr;
    machine_picker_ = nullptr;
    grid_size_picker_ = nullptr;
    material_picker_ = nullptr;
    component_picker_ = nullptr;
    variant_picker_ = nullptr;
    link_source_picker_ = nullptr;
    link_target_picker_ = nullptr;
    link_energy_picker_ = nullptr;
    fluid_source_picker_ = fluid_pump_picker_ = fluid_target_picker_ = nullptr;
    layer_picker_ = nullptr;
    throttle_picker_ = steer_picker_ = pitch_picker_ = push_picker_ = nullptr;
    brake_picker_ = nullptr;
    current_machines_ = machine_view();
    selected_machine_ = Json::object();

    if (!content_ || !simulation_ || !gameplay_ || !world_) {
        add_label(this, "기계 조립을 불러올 수 없습니다.", 22);
        return;
    }

    add_label(this, "기계 조립", 30);
    add_label(this, "복셀을 고르고 9 × 9 격자에서 배치·회수·수리하세요. 재료와 부품은 가방에서 사용합니다.", 18);
    status_label_ = add_label(this, status_text_, 16);
    render_machine_selector();
    render_create_machine();
    render_field_controls();
    if (!selected_machine_.is_object() || selected_machine_.empty()) return;

    initialize_grid_for_machine(selected_machine_);
    render_selected_machine();
    render_assembly_grid();
    render_selected_voxel();
    render_components();
    render_fluid_links();
    render_energy_links();
    render_cargo();
    render_machine_controls();
}

void MachinePanel::render_machine_selector() {
    auto* row = add_row(this);
    add_label(row, "주변의 기계", 20);
    machine_picker_ = memnew(OptionButton);
    machine_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    machine_picker_->set_custom_minimum_size({0,48});
    std::string nearest;
    double nearest_distance = std::numeric_limits<double>::max();
    int index = 0, selected_index = -1;
    if (current_machines_.is_object()) for (auto it = current_machines_.begin(); it != current_machines_.end(); ++it) {
        const Json& machine = it.value();
        const std::string id = it.key();
        const double distance = (read_vec(machine.value("position", Json::array())) - player_position_).length();
        const std::string label = machine.value("name", std::string("기계")) + " · " + number_text(distance, 0) + "m";
        add_option(machine_picker_, label, id);
        if (distance < nearest_distance) { nearest_distance = distance; nearest = id; }
        if (id == selected_machine_id_) selected_index = index;
        ++index;
    }
    if (selected_index < 0 && !selected_machine_id_.empty() && !current_machines_.contains(selected_machine_id_))
        selected_machine_id_.clear();
    if (selected_machine_id_.empty() && !nearest.empty()) selected_machine_id_ = nearest;
    if (selected_index < 0) {
        index = 0;
        if (current_machines_.is_object()) for (auto it = current_machines_.begin(); it != current_machines_.end(); ++it, ++index)
            if (it.key() == selected_machine_id_) { selected_index = index; break; }
    }
    if(selected_index<0&&current_machines_.empty()){
        add_option(machine_picker_,"주변 기계 없음","");machine_picker_->set_item_disabled(0,true);selected_index=0;
    }
    if (selected_index >= 0) machine_picker_->select(selected_index);
    machine_picker_->connect("item_selected", Callable(this, "on_machine_selected"));
    row->add_child(machine_picker_);
    if (selected_index >= 0&&!selected_machine_id_.empty()) selected_machine_ = current_machines_.value(selected_machine_id_, Json::object());
    else add_label(this, "아직 구조물이 없습니다. 복셀 크기를 정하고 첫 구조물을 시작하세요.", 16);
}

void MachinePanel::render_create_machine() {
    add_label(this, "새 구조물", 22);
    auto* row = add_row(this);
    machine_name_input_ = memnew(LineEdit);
    machine_name_input_->set_placeholder(gs("이름"));
    machine_name_input_->set_text(gs(machine_name_));
    machine_name_input_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    machine_name_input_->connect("text_changed", Callable(this, "on_machine_name_changed"));
    row->add_child(machine_name_input_);
    grid_size_picker_ = memnew(OptionButton);
    add_option(grid_size_picker_, "3.125cm · 0.03L", "0.03125");
    add_option(grid_size_picker_, "10cm · 1L", "0.1");
    add_option(grid_size_picker_, "50cm · 125L", "0.5");
    grid_size_picker_->select(grid_m_<=0.04?0:grid_m_>=0.4?2:1);
    grid_size_picker_->connect("item_selected", Callable(this, "on_grid_size_selected"));
    row->add_child(grid_size_picker_);
    add_button(this, "앞에 구조물 조립 시작", Callable(this, "on_create_machine"), false, {0, 50});
}

void MachinePanel::render_field_controls() {
    if (!machine_field_module_) return;
    add_label(this, "기계 시험장", 22);
    add_label(this, "예제는 이 모듈에서만 불러오고 출발 패드로 돌려보낼 수 있습니다.", 16);
    auto* row = add_row(this);
    add_button(row, "경량 예제 불러오기", Callable(this, "on_example").bind(false));
    add_button(row, "중량 예제 불러오기", Callable(this, "on_example").bind(true));
    add_button(row, "선택한 기계를 출발 패드로", Callable(this, "on_return_to_pad"), selected_machine_id_.empty());
}

void MachinePanel::render_selected_machine() {
    const Json voxels = selected_machine_.value("voxels", Json::array());
    const Json components = selected_machine_.value("components", Json::array());
    const Json metrics = selected_machine_.value("metrics", Json::object());
    const std::string name = selected_machine_.value("name", std::string("기계"));
    double mass = 0;
    for (const Json& body : simulation_->view().value("machineBodies", Json::array()))
        if (body.value("id", std::string()) == selected_machine_id_) { mass = body.value("massKg", 0.0); break; }
    const double power = selected_machine_.value("lastPower", 0.0);
    add_label(this, name + " · " + std::to_string(voxels.size()) + "복셀 · " +
              number_text(mass, 1) + "kg · 현재 출력 " + number_text(power, 1) + " EU/s",
              23);
    add_label(this, "격자 " + number_text(selected_machine_.value("gridM", 0.1), 5) + "m · 부품 " +
              std::to_string(components.size()) + "개 · 생성 " + number_text(metrics.value("generated", 0.0), 1) +
              " EU · 소비 " + number_text(metrics.value("consumed", 0.0), 1) + " EU",
              16);
}

void MachinePanel::render_assembly_grid() {
    add_label(this, "격자 조립", 22);
    add_label(this, "위쪽은 +Z 앞쪽, 왼쪽은 +X입니다. 빈 칸은 붙어 있는 복셀의 면을 눌러야 배치됩니다.", 16);
    auto* toolbar = add_row(this);
    const std::array<std::pair<ToolMode, std::string>, 4> tools = {{{TOOL_SELECT, "선택"}, {TOOL_ADD, "배치"},
                                                                     {TOOL_REMOVE, "회수"}, {TOOL_REPAIR, "수리"}}};
    for (const auto& [mode, label] : tools) {
        const std::string button_text = (tool_mode_ == mode ? "● " : "") + label;
        add_button(toolbar, button_text, Callable(this, "on_tool_selected").bind(static_cast<int>(mode)), false, {0, 42});
    }

    auto* layer_row = add_row(this);
    add_label(layer_row, "층 Y", 17);
    layer_picker_ = memnew(SpinBox);
    layer_picker_->set_min(-128);
    layer_picker_->set_max(128);
    layer_picker_->set_step(1);
    layer_picker_->set_value(layer_y_);
    layer_picker_->set_custom_minimum_size({95, 44});
    layer_picker_->connect("value_changed", Callable(this, "on_layer_changed"));
    layer_row->add_child(layer_picker_);

    const double machine_grid_m = selected_machine_.value("gridM", grid_m_);
    const double liters = machine_grid_m * machine_grid_m * machine_grid_m * 1000.0;
    const auto materials = owned_entries("material", liters);
    material_picker_ = memnew(OptionButton);
    material_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    for (const auto& material : materials) {
        const std::string id = material.value("id", std::string());
        add_option(material_picker_, name_of(id) + " · " + number_text(gameplay_->count(id), 2) + "L", id);
    }
    if (materials.empty()) {
        add_option(material_picker_, "재료 없음", "");
        selected_material_id_.clear();
        status_text_ = "복셀 배치에 필요한 재료가 가방에 없습니다.";
        if (status_label_) status_label_->set_text(gs(status_text_));
    } else {
        bool exists = false;
        for (const auto& material : materials) if (material.value("id", std::string()) == selected_material_id_) exists = true;
        if (!exists) selected_material_id_ = materials.front().value("id", std::string());
        select_option(material_picker_, selected_material_id_);
    }
    material_picker_->connect("item_selected", Callable(this, "on_material_selected"));
    layer_row->add_child(material_picker_);

    auto* move_row = add_row(this);
    add_label(move_row, "격자 이동", 16);
    add_button(move_row, "X−", Callable(this, "on_grid_shift_x").bind(-1), false, {42, 40});
    add_button(move_row, "X+", Callable(this, "on_grid_shift_x").bind(1), false, {42, 40});
    add_button(move_row, "Z−", Callable(this, "on_grid_shift_z").bind(-1), false, {42, 40});
    add_button(move_row, "Z+", Callable(this, "on_grid_shift_z").bind(1), false, {42, 40});
    add_label(this, "X " + std::to_string(grid_x_origin_) + "…" + std::to_string(grid_x_origin_ + 8) +
              " · Z " + std::to_string(grid_z_origin_) + "…" + std::to_string(grid_z_origin_ + 8) +
              " · Y " + std::to_string(layer_y_), 15);

    std::map<Cell, Json> voxels_by_cell;
    std::map<std::string, Json> components_by_voxel;
    for (const Json& component : selected_machine_.value("components", Json::array()))
        components_by_voxel[component.value("voxelId", std::string())] = component;
    for (const Json& voxel : selected_machine_.value("voxels", Json::array())) {
        const Json cell = voxel.value("cell", Json::array());
        if (!cell.is_array() || cell.size() < 3) continue;
        voxels_by_cell[Cell{cell[0], cell[1], cell[2]}] = voxel;
    }

    auto* grid = memnew(GridContainer);
    grid->set_columns(kGridEdge);
    grid->add_theme_constant_override("h_separation", 2);
    grid->add_theme_constant_override("v_separation", 2);
    grid->set_h_size_flags(Control::SIZE_SHRINK_CENTER);
    for (int row = 0; row < kGridEdge; ++row) {
        const int z = grid_z_origin_ + (kGridEdge - 1 - row);
        for (int column = 0; column < kGridEdge; ++column) {
            const int x = grid_x_origin_ + (kGridEdge - 1 - column);
            const Cell cell{x, layer_y_, z};
            const auto found = voxels_by_cell.find(cell);
            const bool occupied = found != voxels_by_cell.end();
            const Json voxel = occupied ? found->second : Json::object();
            const std::string voxel_id = voxel.value("id", std::string());
            const auto mounted = components_by_voxel.find(voxel_id);
            const bool has_component = mounted != components_by_voxel.end();
            const std::string material_id = voxel.value("materialId", std::string());
            const std::string caption = has_component ? "C" : occupied ? "■" : "·";
            auto* button = add_button(grid, caption,
                Callable(this, "on_grid_cell_pressed").bind(x, layer_y_, z), false, {27, 36});
            const bool selected = occupied && voxel_id == selected_voxel_id_;
            Ref<StyleBoxFlat> style;
            style.instantiate();
            style->set_bg_color(occupied ? material_color(material_id) : Color(.075, .105, .095, .98));
            style->set_border_color(selected ? Color(.98, .79, .34) : Color(.27, .34, .30));
            style->set_border_width_all(selected ? 2 : 1);
            style->set_corner_radius_all(3);
            button->add_theme_stylebox_override("normal", style);
            button->add_theme_color_override("font_color", occupied ? Color(.98, .96, .87) : Color(.62, .68, .62));
            button->set_tooltip_text(gs("[" + std::to_string(x) + ", " + std::to_string(layer_y_) + ", " +
                std::to_string(z) + "]" + (occupied ? " · " + name_of(material_id) + " · HP " +
                number_text(voxel.value("hp", 0.0), 1) + "/" + number_text(voxel.value("maxHp", 0.0), 1) +
                (has_component ? " · " + name_of(mounted->second.value("componentId", std::string())) +
                                " · " + variant_name(string_value(mounted->second, "legacyType")) : "") : " · 빈 칸")));
            grid->add_child(button);
        }
    }
    add_child(grid);
}

void MachinePanel::render_selected_voxel() {
    const Json* selected = nullptr;
    for (const Json& voxel : selected_machine_.value("voxels", Json::array()))
        if (voxel.value("id", std::string()) == selected_voxel_id_) { selected = &voxel; break; }
    if (!selected) {
        add_label(this, "복셀을 선택하면 체력·수리·장착 부품이 여기에 표시됩니다.", 16);
        return;
    }
    const Json cell = selected->value("cell", Json::array());
    add_label(this, name_of(selected->value("materialId", std::string())) + " · [" + cell_text(cell) + "] · HP " +
              number_text(selected->value("hp", 0.0), 1) + " / " +
              number_text(selected->value("maxHp", 0.0), 1), 19);

    const auto available_components = owned_entries("component", 1);
    auto* row = add_row(this);
    component_picker_ = memnew(OptionButton);
    component_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    for (const auto& component : available_components) {
        const std::string id = component.value("id", std::string());
        add_option(component_picker_, name_of(id) + " × " + number_text(gameplay_->count(id), 0), id);
    }
    if (available_components.empty()) add_option(component_picker_, "가방에 부품 없음", "");
    else {
        bool found = false;
        for (const auto& component : available_components) if (component.value("id", std::string()) == selected_component_id_) found = true;
        if (!found) selected_component_id_ = available_components.front().value("id", std::string());
        select_option(component_picker_, selected_component_id_);
    }
    component_picker_->connect("item_selected", Callable(this, "on_component_selected"));
    row->add_child(component_picker_);

    variant_picker_ = memnew(OptionButton);
    variant_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    add_option(variant_picker_, "기본 기능", "");
    const auto available_variants = variants().find(selected_component_id_);
    if (available_variants != variants().end())
        for (const auto& [variant, label] : available_variants->second) add_option(variant_picker_, label, variant);
    select_option(variant_picker_, selected_variant_);
    variant_picker_->connect("item_selected", Callable(this, "on_variant_selected"));
    row->add_child(variant_picker_);

    bool mounted = false;
    for (const Json& component : selected_machine_.value("components", Json::array()))
        if (component.value("voxelId", std::string()) == selected_voxel_id_) mounted = true;
    add_button(this, "선택 복셀에 부품 설치", Callable(this, "on_install_component"),
               mounted || selected_component_id_.empty() || available_components.empty());
}

void MachinePanel::render_components() {
    add_label(this, "장착 부품 · 동력", 22);
    const Json components = selected_machine_.value("components", Json::array());
    const Json inventory=gameplay_->view().value("progression",Json::object()).value("inventory",Json::object());
    if (components.empty()) {
        add_label(this, "부품을 만들고 복셀에 장착하면 동력과 조종 기능이 생깁니다.", 16);
        return;
    }
    for (const Json& component : components) {
        const std::string component_id = component.value("componentId", std::string());
        const std::string instance_id = component.value("id", std::string());
        const std::string voxel_id = component.value("voxelId", std::string());
        const std::string variant_id = string_value(component, "legacyType");
        const Json* voxel = nullptr;
        for (const Json& candidate : selected_machine_.value("voxels", Json::array()))
            if (candidate.value("id", std::string()) == voxel_id) { voxel = &candidate; break; }
        const std::string where = voxel ? " · [" + cell_text(voxel->value("cell", Json::array())) + "]" : "";
        auto* card = memnew(VBoxContainer);
        add_child(card);
        add_label(card, name_of(component_id) + (variant_id.empty() ? "" : " · " + variant_name(variant_id)) + where, 19);
        const Json& definition = content_->find(component_id);
        const double fuel = component.value("fuel", 0.0);
        const int fuel_items = component.value("fuelItems", 0);
        std::string state = component.value("active", true) ? "작동" : "정지";
        if (fuel_items > 0 || fuel > 0) state += " · 연료 " + std::to_string(fuel_items) + "개 + " + number_text(fuel, 1) + " EU";
        add_label(card, state, 16);

        auto* actions = add_row(card);
        const bool active = component.value("active", true);
        add_button(actions, active ? "끄기" : "켜기",
                   Callable(this, "on_toggle_component").bind(gs(instance_id), !active));
        add_button(actions, "부품 회수", Callable(this, "on_remove_component").bind(gs(instance_id)));
        if (component_id == "heat_engine")
            add_button(actions, "나무 연료 1개 넣기", Callable(this, "on_refuel").bind(gs(instance_id)),
                       gameplay_->count("raw_timber") < 1);

        const Json stores = definition.value("stores", Json::array());
        const Json energy = component.value("energy", Json::object());
        for (const Json& type_json : stores) {
            if (!type_json.is_string()) continue;
            const std::string type = type_json.get<std::string>();
            const double amount = energy.value(type, 0.0);
            const double capacity = definition.value("capacity", 0.0);
            add_label(card, energy_name(type) + " 저장 " + number_text(amount, 1) + " / " +
                      number_text(capacity, 1) + " EU", 16);
            auto* energy_row = add_row(card);
            add_button(energy_row, "10 EU 충전", Callable(this, "on_component_power").bind(gs(instance_id), gs(type), true),
                       gameplay_->view().value("progression", Json::object()).value("energy", Json::object())
                           .value("amounts", Json::object()).value(type, 0.0) < 10 || amount + 10 > capacity);
            add_button(energy_row, "10 EU 꺼내기", Callable(this, "on_component_power").bind(gs(instance_id), gs(type), false),
                       amount < 10);
        }
        if(component_id=="fluid_container"){
            const Json fluid_contents=definition.value("fluidContents",Json::array()),fluids=component.value("fluids",Json::object());
            const double capacity=definition.value("capacityLiters",0.0);double total=0;for(auto it=fluids.begin();it!=fluids.end();++it)if(it.value().is_number())total+=it.value().get<double>();
            add_label(card,"유체 용량 "+number_text(total,1)+" / "+number_text(capacity,1)+" L",16);
            for(const Json& fluid_json:fluid_contents){if(!fluid_json.is_string())continue;const std::string fluid=fluid_json.get<std::string>();const double liters=fluids.value(fluid,0.0),owned=inventory.value(fluid,0.0);auto* fluid_row=add_row(card);
                add_label(fluid_row,name_of(fluid)+" · "+number_text(liters,1)+" L",16);
                add_button(fluid_row,"1 L 넣기",Callable(this,"on_component_fluid").bind(gs(instance_id),gs(fluid),true),owned<1||total+1>capacity);
                add_button(fluid_row,"1 L 꺼내기",Callable(this,"on_component_fluid").bind(gs(instance_id),gs(fluid),false),liters<1);
            }
        }
    }
}

void MachinePanel::render_fluid_links(){
    const Json components=selected_machine_.value("components",Json::array()),links=selected_machine_.value("fluidLinks",Json::array());
    std::vector<const Json*> containers,pumps;std::map<std::string,std::string> names;
    for(const Json& component:components){const std::string id=component.value("id",std::string{}),component_id=component.value("componentId",std::string{});names[id]=name_of(component_id);
        if(component_id=="fluid_container")containers.push_back(&component);else if(component_id=="pump")pumps.push_back(&component);}
    if(containers.empty()&&links.empty())return;add_label(this,"유체 배관",22);
    for(const Json& link:links){const std::string link_id=link.value("id",std::string{}),source=link.value("source",std::string{}),pump=link.value("pump",std::string{}),target=link.value("target",std::string{});
        auto* row=add_row(this);add_label(row,names[source]+" → "+names[target]+" · "+names[pump],16);add_button(row,"배관 해제",Callable(this,"on_disconnect_fluid").bind(gs(link_id)));}
    if(containers.size()<2||pumps.empty()){if(links.empty())add_label(this,"용기 두 개와 펌프가 있으면 유체를 연결할 수 있습니다.",15);return;}
    fluid_source_picker_=memnew(OptionButton);fluid_pump_picker_=memnew(OptionButton);fluid_target_picker_=memnew(OptionButton);
    for(const Json* component:containers){const std::string id=component->value("id",std::string{});const std::string label=name_of("fluid_container")+" · "+id.substr(id.find_last_of(':')==std::string::npos?0:id.find_last_of(':')+1);add_option(fluid_source_picker_,label,id);add_option(fluid_target_picker_,label,id);}
    for(const Json* component:pumps){const std::string id=component->value("id",std::string{});add_option(fluid_pump_picker_,name_of("pump")+" · "+id.substr(id.find_last_of(':')==std::string::npos?0:id.find_last_of(':')+1),id);}
    fluid_source_picker_->select(0);fluid_pump_picker_->select(0);fluid_target_picker_->select(1);
    auto* row=add_row(this);row->add_child(fluid_source_picker_);row->add_child(fluid_pump_picker_);row->add_child(fluid_target_picker_);
    add_button(this,"선택한 용기와 펌프 연결",Callable(this,"on_connect_fluid"),false,{0,46});
}

void MachinePanel::render_cargo(){
    add_label(this,"화물",22);const Json cargo=selected_machine_.value("cargo",Json::object());const Json inventory=gameplay_->view().value("progression",Json::object()).value("inventory",Json::object());
    if(cargo.empty())add_label(this,"적재된 화물이 없습니다.",15);
    for(auto it=cargo.begin();it!=cargo.end();++it)if(it.value().is_number()&&it.value().get<double>()>0){auto* row=add_row(this);add_label(row,name_of(it.key())+" × "+number_text(it.value().get<double>(),1),16);add_button(row,"1개 내리기",Callable(this,"on_cargo_transfer").bind(gs(it.key()),false),it.value().get<double>()<1);}
    int listed=0;for(auto it=inventory.begin();it!=inventory.end();++it)if(it.value().is_number()&&it.value().get<double>()>=1){
        auto* row=add_row(this);add_label(row,name_of(it.key())+" · 소지 "+number_text(it.value().get<double>(),1),15);add_button(row,"1개 적재",Callable(this,"on_cargo_transfer").bind(gs(it.key()),true));if(++listed>=24){add_label(this,"나머지 물품은 인벤토리에서 먼저 정리하세요.",14);break;}}
    if(listed==0)add_label(this,"화물에 넣을 온전한 물품이 가방에 없습니다.",15);
}

void MachinePanel::render_energy_links() {
    const Json components = selected_machine_.value("components", Json::array());
    if (components.size() < 2) return;
    add_label(this, "에너지 연결", 22);
    add_label(this, "출력 포트를 입력 포트에 연결하면 조립체 안에서 실제 동력이 전달됩니다.", 16);
    auto* row = add_row(this);
    link_source_picker_ = memnew(OptionButton);
    link_target_picker_ = memnew(OptionButton);
    link_energy_picker_ = memnew(OptionButton);
    link_source_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    link_target_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);
    link_energy_picker_->set_h_size_flags(Control::SIZE_EXPAND_FILL);

    std::set<std::string> possible_types;
    for (const Json& component : components) {
        const std::string component_id = component.value("componentId", std::string());
        const Json& definition = content_->find(component_id);
        const std::string instance_id = component.value("id", std::string());
        std::string label = name_of(component_id);
        for (const Json& voxel : selected_machine_.value("voxels", Json::array())) {
            if (voxel.value("id", std::string()) == component.value("voxelId", std::string())) {
                label += " · [" + cell_text(voxel.value("cell", Json::array())) + "]";
                break;
            }
        }
        for (const Json& type : definition.value("outputEnergies", Json::array()))
            if (type.is_string()) possible_types.insert(type.get<std::string>());
        add_option(link_source_picker_, label, instance_id);
        add_option(link_target_picker_, label, instance_id);
    }
    if (link_source_picker_->get_item_count() > 0) select_option(link_source_picker_, link_source_id_);
    if (link_target_picker_->get_item_count() > 0) select_option(link_target_picker_, link_target_id_);

    // Present all authored energy domains; Simulation validates output/input compatibility.
    static const std::array<std::string, 6> energy_types = {"mechanical", "electrical", "thermal", "chemical", "magic", "divine"};
    for (const std::string& type : energy_types) add_option(link_energy_picker_, energy_name(type), type);
    select_option(link_energy_picker_, link_energy_type_);

    if (link_source_id_.empty()) {
        for (const Json& component : components) {
            const Json& definition = content_->find(component.value("componentId", std::string()));
            const Json outputs = definition.value("outputEnergies", Json::array());
            if (std::find(outputs.begin(), outputs.end(), Json(link_energy_type_)) != outputs.end()) {
                link_source_id_ = component.value("id", std::string());
                break;
            }
        }
    }
    if (link_target_id_.empty()) {
        for (const Json& component : components) {
            const std::string instance = component.value("id", std::string());
            if (instance == link_source_id_) continue;
            const Json& definition = content_->find(component.value("componentId", std::string()));
            const Json inputs = definition.value("inputEnergies", Json::array());
            if (std::find(inputs.begin(), inputs.end(), Json(link_energy_type_)) != inputs.end()) {
                link_target_id_ = instance;
                break;
            }
        }
    }
    select_option(link_source_picker_, link_source_id_);
    select_option(link_target_picker_, link_target_id_);
    link_source_picker_->connect("item_selected", Callable(this, "on_link_source_selected"));
    link_target_picker_->connect("item_selected", Callable(this, "on_link_target_selected"));
    link_energy_picker_->connect("item_selected", Callable(this, "on_link_energy_selected"));
    row->add_child(link_source_picker_);
    row->add_child(link_target_picker_);
    row->add_child(link_energy_picker_);

    const std::string source_id = link_source_id_, target_id = link_target_id_;
    bool compatible = !source_id.empty() && source_id != target_id && possible_types.count(link_energy_type_) > 0;
    bool source_supports = false, target_supports = false;
    for (const Json& component : components) {
        const std::string component_instance = component.value("id", std::string());
        const Json& definition = content_->find(component.value("componentId", std::string()));
        const Json outputs = definition.value("outputEnergies", Json::array());
        const Json inputs = definition.value("inputEnergies", Json::array());
        if (component_instance == source_id) {
            source_supports = std::find(outputs.begin(), outputs.end(), Json(link_energy_type_)) != outputs.end();
        }
        if (component_instance == target_id) {
            target_supports = std::find(inputs.begin(), inputs.end(), Json(link_energy_type_)) != inputs.end();
        }
    }
    compatible = compatible && source_supports && target_supports;
    add_button(this, "포트 연결", Callable(this, "on_connect_components"), !compatible);
    if (!compatible) add_label(this, "선택한 부품의 출력·입력 포트가 맞는지 확인하세요.", 15);

    const Json links = selected_machine_.value("links", Json::array());
    if (links.empty()) add_label(this, "연결된 에너지 포트가 없습니다.", 15);
    for (const Json& link : links) {
        std::string from_name = "출력", to_name = "입력";
        for (const Json& component : components) {
            const std::string id = component.value("id", std::string());
            if (id == link.value("from", std::string())) from_name = name_of(component.value("componentId", std::string()));
            if (id == link.value("to", std::string())) to_name = name_of(component.value("componentId", std::string()));
        }
        add_label(this, from_name + " → " + to_name + " · " +
                  energy_name(link.value("type", std::string())), 16);
    }
}

void MachinePanel::render_machine_controls() {
    add_label(this, "고정과 조종", 22);
    const bool anchored = selected_machine_.value("anchored", false);
    auto* row = add_row(this);
    add_button(row, anchored ? "고정 풀기" : "제자리에 고정", Callable(this, "on_anchor"));

    bool healthy_controller = false;
    const Json controller_components = selected_machine_.value("components", Json::array());
    const Json machine_voxels = selected_machine_.value("voxels", Json::array());
    for (const Json& component : controller_components) {
        if (component.value("componentId", std::string()) != "controller") continue;
        const std::string voxel_id = component.value("voxelId", std::string());
        for (const Json& voxel : machine_voxels) {
            if (voxel.value("id", std::string()) != voxel_id) continue;
            const double max_hp = voxel.value("maxHp", 0.0);
            healthy_controller = voxel.value("hp", 0.0) > 0 && max_hp > 0;
            break;
        }
        if (healthy_controller) break;
    }
    const Vec3 machine_position = read_vec(selected_machine_.value("position", Json::array()));
    const bool near_enough = (machine_position - player_position_).length() <= 5.0;
    if (drive_machine_) {
        add_button(row, "조종석에 타기", Callable(this, "on_drive_machine"),
                   !healthy_controller || !near_enough);
        if (!healthy_controller) add_label(this, "조종하려면 손상되지 않은 조종 장치를 장착하세요.", 15);
        else if (!near_enough) add_label(this, "조종 장치에서 5m 안으로 다가오세요.", 15);
    }

    const Json command = selected_machine_.value("command", Json::object());
    auto* controls = add_row(this);
    auto spin = [&](const std::string& label, double value, SpinBox*& slot) {
        auto* group = memnew(VBoxContainer);
        controls->add_child(group);
        add_label(group, label, 15);
        slot = memnew(SpinBox);
        slot->set_min(-1);
        slot->set_max(1);
        slot->set_step(0.1);
        slot->set_value(value);
        slot->set_custom_minimum_size({82, 42});
        group->add_child(slot);
    };
    spin("가속", command.value("throttle", 0.0), throttle_picker_);
    spin("조향", command.value("steer", 0.0), steer_picker_);
    spin("상하", command.value("pitch", 0.0), pitch_picker_);
    spin("추력", command.value("push", 0.0), push_picker_);
    brake_picker_ = memnew(CheckButton);
    brake_picker_->set_text(gs("제동"));
    brake_picker_->set_pressed(command.value("brake", false));
    controls->add_child(brake_picker_);
    add_button(this, "조종 명령 적용", Callable(this, "on_control_machine"));
}

void MachinePanel::on_machine_selected(int index) {
    if (!machine_picker_ || index < 0 || index >= machine_picker_->get_item_count()) return;
    set_selected_machine(fs(machine_picker_->get_item_metadata(index)));
    status_text_ = "기계를 선택했습니다.";
    refresh();
}

void MachinePanel::on_drive_machine() {
    if (!drive_machine_ || selected_machine_id_.empty()) return;
    const Json result = drive_machine_(selected_machine_id_);
    if (!result.value("ok", false)) {
        status_text_ = localized_reason(result);
        refresh();
        return;
    }
    status_text_ = "조종석에 탔습니다.";
}

void MachinePanel::on_machine_name_changed(String value) { machine_name_ = fs(value); }

void MachinePanel::on_grid_size_selected(int index) {
    if (!grid_size_picker_ || index < 0) return;
    const std::string value = fs(grid_size_picker_->get_item_metadata(index));
    try { grid_m_ = std::stod(value); } catch (...) { return; }
    refresh();
}

void MachinePanel::on_material_selected(int index) {
    if (!material_picker_ || index < 0) return;
    selected_material_id_ = fs(material_picker_->get_item_metadata(index));
    refresh();
}

void MachinePanel::on_component_selected(int index) {
    if (!component_picker_ || index < 0) return;
    selected_component_id_ = fs(component_picker_->get_item_metadata(index));
    selected_variant_.clear();
    refresh();
}

void MachinePanel::on_variant_selected(int index) {
    if (!variant_picker_ || index < 0) return;
    selected_variant_ = fs(variant_picker_->get_item_metadata(index));
}

void MachinePanel::on_link_source_selected(int index) {
    if (link_source_picker_ && index >= 0) link_source_id_ = fs(link_source_picker_->get_item_metadata(index));
    refresh();
}

void MachinePanel::on_link_target_selected(int index) {
    if (link_target_picker_ && index >= 0) link_target_id_ = fs(link_target_picker_->get_item_metadata(index));
    refresh();
}

void MachinePanel::on_link_energy_selected(int index) {
    if (link_energy_picker_ && index >= 0) link_energy_type_ = fs(link_energy_picker_->get_item_metadata(index));
    refresh();
}

void MachinePanel::on_layer_changed(double value) {
    layer_y_ = std::clamp(static_cast<int>(std::round(value)), -128, 128);
    refresh();
}

void MachinePanel::on_tool_selected(int mode) {
    if (mode < TOOL_SELECT || mode > TOOL_REPAIR) return;
    tool_mode_ = static_cast<ToolMode>(mode);
    refresh();
}

void MachinePanel::on_grid_cell_pressed(int x, int y, int z) { handle_grid_cell(x, y, z); }

void MachinePanel::on_grid_shift_x(int direction) { grid_x_origin_ = std::clamp(grid_x_origin_ + direction, -128, 120); refresh(); }
void MachinePanel::on_grid_shift_z(int direction) { grid_z_origin_ = std::clamp(grid_z_origin_ + direction, -128, 120); refresh(); }

void MachinePanel::handle_grid_cell(int x, int y, int z) {
    if (selected_machine_id_.empty()) { status_text_ = "먼저 기계를 선택하세요."; refresh(); return; }
    Json voxel;
    for (const Json& candidate : selected_machine_.value("voxels", Json::array())) {
        const Json cell = candidate.value("cell", Json::array());
        if (cell.is_array() && cell.size() >= 3 && cell[0] == x && cell[1] == y && cell[2] == z) { voxel = candidate; break; }
    }
    if (tool_mode_ == TOOL_SELECT) {
        selected_voxel_id_ = voxel.value("id", std::string());
        status_text_ = selected_voxel_id_.empty() ? "빈 칸을 선택했습니다." : "복셀을 선택했습니다.";
        refresh();
        return;
    }
    if (tool_mode_ == TOOL_ADD) {
        if (!voxel.empty()) { status_text_ = "그 칸은 이미 차 있습니다."; refresh(); return; }
        if (selected_material_id_.empty()) { status_text_ = "사용할 재료가 없습니다."; refresh(); return; }
        Json result = execute("machine.attach", {{"cell", Json::array({x, y, z})}, {"materialId", selected_material_id_}}, false);
        if (result.value("ok", false)) selected_voxel_id_ = result.value("voxelId", std::string());
        refresh();
        return;
    }
    if (voxel.empty()) { status_text_ = "복셀이 있는 칸을 선택하세요."; refresh(); return; }
    selected_voxel_id_ = voxel.value("id", std::string());
    if (tool_mode_ == TOOL_REMOVE) {
        Json result = execute("machine.remove", {{"partId", selected_voxel_id_}}, false);
        if (result.value("ok", false)) selected_voxel_id_.clear();
        refresh();
        return;
    }
    if (tool_mode_ == TOOL_REPAIR) {
        if (voxel.value("hp", 0.0) >= voxel.value("maxHp", 0.0) - 1e-7) {
            status_text_ = "이미 수리된 복셀입니다.";
            refresh();
            return;
        }
        execute("machine.repair", {{"partId", selected_voxel_id_}}, true);
    }
}

void MachinePanel::on_create_machine() {
    if (machine_name_input_) machine_name_ = fs(machine_name_input_->get_text());
    Vec3 position = player_position_ + Vec3{-std::sin(player_yaw_) * 2.5, 0, -std::cos(player_yaw_) * 2.5};
    position.y = world_ ? world_->surface_height(position.x, position.z) : player_position_.y;
    Json result = execute("machine.create", {{"name", machine_name_.empty() ? "나의 구조물" : machine_name_},
                                              {"gridM", grid_m_}, {"position", position}, {"yaw", player_yaw_}}, false);
    if (result.value("ok", false)) set_selected_machine(result.value("machineId", std::string()));
    refresh();
}

void MachinePanel::install_selected_component() {
    if (selected_machine_id_.empty() || selected_voxel_id_.empty() || selected_component_id_.empty()) {
        status_text_ = "복셀과 부품을 먼저 선택하세요.";
        refresh();
        return;
    }
    Json args = {{"voxelId", selected_voxel_id_}, {"componentId", selected_component_id_}};
    if (!selected_variant_.empty()) args["legacyType"] = selected_variant_;
    execute("machine.install", std::move(args));
}

void MachinePanel::on_install_component() { install_selected_component(); }

void MachinePanel::on_remove_component(String component_id) {
    execute("machine.remove_component", {{"componentInstanceId", fs(component_id)}});
}

void MachinePanel::on_toggle_component(String component_id, bool active) {
    execute("machine.active", {{"componentInstanceId", fs(component_id)}, {"active", active}});
}

void MachinePanel::on_refuel(String component_id) {
    execute("machine.refuel", {{"componentInstanceId", fs(component_id)}, {"itemId", "raw_timber"}, {"count", 1}});
}

void MachinePanel::on_anchor() {
    const bool anchored = selected_machine_.value("anchored", false);
    execute("machine.anchor", {{"anchored", !anchored}});
}

void MachinePanel::on_example(bool heavy) {
    Json result = execute("machine.example", {{"heavy", heavy}}, false);
    if (result.value("ok", false)) set_selected_machine(result.value("machineId", std::string()));
    refresh();
}

void MachinePanel::on_return_to_pad() {
    if (selected_machine_id_.empty()) { status_text_ = "기계를 선택하세요."; refresh(); return; }
    execute("machine.return_to_pad", {{"id", selected_machine_id_}});
}

void MachinePanel::on_control_machine() {
    if (!throttle_picker_ || !steer_picker_ || !pitch_picker_ || !push_picker_ || !brake_picker_) return;
    execute("machine.control", {{"throttle", throttle_picker_->get_value()}, {"steer", steer_picker_->get_value()},
                                 {"pitch", pitch_picker_->get_value()}, {"push", push_picker_->get_value()},
                                 {"brake", brake_picker_->is_pressed()}});
}

void MachinePanel::on_component_power(String component_id, String energy_type, bool fill) {
    const std::string command = fill ? "machine.charge" : "machine.drain";
    execute(command, {{"componentInstanceId", fs(component_id)}, {"type", fs(energy_type)}, {"amount", 10}});
}

void MachinePanel::on_component_fluid(String component_id,String fluid_id,bool fill){
    execute(fill?"machine.fluid.fill":"machine.fluid.drain",{{"componentInstanceId",fs(component_id)},{"fluid",fs(fluid_id)},{"liters",1}});
}

void MachinePanel::on_connect_components() {
    if (!link_source_picker_ || !link_target_picker_ || !link_energy_picker_) return;
    const int source_index = link_source_picker_->get_selected();
    const int target_index = link_target_picker_->get_selected();
    const int energy_index = link_energy_picker_->get_selected();
    if (source_index < 0 || target_index < 0 || energy_index < 0) return;
    execute("machine.connect", {{"from", fs(link_source_picker_->get_item_metadata(source_index))},
                                 {"to", fs(link_target_picker_->get_item_metadata(target_index))},
                                 {"type", fs(link_energy_picker_->get_item_metadata(energy_index))}});
}

void MachinePanel::on_connect_fluid(){
    if(!fluid_source_picker_||!fluid_pump_picker_||!fluid_target_picker_)return;
    const int source=fluid_source_picker_->get_selected(),pump=fluid_pump_picker_->get_selected(),target=fluid_target_picker_->get_selected();
    if(source<0||pump<0||target<0)return;
    execute("machine.fluid.connect",{{"sourceComponentInstanceId",fs(fluid_source_picker_->get_item_metadata(source))},
        {"pumpComponentInstanceId",fs(fluid_pump_picker_->get_item_metadata(pump))},
        {"targetComponentInstanceId",fs(fluid_target_picker_->get_item_metadata(target))}});
}

void MachinePanel::on_disconnect_fluid(String fluid_link_id){execute("machine.fluid.disconnect",{{"fluidLinkId",fs(fluid_link_id)}});}

void MachinePanel::on_cargo_transfer(String item_id,bool loading){
    const std::string item=fs(item_id);execute(loading?"machine.cargo.load":"machine.cargo.unload",{{"items",{{item,1}}}});
}

Json MachinePanel::command_coverage() {
    return Json::array({"machine.create", "machine.attach", "machine.remove", "machine.repair", "machine.install",
                        "machine.remove_component", "machine.active", "machine.refuel", "machine.charge",
                        "machine.drain", "machine.control", "machine.anchor", "machine.example",
                        "machine.return_to_pad", "machine.connect", "machine.fluid.fill", "machine.fluid.drain",
                        "machine.fluid.connect", "machine.fluid.disconnect", "machine.cargo.load", "machine.cargo.unload"});
}

} // namespace feral
