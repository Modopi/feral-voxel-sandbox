#include "world_tools.hpp"

#include "gameplay.hpp"
#include "simulation.hpp"
#include "world.hpp"

#include <iomanip>
#include <sstream>

namespace feral {
namespace {
constexpr double EPS=1e-9;
struct Aim {Vec3 point,normal{0,1,0};double distance=0;std::string kind,id;};

bool finite_vec(Vec3 v){return std::isfinite(v.x)&&std::isfinite(v.y)&&std::isfinite(v.z)&&std::abs(v.x)<5e8&&std::abs(v.y)<5e8&&std::abs(v.z)<5e8;}
bool read_vec(const Json& j,Vec3& out){if(!j.is_array()&&!j.is_object())return false;try{out=j.get<Vec3>();return finite_vec(out);}catch(...){return false;}}
const Json& hit_object(const Json& args){return args.contains("hit")&&args["hit"].is_object()?args["hit"]:args;}
bool read_aim(const Json& args,Aim& aim){
    const Json& hit=hit_object(args);if(!hit.contains("point")||!read_vec(hit["point"],aim.point))return false;
    if(hit.contains("normal")&&read_vec(hit["normal"],aim.normal)){if(aim.normal.length_squared()<EPS)aim.normal={0,1,0};else aim.normal=aim.normal.normalized();}
    if(hit.contains("distance")&&hit["distance"].is_number())aim.distance=hit["distance"].get<double>();
    aim.kind=hit.value("kind",std::string());aim.id=hit.value("id",std::string());
    return std::isfinite(aim.distance)&&aim.distance>=0;
}
int floor_cell(double meters){const double c=std::floor(meters*2.0);if(c<=-1000000000.0||c>=1000000000.0)throw std::out_of_range("sandbox target is outside the world");return int(c);}
uint64_t stable_hash(const std::string& text){
    uint64_t h=14695981039346656037ULL;for(unsigned char c:text){h^=c;h*=1099511628211ULL;}
    h+=0x9e3779b97f4a7c15ULL;h=(h^(h>>30))*0xbf58476d1ce4e5b9ULL;h=(h^(h>>27))*0x94d049bb133111ebULL;return h^(h>>31);
}
double stable_roll(const std::string& text){return double(stable_hash(text)>>11)/9007199254740992.0;}
Json field(std::string key,std::string label,std::string type="text",Json options=Json(),Json value=Json(),bool required=true){
    Json f={{"key",key},{"label",label},{"type",type},{"required",required}};if(!options.is_null())f["options"]=options;if(!value.is_null())f["default"]=value;return f;
}
Json command_row(std::string id,std::string label,int legacy_index,std::string target,Json fields,std::string source){
    return {{"id",id},{"label",label},{"legacyToolIndex",legacy_index},{"requiresSandbox",true},
            {"target",target},{"source",source},{"fields",std::move(fields)}};
}
} // namespace

WorldTools::WorldTools(const Content& content,World& world,Gameplay& gameplay,Simulation& simulation,ExtraSolidQuery extra_solid)
    :content_(content),world_(world),gameplay_(gameplay),simulation_(simulation),extra_solid_(std::move(extra_solid)){}

Json WorldTools::metadata()const{
    Json commands=Json::array();
    commands.push_back(command_row("sandbox.observe","관찰 렌즈",0,"aim_hit",Json::array(),"Simulation poses + World block lookup"));
    commands.push_back(command_row("sandbox.place_block","블록 놓기",-1,"terrain_or_structure_face",Json::array({
        field("itemId","보유 블록","content_id"),field("size","설치 크기","select",Json::array({.5,1.0}),.5),
        field("playerPosition","플레이어 위치","vector3"),field("claim","결제 청구 ID","text")}),"World::set_block + Gameplay::spend"));
    commands.push_back(command_row("sandbox.pour_water","물 붓기",4,"aim_surface",Json::array(),"World::pour (0.5 m³)"));
    commands.push_back(command_row("sandbox.ignite","불 붙이기",5,"aim_terrain_cell",Json::array(),"World::ignite_cell"));
    commands.push_back(command_row("sandbox.pour_acid","산 붓기",6,"aim_surface",Json::array(),"World::pour (0.3 m³, 95% acid)"));
    commands.push_back(command_row("sandbox.apply_heat","열 가하기",7,"aim_terrain_or_fluid_cell",Json::array({
        field("energyEu","열 에너지","number",Json(),Json(),true)}),"World::apply_thermal_energy"));
    commands.push_back(command_row("sandbox.spawn_creature","개체 생성",8,"aim_ecology_surface",Json::array({
        field("speciesId","종","content_id",Json(),Json(),false),field("tier","단계","number",Json(),Json(),false),
        field("claim","생성 청구 ID","text",Json(),Json(),false)}),"Simulation::command(creature.spawn)"));
    return Json{{"sandboxEnabled",world_.sandbox_enabled()},{"commands",std::move(commands)}};
}

Json WorldTools::save()const{return {{"schemaVersion",1},{"spawnSerial",spawn_serial_}};}
void WorldTools::load(Json state){if(!state.is_object())return;spawn_serial_=state.value("spawnSerial",uint64_t(0));}

Json WorldTools::command(const std::string& name,Json args){
    if(!args.is_object())return fail("invalid_arguments");
    if(!world_.sandbox_enabled())return fail("sandbox_required");
    if(name=="sandbox.observe")return observe(args);
    if(name=="sandbox.place_block")return place_block(args);
    if(name=="sandbox.pour_water")return pour(args,false);
    if(name=="sandbox.pour_acid")return pour(args,true);
    if(name=="sandbox.ignite")return ignite(args);
    if(name=="sandbox.apply_heat")return apply_heat(args);
    if(name=="sandbox.spawn_creature")return spawn_creature(args);
    return fail("unknown_sandbox_command");
}

Json WorldTools::place_block(const Json& args){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>6.5+1e-3)return fail("out_of_range");
    const std::string item=args.value("itemId",std::string());
    static const std::map<std::string,std::string> blocks={{"loose_stone","stone"},{"raw_timber","log"},{"sand","sand"},
        {"clay","clay"},{"iron_ore","iron_ore"},{"wood","plank"},{"stone","stone"},{"soil","dirt"}};
    auto block=blocks.find(item);if(block==blocks.end())return fail("not_buildable");
    if(content_.find("blocks",block->second).empty())return fail("unknown_block");
    int n=0;double size=args.value("size",.5);if(!std::isfinite(size))return fail("invalid_size");n=size>=1?2:1;
    Cell face;try{face={floor_cell(aim.point.x+aim.normal.x*.01),floor_cell(aim.point.y+aim.normal.y*.01),floor_cell(aim.point.z+aim.normal.z*.01)};}catch(...){return fail("target_out_of_range");}
    Cell start=n==1?face:Cell{int(std::floor(face.x/2.0))*2,int(std::floor(face.y/2.0))*2,int(std::floor(face.z/2.0))*2};
    std::vector<Cell> cells;cells.reserve(size_t(n*n*n));
    for(int dy=0;dy<n;dy++)for(int dz=0;dz<n;dz++)for(int dx=0;dx<n;dx++)cells.push_back({start.x+dx,start.y+dy,start.z+dz});
    const std::string claim=args.value("claim",std::string());if(claim.empty()||claim.size()>512)return fail("claim_required");
    bool exact_existing=true;for(Cell c:cells)exact_existing&=world_.block(c)==block->second;
    if(exact_existing&&gameplay_.has_claim(claim))return Json{{"ok",true},{"duplicate",true},{"blockId",block->second},{"cells",cells.size()}};
    Vec3 player{};const Json& player_json=args.contains("playerPosition")?args["playerPosition"]:args.value("player",Json());
    if(player_json.is_null())return fail("player_position_required");if(!read_vec(player_json,player))return fail("invalid_player_position");
    double body_height=args.value("bodyHeight",1.5);if(!std::isfinite(body_height)||body_height<=0||body_height>16)return fail("invalid_player_height");
    const double top=player.y+body_height;
    for(Cell c:cells){
        if(!world_.block(c).empty())return fail("occupied");Vec3 center=cell_center(c);
        if(extra_solid_&&extra_solid_(center))return fail("occupied");
        if(c.x*.5<player.x+.28&&c.x*.5+.5>player.x-.28&&c.z*.5<player.z+.28&&c.z*.5+.5>player.z-.28&&c.y*.5<top&&c.y*.5+.5>player.y)return fail("player_overlap");
    }
    Json paid=gameplay_.spend(Json{{item,double(cells.size())}},claim);if(!paid.value("ok",false))return paid;
    if(paid.value("duplicate",false))return Json{{"ok",true},{"duplicate",true},{"blockId",block->second}};

