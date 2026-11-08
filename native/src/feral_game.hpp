#pragma once
#include "actions.hpp"
#include "gameplay.hpp"
#include "simulation.hpp"
#include "world.hpp"
#include "world_tools.hpp"
#include "native_geometry.hpp"
#include "native_body.hpp"
#include "action_timeline.hpp"
#include "input_state.hpp"
#include <memory>
#include <deque>
#include <godot_cpp/classes/node3d.hpp>
#include <godot_cpp/classes/character_body3d.hpp>
#include <godot_cpp/classes/rigid_body3d.hpp>
#include <godot_cpp/classes/animatable_body3d.hpp>
#include <godot_cpp/classes/static_body3d.hpp>
#include <godot_cpp/classes/camera3d.hpp>
#include <godot_cpp/classes/mesh_instance3d.hpp>
#include <godot_cpp/classes/canvas_layer.hpp>
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/v_box_container.hpp>
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <godot_cpp/classes/option_button.hpp>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/classes/theme.hpp>
#include <godot_cpp/classes/audio_stream_player.hpp>

namespace feral {
class Storage;
class FeralGame : public godot::Node3D {
    GDCLASS(FeralGame,godot::Node3D)
    struct TerrainNode {godot::StaticBody3D* body=nullptr;godot::MeshInstance3D* mesh=nullptr;godot::MeshInstance3D* fluid=nullptr;uint64_t terrain_revision=UINT64_MAX,fluid_revision=UINT64_MAX;};
    struct DynamicNode {NativeBody* body=nullptr;godot::MeshInstance3D* mesh=nullptr;uint64_t revision=UINT64_MAX,mass_revision=UINT64_MAX;bool machine=false,fixture=false;Vec3 bounds_center,bounds_size;std::vector<Box> boxes;};
    struct PartNode {godot::Node3D* node=nullptr;godot::MeshInstance3D* mesh=nullptr;godot::Node3D* bone_node=nullptr;godot::MeshInstance3D* bone_mesh=nullptr;std::vector<uint32_t> shape_owners,bone_shape_owners;std::vector<DrawBox> boxes,bone_boxes;godot::Vector3 base_translation;godot::Transform3D shape_transform,bone_shape_transform;bool shape_visible=true,bone_shape_visible=true;};
    struct EntityNode {godot::AnimatableBody3D* body=nullptr;godot::Node3D* visual_root=nullptr;std::string asset,kind;std::map<std::string,PartNode> parts;int64_t revision=-1,wound_revision=-1,structure_revision=-1;std::shared_ptr<const Json> anatomy_source;};
    Content content_;
    Json presets_,profiles_,settings_,config_,catalog_,last_view_,panel_args_=Json::object();
    Json update_info_=Json::object();
    Json active_weapon_=Json::object(),paid_attack_=Json::object();
    uint64_t paid_attack_id_=0;
    std::string grass_reward_attack_;
    int grass_cells_removed_=0;
    bool grass_seed_awarded_=false;
    double next_action_time_=0;
    std::string update_status_;
    bool update_downloaded_=false,legacy_import_pending_=false;
    std::string migration_error_;
    std::unique_ptr<World> world_;
    std::unique_ptr<Gameplay> gameplay_;
    std::unique_ptr<Simulation> simulation_;
    std::unique_ptr<Storage> storage_;
    std::unique_ptr<WorldTools> world_tools_;
    Actions actions_;
    Actions preview_actions_;
    ActionTimeline* timeline_=nullptr;
    std::string preview_profile_;
    bool preview_running_=false;
    godot::Node3D* world_root_=nullptr;
    godot::CharacterBody3D* player_=nullptr;
    godot::Camera3D* camera_=nullptr;
    godot::Node3D* hand_=nullptr;
    godot::CanvasLayer* canvas_=nullptr;
    godot::Control* screen_=nullptr;
    godot::Control* hud_=nullptr;
    godot::Label* hud_status_=nullptr;
    godot::Label* toast_=nullptr;
    godot::Label* target_label_=nullptr;
    godot::VBoxContainer* panel_body_=nullptr;
    godot::LineEdit* name_input_=nullptr;
    godot::OptionButton* preset_input_=nullptr;
    std::map<std::string,godot::Control*> form_inputs_;
    godot::Ref<godot::Theme> theme_;
    godot::Ref<godot::StandardMaterial3D> material_;
    godot::Ref<godot::StandardMaterial3D> fluid_material_;
    godot::Ref<godot::StandardMaterial3D> transparent_material_;
    std::map<Cell,TerrainNode> terrain_;
    std::deque<Cell> mesh_queue_;
    std::set<Cell> mesh_pending_;
    std::set<Cell> loaded_sections_;
    uint64_t stream_revision_=UINT64_MAX;
    std::map<std::string,DynamicNode> dynamics_;
    Json fixture_geometry_=Json::array();
    uint64_t fixture_geometry_revision_=UINT64_MAX;
    std::deque<std::string> fixture_support_queue_;
    double next_support_scan_=0;
    std::map<std::string,EntityNode> entities_;
    mutable std::map<std::string,double> authored_radius_cache_;
    std::map<std::string,godot::Ref<godot::ArrayMesh>> model_meshes_;
    std::map<std::string,double> impact_cooldowns_;
    struct FeedbackMark {godot::MeshInstance3D* mesh;double expires;};
    std::vector<FeedbackMark> feedback_marks_;
    godot::AudioStreamPlayer* impact_audio_=nullptr;
    double audio_at_=-1,slow_until_=0;
    std::string world_id_,session_id_,panel_,held_="stone_pick",gripped_,driving_;
    std::string stance_="stand";
    std::string target_id_;
    double yaw_=0,pitch_=0,clock_=0,ui_clock_=0,save_clock_=0,toast_remaining_=0;
    Vec3 access_position_{};
    uint64_t access_last_update_msec_=0,access_placement_revision_=UINT64_MAX;
    bool access_initialized_=false;
    double grip_distance_=2.4,fall_speed_=0;
    InputState input_state_;
    std::vector<HudTouchBinding> hud_touch_bindings_;
    bool collect_hud_touch_bindings_=false;
    bool playing_=false,paused_=false,smoke_=false,visual_enabled_=true;
    bool stance_blocked_=false,space_down_=false,crouch_key_down_=false,crawl_key_down_=false;
    bool runtime_check_=false;
    int runtime_check_frame_=0;
    std::vector<double> runtime_samples_[3];
    std::map<std::string,std::array<std::vector<double>,3>> runtime_stage_samples_;
    std::vector<Cell> runtime_tree_roots_;
    size_t runtime_initial_sections_=0;
    double runtime_detach_ms_=0;
    Vec3 runtime_player_min_,runtime_player_max_;
    uint64_t runtime_sections_added_=0,runtime_sections_removed_=0;
    uint64_t runtime_late_rebuilds_=0;
    bool ui_check_=false;
    int ui_check_frame_=0,ui_check_index_=0;
    Json ui_evidence_=Json::array();
    int smoke_frame_=0;
    uint64_t hit_count_=0,rebuilt_sections_=0;
    Contact aim_;
    static Json read_json(const std::string& path);
    static void write_json(const std::string& path,const Json& value);
    void load_global_settings();
    void build_theme();
    void clear_screen();
    void show_launcher();
    void show_create_world();
    void start_world(const std::string& id);
    void save_world();
    void close_world();
    void build_hud();
    void show_panel(const std::string& name,Json args=Json::object());
    void refresh_panel();
    void refresh_hud();
    void notice(const std::string& text);
    godot::VBoxContainer* make_panel(const std::string& title,bool wide=false);
    void render_result(godot::Node* parent,const Json& data,int depth=0);
    void add_label(godot::Node* parent,const std::string& text,int size=20);
    void add_button(godot::Node* parent,const std::string& text,const std::string& command,Json args=Json::object());
    void register_hud_touch_button(godot::BaseButton* button,const std::string& command,Json payload,bool held_action=false);
    void clear_input_state(bool reset_key_edges=false);
    void update_touch_movement();
    void handle_screen_touch(const godot::Ref<godot::InputEvent>& event);
    bool touch_button_at(const godot::Vector2& position,HudTouchBinding& binding) const;
    bool button_contains(godot::BaseButton* button,const godot::Vector2& position) const;
    godot::String interaction_state() const;
    void ui_command(godot::String command,godot::String payload);
    void form_target_changed(int64_t index);
    void preset_changed(int64_t index);
    void profile_changed(double value,godot::String path,godot::String id);
    void preview_seek(double frame);
    void migration_finished(godot::String path,godot::String error);
    void update_checked(godot::String json,godot::String error);
    void update_progress(int64_t downloaded,int64_t total);
    void update_downloaded(godot::String path,godot::String error);
    void installer_result(godot::String status,godot::String error);
    Json dispatch(const std::string& name,Json args);
    bool occupied_cell(Vec3 center);
    Json enter_machine(const std::string& id);
    void exit_machine();
    void sync_driving(double dt,godot::Vector2 move);
    bool request_stance(const std::string& stance);
    void cycle_stance();
    void build_scene();
    void sync_terrain(bool initial=false);
    void sync_dynamics(bool teleport=false);
    void require_dynamic_terrain();
    void sync_entities();
    void sync_fixture_support();
    void refresh_access();
    void apply_player_stance();
    void sync_player(double dt);
    void sync_hand();
    void apply_forces();
    void physics_feedback();
    void resolve_impacts();
    void consume_feedback();
    void play_impact();
    void build_entity(EntityNode&,const EntityPose&);
    void update_entity_geometry(EntityNode&,const EntityPose&,bool force=false);
    std::vector<DrawBox> part_boxes(const Json& model,const Json& part,const Json* anatomy=nullptr,bool bones=false)const;
    double cached_authored_radius(const std::string& asset_id)const;
    double entity_broadphase_radius(const EntityNode& entity)const;
    void set_shapes(godot::CollisionObject3D* body,const std::vector<Box>& boxes);
    std::vector<ContactResult> resolve_contacts(const HitQuery& query);
    Contact aim_contact(Vec3 origin,Vec3 direction,double reach);
    void apply_contact(const ContactEvent& event);
    ActorPose actor_pose()const;
    void interact();
    void prepare_runtime_check(Vec3 spawn);
    void runtime_check_step(double milliseconds);
    void smoke_step();
    void ui_check_step();
protected:
    static void _bind_methods();
    void _notification(int what);
public:
    FeralGame();
    ~FeralGame();
    void _ready() override;
    void _process(double dt) override;
    void _physics_process(double dt) override;
    void _input(const godot::Ref<godot::InputEvent>& event) override;
    void _unhandled_input(const godot::Ref<godot::InputEvent>& event) override;
};
}
