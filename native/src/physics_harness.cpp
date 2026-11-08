#include "physics_harness.hpp"

#include <godot_cpp/classes/box_shape3d.hpp>
#include <godot_cpp/classes/display_server.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/project_settings.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/sphere_shape3d.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>

namespace feral {
using namespace godot;
namespace {

Json vec_json(Vec3 value) { return Json{{"x",value.x},{"y",value.y},{"z",value.z}}; }
bool finite_vec(Vec3 value) { return std::isfinite(value.x)&&std::isfinite(value.y)&&std::isfinite(value.z); }
std::string lower(std::string value) {
    std::transform(value.begin(),value.end(),value.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});
    return value;
}

} // namespace

StaticBody3D* NativePhysicsHarness::add_static(const std::string& name,uint32_t layer) {
    auto* body=memnew(StaticBody3D);
    body->set_name(gs(name));
    body->set_meta("feral_id",gs(name));
    body->set_collision_layer(layer);
    body->set_collision_mask(0xffffffffu);
    add_child(body);
    return body;
}

NativeBody* NativePhysicsHarness::add_native(const std::string& name,Vec3 position,double mass,
                                             uint32_t layer,uint32_t mask) {
    auto* body=memnew(NativeBody);
    body->set_name(gs(name));
    body->set_meta("feral_id",gs(name));
    body->set_position(gv(position));
    body->set_collision_layer(layer);
    body->set_collision_mask(mask);
    body->set_mass(mass);
    body->set_max_contacts_reported(8);
    body->set_contact_monitor(true);
    body->set_use_continuous_collision_detection(true);
    body->set_can_sleep(true);
    add_child(body);
    return body;
}

void NativePhysicsHarness::add_box_shape(CollisionObject3D* body,Vec3 local_center,Vec3 size) {
    Ref<BoxShape3D> shape;
    shape.instantiate();
    shape->set_size(gv(size));
    const uint32_t owner=body->create_shape_owner(body);
    body->shape_owner_add_shape(owner,shape);
    body->shape_owner_set_transform(owner,Transform3D(Basis(),gv(local_center)));
}

void NativePhysicsHarness::add_sphere_shape(CollisionObject3D* body,double radius) {
    Ref<SphereShape3D> shape;
    shape.instantiate();
    shape->set_radius(radius);
    const uint32_t owner=body->create_shape_owner(body);
    body->shape_owner_add_shape(owner,shape);
}