    struct Displaced {Cell cell;FluidState original;};std::vector<Displaced> displaced;double displaced_m3=0,lost_m3=0;
    const double top_y=(start.y+n)*CELL_M+.25;
    for(Cell c:cells){
        FluidState original=world_.fluid_at(c);if(!original.present())continue;displaced.push_back({c,original});Vec3 at=cell_center(c);
        Json taken=world_.take_fluid(at,original.volume_m3);double left=taken.value("volumeM3",0.0);displaced_m3+=left;
        const double acid=taken.value("acidFraction",0.0),temperature=std::max(20.0,taken.value("temperatureC",20.0));
        for(double lift:{0.0,.5,1.0}){if(left<=EPS)break;const double added=world_.pour({at.x,top_y+lift,at.z},left,acid,temperature);left-=added;}
        lost_m3+=std::max(0.0,left);
    }
    std::vector<Cell> placed;
    for(Cell c:cells)if(world_.set_block(c,block->second))placed.push_back(c);else{
        for(Cell prior:placed)world_.set_block(prior,"");
        for(const auto& fluid:displaced){const FluidState& f=fluid.original;const double temperature=f.volume_m3>EPS?20+f.thermal_eu/(4000*f.volume_m3):20;world_.pour(cell_center(fluid.cell),f.volume_m3,f.volume_m3>EPS?f.acid_m3/f.volume_m3:0,temperature);}
        gameplay_.grant(Json{{item,double(cells.size())}},claim+":refund");return fail("placement_failed");
    }
    return Json{{"ok",true},{"duplicate",false},{"blockId",block->second},{"cells",cells.size()},
                {"displacedM3",displaced_m3},{"lostM3",lost_m3}};
}

