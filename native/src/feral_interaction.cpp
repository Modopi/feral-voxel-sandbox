#include "feral_game.hpp"
#include "native_asset_bounds.hpp"
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/classes/world3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_shape_query_parameters3d.hpp>
#include <godot_cpp/classes/physics_ray_query_parameters3d.hpp>
#include <godot_cpp/classes/box_shape3d.hpp>

namespace feral {
using namespace godot;
namespace {

struct MiningRule {std::string kind,affinity;double hardness=0;};
struct MiningGear {std::string affinity="rock";double power=1;};

Cell local_wound_cell(Vec3 local){
    // Wound geometry is authored on a 1/32 m grid, but a normal strike cuts a roughly 0.25 m
    // patch. Quantize to that patch size so active sweep samples can hit different torso areas
    // without applying repeated full damage to the same wound patch.
    return {int(std::floor(local.x*4.0)),int(std::floor(local.y*4.0)),int(std::floor(local.z*4.0))};
}

bool mining_rule(const Content& content,const std::string& block_id,MiningRule& out){
    const Json& block=content.find("blocks",block_id);if(block.empty())return false;
    const Json material_value=block.value("materialId",Json());
    const std::string material=material_value.is_string()?material_value.get<std::string>():std::string{};
    const bool ore=block_id.size()>=4&&block_id.compare(block_id.size()-4,4,"_ore")==0||block_id=="sulfur_deposit";
    if(ore)out.kind="ore";
    else if(material=="wood"||material=="mana_wood")out.kind="wood";
    else if(material=="stone"||material=="scrap_iron"||block_id=="clay_brick"||block_id=="glass")out.kind="rock";
    else out.kind="soil";
    out.affinity=out.kind=="ore"?"rock":out.kind;
    out.hardness=out.kind=="soil"?.55:out.kind=="wood"?1.2:out.kind=="ore"?2.4:1.6;
    const std::string reference=out.kind=="soil"?"dirt":out.kind=="wood"?"log":out.kind=="rock"?"stone":"iron_ore";
    const Json& base=content.find("blocks",reference);
    const Json legacy=block.value("legacyBlockId",Json());
    if(legacy.is_null()&&!base.empty()){
        const double durability=block.value("durabilityHpPerCell",0.0),reference_durability=base.value("durabilityHpPerCell",0.0);
        if(durability>0&&reference_durability>0)out.hardness*=std::max(1.0,durability/reference_durability);
    }
    return true;
}

} // namespace

double FeralGame::cached_authored_radius(const std::string& asset_id)const{
    auto found=authored_radius_cache_.find(asset_id);if(found!=authored_radius_cache_.end())return found->second;
    const double radius=authored_asset_radius(content_,asset_id);authored_radius_cache_[asset_id]=radius;return radius;
}

double FeralGame::entity_broadphase_radius(const EntityNode& entity)const{
    double radius=cached_authored_radius(entity.asset);
    // The authored radial bound already contains every parent translation and all box corners,
    // so arbitrary joint rotations remain inside it. Add the current root/part animation offsets,
    // then scale once in world space. The exact per-part boxes still decide all contacts.
    if(entity.visual_root)radius+=fv(entity.visual_root->get_position()).length();
    for(const auto& [id,part]:entity.parts)if(part.node)
        radius+=fv(part.node->get_position()-part.base_translation).length();
    if(entity.body){const Vector3 scale=entity.body->get_global_basis().get_scale();radius*=std::max({std::abs(double(scale.x)),std::abs(double(scale.y)),std::abs(double(scale.z))});}
    return radius;
}

Contact FeralGame::aim_contact(Vec3 origin,Vec3 direction,double reach){
    Contact best=world_->raycast(origin,direction,reach);double distance=best.hit?best.distance:reach;
    Vec3 to=origin+direction*reach;
    auto check=[&](const std::string& kind,const std::string& id,const std::string& part,const Box& box,const Transform3D& transform,const Transform3D& inverse,Cell cell){
        Vec3 a=fv(inverse.xform(gv(origin))),b=fv(inverse.xform(gv(to)));double fraction;Vec3 normal;
        if(swept_box(a,b,0,box.center,box.size,fraction,normal)&&fraction*reach<distance){
            distance=fraction*reach;const Vec3 local=a+(b-a)*fraction;
            const Cell contact_cell=(kind=="creature"||kind=="boss")?local_wound_cell(local):cell;
            best={true,kind,id,part,box.material,origin+direction*distance,fv(transform.basis.xform(gv(normal))).normalized(),contact_cell,distance};
        }
    };
    for(const auto& [id,n]:entities_)if(n.body){
        const Vec3 entity_center=fv(n.body->get_global_position());
        const double broad_radius=entity_broadphase_radius(n);
        if(!segment_overlaps_sphere(entity_center,origin,to,broad_radius))continue;
        for(const auto& [pid,p]:n.parts){
            if(p.node&&p.node->is_visible_in_tree()){
                const Transform3D transform=p.node->get_global_transform(),inverse=transform.affine_inverse();
                for(const auto& b:p.boxes)if(b.box.solid)check(n.kind,id,b.part.empty()?pid:b.part,b.box,transform,inverse,{});
            }
            if(p.bone_node&&p.bone_node->is_visible_in_tree()){
                const Transform3D transform=p.bone_node->get_global_transform(),inverse=transform.affine_inverse();
                for(const auto& b:p.bone_boxes)if(b.box.solid&&b.box.material=="bone_core")check(n.kind,id,b.part,b.box,transform,inverse,{});
            }
        }
    }
    for(const auto& [id,n]:dynamics_){
        if(!n.machine&&!n.fixture)continue; // World::raycast already includes detached voxel bodies.
        const Transform3D transform=n.body->get_global_transform(),inverse=transform.affine_inverse();
        const Vec3 local_origin=fv(inverse.xform(gv(origin))),local_end=fv(inverse.xform(gv(to)));
        double broad_fraction=0;Vec3 broad_normal;
        if(n.bounds_size.length_squared()>1e-10&&!swept_box(local_origin,local_end,0,n.bounds_center,n.bounds_size,broad_fraction,broad_normal))continue;
        if(n.machine){auto it=simulation_->machine_bodies().find(id);if(it!=simulation_->machine_bodies().end())for(const auto& s:it->second.shapes)check("machine",id,s.part_id,s.local_box,transform,inverse,{});}
        else for(const auto& box:n.boxes)if(box.solid)check("fixture",id,{},box,transform,inverse,{});
    }return best;
}
std::vector<ContactResult> FeralGame::resolve_contacts(const HitQuery& query){
    std::vector<ContactResult> out;Vec3 from=query.from,to=query.to;Contact point_anchor;
    if(query.kind==HitQueryKind::Point){point_anchor=aim_contact(query.actor_origin,query.aim_direction,query.max_reach);if(!point_anchor.hit)return out;from=to=point_anchor.point+query.aim_direction*.002;}
    auto append=[&](Contact hit,double /*fraction*/){
        Vec3 direction=hit.point-query.actor_origin;double distance=direction.length();
        if(distance>query.max_reach+query.radius)return;
        if(active_weapon_.is_object()&&(!active_weapon_.value("instanceId",Json()).is_null()||(hit.kind!="terrain"&&hit.kind!="body"))&&distance>active_weapon_.value("range",4.0)+.001)return;
        // Reach tests always start at the actor, including the outer edge of a wide swing.
        Contact obstacle=aim_contact(query.actor_origin,direction.normalized(),distance);
        const bool same_target_surface=obstacle.kind==hit.kind&&obstacle.id==hit.id&&obstacle.cell==hit.cell;
        // A point query is centered on the first ray hit. Let its finite impact volume catch
        // adjacent cells sharing that exposed surface; the radius is smaller than one voxel, so
        // a cell behind the surface cannot be reached through it. Other occluders still block.
        const bool same_point_impact= query.kind==HitQueryKind::Point&&point_anchor.hit&&
            obstacle.kind==point_anchor.kind&&obstacle.id==point_anchor.id&&obstacle.cell==point_anchor.cell&&
            (hit.point-point_anchor.point).length()<=query.radius+.035;
        if(obstacle.hit&&obstacle.distance<distance-query.radius-.035&&!same_target_surface&&!same_point_impact)return;
        // Contact adapters and Actions use distance as the actor-to-contact range. Using
        // segment-local t here made a later swing sample sort ahead of an earlier one and
        // spent a bounded attack's energy in arbitrary trajectory order.
        hit.distance=distance;out.push_back({hit,false});
    };
    Vec3 min{std::min(from.x,to.x)-query.radius,std::min(from.y,to.y)-query.radius,std::min(from.z,to.z)-query.radius};
    Vec3 max{std::max(from.x,to.x)+query.radius,std::max(from.y,to.y)+query.radius,std::max(from.z,to.z)+query.radius};Cell lo=world_cell(min),hi=world_cell(max);
    for(int x=lo.x;x<=hi.x;x++)for(int y=lo.y;y<=hi.y;y++)for(int z=lo.z;z<=hi.z;z++){
        Cell cell{x,y,z};std::string block=world_->block(cell);if(block.empty())continue;double t;Vec3 normal;
        if(!swept_box(from,to,query.radius,cell_center(cell),{.5,.5,.5},t,normal))continue;
        Vec3 p=from+(to-from)*t,center=cell_center(cell);p={std::clamp(p.x,center.x-.25,center.x+.25),std::clamp(p.y,center.y-.25,center.y+.25),std::clamp(p.z,center.z-.25,center.z+.25)};
        append({true,"terrain",{}, {},block,p,normal,cell,0},t);
    }
    auto check=[&](const std::string& kind,const std::string& id,const std::string& part,const Box& box,const Transform3D& transform,const Transform3D& inverse,Cell cell){
        Vec3 a=fv(inverse.xform(gv(from))),b=fv(inverse.xform(gv(to)));double fraction;Vec3 normal;
        // Authored model scales are uniform; transform radius to the same local metric.
        double scale=std::max(.001,double(transform.basis.get_scale().x));
        if(swept_box(a,b,query.radius/scale,box.center,box.size,fraction,normal)){
            Vec3 local=a+(b-a)*fraction;Vec3 half=box.size*.5;local={std::clamp(local.x,box.center.x-half.x,box.center.x+half.x),std::clamp(local.y,box.center.y-half.y,box.center.y+half.y),std::clamp(local.z,box.center.z-half.z,box.center.z+half.z)};
            const Cell contact_cell=(kind=="creature"||kind=="boss")?local_wound_cell(local):cell;
            append({true,kind,id,part,box.material,fv(transform.xform(gv(local))),fv(transform.basis.xform(gv(normal))).normalized(),contact_cell,0},fraction);
        }
    };
    for(const auto& [id,n]:entities_)if(n.body){
        const double broad_radius=entity_broadphase_radius(n);
        if(!segment_overlaps_sphere(fv(n.body->get_global_position()),from,to,broad_radius+query.radius))continue;
        for(const auto& [pid,p]:n.parts){
            if(p.node&&p.node->is_visible_in_tree()){
                const Transform3D transform=p.node->get_global_transform(),inverse=transform.affine_inverse();
                for(const auto& b:p.boxes)if(b.box.solid)check(n.kind,id,b.part.empty()?pid:b.part,b.box,transform,inverse,{});
            }
            if(p.bone_node&&p.bone_node->is_visible_in_tree()){
                const Transform3D transform=p.bone_node->get_global_transform(),inverse=transform.affine_inverse();
                for(const auto& b:p.bone_boxes)if(b.box.solid&&b.box.material=="bone_core")check(n.kind,id,b.part,b.box,transform,inverse,{});
            }
        }
    }
    for(const auto& [id,n]:dynamics_){
        if(!n.machine&&!n.fixture){
            auto body=world_->bodies().find(id);if(body==world_->bodies().end())continue;
            const Transform3D transform=n.body->get_global_transform(),inverse=transform.affine_inverse();
            const Vec3 a=fv(inverse.xform(gv(from))),b=fv(inverse.xform(gv(to)));
            double broad_fraction=0;Vec3 broad_normal;
            if(n.bounds_size.length_squared()>1e-10&&!swept_box(a,b,query.radius/std::max(.001,double(transform.basis.get_scale().x)),n.bounds_center,n.bounds_size,broad_fraction,broad_normal))continue;
            for(const auto& voxel:body->second.voxels){Box box;box.center=cell_center(voxel.cell);box.size={.5,.5,.5};box.material=voxel.block;check("body",id,{},box,transform,inverse,voxel.cell);}
        }else{
            const Transform3D transform=n.body->get_global_transform(),inverse=transform.affine_inverse();
            const Vec3 a=fv(inverse.xform(gv(from))),b=fv(inverse.xform(gv(to)));
            const double scale=std::max(.001,double(transform.basis.get_scale().x));double broad_fraction=0;Vec3 broad_normal;
            if(n.bounds_size.length_squared()>1e-10&&!swept_box(a,b,query.radius/scale,n.bounds_center,n.bounds_size,broad_fraction,broad_normal))continue;
            if(n.machine){auto it=simulation_->machine_bodies().find(id);if(it!=simulation_->machine_bodies().end())for(const auto& s:it->second.shapes)check("machine",id,s.part_id,s.local_box,transform,inverse,{});}
            else for(const auto& box:n.boxes)if(box.solid)check("fixture",id,{},box,transform,inverse,{});
        }
    }
    std::stable_sort(out.begin(),out.end(),[](const auto&a,const auto&b){return a.contact.distance<b.contact.distance;});return out;
}
bool FeralGame::occupied_cell(Vec3 center){
    const Ref<World3D> scene_world=get_world_3d();if(!scene_world.is_valid())return false;
    PhysicsDirectSpaceState3D* space=scene_world->get_direct_space_state();if(!space)return false;
    Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(Vector3(.499,.499,.499));
    Ref<PhysicsShapeQueryParameters3D> query;query.instantiate();query->set_shape(shape);
    query->set_transform(Transform3D(Basis(),gv(center)));query->set_collision_mask(4|8);query->set_margin(0);
    return !space->intersect_shape(query,1).is_empty();
}
void FeralGame::apply_contact(const ContactEvent& event){
    const auto& hit=event.contact;Json result;
    if(!active_weapon_.value("instanceId",Json()).is_null()){
        if(paid_attack_id_!=event.attack_id){paid_attack_id_=event.attack_id;paid_attack_=gameplay_->command("weapon.attack",{{"distanceM",(hit.point-actor_pose().origin).length()},{"claim","hit:"+std::to_string(Time::get_singleton()->get_ticks_usec())+":"+std::to_string(event.attack_id)}});}
        if(!paid_attack_.value("ok",false))return;
    }
    if(hit.kind=="terrain"||hit.kind=="body"){
        const auto& block=content_.find("blocks",hit.material);MiningRule rule;mining_rule(content_,hit.material,rule);
        MiningGear gear;
        if(held_=="stone_pick"||held_=="hand_knife"){
            const Json tool_state=gameplay_->view().value("progression",Json::object());
            const Json& tool=content_.find(held_);const int maximum=tool.value("durabilityActions",0);
            const int count=static_cast<int>(gameplay_->count(held_));
            const int wear=tool_state.value("toolWear",Json::object()).value(held_,maximum);
            if(count>0&&(maximum<=0||wear>0||count>=2)){gear.power=2;gear.affinity=held_=="hand_knife"?"wood":"rock";}
        }
        if(!rule.hardness)rule={"rock","rock",1.6};
        const double work=rule.hardness*std::max(.5,std::pow(.5,3.0))/(gear.affinity==rule.affinity?gear.power:1.0);
        const double hp=block.value("durabilityHpPerCell",100.0),fraction=.2/std::max(.001,work);
        if(hit.kind=="body"&&(held_.empty()||held_=="gripper"))if(auto object=dynamics_.find(hit.id);object!=dynamics_.end()&&object->second.body&&!object->second.body->is_freeze_enabled()){
            const double impulse=std::min(object->second.body->get_mass()*3.0,held_=="gripper"?2200.0:650.0);
            if(impulse>0){const Vec3 direction=feral::rotate(actor_pose().rotation,{0,0,-1});object->second.body->apply_impulse(gv(direction*impulse),gv(hit.point-fv(object->second.body->get_global_position())));}
        }
        // Keep the authored strike strength for each tool (knife 10, pick 20, etc.) as the
        // reference. Editing profile damage scales terrain work without changing the old default.
        result=world_->damage(hit,hp*fraction*event.damage/std::max(.001,event.mining_reference_damage));
        if(result.value("removed",false)){
            if(result.contains("loot")&&result["loot"].is_object()&&!result["loot"].empty()){
                const auto& loot=result["loot"];const std::string loot_id=loot.value("id",std::string{});
                const double count=loot.value("count",1.0);
                if(!loot_id.empty()&&count>0)gameplay_->grant({{loot_id,count}},"hit-loot:"+session_id_+":"+
                    std::to_string(event.attack_id)+":"+hit.kind+":"+hit.id+":"+cell_key(hit.cell));
            }
            if(paid_attack_id_!=event.attack_id){
                paid_attack_id_=event.attack_id;
                if(!held_.empty())gameplay_->command("tools.wear",{{"id",held_},{"actions",1},
                    {"claim","hit-wear:"+session_id_+":"+std::to_string(event.attack_id)}});
            }
            if(hit.kind=="terrain"&&hit.material=="grass"){
                const std::string attack=session_id_+":"+std::to_string(event.attack_id);
                if(grass_reward_attack_!=attack){grass_reward_attack_=attack;grass_cells_removed_=0;grass_seed_awarded_=false;}
                ++grass_cells_removed_;
                if(grass_cells_removed_>=4&&!grass_seed_awarded_){
                    const Json granted=gameplay_->grant({{"seed",1}},"grass-clear:"+attack);
                    grass_seed_awarded_=granted.value("ok",false);
                }
            }
        }
    }else{
        double scale=active_weapon_.value("damage",4.0)/std::max(.001,profiles_["profiles"][event.profile_id].value("damage",20.0));
        std::string part=hit.part;const bool bone_layer=part.rfind("bone:",0)==0;if(bone_layer)part.erase(0,5);
        const Vec3 attack_direction=feral::rotate(actor_pose().rotation,{0,0,-1}).normalized();
        Json args={{"id",hit.id},{"partId",part},{"amount",event.damage*scale},{"point",hit.point},
            {"attackerPosition",actor_pose().origin},{"direction",attack_direction},
            {"mode",event.damage_shape=="point"?"strike":event.damage_shape},
            {"attackId",session_id_+":"+std::to_string(event.attack_id)+":"+hit.part+":"+cell_key(hit.cell)}};
        if(bone_layer)args["layer"]="bone";
        if(hit.kind=="creature")if(auto entity=entities_.find(hit.id);entity!=entities_.end()){
            const std::string visual_part=bone_layer?"bone:"+part:part;
            auto node=entity->second.parts.find(bone_layer?part:visual_part);
            if(node!=entity->second.parts.end()){
                Node3D* transform_node=bone_layer?node->second.bone_node:node->second.node;
                if(transform_node){const Transform3D inverse=transform_node->get_global_transform().affine_inverse();
                    args["localPoint"]=fv(inverse.xform(gv(hit.point)));
                    args["localDirection"]=fv(inverse.basis.xform(gv(attack_direction))).normalized();}
            }
        }
        if(hit.kind=="fixture")result=gameplay_->command("placement.damage",args);
        else result=simulation_->command(hit.kind=="machine"?"machine.damage":hit.kind=="boss"?"boss.damage":"creature.damage",args,*world_,*gameplay_);
    }
    if(result.value("ok",false)){++hit_count_;play_impact();}
    else if(result.contains("reason")&&result["reason"].is_string())notice(result["reason"].get<std::string>());
}
void FeralGame::interact(){
    if(!driving_.empty()){exit_machine();notice("조종을 마쳤습니다.");return;}
    if(!gripped_.empty()){ui_command("grip","{}");return;}
    auto actor=actor_pose();aim_=aim_contact(actor.origin,feral::rotate(actor.rotation,{0,0,-1}),6.5);
    if(!aim_.hit){notice("상호작용할 대상이 없습니다");return;}
    if(aim_.kind=="body"){
        if(held_=="wrench"){auto& b=world_->bodies().at(aim_.id);b.anchored=!b.anchored;notice(b.anchored?"물체를 고정했습니다":"고정을 풀었습니다");return;}
        ui_command("grip","{}");return;
    }
    if(aim_.kind=="machine"){show_panel("machines",{{"id",aim_.id}});return;}
    if(aim_.kind=="fixture"){show_panel("energy",{{"id",aim_.id}});return;}
    if(aim_.kind=="creature"){
        const Json creatures=simulation_->view().value("creatures",Json::object());
        if(creatures.is_object()&&creatures.contains(aim_.id)){
            const Json& creature=creatures[aim_.id];
            if(creature.value("dead",false)){
                const Json drops=simulation_->command("creature.claim_drops",{{"id",aim_.id}},*world_,*gameplay_);
                if(drops.value("ok",false)){notice(drops.value("duplicate",false)?"전리품을 이미 회수했습니다":"전리품을 회수했습니다");return;}
            }
            if(creature.value("civilization",false)){show_panel("community",{{"targetId",aim_.id}});return;}
        }
    }
    Json args={{"id",aim_.id},{"kind",aim_.kind},{"partId",aim_.part},{"position",aim_.point},
        {"actorPosition",fv(player_->get_position())}};
    auto result=simulation_->command("interact",args,*world_,*gameplay_);
    if(result.value("ok",false)){notice(result.value("message",std::string("상호작용했습니다")));return;}
    show_panel("inspect",args);
}
Json FeralGame::dispatch(const std::string& name,Json args){
    args["actorPosition"]=fv(player_->get_position());
    if(!args.contains("claim"))args["claim"]="player:"+std::to_string(Time::get_singleton()->get_ticks_usec());
    if(!args.contains("requestId"))args["requestId"]=args["claim"];
    if(name.rfind("sandbox.",0)==0){
        if(!world_tools_)return fail("world_tools_unavailable");
        const auto actor=actor_pose();Contact hit=aim_contact(actor.origin,feral::rotate(actor.rotation,{0,0,-1}),8.0);
        if(!hit.hit)return fail("aim_required");
        args["hit"]={{"point",hit.point},{"normal",hit.normal},{"kind",hit.kind},{"id",hit.id},{"distance",hit.distance}};
        args["playerPosition"]=fv(player_->get_position());
        args["bodyHeight"]=stance_=="crawl"?.5:stance_=="crouch"?1.0:1.8;
        return world_tools_->command(name,std::move(args));
    }
    if(name=="placement.place"){
        auto actor=actor_pose();auto hit=aim_contact(actor.origin,feral::rotate(actor.rotation,{0,0,-1}),6.5);
        if(!hit.hit)return fail("설치할 바닥을 조준하세요");const auto& model=content_.asset(args.value("assetId",std::string{}));if(model.empty())return fail("설비 형상을 찾을 수 없습니다");
        std::vector<Box> boxes;std::map<std::string,Vec3> offsets;double bottom=1e30;
        for(const auto& p:model["parts"]){Vec3 offset=p["translation"].get<Vec3>();if(p["parent"].is_string())offset+=offsets[p["parent"].get<std::string>()];offsets[p["id"].get<std::string>()]=offset;for(auto b:part_boxes(model,p))if(b.box.solid){b.box.center+=offset;bottom=std::min(bottom,b.box.center.y-b.box.size.y*.5);boxes.push_back(b.box);}}
        Vec3 position=hit.point+hit.normal*.002;position.y-=bottom;position={std::round(position.x*32)/32,std::round(position.y*32)/32,std::round(position.z*32)/32};args["position"]=position;
        bool occupied=false,supported=false;auto space=get_world_3d()->get_direct_space_state();TypedArray<RID> exclude;for(const auto& [id,e]:entities_)if(e.kind=="fixture"&&e.body)exclude.push_back(e.body->get_rid());
        for(const auto& b:boxes){
            Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(gv(b.size)-Vector3(.001,.001,.001));Ref<PhysicsShapeQueryParameters3D> query;query.instantiate();query->set_shape(shape);query->set_transform(Transform3D(Basis(),gv(position+b.center)));query->set_collision_mask(1|2|4|8);query->set_exclude(exclude);query->set_margin(0);
            if(!space->intersect_shape(query,1).is_empty()){occupied=true;break;}
            if(std::abs(b.center.y-b.size.y*.5-bottom)<.04){Vector3 p=gv(position+b.center)-Vector3(0,b.size.y*.5,0);auto ray=PhysicsRayQueryParameters3D::create(p+Vector3(0,.04,0),p-Vector3(0,.08,0),1|4|8);auto support=space->intersect_ray(ray);if(!support.is_empty()&&Vector3(support["normal"]).y>.5)supported=true;}
        }
        args["worldContext"]={{"supported",supported},{"overlap",occupied},{"occupied",occupied}};
    }
    Json result=gameplay_->command(name,args);
    if(!result.value("ok",false)){
        auto other=simulation_->command(name,args,*world_,*gameplay_);
        if(other.value("ok",false)||result.value("reason",std::string{}).find("unknown")!=std::string::npos)result=other;
    }
    if(name=="first_signal.travel"&&result.value("ok",false)&&result.contains("position")){
        const Vec3 destination=result["position"].get<Vec3>();
        player_->set_position(gv(destination));player_->set_velocity({});fall_speed_=0;
        simulation_->tick(0,destination,*world_,*gameplay_);require_dynamic_terrain();
        world_->stream(destination,settings_.value("viewDistance",6));sync_terrain(true);sync_dynamics(true);sync_entities();
        const double height=stance_=="crawl"?.5:stance_=="crouch"?1.0:1.8;
        gameplay_->set_player_state({{"position",destination},{"x",destination.x},{"y",destination.y},{"z",destination.z},
            {"yaw",yaw_},{"moving",false},{"height",height},{"radius",stance_=="crawl"?.23:.28}});
        simulation_->set_player_state(gameplay_->player_state());
    }
    return result;
}
void FeralGame::resolve_impacts(){
    auto award_loot=[&](const Json& result,const std::string& claim){
        if(!result.value("removed",false)||!result.contains("loot")||!result["loot"].is_object())return;
        const Json& loot=result["loot"];const std::string item=loot.value("id",std::string{});const double count=loot.value("count",1.0);
        if(!item.empty()&&count>0)gameplay_->grant({{item,count}},claim);
    };
    auto damage_terrain=[&](Vec3 point,Vec3 normal,double energy,const std::string& claim){
        const Cell cell=world_cell(point-normal*.02);const std::string block_id=world_->block(cell);if(block_id.empty())return;
        const auto& info=content_.find("blocks",block_id);const std::string kind=info.value("kind",std::string("stone"));
        const double strength=kind=="soil"?1800:kind=="wood"?2800:kind=="vegetation"?300:11000;
        Contact hit{true,"terrain",{},{},block_id,point,normal,cell,0};
        award_loot(world_->damage(hit,energy*.35/strength*info.value("durabilityHpPerCell",100.0)),claim);
    };
    auto damage_body=[&](const std::string& id,Vec3 point,double energy,const std::string& claim){
        auto it=world_->bodies().find(id);if(it==world_->bodies().end())return;
        const auto& body=it->second;const Quat inverse{-body.rotation.x,-body.rotation.y,-body.rotation.z,body.rotation.w};
        const Vec3 local=feral::rotate(inverse,point-body.position);const Voxel* nearest=nullptr;double closest=1;
        for(const auto& voxel:body.voxels){const double distance=(cell_center(voxel.cell)-local).length_squared();if(distance<closest){closest=distance;nearest=&voxel;}}
        if(!nearest)return;
        const auto& block=content_.find("blocks",nearest->block);const std::string kind=block.value("kind",std::string("stone"));
        const double strength=kind=="soil"?1800:kind=="wood"?2800:kind=="vegetation"?300:11000;
        Contact hit{true,"body",id,{},nearest->block,point,{},nearest->cell,0};
        award_loot(world_->damage(hit,energy*.35/strength*block.value("durabilityHpPerCell",100.0)),claim);
    };
    auto damage_dynamic=[&](const std::string& id,Vec3 point,double energy,const std::string& attack){
        const auto dynamic=dynamics_.find(id);
        if(dynamic!=dynamics_.end()&&dynamic->second.machine){
            const auto machine=simulation_->machine_bodies().find(id);if(machine==simulation_->machine_bodies().end())return;
            const Quat inverse{-machine->second.rotation.x,-machine->second.rotation.y,-machine->second.rotation.z,machine->second.rotation.w};
            const Vec3 local=feral::rotate(inverse,point-machine->second.position);const MachineShape* nearest=nullptr;double closest=std::numeric_limits<double>::infinity();
            for(const auto& shape:machine->second.shapes){const Box& box=shape.local_box;const Vec3 half=box.size*.5;const Vec3 nearest_point{std::clamp(local.x,box.center.x-half.x,box.center.x+half.x),std::clamp(local.y,box.center.y-half.y,box.center.y+half.y),std::clamp(local.z,box.center.z-half.z,box.center.z+half.z)};const double distance=(local-nearest_point).length_squared();if(distance<closest){closest=distance;nearest=&shape;}}
            if(nearest&&energy>0)simulation_->command("machine.damage",{{"id",id},{"partId",nearest->part_id},{"amount",std::min(100.0,energy/100.0)},{"attackId",attack}},*world_,*gameplay_);
            return;
        }
        if(dynamic!=dynamics_.end()&&dynamic->second.fixture){
            if(energy>0)gameplay_->command("placement.damage",{{"id",id},{"amount",std::min(500.0,energy/100.0)}});
            return;
        }
        damage_body(id,point,energy,attack+":loot");
    };
    auto damage_entity=[&](const std::string& id,int shape_index,Vec3 point,Vec3 direction,double energy,const std::string& attack){
        const auto found=entities_.find(id);if(found==entities_.end())return false;
        std::string part="body";
        if(shape_index>=0&&found->second.body){
            const uint32_t owner=found->second.body->shape_find_owner(shape_index);
            Object* object=found->second.body->shape_owner_get_owner(owner);
            if(auto* node=Object::cast_to<Node>(object))part=fs(node->get_name());
        }
        const bool bone_layer=part.rfind("bone:",0)==0;if(bone_layer)part.erase(0,5);
        if(found->second.kind=="fixture"){
            gameplay_->command("placement.damage",{{"id",id},{"amount",std::min(500.0,energy/100.0)}});
        }else{
            const std::string command=found->second.kind=="boss"?"boss.damage":"creature.damage";
            Json args={{"id",id},{"partId",part},{"point",point},{"direction",direction},{"amount",std::min(80.0,energy/100.0)},
                {"mode","impact"},{"attackId",attack}};if(bone_layer)args["layer"]="bone";
            if(found->second.kind=="creature"){
                auto node=found->second.parts.find(part);
                if(node!=found->second.parts.end()){
                    Node3D* transform_node=bone_layer?node->second.bone_node:node->second.node;
                    if(transform_node){const Transform3D inverse=transform_node->get_global_transform().affine_inverse();
                        args["localPoint"]=fv(inverse.xform(gv(point)));
                        args["localDirection"]=fv(inverse.basis.xform(gv(direction))).normalized();}
                }
            }
            simulation_->command(command,std::move(args),*world_,*gameplay_);
        }
        return true;
    };
    for(auto& [id,n]:dynamics_){
        for(size_t i=0;i<n.body->contact_count();i++){
            const auto& c=n.body->contact(i);std::string pair=id<c.target?id+"|"+c.target:c.target+"|"+id;
            if(impact_cooldowns_[pair]>clock_)continue;impact_cooldowns_[pair]=clock_+.3;
            const std::string impact=session_id_+":impact:"+pair+":"+std::to_string(clock_);
            if(c.target=="player"){
                if(id!=gripped_&&id!=driving_)gameplay_->record_event({{"type","player_damage"},{"amount",std::min(100.0,c.joules/140)},{"source",id}});
                damage_dynamic(id,c.point,c.joules,impact+":source");
            }else if(c.target=="terrain"){
                damage_terrain(c.point,c.normal,c.joules,impact+":terrain-loot");
                damage_dynamic(id,c.point,c.joules,impact+":source");
            }else if(damage_entity(c.target,c.target_shape,c.point,(c.point-fv(n.body->get_global_position())).normalized(),c.joules,impact+":target")){
                damage_dynamic(id,c.point,c.joules,impact+":source");
            }else{
                damage_dynamic(c.target,c.point,c.joules,impact+":target");
                damage_dynamic(id,c.point,c.joules,impact+":source");
            }
        }n.body->clear_contacts();
    }
    for(auto it=impact_cooldowns_.begin();it!=impact_cooldowns_.end();)if(it->second<clock_-2)it=impact_cooldowns_.erase(it);else++it;
}
}