void NativePhysicsHarness::build_test_world() {
    // One StaticBody owns four exact ring sections and a lower catch floor. No coarse AABB bridges
    // the central 1.4 m square opening, so a falling sphere must physically pass through the hole.
    hole_compound_=add_static("harness:hole-compound",1);
    add_box_shape(hole_compound_,{-1.2,0,0},{1.0,.5,4.0});
    add_box_shape(hole_compound_,{ 1.2,0,0},{1.0,.5,4.0});
    add_box_shape(hole_compound_,{0,0,-1.2},{1.4,.5,1.0});
    add_box_shape(hole_compound_,{0,0, 1.2},{1.4,.5,1.0});
    add_box_shape(hole_compound_,{0,-4,0},{6,.5,6});
    const PackedInt32Array hole_owners=hole_compound_->get_shape_owners();
    if(hole_owners.size()!=5)hole_compound_valid_=false;
    for(int owner_index=0;owner_index<hole_owners.size();owner_index++)
        if(hole_compound_->shape_owner_get_shape_count(hole_owners[owner_index])!=1)
            hole_compound_valid_=false;

    hole_faller_=add_native("harness:hole-faller",{0,4,0},1,4,1);
    add_sphere_shape(hole_faller_,.25);

    tree_ground_=add_static("harness:tree-ground",1);
    trees_.fill(nullptr);
    for(int i=0;i<3;i++){
        const double x=14.0+i*4.0;
        add_box_shape(tree_ground_,{x,-.25,0},{3,.5,3});
        trees_[i]=add_native("harness:tree:"+std::to_string(i),{x,3.5,0},18,4,1|4);
        trees_[i]->set_freeze_enabled(true);
        // Trunk plus four branch boxes form one detached compound rigid body. The branch boxes
        // deliberately overlap the trunk at their joints; shapes owned by this body must not collide
        // with one another.
        add_box_shape(trees_[i],{0,1.0,0},{.5,2.0,.5});
        add_box_shape(trees_[i],{-.48,1.72,0},{1.25,.22,.24});
        add_box_shape(trees_[i],{ .48,1.72,0},{1.25,.22,.24});
        add_box_shape(trees_[i],{0,1.5,-.42},{.24,.22,1.25});
        add_box_shape(trees_[i],{0,1.5, .42},{.24,.22,1.25});
        const PackedInt32Array owners=trees_[i]->get_shape_owners();
        if(owners.size()!=5)tree_compounds_valid_=false;
        for(int owner_index=0;owner_index<owners.size();owner_index++)
            if(trees_[i]->shape_owner_get_shape_count(owners[owner_index])!=1)tree_compounds_valid_=false;
    }

    collision_target_=add_native("harness:entity-target",{60,.5,0},20,4,4);
    collision_target_->set_freeze_mode(RigidBody3D::FREEZE_MODE_STATIC);
    collision_target_->set_freeze_enabled(true);
    add_box_shape(collision_target_,{0,0,0},{1.2,1.0,1.2});
    collision_mover_=add_native("harness:entity-mover",{60,4,0},1,4,4);
    add_sphere_shape(collision_mover_,.35);

    sensor_ground_=add_static("harness:sensor-ground",1);
    sensor_leaves_.fill(nullptr);
    leaf_sensors_.fill(nullptr);
    for(int i=0;i<3;i++){
        const double x=80.0+i*4.0;
        add_box_shape(sensor_ground_,{x,-8.25,0},{3,.5,3});
        auto* leaf=memnew(RigidBody3D);
        leaf->set_name(gs("harness:sensor-leaf:"+std::to_string(i)));
        leaf->set_meta("feral_id",gs("harness:sensor-leaf:"+std::to_string(i)));
        leaf->set_position(gv({x,2,0}));
        leaf->set_collision_layer(0);
        leaf->set_collision_mask(0);
        leaf->set_gravity_scale(0);
        leaf->set_linear_velocity({0,-2,0});
        leaf->set_can_sleep(false);
        add_child(leaf);
        sensor_leaves_[i]=leaf;
        // Disabled body shape preserves a real dynamic transform while making the leaf non-solid.
        Ref<SphereShape3D> disabled_shape;
        disabled_shape.instantiate();
        disabled_shape->set_radius(.12);
        const uint32_t owner=leaf->create_shape_owner(leaf);
        leaf->shape_owner_add_shape(owner,disabled_shape);
        leaf->shape_owner_set_disabled(owner,true);
        const PackedInt32Array leaf_owners=leaf->get_shape_owners();
        if(leaf->get_collision_layer()!=0||leaf->get_collision_mask()!=0||leaf_owners.size()!=1||
           leaf->shape_owner_get_shape_count(owner)!=1||!leaf->is_shape_owner_disabled(owner))
            sensor_leaves_collision_disabled_=false;

        auto* area=memnew(Area3D);
        area->set_name(gs("harness:leaf-sensor:"+std::to_string(i)));
        area->set_collision_layer(0);
        area->set_collision_mask(1);
        area->set_monitoring(true);
        area->set_monitorable(false);
        leaf->add_child(area);
        Ref<SphereShape3D> sensor_shape;
        sensor_shape.instantiate();
        sensor_shape->set_radius(.38);
        const uint32_t sensor_owner=area->create_shape_owner(area);
        area->shape_owner_add_shape(sensor_owner,sensor_shape);
        if(area->get_collision_layer()!=0||area->get_collision_mask()!=1||
           area->shape_owner_get_shape_count(sensor_owner)!=1)
            sensor_leaves_collision_disabled_=false;
        leaf_sensors_[i]=area;
    }
}

int NativePhysicsHarness::count_scene_nodes() const {
    int count = 1;
    for (int i = 0; i < get_child_count(); ++i) {
        const Node* child = get_child(i);
        if (!child) continue;
        // Count each descendant recursively so Areas and helper nodes are covered too.
        const auto count_subtree = [](const auto& self, const Node* node) -> int {
            int subtree = 1;
            for (int child_index = 0; child_index < node->get_child_count(); ++child_index) {
                const Node* descendant = node->get_child(child_index);
                if (descendant) subtree += self(self, descendant);
            }
            return subtree;
        };
        count += count_subtree(count_subtree, child);
    }
    return count;
}

