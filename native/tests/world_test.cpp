#include "world.hpp"

#include <cassert>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace feral;

namespace {

Content load_content() {
    std::ifstream file("native/data/content.json");
    if (!file) throw std::runtime_error("native/data/content.json is required");
    Content content;
    content.data = Json::parse(file);
    content.index();
    return content;
}

void configure(World& world, const std::string& generator) {
    const std::string preset = generator == "infinite" ? "expedition" : generator == "machine-field" ? "machine" : generator;
    world.configure({{"configVersion",1},{"preset",preset},{"seed",63026},
                     {"terrain",{{"generator",generator}}},{"rules",Json::object()},{"modules",Json::array()}});
}

Cell section_for(Cell c) {
    auto div=[](int n){return n>=0?n/8:-int((int64_t(-n)+7)/8);};
    return {div(c.x),div(c.y),div(c.z)};
}

void expect_surface(World& world, double x, double z, double height, const std::string& environment,
                    const std::string& material) {
    const SurfaceSample sample = world.surface_sample(x, z);
    assert(std::abs(sample.height - height) < 1e-9);
    assert(sample.environment_id == environment);
    const Cell cell{int(std::floor(x * 2)), int(std::floor(height * 2)) - 1, int(std::floor(z * 2))};
    assert(world.block(cell) == material);
}

void js_generator_golden_samples_and_noise_query_order() {
    Content content = load_content();
    World world(content);

    configure(world, "infinite");
    // Golden values captured from content-runtime/atlas.js at seed 63026. The first two
    // coordinates share the 256 m height-noise lattice cell but use different interpolation
    // fractions; querying one must not cache its interpolated value for the other.
    expect_surface(world, 200, 200, -3, "coast", "sand");
    assert(world.block({400,-6,400}).empty());
    expect_surface(world, 220, 220, -1.5, "coast", "sand");
    expect_surface(world, 3012, 1007, 76, "coast", "sand");
    const Json infinite_nodes=world.harvest_nodes_around({0,0,0},64);
    assert(infinite_nodes.size()==164);
    assert(infinite_nodes[0]["id"]=="harvest:-1,-1:fallen_branch:0");
    assert(infinite_nodes[0]["x"]==-41.5 && infinite_nodes[0]["z"]==-33.5);
    World reverse(content);
    configure(reverse, "infinite");
    expect_surface(reverse, 220, 220, -1.5, "coast", "sand");
    expect_surface(reverse, 200, 200, -3, "coast", "sand");

    configure(world, "island");
    expect_surface(world, 0, 0, 18, "grove", "grass");
    expect_surface(world, 77.5, 84.5, 12, "grove", "plank");
    expect_surface(world, 140, 35, 14, "thermal", "basalt");
    expect_surface(world, 159.5, 159.5, 23, "grove", "grass");
    expect_surface(world, 160, 80, 4, "coast", "sand");
    const Json island_nodes=world.harvest_nodes_around({77.5,0,84.5},64);
    assert(island_nodes.size()==124);
    assert(island_nodes[0]["id"]=="harvest:0,0:fallen_branch:0");
    assert(island_nodes[0]["x"]==23 && island_nodes[0]["y"]==12 && island_nodes[0]["z"]==58.5);

    configure(world, "frontier");
    expect_surface(world, 77.5, 84.5, 12, "grove", "plank");
    expect_surface(world, 133, 50, 16, "ridge", "plank");
    expect_surface(world, 400, 400, 12, "grove", "grass");
    expect_surface(world, 397.5, 84.5, 12, "grove", "plank");
    expect_surface(world, -1, 0, 4, "coast", "sand");
    const Json frontier_nodes=world.harvest_nodes_around({77.5,0,84.5},64);
    assert(frontier_nodes.size()==132);
    assert(frontier_nodes[0]["id"]=="harvest:0,0:fallen_branch:0");
    assert(frontier_nodes[0]["x"]==23 && frontier_nodes[0]["y"]==15 && frontier_nodes[0]["z"]==58.5);
    const auto region = world.region_info(-1, 2);
    assert(region && region->key == "-1,2");
    assert(region->seed == 891635581);
    assert(region->tier == 2 && region->biome == 1);
    assert(region->villages.size() == 2 && region->boss.x > 0 && region->dungeon.z > 0);

    configure(world, "machine-field");
    expect_surface(world, 0, -10, 4, "grove", "grass");
    assert(world.block({0,8,-20}) == "basalt");
    assert(world.block({20,8,10}) == "basalt");
    assert(world.block({-12,8,18}) == "iron_scrap_block");
    assert(world.block({46,8,0}) == "stone");
    assert(world.block({48,8,0}).empty());
}

void sections_mesh_and_collision_preserve_voxel_space() {
    Content content = load_content();
    World world(content);
    configure(world, "infinite");
    const Cell origin{8000, 400, -8000};
    for (int y=0;y<2;y++) for (int z=0;z<2;z++) for (int x=0;x<2;x++)
        assert(world.set_block({origin.x+x,origin.y+y,origin.z+z}, "stone"));
    assert(world.set_block({origin.x+1,origin.y+1,origin.z+1}, ""));

    const Cell section{origin.x/8,origin.y/8,origin.z/8};
    const auto boxes = world.terrain_boxes(section);
    assert(world.terrain_revision(section) > 0);
    assert(world.fluid_revision(section) == 0);
    double collision_volume = 0;
    for (const Box& box : boxes) collision_volume += box.size.x*box.size.y*box.size.z;
    assert(std::abs(collision_volume - 7*.125) < 1e-9);
    const Vec3 missing_center = cell_center({origin.x+1,origin.y+1,origin.z+1});
    for (const Box& box : boxes) {
        const Vec3 delta{std::abs(missing_center.x-box.center.x),std::abs(missing_center.y-box.center.y),std::abs(missing_center.z-box.center.z)};
        assert(delta.x >= box.size.x*.5 || delta.y >= box.size.y*.5 || delta.z >= box.size.z*.5);
    }
    const MeshData mesh = world.mesh(section);
    assert(mesh.face_materials.size() == 24);
    assert(mesh.vertices.size() == mesh.normals.size() && mesh.vertices.size() == mesh.colors.size());
    assert(mesh.indices.size() == mesh.face_materials.size()*6);

    const Cell seam{8,400,8};
    assert(world.set_block(seam, "stone"));
    const auto dirty = world.dirty_sections();
    bool seam_section=false, neighbor_section=false;
    for (Cell c : dirty) {
        seam_section |= c == Cell{1,50,1};
        neighbor_section |= c == Cell{0,50,1};
    }
    assert(seam_section && neighbor_section);

    Contact hit = world.raycast({origin.x*.5-1,(origin.y+.25)*.5,(origin.z+.25)*.5},{1,0,0},3);
    assert(hit.hit && hit.kind == "terrain" && hit.material == "stone");
    assert(hit.cell.x == origin.x && hit.cell.y == origin.y && hit.cell.z == origin.z);
}

void raycasts_return_entry_faces_and_skip_far_compounds(){
    Content content=load_content();World world(content);configure(world,"infinite");
    const Cell terrain{20,2000,20};assert(world.set_block(terrain,"stone"));
    const double surface_x=terrain.x*CELL_M,y=(terrain.y+.5)*CELL_M,z=(terrain.z+.5)*CELL_M;
    Contact front=world.raycast_terrain({surface_x-1,y,z},{1,0,0},2);
    assert(front.hit&&front.cell==terrain&&front.distance==1);
    assert(std::abs(front.point.x-surface_x)<1e-9&&front.normal.x==-1&&front.normal.y==0&&front.normal.z==0);
    Contact inside=world.raycast_terrain(cell_center(terrain),{1,0,0},2);
    assert(inside.hit&&inside.distance==0&&inside.point.x==cell_center(terrain).x&&inside.normal.length_squared()==0);
    Contact boundary=world.raycast_terrain({surface_x,y,z},{1,0,0},2);
    assert(boundary.hit&&boundary.distance==0&&boundary.normal.x==-1);
    Contact reverse_boundary=world.raycast_terrain({surface_x+CELL_M,y,z},{-1,0,0},2);
    assert(reverse_boundary.hit&&reverse_boundary.distance==0&&reverse_boundary.normal.x==1);

    BodyState near;near.id="object:ray-near";near.position={100,1000,100};near.revision=1;
    near.voxels.push_back({{0,0,0},"stone",-1});near.voxels.push_back({{1,0,0},"stone",-1});
    near.boxes.push_back({{.5,.25,.25},{1,.5,.5},"stone",350,true});
    world.bodies()[near.id]=near;
    for(int i=0;i<1000;i++){
        BodyState far;far.id="object:ray-far:"+std::to_string(i);far.position={0,2000+i*4.0,0};far.revision=1;
        far.boxes.push_back({{.25,.25,.25},{.5,.5,.5},"stone",175,true});
        for(int v=0;v<32;v++)far.voxels.push_back({{v,0,0},"stone",-1});
        world.bodies()[far.id]=std::move(far);
    }
    Contact body_hit=world.raycast({99,1000.25,100.25},{1,0,0},3);
    assert(body_hit.hit&&body_hit.kind=="body"&&body_hit.id=="object:ray-near");
    assert(body_hit.part=="0,0,0"&&std::abs(body_hit.distance-1)<1e-9&&body_hit.normal.x==-1);
    const double hp=content.find("blocks","stone").value("durabilityHpPerCell",24.0);
    assert(world.damage(body_hit,hp*2)["removed"]);
    const Contact after_geometry_change=world.raycast({99,1000.25,100.25},{1,0,0},3);
    assert(after_geometry_change.hit&&after_geometry_change.kind=="body"&&after_geometry_change.part=="1,0,0");
    assert(std::abs(after_geometry_change.distance-1.5)<1e-9);
    assert(!world.raycast_terrain({99,1000.25,100.25},{1,0,0},3).hit);
}

void body_damage_splits_with_mass_and_angular_motion() {
    Content content = load_content();
    World world(content);
    configure(world, "infinite");
    const int hp = content.find("blocks", "log").value("durabilityHpPerCell", 24);
    const Cell first{3000,400,3000};
    assert(world.set_block(first, "log"));
    assert(world.set_block(first+Cell{1,0,0}, "log"));
    assert(world.set_block(first+Cell{2,0,0}, "log"));
    assert(world.set_block(first+Cell{0,1,0}, "leaves"));
    const auto detached = world.detach(first+Cell{0,-1,0});
    assert(detached.size() == 1);
    auto& bodies = world.bodies();
    auto body_it = bodies.find(detached.front());
    assert(body_it != bodies.end() && body_it->second.voxels.size() == 4);
    assert(std::any_of(body_it->second.boxes.begin(),body_it->second.boxes.end(),[](const Box& box){return box.material=="leaves"&&!box.solid;}));
    const std::string body_id = body_it->first;
    body_it->second.angular_velocity = {0,0,1};
    const uint64_t geometry_revision = body_it->second.revision;

    Contact body_hit;body_hit.hit=true;body_hit.kind="body";body_hit.id=body_id;body_hit.cell={0,0,0};body_hit.material="log";
    Json partial = world.damage(body_hit, hp*.25);
    assert(partial["ok"] && !partial["removed"] && std::abs(partial["hp"].get<double>()-hp*.75)<1e-8);
    assert(world.bodies().at(body_id).revision == geometry_revision);

    body_hit.cell={1,0,0};
    Json removed = world.damage(body_hit, hp*2.0);
    assert(removed["ok"] && removed["removed"] && removed["loot"].is_object());
    assert(world.bodies().size() == 2);
    auto it = world.bodies().begin();
    const BodyState& a=it++->second;const BodyState& b=it->second;
    const double log_mass=content.find("blocks","log").value("massPerCellKg",175.0);
    const double leaf_mass=content.find("blocks","leaves").value("massPerCellKg",0.0);
    assert(std::abs(a.mass+b.mass-(2*log_mass+leaf_mass))<1e-8);
    assert((a.angular_velocity-b.angular_velocity).length()<1e-8);
    assert((a.velocity-b.velocity).length()>0.1);
    assert(std::any_of(a.boxes.begin(),a.boxes.end(),[](const Box& box){return box.material=="leaves"&&!box.solid;}) ||
           std::any_of(b.boxes.begin(),b.boxes.end(),[](const Box& box){return box.material=="leaves"&&!box.solid;}));

    // The physics pose changes continuously, while source coordinates remain anchored
    // to the original atlas cells. Splitting must keep the old local frame and metadata.
    for(auto& pair:world.bodies())pair.second.position+=Vec3{17.25,3.5,-9.0};
    const Json saved=world.save();
    const Json saved_objects=saved["objects"]["objects"];
    assert(saved_objects.size()==2);
    for(const Json& object:saved_objects){
        assert(object["originCell"]==Json::array({first.x,first.y,first.z}));
        for(const Json& cell:object["cells"]){
            assert(cell["sourceCell"]==Json::array({first.x+cell["cell"][0].get<int>(),
                                                     first.y+cell["cell"][1].get<int>(),
                                                     first.z+cell["cell"][2].get<int>()}));
        }
    }
    World restored(content);restored.load(saved);
    assert(restored.bodies().size()==2);
    const Json resaved=restored.save();
    for(const Json& object:resaved["objects"]["objects"]){
        assert(object["originCell"]==Json::array({first.x,first.y,first.z}));
        for(const Json& cell:object["cells"])
            assert(cell["sourceCell"]==Json::array({first.x+cell["cell"][0].get<int>(),
                                                     first.y+cell["cell"][1].get<int>(),
                                                     first.z+cell["cell"][2].get<int>()}));
    }
}

void streaming_is_bounded_and_ignores_remote_or_sensor_bodies() {
    Content content = load_content();
    World world(content);
    configure(world, "infinite");

    BodyState near;near.id="object:near";near.position={0,0,0};near.revision=1;
    near.boxes.push_back({{0,0,0},{.5,.5,.5},"stone",175,true});
    world.bodies()[near.id]=near;
    BodyState far;far.id="object:far";far.position={65,0,0};far.revision=1;
    far.boxes.push_back({{0,0,0},{.5,.5,.5},"stone",175,true});
    world.bodies()[far.id]=far;
    BodyState sensor;sensor.id="object:sensor";sensor.position={1,0,1};sensor.revision=1;
    sensor.boxes.push_back({{0,0,0},{40,40,40},"leaves",0,false});
    world.bodies()[sensor.id]=sensor;

    world.stream({0,0,0},0);
    const auto initial=world.loaded_sections();
    const uint64_t first_revision=world.stream_revision();
    assert(initial.size() < 100);
    world.dirty_sections();
    world.stream({0,0,0},0);
    assert(world.dirty_sections().empty());
    assert(world.loaded_sections().size() == initial.size());
    assert(world.stream_revision() == first_revision);
    world.update_rules({{"sandbox",true},{"survival",false}});
    assert(world.sandbox_enabled());
    assert(world.loaded_sections().size()==initial.size()&&world.stream_revision()==first_revision);
    assert(world.dirty_sections().empty());

    world.bodies().at("object:far").position={1000,0,1000};
    world.stream({0,0,0},0);
    assert(world.loaded_sections().size() == initial.size());
    assert(world.dirty_sections().empty());
    assert(world.stream_revision() == first_revision);

    world.bodies().at("object:near").position={12,0,0};
    world.stream({0,0,0},0);
    assert(world.loaded_sections().size() < 140);
    assert(!world.dirty_sections().empty());
    assert(world.stream_revision() > first_revision);
}

void stream_center_hysteresis_ignores_boundary_jitter() {
    Content content=load_content();World world(content);configure(world,"infinite");
    world.stream({0,5,0},0);
    const auto initial=world.loaded_sections();const uint64_t revision=world.stream_revision();
    world.dirty_sections();
    world.stream({-.02,5,-.02},0);
    assert(world.stream_revision()==revision&&world.loaded_sections()==initial&&world.dirty_sections().empty());
    world.stream({-.26,5,-.26},0);
    const auto negative=world.loaded_sections();const uint64_t negative_revision=world.stream_revision();
    assert(negative_revision>revision&&negative!=initial);
    world.dirty_sections();
    world.stream({.02,5,.02},0);
    assert(world.stream_revision()==negative_revision&&world.loaded_sections()==negative&&world.dirty_sections().empty());
    world.stream({.26,5,.26},0);
    assert(world.stream_revision()>negative_revision&&world.loaded_sections()==initial);
}

void generated_trees_break_with_real_mining_and_stay_locally_streamed(){
    Content content=load_content();World world(content);configure(world,"infinite");
    const double player_x=3012,player_z=1007;
    const auto start=std::chrono::steady_clock::now();std::vector<std::vector<Cell>> roots;
    const int tx0=int(std::floor(player_x/8)),tz0=int(std::floor(player_z/8));
    for(int tz=tz0-8;tz<=tz0+8&&roots.size()<3;tz++)for(int tx=tx0-8;tx<=tx0+8&&roots.size()<3;tx++){
        bool found_patch=false;
        for(int ix=0;ix<8&&!found_patch;ix++)for(int iz=0;iz<8&&!found_patch;iz++){
            const double x=tx*8+2+ix*.5,z=tz*8+2+iz*.5;const SurfaceSample surface=world.surface_sample(x,z);
            if(surface.has_water||surface.safe_bypass||std::hypot(x-player_x,z-player_z)>60||std::hypot(x,z)<160)continue;
            const int hx=int(std::floor(x*2)),hz=int(std::floor(z*2)),base_y=int(std::floor(surface.height*2))-20;
            Cell root{};bool found=false;
            for(int y=base_y;y<base_y+60;y++){const std::string id=world.block({hx,y,hz});if(id=="log"||id=="mana_log"){root={hx,y,hz};found=true;break;}}
            if(!found)continue;
            for(int y=root.y-1;y>=base_y;y--){const std::string id=world.block({root.x,y,root.z});if(id!="log"&&id!="mana_log")break;root.y=y;}
            std::vector<Cell> bottom;
            for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++){
                Cell c{root.x+dx,root.y,root.z+dz};const std::string id=world.block(c);if(id=="log"||id=="mana_log")bottom.push_back(c);
            }
            if(bottom.empty())continue;
            roots.push_back(std::move(bottom));found_patch=true;
        }
    }
    assert(roots.size()==3);
    std::vector<std::string> spawned;
    const Cell dirs[]={{0,1,0},{1,0,0},{-1,0,0},{0,0,1},{0,0,-1},{0,-1,0}};
    auto is_tree_block=[](const std::string& id){return id=="log"||id=="mana_log"||id=="leaves";};
    auto collect_detached=[&](const Json& result){if(result.contains("detached")&&result["detached"].is_array())for(const auto& id:result["detached"])spawned.push_back(id.get<std::string>());};
    for(const auto& bottom:roots){
        const size_t before=spawned.size();std::unordered_set<Cell,CellHash> tree_cells;std::vector<Cell> queue=bottom;
        for(Cell c:bottom)tree_cells.insert(c);
        for(size_t i=0;i<queue.size();i++)for(Cell d:dirs){Cell n=queue[i]+d;if(tree_cells.count(n))continue;const std::string id=world.block(n);if(is_tree_block(id)){tree_cells.insert(n);queue.push_back(n);}}
        // Terrain height variation can let sand/soil touch the side of an upper trunk cell.
        // Clear only direct contacts to form a small isolated generated-tree fixture; the
        // following real mining hit must transfer every remaining tree voxel to one body.
        std::unordered_set<Cell,CellHash> contacts;
        for(Cell c:tree_cells)for(Cell d:dirs){Cell n=c+d;if(tree_cells.count(n)||world.block(n).empty())continue;contacts.insert(n);}
        for(Cell c:contacts)world.set_block(c,"");
        Cell mined=bottom.front();const std::string material=world.block(mined);assert(material=="log"||material=="mana_log");
        Contact hit;hit.hit=true;hit.kind="terrain";hit.cell=mined;hit.material=material;const double hp=content.find("blocks",material).value("durabilityHpPerCell",24.0);
        const Json result=world.damage(hit,hp*2);assert(result["ok"]&&result["removed"]);collect_detached(result);
        assert(spawned.size()>before);
        for(Cell c:bottom)assert(world.block(c).empty());
    }
    assert(world.bodies().size()==3);
    double detached_mass=0;for(const auto& pair:world.bodies())detached_mass+=pair.second.mass;assert(detached_mass>0);
    world.dirty_sections();world.stream({player_x,0,player_z},0);const size_t sections=world.loaded_sections().size();assert(sections>0&&sections<200);
    const auto end=std::chrono::steady_clock::now();const double ms=std::chrono::duration<double,std::milli>(end-start).count();
    std::cout<<"three generated trees detached and streamed in "<<ms<<" ms across "<<sections<<" sections\n";
}