Json WorldTools::pour(const Json& args,bool acid){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>8+1e-3)return fail("out_of_range");
    Vec3 target=aim.point+aim.normal*.3;double added=world_.pour(target,acid?.3:.5,acid?.95:0,20);
    return Json{{"ok",true},{"type",acid?"acid":"water"},{"addedM3",added},{"requestedM3",acid?.3:.5}};
}

Json WorldTools::ignite(const Json& args){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>8+1e-3)return fail("out_of_range");
    Cell cell;try{Vec3 inside=aim.point-aim.normal*.001;cell={floor_cell(inside.x),floor_cell(inside.y),floor_cell(inside.z)};}catch(...){return fail("target_out_of_range");}
    if(!world_.ignite_cell(cell))return fail("not_flammable");return Json{{"ok",true},{"cell",cell}};
}

Json WorldTools::apply_heat(const Json& args){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>8+1e-3)return fail("out_of_range");
    const double energy=args.value("energyEu",0.0);if(!std::isfinite(energy)||energy<=0||energy>1e12)return fail("invalid_energy");
    Cell cell;try{Vec3 inside=aim.point-aim.normal*.001;cell={floor_cell(inside.x),floor_cell(inside.y),floor_cell(inside.z)};}catch(...){return fail("target_out_of_range");}
    const double accepted=world_.apply_thermal_energy(cell,energy);return Json{{"ok",true},{"cell",cell},{"acceptedEu",accepted}};
}