void NativePhysicsHarness::_ready() {
    wall_start_=std::chrono::steady_clock::now();
    previous_physics_callback_=wall_start_;
    physics_frames_start_=Engine::get_singleton()->get_physics_frames();
    try {
        build_test_world();
        visible_action_marks_.reserve(64);
        hidden_action_marks_.reserve(64);
        const std::string profile_text=fs(FileAccess::get_file_as_string("res://data/action_profiles.json"));
        if(profile_text.empty())throw std::runtime_error("res://data/action_profiles.json is missing or empty");
        Json profiles=Json::parse(profile_text);
        visible_actions_.configure(profiles);
        hidden_actions_.configure(profiles);
        action_profiles_loaded_=true;
    } catch(const std::exception& error) {
        setup_error_=error.what();
    }
    direct_child_count_=get_child_count();
    scene_node_count_=count_scene_nodes();
    set_process(true);
    set_physics_process(true);
}

void NativePhysicsHarness::observe_previous_physics_contacts() {
    auto inspect=[this](NativeBody* body,const std::string& expected_id){
        if(!body)return;
        for(size_t i=0;i<body->contact_count();i++){
            const BodyContact& contact=body->contact(i);
            const double normal_length=contact.normal.length();
            if(!finite_vec(contact.point)||!finite_vec(contact.normal)||
               !std::isfinite(normal_length)||std::abs(normal_length-1.0)>.08)
                contact_coordinates_valid_=false;
            if(contact.target==expected_id){
                for(size_t t=0;t<trees_.size();t++)if(body==trees_[t])tree_self_contact_[t]=true;
            }
            if(body==hole_faller_&&contact.target=="harness:hole-compound")hole_faller_hit_floor_=true;
            if(body==collision_mover_&&contact.target=="harness:entity-target")collision_target_contact_=true;
            for(size_t t=0;t<trees_.size();t++)if(body==trees_[t]&&contact.target=="harness:tree-ground")tree_had_external_contact_[t]=true;
        }
        body->clear_contacts();
    };
    inspect(hole_faller_,"harness:hole-faller");
    for(size_t i=0;i<trees_.size();i++)inspect(trees_[i],"harness:tree:"+std::to_string(i));
    inspect(collision_target_,"harness:entity-target");
    inspect(collision_mover_,"harness:entity-mover");
}

void NativePhysicsHarness::advance_action_comparison(double dt) {
    if(!action_profiles_loaded_)return;
    const ActorPose actor{{0,0,0},{}};
    if(physics_steps_%30==1){
        const ActionIntent intent{"pick",actor};
        if(!visible_actions_.begin(intent)||!hidden_actions_.begin(intent))action_begin_failed_=true;
    }
    const ContactResolver resolver=[](const HitQuery& query){
        Contact contact;contact.hit=true;contact.kind="entity";contact.id="harness:action-target";
        contact.point=query.actor_origin+query.aim_direction*2.0;contact.distance=2.0;
        return std::vector<ContactResult>{{contact,false}};
    };
    const ContactSink visible_sink=[this](const ContactEvent& event){
        visible_action_marks_.push_back({event.attack_id,event.simulation_frame,event.damage,event.profile_id});
    };
    const ContactSink hidden_sink=[this](const ContactEvent& event){
        hidden_action_marks_.push_back({event.attack_id,event.simulation_frame,event.damage,event.profile_id});
    };
    visible_actions_.advance(dt,actor,resolver,visible_sink);
    // This timeline represents a disabled/hidden hand model. Sampling the visible timeline below
    // cannot feed back into either event stream.
    hidden_actions_.advance(dt,actor,resolver,hidden_sink);
    (void)visible_actions_.sample_visual((physics_steps_%10)/10.0);
}

