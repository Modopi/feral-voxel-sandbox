#include "feral_game.hpp"
#include "storage.hpp"
#include "physics_harness.hpp"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/project_settings.hpp>
#include <godot_cpp/classes/os.hpp>
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/input_event_key.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
#include <godot_cpp/classes/capsule_shape3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_shape_query_parameters3d.hpp>
#include <godot_cpp/classes/world3d.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/classes/viewport_texture.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/display_server.hpp>
#include <godot_cpp/classes/dir_access.hpp>
#include <godot_cpp/classes/base_button.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <filesystem>
#include <fstream>

namespace feral {
using namespace godot;
FeralGame::FeralGame()=default;
FeralGame::~FeralGame()=default;
void FeralGame::_bind_methods(){
    ClassDB::bind_method(D_METHOD("ui_command","command","payload"),&FeralGame::ui_command);
    ClassDB::bind_method(D_METHOD("form_target_changed","index"),&FeralGame::form_target_changed);
    ClassDB::bind_method(D_METHOD("preset_changed","index"),&FeralGame::preset_changed);
    ClassDB::bind_method(D_METHOD("profile_changed","value","path","id"),&FeralGame::profile_changed);
    ClassDB::bind_method(D_METHOD("preview_seek","frame"),&FeralGame::preview_seek);
    ClassDB::bind_method(D_METHOD("migration_finished","path","error"),&FeralGame::migration_finished);
    ClassDB::bind_method(D_METHOD("update_checked","json","error"),&FeralGame::update_checked);
    ClassDB::bind_method(D_METHOD("update_progress","downloaded","total"),&FeralGame::update_progress);
    ClassDB::bind_method(D_METHOD("update_downloaded","path","error"),&FeralGame::update_downloaded);
    ClassDB::bind_method(D_METHOD("installer_result","status","error"),&FeralGame::installer_result);
}
void FeralGame::_notification(int what){
    if(what==NOTIFICATION_APPLICATION_PAUSED||what==NOTIFICATION_WM_CLOSE_REQUEST){
        attack_down_=false;jump_=false;movement_={};move_touch_=look_touch_=-1;
        if(playing_)try{save_world();if(what==NOTIFICATION_APPLICATION_PAUSED)show_panel("pause");}catch(const std::exception& e){UtilityFunctions::push_error(gs(std::string("저장 실패: ")+e.what()));}
    }else if(what==NOTIFICATION_APPLICATION_RESUMED){attack_down_=false;jump_=false;movement_={};move_touch_=look_touch_=-1;space_down_=crouch_key_down_=crawl_key_down_=false;
    }else if(what==NOTIFICATION_WM_GO_BACK_REQUEST){
        if(playing_){if(panel_.empty())show_panel("pause");else build_hud();}else get_tree()->quit();
    }
}
Json FeralGame::read_json(const std::string& path){
    String raw=FileAccess::get_file_as_string(gs(path));if(raw.is_empty())throw std::runtime_error("읽을 수 없는 파일: "+path);return Json::parse(fs(raw));
}
void FeralGame::write_json(const std::string& path,const Json& data){
    const std::string temporary=path+".tmp";auto file=FileAccess::open(gs(temporary),FileAccess::WRITE);if(file.is_null())throw std::runtime_error("저장할 수 없는 파일: "+path);file->store_string(gs(data.dump()));file->flush();file->close();
    auto settings=ProjectSettings::get_singleton();if(DirAccess::rename_absolute(settings->globalize_path(gs(temporary)),settings->globalize_path(gs(path)))!=OK)throw std::runtime_error("저장을 완료할 수 없습니다: "+path);
}
void FeralGame::load_global_settings(){
    auto saved=storage_->load_settings();if(saved.is_object()){
        auto values=saved.value("settings",Json::object());if(values.is_object()){
            auto numeric=[&](const std::string& key,double fallback){if(!values.contains(key))return fallback;if(values[key].is_number())return values[key].get<double>();if(values[key].is_string())try{return std::stod(values[key].get<std::string>());}catch(...){}return fallback;};
            double sensitivity=numeric("sensitivity",.0025);if(sensitivity>.02)sensitivity=sensitivity/80*.0025;settings_.update(values);settings_["sensitivity"]=std::clamp(sensitivity,.0005,.01);settings_["fov"]=std::clamp(numeric("fov",82),50.0,105.0);
            settings_["viewDistance"]=int(std::clamp(numeric("viewDistance",values.value("quality",std::string("balanced"))=="low"?4:values.value("quality",std::string("balanced"))=="high"?10:6),3.0,16.0));
        }
    }visual_enabled_=settings_.value("visualAnimation",true);if(camera_)camera_->set_fov(settings_.value("fov",82.0));
}
void FeralGame::_ready(){
    try{
        if(OS::get_singleton()->get_cmdline_user_args().has("--feral-physics-check")){add_child(memnew(NativePhysicsHarness));return;}
        set_process_mode(Node::PROCESS_MODE_ALWAYS);
        ui_check_=OS::get_singleton()->get_cmdline_user_args().has("--feral-ui-check");
        runtime_check_=OS::get_singleton()->get_cmdline_user_args().has("--feral-runtime-check");
        smoke_=runtime_check_||ui_check_||OS::get_singleton()->get_cmdline_user_args().has("--feral-smoke");
        content_.data=read_json("res://data/content.json");content_.data["runtimeModules"]=read_json("res://data/modules.json");content_.assets=read_json("res://data/assets.json");content_.index();
        presets_=read_json("res://data/presets.json");profiles_=read_json("res://data/action_profiles.json");
        if(FileAccess::file_exists("user://action_profiles.json"))profiles_=read_json("user://action_profiles.json");
        actions_.configure(profiles_);
        settings_={{"sensitivity",.0025},{"viewDistance",6},{"masterVolume",.8},{"fov",75},{"visualAnimation",true}};
        if(FileAccess::file_exists("user://settings.json"))settings_.update(read_json("user://settings.json"));
        const std::string storage_path=smoke_?"user://native-checks/"+std::to_string(int64_t(Time::get_singleton()->get_unix_time_from_system()*1000000)):"user://worlds";
        auto directory=ProjectSettings::get_singleton()->globalize_path(gs(storage_path));
        storage_=std::make_unique<Storage>(fs(directory));catalog_=storage_->load_catalog();load_global_settings();
        build_theme();build_scene();
        if(smoke_){
            Json row={{"id","native-smoke"},{"name","네이티브 검증"},{"type","expedition"},{"seed",63026}};
            const auto& p=presets_["presets"]["expedition"];row["config"]={{"configVersion",1},{"preset","expedition"},{"seed",63026},{"terrain",{{"generator",p["terrain"]}}},{"rules",p["rules"]},{"modules",Json::array()}};
            storage_->upsert_world(row);start_world("native-smoke");
        }else{
            legacy_import_pending_=Engine::get_singleton()->has_singleton("FeralMigration")&&!storage_->legacy_import_status().value("complete",false);show_launcher();
            if(Engine::get_singleton()->has_singleton("FeralUpdates")){
                Object* bridge=Engine::get_singleton()->get_singleton("FeralUpdates");bridge->connect("checked",Callable(this,"update_checked"));bridge->connect("download_progress",Callable(this,"update_progress"));bridge->connect("downloaded",Callable(this,"update_downloaded"));bridge->connect("installer_result",Callable(this,"installer_result"));
            }
            if(Engine::get_singleton()->has_singleton("FeralMigration")&&!storage_->legacy_import_status().value("complete",false)){
                Object* bridge=Engine::get_singleton()->get_singleton("FeralMigration");
                bridge->connect("completed",Callable(this,"migration_finished"));bridge->call("start_import");
            }
        }
    }catch(const std::exception& e){UtilityFunctions::push_error(gs(e.what()));if(smoke_)get_tree()->quit(1);else{build_theme();clear_screen();add_label(make_panel("시작할 수 없습니다"),e.what());}}
}
void FeralGame::start_world(const std::string& id){
    if(legacy_import_pending_||storage_->legacy_import_status().value("exportFailed",false))throw std::runtime_error("기존 저장 가져오기가 끝나야 월드를 열 수 있습니다. 저장 가져오기에서 다시 시도하세요.");
    auto row=storage_->find_world(id);if(!row)throw std::runtime_error("세계를 찾을 수 없습니다");if(row->value("legacyImportBlocked",false))throw std::runtime_error("기존 저장을 확인해야 합니다: "+row->value("legacyImportWarning",std::string{}));Json next_config=storage_->world_config(id);if(playing_)close_world();config_=std::move(next_config);world_id_=id;session_id_=id+":"+std::to_string(int64_t(Time::get_singleton()->get_unix_time_from_system()*1000000));next_action_time_=0;
    world_=std::make_unique<World>(content_);gameplay_=std::make_unique<Gameplay>(content_);simulation_=std::make_unique<Simulation>(content_);
    world_->configure(config_);gameplay_->configure(config_);simulation_->configure(config_);world_tools_=std::make_unique<WorldTools>(content_,*world_,*gameplay_,*simulation_,[this](Vec3 p){return occupied_cell(p);});
    stance_="stand";stance_blocked_=false;space_down_=crouch_key_down_=crawl_key_down_=false;
    Vec3 spawn{0,0,0};std::string generator=config_["terrain"].value("generator",std::string("infinite"));
    if(generator=="island"||generator=="frontier")spawn={77.5,0,84.5};if(generator=="machine-field")spawn={0,0,16};
    spawn.y=world_->surface_height(spawn.x,spawn.z)+1.0;
    const auto snapshot=storage_->load_world(id);if(snapshot){
        const auto& envelope=*snapshot;
        const auto& data=envelope.contains("legacy")&&envelope["legacy"].contains("unified")&&(!envelope.contains("world")||envelope["world"].is_null())?envelope["legacy"]["unified"]:envelope;
        world_->load(data.contains("world")&&!data["world"].is_null()?data["world"]:data);
        gameplay_->load(data.contains("gameplay")&&!data["gameplay"].is_null()?data["gameplay"]:data);
        simulation_->load(data.contains("simulation")&&!data["simulation"].is_null()?data["simulation"]:data);if(data.contains("worldTools"))world_tools_->load(data["worldTools"]);
        if(data.contains("player")){const auto& p=data["player"];spawn=p.contains("position")?p["position"].get<Vec3>():p.get<Vec3>();yaw_=p.value("yaw",0.0);pitch_=p.value("pitch",0.0);held_=p.value("held",std::string("stone_pick"));const std::string saved_stance=p.value("stance",std::string("stand"));if(saved_stance=="stand"||saved_stance=="crouch"||saved_stance=="crawl")stance_=saved_stance;}
    }
    if(!snapshot)gameplay_->initialize_new_world();
    if(gameplay_->count(held_)<1)held_=gameplay_->count("stone_pick")>=1?"stone_pick":gameplay_->count("hand_knife")>=1?"hand_knife":"";
    if(smoke_&&!ui_check_&&!runtime_check_){yaw_=pitch_=0;for(int x:{-4,0,4}){double h=world_->surface_height(spawn.x+x*.5,spawn.z-2);int base=int(std::round(h*2));for(int y=0;y<9;y++)world_->set_block({int(std::floor(spawn.x*2))+x,base+y,int(std::floor(spawn.z*2))-4},"log");}}
    if(runtime_check_)prepare_runtime_check(spawn);
    player_->set_position(gv(spawn));player_->set_velocity({});player_->set_rotation(Vector3(0,real_t(yaw_),0));apply_player_stance();camera_->set_rotation(Vector3(real_t(pitch_),0,0));
    playing_=true;paused_=false;access_initialized_=false;clock_=ui_clock_=save_clock_=0;actions_.reset();refresh_access();
    simulation_->tick(0,spawn,*world_,*gameplay_);require_dynamic_terrain();world_->stream(spawn,settings_.value("viewDistance",6));sync_terrain(true);sync_entities();sync_dynamics();sync_hand();build_hud();
    if(!smoke_&&!OS::get_singleton()->has_feature("mobile"))Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_CAPTURED);
    notice("월드를 불러왔습니다");
}
void FeralGame::save_world(){
    if(!playing_)return;physics_feedback();
    Json state={{"schemaVersion",1},{"nativeSchema",1},{"config",config_},{"world",world_->save()},{"gameplay",gameplay_->save()},{"simulation",simulation_->save()},{"worldTools",world_tools_->save()},
        {"player",{{"position",fv(player_->get_position())},{"yaw",yaw_},{"pitch",pitch_},{"held",held_},{"stance",stance_}}}};
    storage_->save_world(world_id_,state);save_clock_=0;
}
void FeralGame::close_world(){
    if(!playing_)return;exit_machine();save_world();playing_=false;paused_=false;actions_.reset();
    for(auto& [k,n]:terrain_)n.body->queue_free();terrain_.clear();mesh_queue_.clear();mesh_pending_.clear();loaded_sections_.clear();stream_revision_=UINT64_MAX;
    for(auto& [k,n]:dynamics_)n.body->queue_free();dynamics_.clear();fixture_geometry_=Json::array();fixture_geometry_revision_=UINT64_MAX;fixture_support_queue_.clear();next_support_scan_=0;for(auto& [k,n]:entities_)n.body->queue_free();entities_.clear();
    for(auto& mark:feedback_marks_)mark.mesh->queue_free();feedback_marks_.clear();world_tools_.reset();world_.reset();gameplay_.reset();simulation_.reset();gripped_.clear();driving_.clear();
    Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_VISIBLE);show_launcher();
}
ActorPose FeralGame::actor_pose()const{return {fv(camera_->get_global_position()),fq(camera_->get_global_basis().get_rotation_quaternion())};}
void FeralGame::_physics_process(double dt){
    if(smoke_&&!ui_check_&&paused_&&smoke_frame_==65){build_hud();}
    if(!playing_||paused_)return;
    const uint64_t tick_started=Time::get_singleton()->get_ticks_usec();uint64_t stage_started=tick_started;
    auto stage=[&](const char* name){if(!runtime_check_)return;const uint64_t now=Time::get_singleton()->get_ticks_usec();if(runtime_check_frame_>=30)runtime_stage_samples_[name][runtime_check_frame_<120?0:runtime_check_frame_<360?1:2].push_back((now-stage_started)/1000.0);stage_started=now;};
    try{
        clock_+=dt;save_clock_+=dt;physics_feedback();resolve_impacts();sync_player(dt);stage("feedback_impacts_player");
        Vec3 position=fv(player_->get_global_position());
        gameplay_->set_player_state({{"position",position},{"x",position.x},{"y",position.y},{"z",position.z},{"yaw",yaw_},{"moving",movement_.length()>0.1}});
        refresh_access();simulation_->set_player_state(gameplay_->player_state());
        stage("access");world_->tick(dt);stage("world");gameplay_->tick(dt);stage("gameplay");simulation_->tick(dt,position,*world_,*gameplay_);stage("simulation");consume_feedback();
        if(attack_down_&&!actions_.active()&&clock_>=next_action_time_){
            auto held_attack=gameplay_->held_attack();
            std::string profile="pick";
            if(held_.find("knife")!=std::string::npos)profile="knife";else if(held_.find("axe")!=std::string::npos)profile="axe";
            else if(held_.find("slash")!=std::string::npos||held_.find("sword")!=std::string::npos)profile="sword";
            else if(held_.find("pierce")!=std::string::npos||held_.find("spear")!=std::string::npos)profile="spear";
            else if(held_.find("blunt")!=std::string::npos||held_.find("hammer")!=std::string::npos||held_.find("club")!=std::string::npos)profile="hammer";
            if(held_.empty())profile=held_attack.value("profileId",std::string("pick"));
            if(actions_.begin({profile,actor_pose()})){
                active_weapon_=held_attack;paid_attack_id_=0;paid_attack_=Json::object();
                auto actor=actor_pose();auto hit=aim_contact(actor.origin,feral::rotate(actor.rotation,{0,0,-1}),6.5);
                bool mining=hit.kind=="terrain"||hit.kind=="body";
                next_action_time_=clock_+((!held_attack["instanceId"].is_null()||!mining)?held_attack.value("cooldown",.18):.18);
            }
        }
        actions_.advance(dt,actor_pose(),[this](const HitQuery&q){return resolve_contacts(q);},[this](const ContactEvent&e){apply_contact(e);});
        stage("actions_feedback");require_dynamic_terrain();stage("require_terrain");
        world_->stream(position,settings_.value("viewDistance",6));stage("stream");sync_terrain();stage("terrain_mesh");sync_entities();stage("entities");sync_fixture_support();sync_dynamics();stage("dynamics");apply_forces();stage("forces");
        if(gameplay_->player_state().value("hp",100.0)<=0&&!smoke_)show_panel("death");
        if(save_clock_>=30)try{save_world();}catch(const std::exception& e){save_clock_=25;notice(std::string("저장 재시도 대기: ")+e.what());}
        if(runtime_check_)runtime_check_step((Time::get_singleton()->get_ticks_usec()-tick_started)/1000.0);
        else if(smoke_&&!ui_check_)smoke_step();
    }catch(const std::exception&e){UtilityFunctions::push_error(gs(e.what()));notice(e.what());if(smoke_)get_tree()->quit(1);else{show_panel("pause");if(panel_body_)add_label(panel_body_,std::string("실행 오류로 일시정지했습니다: ")+e.what(),18);}}
}
void FeralGame::_process(double dt){
    if(ui_check_){try{ui_check_step();}catch(const std::exception& e){UtilityFunctions::push_error(gs(e.what()));get_tree()->quit(1);ui_check_=false;}}
    if(panel_=="action_detail"&&preview_running_){preview_actions_.advance(dt,ActorPose{},[](const HitQuery&){return std::vector<ContactResult>{};},[](const ContactEvent&){});if(timeline_)timeline_->set_frame(preview_actions_.sample_visual().timeline_frame);if(!preview_actions_.active())preview_running_=false;}
    if(!playing_)return;
    if(hand_){auto pose=panel_=="action_detail"?preview_actions_.sample_visual():actions_.sample_visual(Engine::get_singleton()->get_physics_interpolation_fraction());hand_->set_visible(visual_enabled_);hand_->set_position(Vector3(.42,-.4,-.68)+gv(pose.local_position));hand_->set_quaternion(gq(pose.local_rotation)*Quaternion(Vector3(1,0,0),-.65));}
    ui_clock_+=dt;if(ui_clock_>.2){ui_clock_=0;refresh_hud();}
    if(toast_remaining_>0){toast_remaining_-=dt;if(toast_remaining_<=0&&toast_)toast_->set_text("");}
}
void FeralGame::sync_player(double dt){
    auto input=Input::get_singleton();Vector2 move=movement_;
    if(panel_.empty()&&input->is_physical_key_pressed(KEY_W))move.y-=1;if(panel_.empty()&&input->is_physical_key_pressed(KEY_S))move.y+=1;
    if(panel_.empty()&&input->is_physical_key_pressed(KEY_A))move.x-=1;if(panel_.empty()&&input->is_physical_key_pressed(KEY_D))move.x+=1;
    if(move.length()>1)move=move.normalized();
    const bool c_down=input->is_physical_key_pressed(KEY_C),z_down=input->is_physical_key_pressed(KEY_Z);
    const bool space_down=input->is_physical_key_pressed(KEY_SPACE);
    const bool space_pressed=space_down&&!space_down_;
    if(panel_.empty()&&driving_.empty()){
        if(c_down&&!crouch_key_down_)request_stance(stance_=="crouch"?"stand":"crouch");
        if(z_down&&!crawl_key_down_)request_stance(stance_=="crawl"?"stand":"crawl");
    }
    crouch_key_down_=c_down;crawl_key_down_=z_down;space_down_=space_down;
    if(!driving_.empty()){sync_driving(dt,move);camera_->set_rotation(Vector3(real_t(pitch_),0,0));return;}
    player_->set_rotation(Vector3(0,real_t(yaw_),0));
    bool should_jump=jump_||space_pressed;
    if(should_jump&&stance_!="stand"){request_stance("stand");should_jump=false;}
    Vector3 direction=player_->get_basis().xform(Vector3(move.x,0,move.y));
    Vector3 velocity=player_->get_velocity();double speed=stance_=="crawl"?1.15:stance_=="crouch"?2.4:(input->is_physical_key_pressed(KEY_SHIFT)?6.5:4.2);
    if(clock_<slow_until_)speed*=.7;
    if(!gripped_.empty()){auto it=dynamics_.find(gripped_);if(it!=dynamics_.end())speed*=std::max(.45,1.0/(1+it->second.body->get_mass()/(held_=="gripper"?12000:1600)));}
    velocity.x=direction.x*speed;velocity.z=direction.z*speed;
    if(player_->is_on_floor()){if(fall_speed_>8)gameplay_->record_event({{"type","player_damage"},{"amount",std::min(100.0,40*(fall_speed_*fall_speed_-64)/140)}});fall_speed_=0;velocity.y=0;if(panel_.empty()&&should_jump)velocity.y=7;}
    else{velocity.y-=18*dt;fall_speed_=std::max(fall_speed_,double(-velocity.y));}jump_=false;
    player_->set_velocity(velocity);player_->move_and_slide();camera_->set_rotation(Vector3(real_t(pitch_),0,0));
}
void FeralGame::_unhandled_input(const Ref<InputEvent>& event){
    if(!playing_)return;
    if(auto key=Ref<InputEventKey>(event);key.is_valid()&&key->is_pressed()&&!key->is_echo()){
        if(key->get_physical_keycode()==KEY_ESCAPE){if(!driving_.empty()&&panel_.empty()){exit_machine();return;}if(panel_.empty())show_panel("pause");else build_hud();get_viewport()->set_input_as_handled();}
        else if(key->get_physical_keycode()==KEY_E&&panel_.empty())interact();else if(key->get_physical_keycode()==KEY_I)show_panel("inventory");
        else if(key->get_physical_keycode()==KEY_TAB)show_panel("journal");else if(key->get_physical_keycode()==KEY_F&&panel_.empty())ui_command("grip", "{}");
    }
    if(!panel_.empty())return;
    if(auto motion=Ref<InputEventMouseMotion>(event);motion.is_valid()&&Input::get_singleton()->get_mouse_mode()==Input::MOUSE_MODE_CAPTURED){yaw_-=motion->get_relative().x*settings_.value("sensitivity",.0025);pitch_=std::clamp(pitch_-motion->get_relative().y*settings_.value("sensitivity",.0025),-1.5,1.5);}
    if(auto button=Ref<InputEventMouseButton>(event);button.is_valid()){
        if(button->get_button_index()==MOUSE_BUTTON_LEFT)attack_down_=button->is_pressed();
        if(button->get_button_index()==MOUSE_BUTTON_RIGHT&&button->is_pressed())interact();
    }
    if(auto touch=Ref<InputEventScreenTouch>(event);touch.is_valid()){
        if(!touch->is_pressed()){if(touch->get_index()==move_touch_){move_touch_=-1;movement_={};}if(touch->get_index()==look_touch_)look_touch_=-1;}
        else if((settings_.value("leftHand",false)?touch->get_position().x>get_viewport()->get_visible_rect().size.x*.62:touch->get_position().x<get_viewport()->get_visible_rect().size.x*.38)){move_touch_=touch->get_index();touch_origin_=touch->get_position();}
        else look_touch_=touch->get_index();
    }
    if(auto drag=Ref<InputEventScreenDrag>(event);drag.is_valid()){
        if(drag->get_index()==move_touch_){movement_=(drag->get_position()-touch_origin_)/90;if(movement_.length()>1)movement_=movement_.normalized();}
        else if(drag->get_index()==look_touch_){yaw_-=drag->get_relative().x*settings_.value("sensitivity",.0025)*1.6;pitch_=std::clamp(pitch_-drag->get_relative().y*settings_.value("sensitivity",.0025)*1.6,-1.5,1.5);}
    }
}
void FeralGame::migration_finished(String path,String error){
    if(!error.is_empty()){legacy_import_pending_=true;migration_error_=fs(error);storage_->record_legacy_export_failure(migration_error_);if(!playing_)show_launcher();notice("기존 저장 읽기 실패: "+migration_error_);return;}
    if(path.is_empty())return;
    try{auto report=storage_->import_legacy_export(read_json(fs(path)));bool blocked=!report.blocked_worlds.empty();
        // Every incomplete import is revalidated, including snapshots preserved by an earlier attempt.
        for(auto row:storage_->list_worlds()){
            std::string id=row.value("id",std::string{});auto state=storage_->load_world(id);if(!state||!state->contains("legacy"))continue;
            try{const auto& source=(*state)["legacy"]["unified"];auto config=storage_->world_config(id);World w(content_);Gameplay g(content_);Simulation sim(content_);w.configure(config);g.configure(config);sim.configure(config);w.load(source);g.load(source);sim.load(source);
                if(row.value("legacySemanticBlocked",false)){row.erase("legacySemanticBlocked");row.erase("legacyImportBlocked");row.erase("legacyImportWarning");storage_->upsert_world(row);}
            }catch(const std::exception& e){blocked=true;row["legacySemanticBlocked"]=true;row["legacyImportBlocked"]=true;row["legacyImportWarning"]=e.what();storage_->upsert_world(row);}
        }
        if(blocked)throw std::runtime_error("일부 저장을 읽지 못했습니다. 해당 월드는 원본을 보존하고 시작을 막았습니다.");
        storage_->mark_legacy_import_done();legacy_import_pending_=false;migration_error_.clear();load_global_settings();catalog_=storage_->load_catalog();if(!playing_)show_launcher();notice("기존 월드의 원본을 보존하고 가져왔습니다");}
    catch(const std::exception&e){legacy_import_pending_=true;migration_error_=e.what();if(!playing_)show_launcher();notice(std::string("저장 가져오기 실패: ")+e.what());}
}
void FeralGame::smoke_step(){
    ++smoke_frame_;if(smoke_frame_==2){attack_down_=true;visual_enabled_=false;}
    if(smoke_frame_==65){attack_down_=false;save_world();show_panel("inventory");}
    if(smoke_frame_==66){build_hud();}
    if(smoke_frame_==90){
        Json evidence={{"native",true},{"engine",fs(Engine::get_singleton()->get_version_info()["string"])},{"frames",smoke_frame_},{"sections",terrain_.size()},{"rebuiltSections",rebuilt_sections_},{"entities",entities_.size()},{"bodies",dynamics_.size()},{"hitEvents",hit_count_},{"visualsDisabled",!visual_enabled_},{"saved",storage_->load_world(world_id_).has_value()}};
        write_json("user://native-smoke-result.json",evidence);UtilityFunctions::print("FERAL_NATIVE_SMOKE ",gs(evidence.dump()));get_tree()->quit(terrain_.empty()||hit_count_==0?1:0);
    }
}
void FeralGame::ui_check_step(){
    if(!playing_)return;
    static const std::vector<std::string> panels={"hud","inventory","craft","research","build","machines","energy","equipment","community","faith","campaign","map","actions","action_detail","settings","updates","world_settings","import","pause"};
    ++ui_check_frame_;if(ui_check_frame_%12!=0)return;
    if(ui_check_frame_>12){
        int controls=0,buttons=0;std::function<void(Node*)> count=[&](Node* node){if(Object::cast_to<Control>(node))controls++;if(Object::cast_to<BaseButton>(node))buttons++;for(int i=0;i<node->get_child_count();i++)count(node->get_child(i));};count(screen_);
        std::string previous=panels[ui_check_index_-1];bool graphical=DisplayServer::get_singleton()->get_name()!="headless";
        if(previous=="hud"){
            std::vector<Rect2> buttons;const Rect2 viewport=screen_->get_global_rect();
            std::function<void(Node*)> inspect=[&](Node* node){if(auto button=Object::cast_to<BaseButton>(node)){Rect2 rect=button->get_global_rect();if(!viewport.encloses(rect))throw std::runtime_error("HUD button outside viewport");for(const auto& prior:buttons)if(prior.intersects(rect))throw std::runtime_error("HUD buttons overlap");buttons.push_back(rect);}for(int i=0;i<node->get_child_count();i++)inspect(node->get_child(i));};inspect(screen_);
        }
        ui_evidence_.push_back({{"panel",previous},{"controls",controls},{"buttons",buttons},{"graphical",graphical}});
        if(graphical){String directory="res://../verification/0.19.0-native-ui";DirAccess::make_dir_recursive_absolute(directory);auto image=get_viewport()->get_texture()->get_image();if(image.is_valid())image->save_png(directory+"/"+gs(previous)+".png");}
    }
    if(ui_check_index_>=int(panels.size())){write_json("user://native-ui-check.json",ui_evidence_);UtilityFunctions::print("FERAL_NATIVE_UI ",gs(ui_evidence_.dump()));get_tree()->quit(0);ui_check_=false;return;}
    std::string name=panels[ui_check_index_++];if(name=="hud")build_hud();else show_panel(name,name=="world_settings"?Json{{"id",world_id_}}:name=="action_detail"?Json{{"id","pick"}}:Json::object());
}
}
