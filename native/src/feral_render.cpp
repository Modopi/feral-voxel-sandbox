#include "feral_game.hpp"
#include "native_asset_bounds.hpp"
#include <godot_cpp/classes/box_shape3d.hpp>
#include <godot_cpp/classes/capsule_shape3d.hpp>
#include <godot_cpp/classes/directional_light3d.hpp>
#include <godot_cpp/classes/world_environment.hpp>
#include <godot_cpp/classes/environment.hpp>
#include <godot_cpp/classes/sky.hpp>
#include <godot_cpp/classes/procedural_sky_material.hpp>
#include <godot_cpp/classes/physics_material.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/kinematic_collision3d.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <functional>
#include <godot_cpp/classes/time.hpp>

namespace feral {
using namespace godot;
void FeralGame::build_scene(){
    material_.instantiate();material_->set_flag(BaseMaterial3D::FLAG_ALBEDO_FROM_VERTEX_COLOR,true);material_->set_flag(BaseMaterial3D::FLAG_SRGB_VERTEX_COLOR,true);material_->set_roughness(.9);material_->set_cull_mode(BaseMaterial3D::CULL_DISABLED);
    fluid_material_.instantiate();fluid_material_->set_flag(BaseMaterial3D::FLAG_ALBEDO_FROM_VERTEX_COLOR,true);fluid_material_->set_flag(BaseMaterial3D::FLAG_SRGB_VERTEX_COLOR,true);fluid_material_->set_roughness(.25);fluid_material_->set_transparency(BaseMaterial3D::TRANSPARENCY_ALPHA);fluid_material_->set_albedo(Color(1,1,1,.62));fluid_material_->set_cull_mode(BaseMaterial3D::CULL_DISABLED);
    world_root_=memnew(Node3D);world_root_->set_process_mode(Node::PROCESS_MODE_PAUSABLE);add_child(world_root_);
    auto sun=memnew(DirectionalLight3D);sun->set_rotation_degrees({-48,-25,0});sun->set_param(Light3D::PARAM_ENERGY,1.0);sun->set_shadow(true);add_child(sun);
    auto environment_node=memnew(WorldEnvironment);Ref<Environment> environment;environment.instantiate();
    Ref<ProceduralSkyMaterial> sky_material;sky_material.instantiate();sky_material->set_sky_top_color(Color(.19,.32,.43));sky_material->set_sky_horizon_color(Color(.66,.72,.65));sky_material->set_ground_horizon_color(Color(.66,.72,.65));
    Ref<Sky> sky;sky.instantiate();sky->set_material(sky_material);environment->set_sky(sky);environment->set_background(Environment::BG_SKY);
    environment->set_ambient_source(Environment::AMBIENT_SOURCE_COLOR);environment->set_ambient_light_color(Color(.66,.74,.78));environment->set_ambient_light_energy(.7);environment->set_tonemapper(Environment::TONE_MAPPER_FILMIC);
    environment->set_fog_enabled(true);environment->set_fog_density(.003);environment->set_fog_light_color(Color(.54,.64,.64));environment_node->set_environment(environment);add_child(environment_node);
    player_=memnew(CharacterBody3D);player_->set_process_mode(Node::PROCESS_MODE_PAUSABLE);player_->set_meta("feral_player",true);player_->set_meta("feral_id","player");player_->set_collision_layer(2);player_->set_collision_mask(1|4|8);player_->set_floor_snap_length(.3);add_child(player_);
    Ref<CapsuleShape3D> capsule;capsule.instantiate();capsule->set_radius(.28);capsule->set_height(1.7);auto owner=player_->create_shape_owner(player_);player_->shape_owner_add_shape(owner,capsule);player_->shape_owner_set_transform(owner,Transform3D(Basis(),Vector3(0,.85,0)));
    camera_=memnew(Camera3D);camera_->set_position({0,1.55,0});camera_->set_fov(settings_.value("fov",75.0));camera_->set_near(.04);camera_->set_far(350);player_->add_child(camera_);camera_->make_current();
    hand_=memnew(Node3D);camera_->add_child(hand_);
    canvas_=memnew(CanvasLayer);add_child(canvas_);
}
void FeralGame::set_shapes(CollisionObject3D* body,const std::vector<Box>& boxes){
    auto owners=body->get_shape_owners();for(int i=0;i<owners.size();i++)body->remove_shape_owner(owners[i]);
    for(const auto& b:boxes)if(b.solid&&b.size.x>1e-6&&b.size.y>1e-6&&b.size.z>1e-6){
        Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(gv(b.size));auto owner=body->create_shape_owner(body);body->shape_owner_add_shape(owner,shape);body->shape_owner_set_transform(owner,Transform3D(Basis(),gv(b.center)));
    }
}
void FeralGame::sync_terrain(bool initial){
    auto dirty=world_->dirty_sections();bool changed=stream_revision_!=world_->stream_revision();if(!changed&&dirty.empty()&&mesh_queue_.empty())return;
    if(changed){auto loaded=world_->loaded_sections();std::set<Cell> next_loaded(loaded.begin(),loaded.end());if(runtime_check_&&runtime_check_frame_>0){for(Cell section:next_loaded)if(!loaded_sections_.count(section))runtime_sections_added_++;for(Cell section:loaded_sections_)if(!next_loaded.count(section))runtime_sections_removed_++;}loaded_sections_=std::move(next_loaded);stream_revision_=world_->stream_revision();
        for(auto it=terrain_.begin();it!=terrain_.end();)if(!loaded_sections_.count(it->first)){it->second.body->queue_free();it=terrain_.erase(it);}else++it;
        for(Cell section:loaded)if(!terrain_.count(section)&&mesh_pending_.insert(section).second)mesh_queue_.push_back(section);
    }
    for(Cell section:dirty)if(loaded_sections_.count(section)&&mesh_pending_.insert(section).second)mesh_queue_.push_back(section);
    if(!initial&&(changed||!dirty.empty())){
        Vec3 player=fv(player_->get_position());auto priority=[&](Cell section){Vec3 center{section.x*4.+2,section.y*4.+2,section.z*4.+2};double value=(center-player).length_squared();for(const auto& [id,n]:dynamics_)if(!n.body->is_sleeping()&&n.body->get_collision_layer()!=0)value=std::min(value,(center-fv(n.body->get_position())).length_squared());return value;};
        std::stable_sort(mesh_queue_.begin(),mesh_queue_.end(),[&](Cell a,Cell b){return priority(a)<priority(b);});
    }
    int budget=initial?int(mesh_queue_.size()):3;const uint64_t mesh_started=Time::get_singleton()->get_ticks_usec();
    while(budget--&&!mesh_queue_.empty()){
        Cell section=mesh_queue_.front();mesh_queue_.pop_front();mesh_pending_.erase(section);if(!loaded_sections_.count(section))continue;
        auto& n=terrain_[section];if(!n.body){n.body=memnew(StaticBody3D);n.body->set_collision_layer(1);n.body->set_collision_mask(2|4|8);world_root_->add_child(n.body);n.mesh=memnew(MeshInstance3D);n.body->add_child(n.mesh);n.mesh->set_material_override(material_);n.fluid=memnew(MeshInstance3D);n.body->add_child(n.fluid);n.fluid->set_material_override(fluid_material_);}
        if(n.terrain_revision!=world_->terrain_revision(section)){n.mesh->set_mesh(terrain_mesh(world_->mesh(section)));set_shapes(n.body,world_->terrain_boxes(section));n.terrain_revision=world_->terrain_revision(section);++rebuilt_sections_;}
        if(n.fluid_revision!=world_->fluid_revision(section)){n.fluid->set_mesh(terrain_mesh(world_->fluid_mesh(section)));n.fluid_revision=world_->fluid_revision(section);}
        if(!initial&&Time::get_singleton()->get_ticks_usec()-mesh_started>=4000)break;
    }
}
void FeralGame::sync_dynamics(bool teleport){
    if(teleport){require_dynamic_terrain();world_->stream(fv(player_->get_position()),settings_.value("viewDistance",6));sync_terrain(true);}
    std::set<std::string> keep;Vec3 player=fv(player_->get_position());
    auto update=[&](const std::string& id,Vec3 position,Quat rotation,Vec3 velocity,Vec3 omega,double mass,bool anchored,uint64_t revision,const std::vector<Box>& boxes,bool machine,bool fixture=false,const std::string& asset_id={}){
        bool solid=std::any_of(boxes.begin(),boxes.end(),[](const Box& b){return b.solid;});Vec3 delta=position-player;
        if((solid?delta.x*delta.x+delta.z*delta.z:delta.length_squared())>64*64)return;
        keep.insert(id);auto& n=dynamics_[id];bool created=!n.body;
        if(created){n.body=memnew(NativeBody);n.body->set_meta("feral_id",gs(id));n.body->set_collision_layer(solid?4:0);n.body->set_collision_mask(solid?1|2|4|8:0);n.body->set_max_contacts_reported(8);n.body->set_contact_monitor(true);n.body->set_use_continuous_collision_detection(true);world_root_->add_child(n.body);n.mesh=memnew(MeshInstance3D);n.mesh->set_material_override(material_);n.body->add_child(n.mesh);n.body->set_position(gv(position));n.body->set_quaternion(gq(rotation));n.body->set_linear_velocity(gv(velocity));n.body->set_angular_velocity(gv(omega));}
        n.machine=machine;n.fixture=fixture;if(n.body->is_freeze_enabled()!=anchored)n.body->set_freeze_enabled(anchored);
        if(teleport&&(machine||fixture)){n.body->set_position(gv(position));n.body->set_quaternion(gq(rotation));n.body->set_linear_velocity(gv(velocity));n.body->set_angular_velocity(gv(omega));n.body->set_sleeping(false);}
        if(n.revision!=revision){n.boxes=boxes;Vec3 lo{1e30,1e30,1e30},hi{-1e30,-1e30,-1e30};for(const auto& box:boxes)if(box.solid)for(int axis=0;axis<3;axis++){lo[axis]=std::min(lo[axis],box.center[axis]-box.size[axis]*.5);hi[axis]=std::max(hi[axis],box.center[axis]+box.size[axis]*.5);}n.bounds_center=solid?(lo+hi)*.5:Vec3{};n.bounds_size=solid?hi-lo:Vec3{};n.body->set_mass(std::max(.01,mass));n.body->set_collision_layer(solid?4:0);n.body->set_collision_mask(solid?1|2|4|8:0);set_shapes(n.body,boxes);std::vector<DrawBox> draw;Vec3 com;double total=0;for(const auto& b:boxes){auto color=material_color(content_,b.material);if(!asset_id.empty()){const auto& asset=content_.asset(asset_id);if(asset.contains("materials"))for(const auto& material:asset["materials"])if(material.value("id",std::string{})==b.material){color=Color::html(gs(material.value("color",std::string("#83957B"))));color.a=material.value("opacity",1.0);break;}}draw.push_back({b,color,{}});com+=b.center*b.mass;total+=b.mass;}if(total>0){n.body->set_center_of_mass_mode(RigidBody3D::CENTER_OF_MASS_MODE_CUSTOM);n.body->set_center_of_mass(gv(com/total));}if(fixture&&!asset_id.empty()){const auto& model=content_.asset(asset_id);std::map<std::string,Vec3> offsets;draw.clear();for(const auto& part:model["parts"]){Vec3 offset=part["translation"].get<Vec3>();if(part["parent"].is_string())offset+=offsets[part["parent"].get<std::string>()];offsets[part["id"].get<std::string>()]=offset;for(auto box:part_boxes(model,part)){box.box.center+=offset;draw.push_back(box);}}}n.mesh->set_mesh(boxes_mesh(draw));n.revision=revision;}
    };
    for(const auto& [id,b]:world_->bodies())update(id,b.position,b.rotation,b.velocity,b.angular_velocity,b.mass,b.anchored,b.revision,b.boxes,false);
    for(const auto& [id,b]:simulation_->machine_bodies()){auto it=dynamics_.find(id);const bool geometry_changed=it==dynamics_.end()||it->second.revision!=b.revision;if(it!=dynamics_.end()&&it->second.revision==b.revision)update(id,b.position,b.rotation,b.velocity,b.angular_velocity,b.mass_kg,b.anchored,b.revision,it->second.boxes,true);else{std::vector<Box> boxes;boxes.reserve(b.shapes.size());for(const auto& s:b.shapes){Box box=s.local_box;box.mass=s.mass_kg;box.material=s.material_id;boxes.push_back(box);}update(id,b.position,b.rotation,b.velocity,b.angular_velocity,b.mass_kg,b.anchored,b.revision,boxes,true);}
        if(auto node=dynamics_.find(id);node!=dynamics_.end()&&(geometry_changed||node->second.mass_revision!=b.mass_revision)){node->second.body->set_mass(std::max(.01,b.mass_kg));node->second.body->set_center_of_mass_mode(RigidBody3D::CENTER_OF_MASS_MODE_CUSTOM);node->second.body->set_center_of_mass(gv(b.center_of_mass));node->second.mass_revision=b.mass_revision;}
    }
    if(fixture_geometry_revision_!=gameplay_->placement_geometry_revision()){fixture_geometry_=gameplay_->dynamic_fixtures();fixture_geometry_revision_=gameplay_->placement_geometry_revision();}
    for(const auto& geometry:fixture_geometry_){std::string id=geometry.value("id",std::string{});const Json* current=nullptr;for(const auto& f:gameplay_->fixtures())if(f.value("id",std::string{})==id){current=&f;break;}if(!current)continue;const auto& f=*current;const auto& motion=f.value("motion",Json::object());
        auto existing=dynamics_.find(id);std::vector<Box> boxes;if(existing==dynamics_.end()||existing->second.revision!=fixture_geometry_revision_)for(const auto& b:geometry["boxes"]){Box box;box.center=b["center"].get<Vec3>();box.size=b["size"].get<Vec3>();box.material=b.value("material",std::string("wood"));box.mass=b.value("massKg",1.0);box.solid=b.value("solid",true);boxes.push_back(box);}
        const auto& shapes=boxes.empty()&&existing!=dynamics_.end()?existing->second.boxes:boxes;
        update(id,f["position"].get<Vec3>(),motion.value("rotation",Json::object()).get<Quat>(),motion.value("velocity",Json::object()).get<Vec3>(),motion.value("angularVelocity",Json::object()).get<Vec3>(),geometry.value("massKg",1.0),false,fixture_geometry_revision_,shapes,false,true,geometry.value("assetId",std::string{}));
    }
    for(auto it=dynamics_.begin();it!=dynamics_.end();)if(!keep.count(it->first)){it->second.body->queue_free();it=dynamics_.erase(it);}else++it;
}
void FeralGame::physics_feedback(){
    if(!world_)return;
    for(const auto& [id,n]:dynamics_){Vec3 p=fv(n.body->get_position()),v=fv(n.body->get_linear_velocity()),w=fv(n.body->get_angular_velocity());Quat q=fq(n.body->get_quaternion());
        if(n.machine)simulation_->sync_machine_body(id,p,q,v,w);
        else if(n.fixture)gameplay_->sync_fixture_body(id,{{"position",p},{"rotation",q},{"velocity",v},{"angularVelocity",w},{"settled",n.body->is_sleeping()}});
        else if(auto it=world_->bodies().find(id);it!=world_->bodies().end()){it->second.position=p;it->second.rotation=q;it->second.velocity=v;it->second.angular_velocity=w;}
    }
}
void FeralGame::apply_forces(){
    for(auto& [id,n]:dynamics_){n.body->capture_velocity();if(!n.body->is_freeze_enabled()&&!n.body->is_sleeping()){
        auto fluid=world_->buoyancy_for_compound(fv(n.body->get_position()),fq(n.body->get_quaternion()),fv(n.body->get_linear_velocity()),n.body->get_mass(),n.boxes,FIXED_DT);
        for(const auto& f:fluid.forces)n.body->apply_force(gv(f.force_n),gv(f.world_point)-n.body->get_position());if(fluid.drag_force_n.length_squared()>1e-10)n.body->apply_central_force(gv(fluid.drag_force_n));
    }}
    for(const auto& f:simulation_->consume_forces())if(auto it=dynamics_.find(f.body_id);it!=dynamics_.end())it->second.body->apply_force(gv(f.force_newtons),gv(f.world_point)-it->second.body->get_position());
    if(!gripped_.empty())if(auto it=dynamics_.find(gripped_);it!=dynamics_.end()){
        auto body=it->second.body;Vector3 target=camera_->get_global_position()-camera_->get_global_basis().get_column(2)*grip_distance_;Vector3 delta=target-body->get_global_position();double mass=body->get_mass();
        if(delta.length()>8||body->is_freeze_enabled()){gripped_.clear();return;}
        Vector3 force=(delta*30-body->get_linear_velocity()*9+Vector3(0,9.8,0))*mass;double limit=held_=="gripper"?22000:3500;
        if(force.length()>limit)force=force.normalized()*limit;body->apply_central_force(force);body->set_angular_velocity(body->get_angular_velocity()*.94);
    }
}
std::vector<DrawBox> FeralGame::part_boxes(const Json& model,const Json& part,const Json* anatomy,bool bones)const{
    std::vector<DrawBox> result;const std::string part_id=part.value("id",std::string{});
    Json authored=part.value("boxes",Json::array());
    if(anatomy&&anatomy->is_object()){
        if(bones){authored=Json::array();for(const auto& row:anatomy->value("boneBoxes",Json::array()))if(row.value("partId",std::string{})==part_id)authored.push_back(row);}
        else if(anatomy->contains("partBoxes")&&(*anatomy)["partBoxes"].is_object()&&(*anatomy)["partBoxes"].contains(part_id))authored=(*anatomy)["partBoxes"][part_id];
    }
    for(const auto& box:authored){
        const std::string mat=bones?std::string("bone_core"):box.value("material",std::string{});Json descriptor=Json::object();
        if(!bones&&model.contains("materials")&&model["materials"].is_array())for(const auto& m:model["materials"])if(m.value("id",std::string{})==mat){descriptor=m;break;}
        Box b;b.center=box.at("center").get<Vec3>();b.size=box.at("size").get<Vec3>();b.material=mat;
        b.solid=bones?box.value("collidable",true):descriptor.value("collision",true);
        Color color=bones?Color(.82,.76,.6):Color::html(gs(descriptor.value("color",std::string("#83957B"))));
        if(!bones)color.a=descriptor.value("opacity",1.0);
        result.push_back({b,color,bones?"bone:"+part_id:part_id});
    }
    return result;
}
void FeralGame::build_entity(EntityNode& n,const EntityPose& pose){
    const auto& model=content_.asset(pose.asset_id);if(model.empty())return;
    n.asset=pose.asset_id;n.kind=pose.kind;n.anatomy_source=pose.anatomy_geometry;
    n.body=memnew(AnimatableBody3D);n.body->set_meta("feral_id",gs(pose.id));n.body->set_collision_layer(8);n.body->set_collision_mask(1|2|4);n.body->set_sync_to_physics(false);world_root_->add_child(n.body);
    n.visual_root=memnew(Node3D);n.visual_root->set_name("anatomy");n.body->add_child(n.visual_root);
    for(const auto& p:model["parts"]){
        const std::string id=p["id"];auto& part=n.parts[id];part.node=memnew(Node3D);part.node->set_name(gs(id));part.base_translation=gv(p["translation"].get<Vec3>());
        part.mesh=memnew(MeshInstance3D);part.node->add_child(part.mesh);part.mesh->set_material_override(material_);
        part.bone_node=memnew(Node3D);part.bone_node->set_name(gs("bone:"+id));part.node->add_child(part.bone_node);
        part.bone_mesh=memnew(MeshInstance3D);part.bone_node->add_child(part.bone_mesh);part.bone_mesh->set_material_override(material_);
    }
    for(const auto& p:model["parts"]){
        const std::string id=p["id"];Node3D* parent=n.visual_root;
        if(p["parent"].is_string()){auto it=n.parts.find(p["parent"].get<std::string>());if(it!=n.parts.end())parent=it->second.node;}
        parent->add_child(n.parts[id].node);
    }
    // Authored model instances are real child transforms, not flattened
    // offsets. Their parts retain independent owner identity and collision.
    std::set<std::string> instance_stack{pose.asset_id};
    auto add_instances=[&](auto&& self,const Json& parent_model,Node3D* parent,const std::string& prefix,int depth)->void{
        if(depth>=8||!parent_model.contains("instances")||!parent_model["instances"].is_array())return;
        for(const auto& instance:parent_model["instances"]){
            const std::string instance_id=instance.value("id",std::string("instance"));
            const std::string asset_id=instance.value("assetId",std::string{});
            const Json& child_model=content_.asset(asset_id);
            if(asset_id.empty()||child_model.empty()||instance_stack.count(asset_id))continue;
            Node3D* instance_root=memnew(Node3D);instance_root->set_name(gs(prefix+instance_id));parent->add_child(instance_root);
            if(instance.contains("translation"))instance_root->set_position(gv(instance["translation"].get<Vec3>()));
            else if(instance.contains("position"))instance_root->set_position(gv(instance["position"].get<Vec3>()));
            if(instance.contains("rotation")){if(instance["rotation"].is_array())instance_root->set_rotation(gv(instance["rotation"].get<Vec3>()));else if(instance["rotation"].is_object())instance_root->set_quaternion(gq(instance["rotation"].get<Quat>()));}
            if(instance.contains("scale"))instance_root->set_scale(gv(instance["scale"].get<Vec3>()));
            const std::string child_prefix=prefix+instance_id+"/";
            std::map<std::string,Node3D*> local_parts;
            for(const auto& authored:child_model.value("parts",Json::array())){
                const std::string id=authored.value("id",std::string{});if(id.empty())continue;
                const std::string key=child_prefix+id;auto& part=n.parts[key];part.node=memnew(Node3D);part.node->set_name(gs(key));part.base_translation=gv(authored.value("translation",Json::array({0,0,0})).get<Vec3>());part.node->set_position(part.base_translation);
                part.boxes=part_boxes(child_model,authored);for(auto& b:part.boxes)b.part=key;part.mesh=memnew(MeshInstance3D);part.mesh->set_material_override(material_);part.node->add_child(part.mesh);
                const std::string mesh_key=asset_id+":"+id;if(!model_meshes_.count(mesh_key))model_meshes_[mesh_key]=boxes_mesh(part.boxes);part.mesh->set_mesh(model_meshes_[mesh_key]);
                if(std::any_of(part.boxes.begin(),part.boxes.end(),[](const DrawBox& b){return b.color.a<.999;})){if(!transparent_material_.is_valid()){transparent_material_.instantiate();transparent_material_->set_flag(BaseMaterial3D::FLAG_ALBEDO_FROM_VERTEX_COLOR,true);transparent_material_->set_flag(BaseMaterial3D::FLAG_SRGB_VERTEX_COLOR,true);transparent_material_->set_transparency(BaseMaterial3D::TRANSPARENCY_ALPHA);transparent_material_->set_roughness(.9);transparent_material_->set_cull_mode(BaseMaterial3D::CULL_DISABLED);}part.mesh->set_material_override(transparent_material_);}
                part.bone_node=memnew(Node3D);part.bone_node->set_name(gs("bone:"+key));part.node->add_child(part.bone_node);part.bone_mesh=memnew(MeshInstance3D);part.bone_node->add_child(part.bone_mesh);part.bone_mesh->set_material_override(material_);
                local_parts[id]=part.node;
            }
            for(const auto& authored:child_model.value("parts",Json::array())){
                const std::string id=authored.value("id",std::string{});if(id.empty())continue;Node3D* owner=instance_root;
                if(authored.contains("parent")&&authored["parent"].is_string()){auto found=local_parts.find(authored["parent"].get<std::string>());if(found!=local_parts.end())owner=found->second;}
                owner->add_child(n.parts[child_prefix+id].node);
            }
            for(const auto& authored:child_model.value("parts",Json::array())){
                const std::string id=authored.value("id",std::string{});if(id.empty())continue;auto& part=n.parts[child_prefix+id];
                for(const auto& b:part.boxes)if(b.box.solid&&b.box.size.x>1e-6&&b.box.size.y>1e-6&&b.box.size.z>1e-6){
                    Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(gv(b.box.size));auto owner=n.body->create_shape_owner(part.node);n.body->shape_owner_add_shape(owner,shape);n.body->shape_owner_set_transform(owner,n.body->get_global_transform().affine_inverse()*part.node->get_global_transform()*Transform3D(Basis(),gv(b.box.center)));part.shape_owners.push_back(owner);
                }
            }
            instance_stack.insert(asset_id);self(self,child_model,instance_root,child_prefix,depth+1);instance_stack.erase(asset_id);
        }
    };
    add_instances(add_instances,model,n.visual_root,"",0);
    update_entity_geometry(n,pose,true);
}
void FeralGame::update_entity_geometry(EntityNode& n,const EntityPose& pose,bool force){
    if(!n.body)return;const auto& model=content_.asset(pose.asset_id);if(model.empty())return;
    const Json* previous=n.anatomy_source.get();const Json* next=pose.anatomy_geometry.get();
    auto bone_rows=[](const Json* geometry,const std::string& id){Json rows=Json::array();if(geometry&&geometry->is_object())for(const auto& row:geometry->value("boneBoxes",Json::array()))if(row.value("partId",std::string{})==id)rows.push_back(row);return rows;};
    for(const auto& part_json:model["parts"]){
        const std::string id=part_json["id"];auto& part=n.parts[id];
        Json old_skin=Json::array(),new_skin=Json::array();
        if(previous&&previous->contains("partBoxes")&&(*previous)["partBoxes"].is_object()&&(*previous)["partBoxes"].contains(id))old_skin=(*previous)["partBoxes"][id];
        if(next&&next->contains("partBoxes")&&(*next)["partBoxes"].is_object()&&(*next)["partBoxes"].contains(id))new_skin=(*next)["partBoxes"][id];
        const bool skin_changed=force||old_skin!=new_skin;
        const Json old_bones=bone_rows(previous,id),new_bones=bone_rows(next,id);
        const bool bones_changed=force||old_bones!=new_bones;
        if(skin_changed){
            for(uint32_t owner:part.shape_owners)n.body->remove_shape_owner(owner);part.shape_owners.clear();
            part.boxes=part_boxes(model,part_json,next,false);
            const bool pristine=!next||!next->contains("partBoxes")||!(*next)["partBoxes"].is_object()||!(*next)["partBoxes"].contains(id);
            if(pristine){const std::string key=pose.asset_id+":"+id;if(!model_meshes_.count(key))model_meshes_[key]=boxes_mesh(part.boxes);part.mesh->set_mesh(model_meshes_[key]);}
            else part.mesh->set_mesh(boxes_mesh(part.boxes));
            const bool translucent=std::any_of(part.boxes.begin(),part.boxes.end(),[](const DrawBox& b){return b.color.a<.999;});
            if(translucent){if(!transparent_material_.is_valid()){transparent_material_.instantiate();transparent_material_->set_flag(BaseMaterial3D::FLAG_ALBEDO_FROM_VERTEX_COLOR,true);transparent_material_->set_flag(BaseMaterial3D::FLAG_SRGB_VERTEX_COLOR,true);transparent_material_->set_transparency(BaseMaterial3D::TRANSPARENCY_ALPHA);transparent_material_->set_roughness(.9);transparent_material_->set_cull_mode(BaseMaterial3D::CULL_DISABLED);}part.mesh->set_material_override(transparent_material_);}
            else part.mesh->set_material_override(material_);
            for(const auto& b:part.boxes)if(b.box.solid&&b.box.size.x>1e-6&&b.box.size.y>1e-6&&b.box.size.z>1e-6){
                Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(gv(b.box.size));auto owner=n.body->create_shape_owner(part.node);n.body->shape_owner_add_shape(owner,shape);n.body->shape_owner_set_transform(owner,n.body->get_global_transform().affine_inverse()*part.node->get_global_transform()*Transform3D(Basis(),gv(b.box.center)));part.shape_owners.push_back(owner);
            }
            part.shape_transform=Transform3D();part.shape_visible=true;
        }
        if(bones_changed){
            for(uint32_t owner:part.bone_shape_owners)n.body->remove_shape_owner(owner);part.bone_shape_owners.clear();
            part.bone_boxes=part_boxes(model,part_json,next,true);part.bone_mesh->set_mesh(boxes_mesh(part.bone_boxes));part.bone_mesh->set_material_override(material_);
            for(const auto& b:part.bone_boxes)if(b.box.solid&&b.box.size.x>1e-6&&b.box.size.y>1e-6&&b.box.size.z>1e-6){
                Ref<BoxShape3D> shape;shape.instantiate();shape->set_size(gv(b.box.size));auto owner=n.body->create_shape_owner(part.bone_node);n.body->shape_owner_add_shape(owner,shape);n.body->shape_owner_set_transform(owner,n.body->get_global_transform().affine_inverse()*part.bone_node->get_global_transform()*Transform3D(Basis(),gv(b.box.center)));part.bone_shape_owners.push_back(owner);
            }
            part.bone_shape_transform=Transform3D();part.bone_shape_visible=true;
        }
    }
    n.anatomy_source=pose.anatomy_geometry;
    n.wound_revision=next?next->value("woundRevision",int64_t(0)):-1;
    n.structure_revision=next?next->value("structureRevision",int64_t(0)):-1;
}
void FeralGame::sync_entities(){
    std::set<std::string> keep;const double terrain_view_radius=std::max(4.0,settings_.value("viewDistance",6)*4.0);
    const Vec3 player_position=fv(player_->get_position());
    auto translation_length=[](const Json& value){
        Vec3 v{};
        if(value.is_array()&&value.size()>=3&&value[0].is_number()&&value[1].is_number()&&value[2].is_number())v={value[0].get<double>(),value[1].get<double>(),value[2].get<double>()};
        else if(value.is_object())v=value.get<Vec3>();
        return v.length();
    };
    auto animation_expansion=[&](const Json& animation){
        if(!animation.is_object())return 0.0;
        double expansion=translation_length(animation.value("rootTranslation",Json::array()));
        const Json tracks=animation.value("parts",Json::object());
        if(tracks.is_object())for(const auto& [part_id,track]:tracks.items())if(track.is_object()&&track.contains("translation"))expansion+=translation_length(track["translation"]);
        return expansion;
    };
    auto in_loaded_terrain_view=[&](Vec3 position,const std::string& asset_id,Vec3 scale,double animated_expansion=0.0){
        const double dx=position.x-player_position.x,dz=position.z-player_position.z;
        // A model is kept while any authored geometry can intersect the loaded terrain
        // radius. This uses the cached recursive authored bound (parts and instances),
        // rather than culling large buildings by their anchor point.
        const double scale_radius=std::max({std::abs(scale.x),std::abs(scale.y),std::abs(scale.z)});
        const double visible_radius=terrain_view_radius+(authored_asset_radius(content_,asset_id)+animated_expansion)*scale_radius;
        return dx*dx+dz*dz<=visible_radius*visible_radius;
    };
    for(const auto& pose:simulation_->poses()){
        if(!pose.visible||content_.asset(pose.asset_id).empty())continue;
        if(!in_loaded_terrain_view(pose.position,pose.asset_id,pose.scale,animation_expansion(pose.animation)))continue;
        keep.insert(pose.id);auto& n=entities_[pose.id];if(n.body&&n.asset!=pose.asset_id){n.body->set_collision_layer(0);n.body->set_collision_mask(0);n.body->queue_free();n=EntityNode{};}bool created=!n.body;if(created)build_entity(n,pose);if(!n.body)continue;
        if(!created&&n.anatomy_source.get()!=pose.anatomy_geometry.get())update_entity_geometry(n,pose);
        if(!created&&(pose.kind=="creature"||pose.kind=="boss")){n.body->move_and_collide(gv(pose.position)-n.body->get_position());simulation_->sync_entity_pose(pose.id,fv(n.body->get_position()),pose.rotation);}else n.body->set_position(gv(pose.position));n.body->set_quaternion(gq(pose.rotation));n.body->set_scale(gv(pose.scale));
        const auto& anim=pose.animation;
        auto vec3_from_array=[](const Json& value){Vec3 v{};if(value.is_array()){if(value.size()>0&&value[0].is_number())v.x=value[0].get<double>();if(value.size()>1&&value[1].is_number())v.y=value[1].get<double>();if(value.size()>2&&value[2].is_number())v.z=value[2].get<double>();}else if(value.is_object())v=value.get<Vec3>();return v;};
        n.visual_root->set_position(gv(vec3_from_array(anim.value("rootTranslation",Json::array()))));
        n.visual_root->set_rotation(gv(vec3_from_array(anim.value("rootRotation",Json::array()))));
        for(auto& [id,p]:n.parts){
            const auto& a=anim.contains("parts")&&anim["parts"].contains(id)?anim["parts"][id]:empty_object();
            p.node->set_visible(!a.value("hidden",false));p.node->set_position(p.base_translation+gv(vec3_from_array(a.value("translation",Json::array()))));
            if(a.contains("rotation"))p.node->set_rotation(gv(vec3_from_array(a["rotation"])));else p.node->set_rotation(Vector3());
            const bool visible=p.node->is_visible_in_tree();
            Transform3D transform=n.body->get_global_transform().affine_inverse()*p.node->get_global_transform();
            if(!transform.is_equal_approx(p.shape_transform)||visible!=p.shape_visible||created){
                size_t s=0;for(const auto& b:p.boxes)if(b.box.solid){if(s<p.shape_owners.size()){auto owner=p.shape_owners[s++];n.body->shape_owner_set_disabled(owner,!visible);n.body->shape_owner_set_transform(owner,transform*Transform3D(Basis(),gv(b.box.center)));}}
                p.shape_transform=transform;p.shape_visible=visible;
            }
            Transform3D bone_transform=n.body->get_global_transform().affine_inverse()*p.bone_node->get_global_transform();
            if(!bone_transform.is_equal_approx(p.bone_shape_transform)||visible!=p.bone_shape_visible||created){
                size_t s=0;for(const auto& b:p.bone_boxes)if(b.box.solid){if(s<p.bone_shape_owners.size()){auto owner=p.bone_shape_owners[s++];n.body->shape_owner_set_disabled(owner,!visible);n.body->shape_owner_set_transform(owner,bone_transform*Transform3D(Basis(),gv(b.box.center)));}}
                p.bone_shape_transform=bone_transform;p.bone_shape_visible=visible;
            }
        }
    }
    for(const auto& fixture:gameplay_->fixtures()){
        std::string id=fixture.value("id",std::string{});if(id.empty())continue;const auto& motion=fixture.value("motion",Json::object());
        if(motion.value("mode",std::string("fixed"))=="dynamic"){
            auto old=entities_.find(id);if(old!=entities_.end()){if(old->second.body){old->second.body->set_collision_layer(0);old->second.body->set_collision_mask(0);old->second.body->queue_free();}entities_.erase(old);}continue;
        }
        EntityPose pose;pose.id=id;pose.kind="fixture";pose.asset_id=fixture.value("assetId",std::string{});pose.position=fixture.value("position",Json::object()).get<Vec3>();pose.rotation=motion.value("rotation",Json::object()).get<Quat>();
        if(!in_loaded_terrain_view(pose.position,pose.asset_id,pose.scale))continue;
        keep.insert(id);auto& n=entities_[id];const int64_t revision=fixture.value("revision",0);
        if(n.body&&n.asset!=pose.asset_id){n.body->set_collision_layer(0);n.body->set_collision_mask(0);n.body->queue_free();n=EntityNode{};}
        if(!n.body)build_entity(n,pose);if(n.body){n.body->set_position(gv(pose.position));n.body->set_quaternion(gq(pose.rotation));n.revision=revision;}
    }
    for(auto it=entities_.begin();it!=entities_.end();)if(!keep.count(it->first)){if(it->second.body)it->second.body->queue_free();it=entities_.erase(it);}else++it;
}
void FeralGame::sync_hand(){
    for(int i=0;i<hand_->get_child_count();i++)hand_->get_child(i)->queue_free();
    std::string asset=held_;if(asset.empty()&&gameplay_){auto attack=gameplay_->held_attack();if(attack["assetId"].is_string())asset=attack["assetId"].get<std::string>();}if(content_.asset(asset).empty())return;const auto& model=content_.asset(asset);
    std::map<std::string,Vec3> offsets;for(const auto& p:model["parts"]){Vec3 offset=p["translation"].get<Vec3>();if(p["parent"].is_string())offset+=offsets[p["parent"].get<std::string>()];offsets[p["id"].get<std::string>()]=offset;}
    Vec3 anchor;if(model.contains("equipmentSlots")&&!model["equipmentSlots"].empty()){auto aid=model["equipmentSlots"][0].value("anchorId",std::string{});for(const auto& a:model["anchors"])if(a.value("id",std::string{})==aid)anchor=a["position"].get<Vec3>()+offsets[a["partId"].get<std::string>()];}
    std::vector<DrawBox> boxes;for(const auto& p:model["parts"]){auto part=part_boxes(model,p);for(auto& b:part){b.box.center+=offsets[p["id"].get<std::string>()]-anchor;boxes.push_back(b);}}
    auto mesh=memnew(MeshInstance3D);mesh->set_mesh(boxes_mesh(boxes));mesh->set_material_override(material_);mesh->set_scale(Vector3(.72,.72,.72));mesh->set_cast_shadows_setting(GeometryInstance3D::SHADOW_CASTING_SETTING_OFF);hand_->add_child(mesh);
}
}