void NativePhysicsHarness::_physics_process(double dt) {
    if(finished_||finish_pending_)return;
    const auto callback_start=std::chrono::steady_clock::now();
    if(have_previous_callback_){
        const uint64_t interval=std::chrono::duration_cast<std::chrono::nanoseconds>(callback_start-previous_physics_callback_).count();
        physics_interval_ns_total_+=interval;
        physics_interval_ns_max_=std::max(physics_interval_ns_max_,interval);
    }
    previous_physics_callback_=callback_start;
    have_previous_callback_=true;
    physics_steps_++;
    dt_min_=std::min(dt_min_,dt);
    dt_max_=std::max(dt_max_,dt);
    if(get_child_count()!=direct_child_count_||count_scene_nodes()!=scene_node_count_)count_stable_=false;

    observe_previous_physics_contacts();
    if(physics_steps_==5)for(auto* tree:trees_)if(tree)tree->set_freeze_enabled(false);
    if(hole_faller_){
        const double y=hole_faller_->get_position().y;
        hole_faller_min_y_=std::min(hole_faller_min_y_,y);
        if(y<-.75)passed_hole_=true;
    }
    for(size_t i=0;i<sensor_leaves_.size();i++)if(sensor_leaves_[i]&&leaf_sensors_[i]){
        if(sensor_leaves_[i]->get_position().y < -8.5)leaf_underground_observed_[i]=true;
        const auto overlaps=leaf_sensors_[i]->get_overlapping_bodies();
        if(!overlaps.is_empty()){
            bool saw_sensor_ground=false;
            for (int overlap_index = 0; overlap_index < overlaps.size(); ++overlap_index) {
                Object* overlap = overlaps[overlap_index];
                if (overlap && overlap->has_meta("feral_id") &&
                    fs(overlap->get_meta("feral_id")) == "harness:sensor-ground") {
                    leaf_area_ground_observed_[i]=true;
                    saw_sensor_ground=true;
                    break;
                }
            }
            if(saw_sensor_ground)++area_ground_overlap_observations_;
        }
    }
    advance_action_comparison(dt);

    if(hole_faller_)hole_faller_->capture_velocity();
    for(auto* tree:trees_)if(tree)tree->capture_velocity();
    if(collision_target_)collision_target_->capture_velocity();
    if(collision_mover_)collision_mover_->capture_velocity();

    if(physics_steps_>=kScenarioSteps){
        finish_pending_=true;
        set_physics_process(false);
    }
    const auto callback_end=std::chrono::steady_clock::now();
    const uint64_t callback=std::chrono::duration_cast<std::chrono::nanoseconds>(callback_end-callback_start).count();
    callback_ns_total_+=callback;
    callback_ns_max_=std::max(callback_ns_max_,callback);
}

bool NativePhysicsHarness::action_marks_equal() const {
    if(visible_action_marks_.size()!=hidden_action_marks_.size())return false;
    for(size_t i=0;i<visible_action_marks_.size();i++){
        const auto& a=visible_action_marks_[i];
        const auto& b=hidden_action_marks_[i];
        if(a.attack!=b.attack||a.frame!=b.frame||a.profile!=b.profile||std::abs(a.damage-b.damage)>1e-9)return false;
    }
    return true;
}

bool NativePhysicsHarness::renderer_is_software() const {
    const RenderingServer* server=RenderingServer::get_singleton();
    if(!server)return false;
    const std::string adapter=lower(fs(server->get_video_adapter_name()));
    return adapter.find("swiftshader")!=std::string::npos||adapter.find("llvmpipe")!=std::string::npos||
           adapter.find("softpipe")!=std::string::npos||adapter.find("software")!=std::string::npos;
}