Json WorldTools::spawn_creature(const Json& args){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>8+1e-3)return fail("out_of_range");
    const Vec3 target=aim.point+aim.normal*.3;const SurfaceSample sample=world_.surface_sample(target.x,target.z);
    const Json& environment=content_.find("environments",sample.environment_id);Json rules=environment.value("spawning",Json::object()).value("rules",Json::array());
    if(!rules.is_array()||rules.empty())return fail("no_ecology_here");
    std::vector<std::pair<std::string,double>> choices;double total=0;for(const Json& rule:rules){
        const std::string id=rule.value("speciesId",std::string());const double weight=rule.value("weight",0.0);
        if(id.empty()||content_.find("creatures",id).empty()||!std::isfinite(weight)||weight<=0)continue;
        choices.push_back({id,weight});total+=weight;
    }
    if(choices.empty()||!(total>0))return fail("no_ecology_here");
    const std::string requested=args.value("speciesId",std::string());std::string species;
    if(!requested.empty()){
        auto it=std::find_if(choices.begin(),choices.end(),[&](const auto& row){return row.first==requested;});if(it==choices.end())return fail("species_unavailable_here");species=requested;
    }else{
        const std::string claim=args.value("claim",std::string());if(claim.size()>512)return fail("invalid_claim");const uint64_t serial=spawn_serial_++;
        std::ostringstream key;key<<world_.seed()<<':'<<(claim.empty()?std::to_string(serial):claim)<<':'<<std::setprecision(17)<<target.x<<','<<target.z;
        double roll=stable_roll(key.str())*total;species=choices.back().first;for(const auto& row:choices){roll-=row.second;if(roll<=0){species=row.first;break;}}
    }
    int rx=int(std::floor(target.x/64)),rz=int(std::floor(target.z/64));std::string claim=args.value("claim",std::string());
    std::string id=claim.empty()?"creature:sandbox:"+std::to_string(spawn_serial_++):"creature:sandbox:"+claim;
    Json spawn={{"id",id},{"speciesId",species},{"position",Json::array({target.x,world_.surface_height(target.x,target.z),target.z})},
                {"regionId",std::to_string(rx)+","+std::to_string(rz)},{"tier",args.value("tier",content_.find("creatures",species).value("baselineTier",2))}};
    Json result=simulation_.command("creature.spawn",std::move(spawn),world_,gameplay_);if(result.value("ok",false)){result["speciesId"]=species;result["environmentId"]=sample.environment_id;}return result;
}

Json WorldTools::observe(const Json& args){
    Aim aim;if(!read_aim(args,aim))return fail("aim_required");if(aim.distance>8+1e-3)return fail("out_of_range");
    Json result={{"ok",true},{"kind",aim.kind.empty()?"surface":aim.kind},{"id",aim.id},{"distance",aim.distance},{"point",aim.point}};
    if(aim.kind=="terrain"){
        try{Vec3 inside=aim.point-aim.normal*.001;Cell c{floor_cell(inside.x),floor_cell(inside.y),floor_cell(inside.z)};std::string id=world_.block(c);result["cell"]=c;result["blockId"]=id;result["cellSizeM"]=CELL_M;}
        catch(...){return fail("target_out_of_range");}
    }else if(aim.kind=="creature"&&!aim.id.empty()){
        Json inspected=simulation_.command("creature.interact",Json{{"id",aim.id}},world_,gameplay_);
        if(inspected.value("ok",false))result["creature"]=std::move(inspected);
    }
    return result;
}

} // namespace feral