void fluids_and_persistence_keep_unknown_data_and_legacy_damage() {
    Content content=load_content();
    World world(content);
    configure(world,"infinite");

    // Repeated mining work is cumulative and the final hit removes the terrain cell.
    const Cell mining_cell{1450,400,1450};
    assert(world.set_block(mining_cell,"stone"));
    Contact mining_hit;mining_hit.hit=true;mining_hit.kind="terrain";mining_hit.cell=mining_cell;mining_hit.material="stone";
    const double stone_hp=content.find("blocks","stone").value("durabilityHpPerCell",24.0);
    for(int i=0;i<4;i++){
        const Json result=world.damage(mining_hit,stone_hp*.25);
        assert(result["ok"]);
        assert(bool(result["removed"])==(i==3));
    }
    assert(world.block(mining_cell).empty());

    // Blocks with a null rawResourceId still mine cleanly and report fallback/no loot.
    const Cell glass_cell{1452,400,1450};
    assert(world.set_block(glass_cell,"glass"));
    Contact glass_hit;glass_hit.hit=true;glass_hit.kind="terrain";glass_hit.cell=glass_cell;glass_hit.material="glass";
    const double glass_hp=content.find("blocks","glass").value("durabilityHpPerCell",24.0);
    const Json glass_result=world.damage(glass_hit,glass_hp*2);
    assert(glass_result["ok"]&&glass_result["removed"]&&glass_result["loot"].is_null());
    assert(world.block(glass_cell).empty());

    const Vec3 point{700,50,700};
    assert(std::abs(world.pour(point,.125,.5,80)-.125)<1e-9);
    const Json fluid=world.fluid_at(point);
    assert(fluid.is_object() && fluid["type"]=="acid");
    const Box buoyant_box{{0,0,0},{.5,.5,.5},"stone",175,true};
    const BuoyancyResult buoyancy=world.buoyancy_for_compound(point+Vec3{0,.25,0},{}, {2,0,0},175,{buoyant_box},.1);
    assert(buoyancy.forces.size()==1 && std::abs(buoyancy.total_volume_m3-.125)<1e-9);
    assert(buoyancy.submerged_volume_m3>.124 && buoyancy.forces[0].force_n.y>1200);
    assert(buoyancy.drag_force_n.x < -1390 && std::abs(buoyancy.drag_force_n.y)<1e-9);
    const Box leaf_box{{0,0,0},{.5,.5,.5},"leaves",0,false};
    const BuoyancyResult leaf_buoyancy=world.buoyancy_for_compound(point+Vec3{0,.25,0},{},{2,0,0},0,{leaf_box},.1);
    assert(leaf_buoyancy.forces.empty()&&leaf_buoyancy.total_volume_m3==0&&leaf_buoyancy.drag_force_n.length_squared()==0);
    const Cell fluid_cell=world_cell(point);
    const Cell fluid_section=section_for(fluid_cell);
    assert(world.fluid_revision(fluid_section)>0);
    assert(world.terrain_revision(fluid_section)==0);
    assert(!world.fluid_mesh(section_for(fluid_cell)).indices.empty());
    const Json taken=world.take_fluid(point,.125);
    assert(std::abs(taken["volumeM3"].get<double>()-.125)<1e-9);
    assert(world.fluid_at(point).is_null());

    const Cell edited{720,100,720};
    Json legacy=Json::object();
    legacy["schemaVersion"]=4;
    legacy["config"]={{"configVersion",1},{"preset","frontier"},{"seed",63026},
                      {"terrain",{{"generator","frontier"}}},{"modules",Json::array({"first-signal"})},{"futureConfigField",true}};
    legacy["atlas"]={{"schemaVersion",1},{"generator","frontier-v1"},{"seed","63026"},
                     {"edits",Json::array({Json::array({cell_key(edited),"stone"})})},
                     {"regionTerrain",Json::array({Json::array({"-2,3",1})})},
                     {"futureAtlasField",{{"keep",true}}}};
    legacy["terrainDamage"]={{cell_key(edited),{{"blockId","stone"},{"damage",.25}}}};
    legacy["futureSubsystem"]={{"payload",Json::array({1,2,3})}};
    World restored(content);
    restored.load(legacy);
    assert(restored.block(edited)=="stone");
    const auto old_region=restored.region_info(-2,3);
    assert(old_region && old_region->terrain_version==1);
    Contact contact;contact.hit=true;contact.kind="terrain";contact.cell=edited;contact.material="stone";
    const double hp=content.find("blocks","stone").value("durabilityHpPerCell",24.0);
    const Json damaged=restored.damage(contact,hp*.25);
    assert(damaged["ok"] && std::abs(damaged["hp"].get<double>()-hp*.5)<1e-7);
    const Json saved=restored.save();
    assert(saved["futureSubsystem"]["payload"].size()==3);
    assert(saved["config"]["futureConfigField"]==true);
    assert(saved["atlas"]["futureAtlasField"]["keep"]==true);
    assert(saved["atlas"]["regionTerrain"][0][0]=="-2,3");
    World roundtrip(content);roundtrip.load(saved);
    assert(roundtrip.block(edited)=="stone");
    assert(roundtrip.save()["atlas"]["futureAtlasField"]["keep"]==true);
}

} // namespace

int main() {
    js_generator_golden_samples_and_noise_query_order();
    sections_mesh_and_collision_preserve_voxel_space();
    body_damage_splits_with_mass_and_angular_motion();
    streaming_is_bounded_and_ignores_remote_or_sensor_bodies();
    stream_center_hysteresis_ignores_boundary_jitter();
    generated_trees_break_with_real_mining_and_stay_locally_streamed();
    fluids_and_persistence_keep_unknown_data_and_legacy_damage();
    std::cout << "native world tests passed\n";
}