Json NativePhysicsHarness::build_report() const {
    const auto now=std::chrono::steady_clock::now();
    const double wall_seconds=std::chrono::duration<double>(now-wall_start_).count();
    const uint64_t physics_frames_end=Engine::get_singleton()->get_physics_frames();
    const uint64_t physics_frames_elapsed=physics_frames_end>=physics_frames_start_?physics_frames_end-physics_frames_start_:0;
    const RenderingServer* rendering=RenderingServer::get_singleton();
    const DisplayServer* display=DisplayServer::get_singleton();
    std::string renderer=rendering?fs(rendering->get_video_adapter_name()):"unavailable";
    std::string vendor=rendering?fs(rendering->get_video_adapter_vendor()):"unavailable";
    std::string display_name=display?fs(display->get_name()):"unavailable";
    std::string physics_engine="unknown";
    if(ProjectSettings::get_singleton())physics_engine=ProjectSettings::get_singleton()->get_setting("physics/3d/physics_engine").stringify().utf8().get_data();

    int tree_shape_owners=0,tree_sleeping=0,tree_external=0,tree_self=0;
    Json trees=Json::array();
    for(size_t i=0;i<trees_.size();i++){
        NativeBody* tree=trees_[i];
        const int owners=tree?tree->get_shape_owners().size():0;
        tree_shape_owners+=owners;
        if(tree&&tree->is_sleeping())tree_sleeping++;
        if(tree_had_external_contact_[i])tree_external++;
        if(tree_self_contact_[i])tree_self++;
        trees.push_back({{"id","harness:tree:"+std::to_string(i)},{"shapeOwners",owners},
                         {"sleeping",tree&&tree->is_sleeping()},
                         {"externalGroundContact",tree_had_external_contact_[i]},
                         {"selfContact",tree_self_contact_[i]},
                         {"position",tree?vec_json(fv(tree->get_position())):Json::object()}});
    }
    int leaves_underground=0,leaves_underground_seen=0,leaf_area_count=0;
    Json leaves=Json::array();
    for(size_t i=0;i<sensor_leaves_.size();i++){
        const bool underground=sensor_leaves_[i]&&sensor_leaves_[i]->get_position().y < -8.5;
        const int overlap_count=leaf_sensors_[i]?leaf_sensors_[i]->get_overlapping_bodies().size():0;
        if(underground)leaves_underground++;
        if(leaf_underground_observed_[i])leaves_underground_seen++;
        if(leaf_area_ground_observed_[i])leaf_area_count++;
        const PackedInt32Array owners=sensor_leaves_[i]?sensor_leaves_[i]->get_shape_owners():PackedInt32Array();
        const bool shape_disabled=sensor_leaves_[i]&&owners.size()==1&&sensor_leaves_[i]->is_shape_owner_disabled(owners[0]);
        leaves.push_back({{"id","harness:sensor-leaf:"+std::to_string(i)},
                          {"position",sensor_leaves_[i]?vec_json(fv(sensor_leaves_[i]->get_position())):Json::object()},
                          {"underground",underground},{"undergroundObservedDuringRun",leaf_underground_observed_[i]},
                          {"areaGroundOverlapObserved",leaf_area_ground_observed_[i]},
                          {"collisionLayer",sensor_leaves_[i]?sensor_leaves_[i]->get_collision_layer():-1},
                          {"collisionMask",sensor_leaves_[i]?sensor_leaves_[i]->get_collision_mask():-1},
                          {"collisionShapeDisabled",shape_disabled},
                          {"currentOverlaps",overlap_count}});
    }
    const bool hole_sleeping=hole_faller_&&hole_faller_->is_sleeping();
    const Vec3 hole_position=hole_faller_?fv(hole_faller_->get_position()):Vec3{};
    const bool action_equal=action_marks_equal();
    const int hole_shape_owners=hole_compound_?hole_compound_->get_shape_owners().size():0;
    const bool hole_compound_valid=hole_compound_valid_&&hole_shape_owners==5;
    const bool exact_steps=physics_steps_==kScenarioSteps&&physics_frames_elapsed==kScenarioSteps;
    const bool fixed_delta_is_60hz=std::abs(dt_min_-FIXED_DT)<1e-6&&std::abs(dt_max_-FIXED_DT)<1e-6;
    const bool jolt_configured=physics_engine.find("Jolt")!=std::string::npos;
    const bool all_passed=setup_error_.empty()&&exact_steps&&fixed_delta_is_60hz&&jolt_configured&&count_stable_&&passed_hole_&&hole_faller_hit_floor_&&
        hole_compound_valid&&hole_sleeping&&tree_compounds_valid_&&tree_shape_owners==15&&tree_self==0&&tree_external==3&&
        collision_target_contact_&&contact_coordinates_valid_&&sensor_leaves_collision_disabled_&&
        leaves_underground==3&&leaves_underground_seen==3&&leaf_area_count==3&&
        area_ground_overlap_observations_>0&&action_profiles_loaded_&&action_marks_equal()&&!action_begin_failed_&&
        !visible_action_marks_.empty()&&visible_action_marks_.size()==hidden_action_marks_.size();
    double physics_interval_avg_us=physics_steps_>1?double(physics_interval_ns_total_)/(physics_steps_-1)/1000.0:0;
    double callback_avg_us=physics_steps_>0?double(callback_ns_total_)/physics_steps_/1000.0:0;
    Json report={{"harness","native_physics"},{"physicsEngine",physics_engine},
                 {"physicsEngineConfigured",physics_engine.find("Jolt")!=std::string::npos},
                 {"renderingMode",display_name=="headless"?"headless":"windowed"},
                 {"displayServer",display_name},{"rendererAdapter",renderer},{"rendererVendor",vendor},
                 {"softwareRenderer",renderer_is_software()},{"softwareRenderPerformanceClaim",false},
                 {"scenarioFixedSteps",physics_steps_},{"scenarioTargetSteps",kScenarioSteps},
                 {"enginePhysicsFramesStart",physics_frames_start_},{"enginePhysicsFramesEnd",physics_frames_end},
                 {"enginePhysicsFramesElapsed",physics_frames_elapsed},{"actualPhysicsStepsVerified",exact_steps},
                 {"fixedDeltaSecondsMin",dt_min_==1e9?0:dt_min_},{"fixedDeltaSecondsMax",dt_max_},
                 {"fixedDeltaIs60Hz",fixed_delta_is_60hz},
                 {"wallElapsedSeconds",wall_seconds},{"physicsCallbackIntervalAverageUs",physics_interval_avg_us},
                 {"physicsCallbackIntervalMaximumUs",double(physics_interval_ns_max_)/1000.0},
                 {"harnessCallbackAverageUs",callback_avg_us},{"harnessCallbackMaximumUs",double(callback_ns_max_)/1000.0},
                 {"renderFpsAtFinish",Engine::get_singleton()->get_frames_per_second()},
                 {"setupError",setup_error_},{"registeredDirectChildren",direct_child_count_},
                 {"registeredSceneNodes",scene_node_count_},{"sceneNodeCountStable",count_stable_},
                 {"directChildrenStable",count_stable_},
                 {"hollowCompound",{{"shapeOwners",hole_shape_owners},{"validExactCompound",hole_compound_valid},
                                     {"passedThroughHole",passed_hole_},{"minimumCenterY",hole_faller_min_y_},
                                     {"lowerFloorContact",hole_faller_hit_floor_},{"sleeping",hole_sleeping},
                                     {"finalPosition",vec_json(hole_position)}}},
                 {"treeBodies",trees},{"treeCompoundCount",trees_.size()},
                 {"treeCompoundShapeOwners",tree_shape_owners},{"treeBodiesSleeping",tree_sleeping},
                 {"treeExternalGroundContacts",tree_external},{"treeSelfContacts",tree_self},
                 {"treeCompoundNoSelfCollision",tree_compounds_valid_&&tree_self==0},
                 {"otherEntityCollisionObserved",collision_target_contact_},
                 {"nativeBodyContactCoordinatesValid",contact_coordinates_valid_},
                 {"sensorLeaves",leaves},{"sensorLeavesUnderground",leaves_underground},
                 {"sensorLeavesObservedUndergroundDuringRun",leaves_underground_seen},
                 {"sensorLeavesCollisionDisabled",sensor_leaves_collision_disabled_},
                 {"sensorLeavesWithAreaObservation",leaf_area_count},
                 {"sensorAreaGroundOverlapObservations",area_ground_overlap_observations_},
                 {"actionProfilesLoaded",action_profiles_loaded_},
                 {"hiddenVisualActionsMatchVisibleActions",action_equal},
                 {"actionBeginFailed",action_begin_failed_},
                 {"visibleActionEvents",visible_action_marks_.size()},
                 {"hiddenActionEvents",hidden_action_marks_.size()},
                 {"allPassed",all_passed}};
    return report;
}

void NativePhysicsHarness::finish_and_write_report() {
    if(finished_)return;
    finished_=true;
    observe_previous_physics_contacts();
    const Json report=build_report();
    const String serialized=gs(report.dump(2));
    Ref<FileAccess> file=FileAccess::open("user://native-physics-harness.json",FileAccess::WRITE);
    if(file.is_valid())file->store_string(serialized);
    UtilityFunctions::print("FERAL_NATIVE_PHYSICS ",serialized);
    const bool success=report.value("allPassed",false);
    if(SceneTree* tree=get_tree())tree->quit(success?0:1);
}

void NativePhysicsHarness::_process(double) {
    if(!finish_pending_||finished_)return;
    const uint64_t frames=Engine::get_singleton()->get_physics_frames();
    if(frames>=physics_frames_start_+kScenarioSteps)finish_and_write_report();
}

} // namespace feral
