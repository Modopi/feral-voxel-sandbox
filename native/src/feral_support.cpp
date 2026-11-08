#include "feral_game.hpp"
#include <godot_cpp/classes/world3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_ray_query_parameters3d.hpp>

namespace feral {
using namespace godot;
namespace {
struct Bounds {
    Vec3 minimum{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity()};
    Vec3 maximum{-std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity()};
    bool valid=false;
};

bool finite_vec(Vec3 value){return std::isfinite(value.x)&&std::isfinite(value.y)&&std::isfinite(value.z);}

void include(Bounds& bounds,Vec3 point){
    if(!finite_vec(point))return;
    for(int axis=0;axis<3;axis++){
        bounds.minimum[axis]=std::min(bounds.minimum[axis],point[axis]);
        bounds.maximum[axis]=std::max(bounds.maximum[axis],point[axis]);
    }
    bounds.valid=true;
}

void include_box(Bounds& bounds,Vec3 center,Vec3 size){
    if(!finite_vec(center)||!finite_vec(size)||size.x<=0||size.y<=0||size.z<=0)return;
    include(bounds,center-size*.5);include(bounds,center+size*.5);
}

Vec3 read_vec3(const Json& value){
    Vec3 result{};
    if(value.is_object()||(value.is_array()&&value.size()>=3))from_json(value,result);
    return result;
}

Quat normalized(Quat rotation){
    const double norm=std::sqrt(rotation.x*rotation.x+rotation.y*rotation.y+rotation.z*rotation.z+rotation.w*rotation.w);
    if(!std::isfinite(norm)||norm<1e-12)return {};
    return {rotation.x/norm,rotation.y/norm,rotation.z/norm,rotation.w/norm};
}

void include_transformed(Bounds& world_bounds,const Bounds& local_bounds,Vec3 position,Quat rotation){
    if(!local_bounds.valid||!finite_vec(position))return;
    rotation=normalized(rotation);
    for(int x:{0,1})for(int y:{0,1})for(int z:{0,1}){
        Vec3 corner{x?local_bounds.maximum.x:local_bounds.minimum.x,
                    y?local_bounds.maximum.y:local_bounds.minimum.y,
                    z?local_bounds.maximum.z:local_bounds.minimum.z};
        include(world_bounds,position+feral::rotate(rotation,corner));
    }
}

void request_bounds(World& world,const Bounds& bounds,Vec3 velocity){
    if(!bounds.valid||!finite_vec(velocity))return;
    const Vec3 size=bounds.maximum-bounds.minimum;
    const Vec3 margin{1.0+std::abs(velocity.x)*.15,
                      1.0+std::abs(velocity.y)*.15,
                      1.0+std::abs(velocity.z)*.15};
    world.require_terrain((bounds.minimum+bounds.maximum)*.5,size+margin*2);
}

bool near_player(Vec3 origin,Vec3 player){
    const double dx=origin.x-player.x,dz=origin.z-player.z;
    return finite_vec(origin)&&finite_vec(player)&&dx*dx+dz*dz<=64.0*64.0;
}
}

void FeralGame::require_dynamic_terrain(){
    if(!world_||!simulation_||!gameplay_||!player_)return;
    const Vec3 player_position=fv(player_->get_position());

    for(const auto& [id,body]:simulation_->machine_bodies()){
        if(!near_player(body.position,player_position))continue;
        Bounds local_bounds;
        const auto dynamic=dynamics_.find(id);
        if(dynamic!=dynamics_.end()&&dynamic->second.revision==body.revision){
            include_box(local_bounds,dynamic->second.bounds_center,dynamic->second.bounds_size);
        }
        if(!local_bounds.valid){
            for(const auto& shape:body.shapes)if(shape.local_box.solid)
                include_box(local_bounds,shape.local_box.center,shape.local_box.size);
        }
        Bounds world_bounds;
        include_transformed(world_bounds,local_bounds,body.position,body.rotation);
        request_bounds(*world_,world_bounds,body.velocity);
    }

    const uint64_t geometry_revision=gameplay_->placement_geometry_revision();
    if(fixture_geometry_revision_!=geometry_revision){
        fixture_geometry_=gameplay_->dynamic_fixtures();
        fixture_geometry_revision_=geometry_revision;
    }
    for(const auto& geometry:fixture_geometry_){
        if(!geometry.is_object()||!geometry.contains("id")||!geometry["id"].is_string())continue;
        const std::string& id=geometry["id"].get_ref<const std::string&>();
        const Json* current=nullptr;
        for(const auto& fixture:gameplay_->fixtures())if(fixture.is_object()&&fixture.value("id",Json())==id){current=&fixture;break;}
        if(!current)continue;
        const Json& fixture=*current;
        const Json& motion=fixture.contains("motion")&&fixture["motion"].is_object()?fixture["motion"]:empty_object();
        if(motion.value("mode",std::string("fixed"))!="dynamic")continue;
        const Vec3 position=fixture.contains("position")?read_vec3(fixture["position"]):Vec3{};
        if(!near_player(position,player_position))continue;
        const Vec3 velocity=motion.contains("velocity")?read_vec3(motion["velocity"]):Vec3{};
        Quat rotation{};
        if(motion.contains("rotation")&&motion["rotation"].is_object())from_json(motion["rotation"],rotation);

        Bounds local_bounds;
        const auto dynamic=dynamics_.find(id);
        if(dynamic!=dynamics_.end()&&dynamic->second.revision==fixture_geometry_revision_){
            include_box(local_bounds,dynamic->second.bounds_center,dynamic->second.bounds_size);
        }
        if(!local_bounds.valid&&geometry.contains("boxes")&&geometry["boxes"].is_array()){
            for(const auto& box:geometry["boxes"]){
                if(!box.is_object()||!box.value("solid",true))continue;
                const Vec3 center=box.contains("center")?read_vec3(box["center"]):Vec3{};
                const Vec3 size=box.contains("size")?read_vec3(box["size"]):Vec3{};
                include_box(local_bounds,center,size);
            }
        }
        Bounds world_bounds;
        include_transformed(world_bounds,local_bounds,position,rotation);
        request_bounds(*world_,world_bounds,velocity);
    }
}

void FeralGame::sync_fixture_support(){
    if(fixture_support_queue_.empty()&&clock_>=next_support_scan_){
        next_support_scan_=clock_+.5;
        for(const auto& [id,node]:entities_)if(node.kind=="fixture"&&node.body)fixture_support_queue_.push_back(id);
    }
    auto* space=get_world_3d()->get_direct_space_state();
    for(int budget=2;budget>0&&!fixture_support_queue_.empty();--budget){
        std::string id=fixture_support_queue_.front();fixture_support_queue_.pop_front();auto found=entities_.find(id);if(found==entities_.end()||!found->second.body)continue;
        const auto& entity=found->second;if((fv(entity.body->get_position())-fv(player_->get_position())).length_squared()>64*64)continue;
        double lowest=1e30;std::vector<Vec3> feet;
        for(const auto& [part_id,part]:entity.parts)for(const auto& draw:part.boxes)if(draw.box.solid){
            const auto transform=part.node->get_global_transform();
            for(int x:{-1,1})for(int y:{-1,1})for(int z:{-1,1}){
                Vec3 p=fv(transform.xform(gv(draw.box.center+Vec3{draw.box.size.x*x*.45,draw.box.size.y*y*.5,draw.box.size.z*z*.45})));
                if(p.y<lowest-.03){lowest=p.y;feet.clear();}if(p.y<=lowest+.03)feet.push_back(p);
            }
        }
        bool supported=feet.empty();TypedArray<RID> exclude;exclude.push_back(entity.body->get_rid());
        for(Vec3 foot:feet){Cell section{int(std::floor(foot.x/4)),int(std::floor((foot.y-.05)/4)),int(std::floor(foot.z/4))};if(!terrain_.count(section)){supported=true;break;}auto ray=PhysicsRayQueryParameters3D::create(gv(foot)+Vector3(0,.025,0),gv(foot)-Vector3(0,.10,0),1|4|8);ray->set_exclude(exclude);auto hit=space->intersect_ray(ray);if(!hit.is_empty()&&Vector3(hit["normal"]).y>.45){supported=true;break;}}
        if(!supported){auto result=gameplay_->command("placement.mark_dynamic",{{"id",id},{"reason","support_lost"}});if(result.value("ok",false)){entity.body->set_collision_layer(0);entity.body->set_collision_mask(0);}}
    }
}
}
