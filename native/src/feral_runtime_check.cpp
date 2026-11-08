#include "feral_game.hpp"
#include "storage.hpp"
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/display_server.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <numeric>
#include <godot_cpp/classes/time.hpp>

namespace feral {
using namespace godot;
void FeralGame::prepare_runtime_check(Vec3 spawn){
    // Dedicated test storage is selected by _ready; no player world is changed.
    world_->bodies().clear();
    for(int x:{-12,0,12}){
        Cell root=world_cell(spawn+Vec3{x*.5,0,-8});root.y=int(std::ceil(world_->surface_height(root.x*.5,root.z*.5)*2));
        for(int dx=-4;dx<=4;dx++)for(int dz=-4;dz<=4;dz++)for(int y=0;y<17;y++)world_->set_block(root+Cell{dx,y,dz},"");
        world_->set_block(root+Cell{0,-1,0},"stone");
        for(int y=0;y<13;y++)world_->set_block(root+Cell{0,y,0},"log");
        for(int y=9;y<15;y++)for(int dx=-4;dx<=4;dx++)for(int dz=-4;dz<=4;dz++)if(dx||dz)world_->set_block(root+Cell{dx,y,dz},"leaves");
        runtime_tree_roots_.push_back(root);
    }
}
void FeralGame::runtime_check_step(double milliseconds){
    ++runtime_check_frame_;const Vec3 player_position=fv(player_->get_position());if(runtime_check_frame_==1)runtime_player_min_=runtime_player_max_=player_position;else for(int axis=0;axis<3;axis++){runtime_player_min_[axis]=std::min(runtime_player_min_[axis],player_position[axis]);runtime_player_max_[axis]=std::max(runtime_player_max_[axis],player_position[axis]);}
    const int phase=runtime_check_frame_<=120?0:runtime_check_frame_<=360?1:2;
    if(runtime_check_frame_>30)runtime_samples_[phase].push_back(milliseconds);
    if(runtime_check_frame_==120){
        runtime_initial_sections_=terrain_.size();const uint64_t detach_started=Time::get_singleton()->get_ticks_usec();
        for(Cell root:runtime_tree_roots_){Contact hit{true,"terrain",{}, {},"log",cell_center(root),{0,0,1},root,0};world_->damage(hit,1e9);}
        runtime_detach_ms_=(Time::get_singleton()->get_ticks_usec()-detach_started)/1000.0;
        if(world_->bodies().size()!=3){UtilityFunctions::push_error("Runtime tree test expected three actual detached trees");get_tree()->quit(1);return;}
        for(auto& [id,body]:world_->bodies())body.angular_velocity={.35,0,.1};
    }
    if(runtime_check_frame_==360)runtime_late_rebuilds_=rebuilt_sections_;
    if(runtime_check_frame_<600)return;
    Json stages=Json::array();const char* names[]={"standing_trees","three_detached_trees","settled_trees"};
    for(int i=0;i<3;i++){auto samples=runtime_samples_[i];std::sort(samples.begin(),samples.end());stages.push_back({{"stage",names[i]},{"ticks",samples.size()},{"meanMs",std::accumulate(samples.begin(),samples.end(),0.0)/samples.size()},{"p95Ms",samples[size_t((samples.size()-1)*.95)]},{"maxMs",samples.back()}});}
    Json breakdown=Json::object();for(const auto& [name,phases]:runtime_stage_samples_)for(int phase=0;phase<3;phase++){auto values=phases[phase];if(values.empty())continue;std::sort(values.begin(),values.end());breakdown[name][names[phase]]={{"meanMs",std::accumulate(values.begin(),values.end(),0.0)/values.size()},{"p95Ms",values[size_t((values.size()-1)*.95)]},{"maxMs",values.back()}};}
    size_t solid=0,non_solid=0,sleeping=0;for(const auto& [id,node]:dynamics_){if(node.body->get_collision_layer())solid++;else non_solid++;if(node.body->is_sleeping())sleeping++;}
    Json evidence={{"scope","Full native World/Gameplay/Simulation adapter with real Godot Jolt; desktop, not phone FPS"},{"renderer",fs(DisplayServer::get_singleton()->get_name())},{"ticks",runtime_check_frame_},{"threeTreeDetachMs",runtime_detach_ms_},{"streamSectionsAdded",runtime_sections_added_},{"streamSectionsRemoved",runtime_sections_removed_},{"playerBoundsMin",runtime_player_min_},{"playerBoundsMax",runtime_player_max_},{"initialSections",runtime_initial_sections_},{"finalSections",terrain_.size()},{"lateSectionRebuilds",rebuilt_sections_-runtime_late_rebuilds_},{"preservedBodies",world_->bodies().size()},{"activeSolidBodies",solid},{"activeNonSolidBodies",non_solid},{"sleepingBodies",sleeping},{"cpuStages",stages},{"cpuBreakdown",breakdown}};
    write_json("user://native-runtime-check.json",evidence);UtilityFunctions::print("FERAL_NATIVE_RUNTIME ",gs(evidence.dump()));
    get_tree()->quit(terrain_.size()>runtime_initial_sections_+500?1:0);
}
}
