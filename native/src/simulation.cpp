#include "simulation.hpp"
#include "world.hpp"
#include "gameplay.hpp"

#include <limits>
#include <sstream>
#include <stdexcept>

namespace feral {
namespace {
constexpr double EPS=1e-8;
constexpr double AI_STEP=.25;
constexpr double MACHINE_STEP=1.0/60.0;

double clampd(double v,double lo,double hi){return std::max(lo,std::min(hi,v));}
double number(const Json& j,double fallback=0){return j.is_number()?j.get<double>():fallback;}
double number(const Json& j,const char* key,double fallback=0){return j.is_object()&&j.contains(key)&&j[key].is_number()?j[key].get<double>():fallback;}
double number(const Json& j,const std::string& key,double fallback=0){return j.is_object()&&j.contains(key)&&j[key].is_number()?j[key].get<double>():fallback;}
int integer(const Json& j,const char* key,int fallback=0){return j.is_object()&&j.contains(key)&&j[key].is_number_integer()?j[key].get<int>():fallback;}
std::string string(const Json& j,const char* key,const std::string& fallback={}){return j.is_object()&&j.contains(key)&&j[key].is_string()?j[key].get<std::string>():fallback;}
bool boolean(const Json& j,const char* key,bool fallback=false){return j.is_object()&&j.contains(key)&&j[key].is_boolean()?j[key].get<bool>():fallback;}
bool boolean(const Json& j,const std::string& key,bool fallback=false){return j.is_object()&&j.contains(key)&&j[key].is_boolean()?j[key].get<bool>():fallback;}
Vec3 point(const Json& j,Vec3 fallback={}){if(j.is_array()&&j.size()>=3)return{j[0].get<double>(),j[1].get<double>(),j[2].get<double>()};if(j.is_object())return{number(j,"x",fallback.x),number(j,"y",fallback.y),number(j,"z",fallback.z)};return fallback;}
void set_axis(Vec3& v,int axis,double value){if(axis==0)v.x=value;else if(axis==1)v.y=value;else v.z=value;}
int parsed_int(const std::string& text,int fallback=-1){try{size_t used=0;int value=std::stoi(text,&used);return used==text.size()?value:fallback;}catch(...){return fallback;}}
std::string creature_logical_part(const std::string& profile,const std::string& id){
    if(id=="root")return{};
    if(id=="core"||id=="head"||id=="spine"||id=="shell"||id=="weapon")return id;
    if(id.rfind("limb_",0)==0){int index=parsed_int(id.substr(5));return index>=0?"limb_"+std::to_string(index):std::string();}
    const std::array<std::string,4> quad={"left_foreleg","right_foreleg","left_hindleg","right_hindleg"};
    for(int i=0;i<int(quad.size());++i)if(id==quad[i])return "limb_"+std::to_string(i);
    if(id.rfind("wing_",0)==0){int side=parsed_int(id.substr(5));if(side!=-1)return "limb_"+std::to_string(side<0?0:1);}
    if(id.rfind("thruster_",0)==0){int index=parsed_int(id.substr(9));if(index>=0)return "limb_"+std::to_string(index);}
    auto side_leg=[&](const std::string& prefix)->std::string{
        if(id.rfind(prefix,0)!=0)return{};const std::string suffix=id.substr(prefix.size());const auto split=suffix.find('_');const int side=parsed_int(split==std::string::npos?suffix:suffix.substr(0,split));
        if(side==-1)return{};const int row=split==std::string::npos?0:parsed_int(suffix.substr(split+1));if(row<0)return{};return "limb_"+std::to_string(split==std::string::npos?(side<0?0:1):row*2+(side<0?0:1));
    };
    if(auto mapped=side_leg("walking_leg_");!mapped.empty())return mapped;
    if(auto mapped=side_leg("leg_");!mapped.empty())return mapped;
    if(id.rfind("segment_",0)==0){int index=parsed_int(id.substr(8));if(index>=0)return profile=="serpent"?"limb_"+std::to_string(std::min(3,index/3)):"core";}
    if(id.find("raptorial_arm")!=std::string::npos||id.rfind("claw_",0)==0||id.find("spinneret")!=std::string::npos||id.find("heat_pouch")!=std::string::npos||id.find("guard_staff")!=std::string::npos||id.rfind("arm_",0)==0)return "weapon";
    if(id.find("carapace")!=std::string::npos||id.find("shell")!=std::string::npos||id.find("scute")!=std::string::npos||id.find("crest")!=std::string::npos||id.find("backpack")!=std::string::npos||id.find("service_pack")!=std::string::npos||id.find("chest_panel")!=std::string::npos||id.find("folded_wings")!=std::string::npos)return "shell";
    if(id.find("head")!=std::string::npos||id.find("face")!=std::string::npos||id.find("sensor")!=std::string::npos||id.find("mouth")!=std::string::npos||id.find("eye_stalk")!=std::string::npos||id.find("antenna")!=std::string::npos||id.find("horn")!=std::string::npos||id.find("antler")!=std::string::npos||id.find("beard")!=std::string::npos||id.find("hood")!=std::string::npos)return "head";
    if(id=="foot"&&profile=="crawler")return "limb_0";
    if(id.rfind("talon_",0)==0)return "core";
    for(const auto& word:{"tail","neck","reed_back","mane","mantle","ridge","thorax","torso","abdomen","hull","pelvis","belt","scarf","tabard","satchel","root_shoulder"})if(id.find(word)!=std::string::npos)return "core";
    return{};
}
void refresh_creature_structure_pose(Json& e,const Json& species,const Content& content){
    const Json structure=e.value("structure",Json::object()),hp=structure.value("hp",Json::object()),max_hp=structure.value("maxHp",Json::object());
    const std::string profile=string(e,"bodyProfile",string(species.value("body",Json::object()),"profile","quadruped"));
    const Json profiles=content.data.value("creatures",Json::object()).value("bodyProfiles",Json::object()),definition=profiles.value(profile,Json::object());
    const int count=std::clamp(integer(definition,"limbCount",4),0,32);Json support=Json::array(),missing=Json::array();int intact=0;
    for(int i=0;i<count;++i){const std::string part="limb_"+std::to_string(i);const bool good=number(hp,part,number(max_hp,part,1))>EPS&&number(hp,"spine",number(max_hp,"spine",1))>EPS;support.push_back(good);if(good)intact++;}
    double speed=0;const Json speeds=definition.value("intactLimbSpeed",Json::array());if(speeds.is_array()&&!speeds.empty())speed=number(speeds[std::min<int>(intact,int(speeds.size())-1)]);
    if(profile=="quadruped"&&intact==2&&support.size()==4&&support[0]==support[3]&&support[1]==support[2])speed=.22;
    if(profile=="winged"&&intact<2)speed=.25;if(number(hp,"core",number(max_hp,"core",1))<=EPS)speed*=.25;if(boolean(e,"dead"))speed=0;
    for(auto it=hp.begin();it!=hp.end();++it){const std::string part=it.key();const double maximum=number(max_hp,part.c_str(),number(it.value()));const bool broken=number(it.value())<=EPS;
        e["parts"][part]={{"hp",it.value()},{"maxHp",maximum},{"broken",broken},{"detached",broken&&part!="core"&&part!="spine"}};
        if(broken&&part!="core"&&part!="spine")missing.push_back(part);
    }
    e["pose"]["limbSupport"]=std::move(support);e["pose"]["speedFactor"]=speed;e["pose"]["missingParts"]=std::move(missing);
    if(boolean(e,"dead"))e["pose"]["moving"]=false;
}
Vec3 json_vec3(const Json& j,const char* key,Vec3 fallback={}){return j.is_object()&&j.contains(key)?point(j[key],fallback):fallback;}
Json vec_json(Vec3 v){return Json{{"x",v.x},{"y",v.y},{"z",v.z}};}
Json quat_json(Quat q){return Json{{"x",q.x},{"y",q.y},{"z",q.z},{"w",q.w}};}
Quat yaw_quat(double yaw){return{0,std::sin(yaw*.5),0,std::cos(yaw*.5)};}
double yaw_of(Quat q){return std::atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));}
double distance_xz(Vec3 a,Vec3 b){return std::hypot(a.x-b.x,a.z-b.z);}
uint32_t hash32(const std::string& text){uint32_t h=2166136261u;for(unsigned char c:text){h^=c;h*=16777619u;}return h;}
double fraction(const std::string& text){uint32_t x=hash32(text);x^=x>>16;x*=0x7feb352du;x^=x>>15;return double(x)/4294967296.0;}
int deterministic_int(const std::string& key,int lo,int hi){if(hi<lo)return lo;return lo+int(hash32(key)%uint32_t(hi-lo+1));}
std::string cell_key(int x,int y,int z){return std::to_string(x)+","+std::to_string(y)+","+std::to_string(z);}
bool has_array(const Json& j,const char* k){return j.is_object()&&j.contains(k)&&j[k].is_array();}
Json object_or(const Json& j){return j.is_object()?j:Json::object();}
Json array_or(const Json& j){return j.is_array()?j:Json::array();}
Json bones_hp(const Json& e,const std::string& id,double maxhp){const auto& s=e.value("structure",Json::object());const auto& hp=s.value("hp",Json::object());return hp.contains(id)?hp[id]:Json(maxhp);}
void append_array(Json& target,const std::string& key,const Json& value){if(!target.contains(key)||!target[key].is_array())target[key]=Json::array();target[key].push_back(value);}

// Subtract an axis-aligned local-space wound box from an authored box. The six
// disjoint output boxes exactly preserve all material outside the cut.
std::vector<Json> subtract_box(const Json& source,const Json& cut){
    Vec3 c=point(source.value("center",Json::array({0,0,0}))),s=point(source.value("size",Json::array({0,0,0})));
    Vec3 q=point(cut.value("center",Json::array({0,0,0}))),t=point(cut.value("size",Json::array({0,0,0})));
    Vec3 lo{std::max(c.x-s.x/2,q.x-t.x/2),std::max(c.y-s.y/2,q.y-t.y/2),std::max(c.z-s.z/2,q.z-t.z/2)};
    Vec3 hi{std::min(c.x+s.x/2,q.x+t.x/2),std::min(c.y+s.y/2,q.y+t.y/2),std::min(c.z+s.z/2,q.z+t.z/2)};
    if(lo.x>=hi.x-EPS||lo.y>=hi.y-EPS||lo.z>=hi.z-EPS)return{source};
    const Vec3 b0{c.x-s.x/2,c.y-s.y/2,c.z-s.z/2},b1{c.x+s.x/2,c.y+s.y/2,c.z+s.z/2};
    std::vector<std::pair<Vec3,Vec3>> bounds;
    auto add=[&](Vec3 a,Vec3 b){if(b.x>a.x+EPS&&b.y>a.y+EPS&&b.z>a.z+EPS)bounds.emplace_back(a,b);};
    add(b0,{lo.x,b1.y,b1.z}); add({hi.x,b0.y,b0.z},b1);
    add({lo.x,b0.y,b0.z},{hi.x,lo.y,b1.z}); add({lo.x,hi.y,b0.z},{hi.x,b1.y,b1.z});
    add({lo.x,lo.y,b0.z},{hi.x,hi.y,lo.z}); add({lo.x,lo.y,hi.z},{hi.x,hi.y,b1.z});
    std::vector<Json> result;for(auto& [a,b]:bounds){Json box=source;box["center"]={(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2};box["size"]={b.x-a.x,b.y-a.y,b.z-a.z};result.push_back(std::move(box));}
    return result;
}
Json build_creature_bone_boxes(const Json& part,const std::string& part_id,const std::string& logical){
    Json clipped=Json::array();if(!has_array(part,"boxes")||logical.empty()||logical=="shell")return clipped;
    Vec3 lo{1e9,1e9,1e9},hi{-1e9,-1e9,-1e9};double volume=0;
    for(const auto& b:part["boxes"]){Vec3 c=point(b.value("center",Json::array({0,0,0}))),s=point(b.value("size",Json::array({0,0,0})));lo={std::min(lo.x,c.x-s.x/2),std::min(lo.y,c.y-s.y/2),std::min(lo.z,c.z-s.z/2)};hi={std::max(hi.x,c.x+s.x/2),std::max(hi.y,c.y+s.y/2),std::max(hi.z,c.z+s.z/2)};volume+=s.x*s.y*s.z;}
    const Vec3 size=hi-lo,center=(lo+hi)*.5;auto snap=[](double v){return std::max(1.0/32,std::round(v/(1.0/32))*(1.0/32));};
    const double volume_box=size.x*size.y*size.z;if(volume_box<=EPS||volume/volume_box<.4||std::min({size.x,size.y,size.z})<.09)return clipped;
    const int axis=size.x>=size.y&&size.x>=size.z?0:size.y>=size.z?1:2,cross=axis==0?2:0;
    Vec3 bar{std::min(snap(std::min({size.x,size.y,size.z})*.34),.09),std::min(snap(std::min({size.x,size.y,size.z})*.34),.09),std::min(snap(std::min({size.x,size.y,size.z})*.34),.09)};
    if(axis==0)bar.x=snap(size.x*.84);else if(axis==1)bar.y=snap(size.y*.84);else bar.z=snap(size.z*.84);
    Json candidates=Json::array();
    if(logical=="head")candidates.push_back(Json{{"center",vec_json(center)},{"size",vec_json({snap(size.x*.45),snap(size.y*.45),snap(size.z*.45)})},{"material","bone_core"}});
    else if(!(logical=="core"&&axis!=1&&(cross==0?size.x:size.z)>=.16&&size.y>=.16))candidates.push_back(Json{{"center",vec_json(center)},{"size",vec_json(bar)},{"material","bone_core"}});
    else{
        const double top=center.y+size.y*.22,rib=2.0/32,drop=snap(size.y*.56),length=axis==0?size.x:size.z;
        const int count=std::max(3,int(std::floor(length*.8/rib)));const double start=(axis==0?center.x:center.z)-count*rib/2+rib/2;
        candidates.push_back(Json{{"center",vec_json({center.x,top,center.z})},{"size",vec_json(bar)},{"material","bone_core"}});
        for(int i=0;i<count;i++)for(int side:{-1,1}){Vec3 c=center,s{rib,rib,rib};if(axis==0)c.x=start+i*rib;else c.z=start+i*rib;if(cross==0)c.x+=side*size.x*.3;else c.z+=side*size.z*.3;c.y=top-drop/2;s.y=drop;candidates.push_back(Json{{"center",vec_json(c)},{"size",vec_json(s)},{"material","bone_core"}});}
    }
    Json disjoint=Json::array();for(const auto& bone:candidates){Json pieces=Json::array({bone});for(const auto& earlier:disjoint){Json next=Json::array();for(const auto& piece:pieces)for(auto rem:subtract_box(piece,earlier))next.push_back(std::move(rem));pieces=std::move(next);}for(auto& piece:pieces)disjoint.push_back(std::move(piece));}
    auto coord=[](Vec3 v,int i){return i==0?v.x:i==1?v.y:v.z;};
    for(const auto& bone:disjoint)for(const auto& shell:part["boxes"]){
        const Vec3 bc=point(bone["center"]),bs=point(bone["size"]),sc=point(shell["center"]),ss=point(shell["size"]);Vec3 a,b;
        for(int j=0;j<3;j++){const double bl=coord(bc,j)-coord(bs,j)/2,bh=coord(bc,j)+coord(bs,j)/2,sl=coord(sc,j)-coord(ss,j)/2,sh=coord(sc,j)+coord(ss,j)/2,low=std::max(bl,sl)+.002,high=std::min(bh,sh)-.002;set_axis(a,j,low);set_axis(b,j,high);}
        if(b.x-a.x>1.0/128&&b.y-a.y>1.0/128&&b.z-a.z>1.0/128)clipped.push_back(Json{{"partId",part_id},{"center",vec_json((a+b)*.5)},{"size",vec_json(b-a)},{"material","bone_core"},{"collidable",true}});
    }
    return clipped;
}

Json get_asset_part(const Json& asset,const std::string& id){if(!has_array(asset,"parts"))return Json::object();for(const auto& p:asset["parts"])if(string(p,"id")==id)return p;return Json::object();}
Vec3 part_translation(const Json& asset,const std::string& id){
    std::map<std::string,Json> parts; if(has_array(asset,"parts"))for(const auto& p:asset["parts"])parts[string(p,"id")]=p;
    Vec3 out{};std::set<std::string> seen;std::string at=id;
    while(!at.empty()&&parts.count(at)&&seen.insert(at).second){const auto& p=parts.at(at);if(p.contains("translation"))out+=point(p["translation"]);at=string(p,"parent");}
    return out;
}
double entry_number(const Content& content,const std::string& id,const char* key,double fallback=0){const auto& e=content.find(id);return number(e,key,fallback);}
bool shape_hits_player(const Json& shape,Vec3 feet,double radius,double height){
    if(!shape.is_object())return false;const std::string kind=string(shape,"kind");const Vec3 center=point(shape.value("center",Json::object()));
    if(kind=="sphere"){
        Vec3 closest{feet.x,clampd(center.y,feet.y+radius,feet.y+std::max(radius,height-radius)),feet.z};return (center-closest).length()<=number(shape,"radiusM",number(shape,"radius",1))+radius;
    }
    if(kind=="cylinder"||kind=="annular_cylinder"){
        const double bottom=number(shape,"bottomY",center.y-number(shape,"heightM",1)/2),top=bottom+number(shape,"heightM",1);if(feet.y>top||feet.y+height<bottom)return false;
        const double r=std::hypot(feet.x-center.x,feet.z-center.z),outer=number(shape,"outerRadiusM",number(shape,"radiusM",1)),inner=number(shape,"innerRadiusM",0);return r-radius<=outer&&r+radius>=inner;
    }
    const Json axes=shape.value("axes",Json::array());const Json half=shape.value("halfSize",Json::array({1,1,1}));if(!axes.is_array()||axes.size()<3||!half.is_array()||half.size()<3)return false;
    Vec3 c{feet.x,feet.y+height/2,feet.z},delta=c-center;const double extent=std::max(0.0,height/2-radius);
    for(int i=0;i<3;i++){Vec3 a=point(axes[i]);if(std::abs(delta.dot(a))>half[i].get<double>()+radius+std::abs(a.y)*extent)return false;}return true;
}
}

Simulation::Simulation(const Content& content):content_(content){modules_=Json::object();}
const Json& Simulation::entry(const std::string& id)const{return content_.find(id);}
std::string Simulation::make_id(const std::string& type){return type+":"+seed_+":"+std::to_string(next_id_++);}

void Simulation::configure(Json config){
    config_=object_or(config);
    seed_=string(config_,"seed",seed_);
    if(config_.contains("rules")&&config_["rules"].is_object())survival_=boolean(config_["rules"],"survival",survival_);
    if(config_.contains("world")&&config_["world"].is_object())survival_=boolean(config_["world"],"survival",survival_);
    if(config_.contains("survival"))survival_=boolean(config_,"survival",survival_);
    const Json* mod=nullptr;
    if(config_.contains("modules")&&config_["modules"].is_array())mod=&config_["modules"];
    if(mod)for(const auto& m:*mod)if(m.is_string()){
        const auto name=m.get<std::string>();if(!modules_.contains(name))modules_[name]=Json::object();
    }
    if(config_.contains("seed"))seed_=config_["seed"].is_string()?config_["seed"].get<std::string>():config_["seed"].dump();
    harvest_bucket_x_=harvest_bucket_z_=std::numeric_limits<int>::min();
}

void Simulation::load(Json state){
    if(!state.is_object())throw std::invalid_argument("simulation save must be an object");
    unknown_state_=state;time_=std::max(0.0,number(state,"time",0));seed_=string(state,"seed",seed_);next_id_=std::max<uint64_t>(1,uint64_t(std::max(1,integer(state,"nextId",1))));
    ai_remainder_=std::max(0.0,number(state,"aiRemainder",0));machine_remainder_=std::max(0.0,number(state,"machineRemainder",0));
    creatures_.clear();regions_.clear();corpses_.clear();dungeons_.clear();bosses_.clear();machines_.clear();machine_bodies_.clear();harvest_states_.clear();
    auto load_rows=[](const Json& group,const char* field,std::map<std::string,Json>& target,const char* idfield){
        if(!has_array(group,field))return;
        for(const auto& row:group[field])if(row.is_object()){
            const std::string id=string(row,idfield);if(!id.empty())target[id]=row;
        }
    };
    const Json c=state.value("creatures",Json::object());load_rows(c,"entities",creatures_,"id");load_rows(c,"regions",regions_,"id");load_rows(c,"corpses",corpses_,"id");
    const Json d=state.value("dungeons",Json::object());load_rows(d,"instances",dungeons_,"id");
    const Json b=state.value("bosses",Json::object());load_rows(b,"entities",bosses_,"id");
    const Json m=state.value("machines",Json::object());load_rows(m,"machines",machines_,"id");
    // Keep modules enabled by the active preset when an older native or
    // imported unified snapshot predates their per-module state. Saved module
    // records override preset defaults and unknown records remain lossless.
    Json merged_modules=modules_;
    const Json saved_modules=object_or(state.value("modules",Json::object()));
    for(auto it=saved_modules.begin();it!=saved_modules.end();++it)merged_modules[it.key()]=it.value();
    modules_=std::move(merged_modules);poses_.clear();wound_geometry_cache_.clear();anatomy_geometry_cache_.clear();
    if(state.contains("harvestStates")&&state["harvestStates"].is_object())
        for(auto it=state["harvestStates"].begin();it!=state["harvestStates"].end();++it)
            if(it.value().is_object())harvest_states_[it.key()]=it.value();
    harvest_nodes_=Json::array();harvest_bucket_x_=harvest_bucket_z_=std::numeric_limits<int>::min();
    for(const auto& kv:machines_)rebuild_machine(kv.first);
    rebuild_views();
}

Json Simulation::save()const{
    Json out=object_or(unknown_state_);out["schemaVersion"]=1;out["time"]=time_;out["seed"]=seed_;out["nextId"]=next_id_;out["aiRemainder"]=ai_remainder_;out["machineRemainder"]=machine_remainder_;
    Json c=object_or(out.value("creatures",Json::object()));c["version"]=1;c["seed"]=seed_;c["time"]=time_;c["remainder"]=ai_remainder_;c["serial"]=next_id_;
    c["entities"]=Json::array();for(const auto& kv:creatures_)c["entities"].push_back(kv.second);
    c["regions"]=Json::array();for(const auto& kv:regions_)c["regions"].push_back(kv.second);
    c["corpses"]=Json::array();for(const auto& kv:corpses_)c["corpses"].push_back(kv.second);out["creatures"]=std::move(c);
    Json d=object_or(out.value("dungeons",Json::object()));d["schemaVersion"]=1;d["seed"]=seed_;d["time"]=time_;d["instances"]=Json::array();for(const auto& kv:dungeons_)d["instances"].push_back(kv.second);out["dungeons"]=std::move(d);
    Json b=object_or(out.value("bosses",Json::object()));b["schemaVersion"]=1;b["nextId"]=next_id_;b["time"]=time_;b["entities"]=Json::array();for(const auto& kv:bosses_)b["entities"].push_back(kv.second);out["bosses"]=std::move(b);
    Json m=object_or(out.value("machines",Json::object()));m["schemaVersion"]=1;m["nextId"]=next_id_;m["clock"]=time_;m["machines"]=Json::array();for(const auto& kv:machines_)m["machines"].push_back(kv.second);out["machines"]=std::move(m);
    out["modules"]=modules_;out["harvestStates"]=Json::object();for(const auto& kv:harvest_states_)out["harvestStates"][kv.first]=kv.second;return out;
}

void Simulation::set_player_state(Json state){if(state.is_object()){player_state_=std::move(state);survival_=boolean(player_state_,"survival",survival_);}}
double Simulation::surface(World& world,double x,double z)const{return world.surface_height(x,z);}
bool Simulation::solid(World& world,Vec3 p)const{return !world.block(world_cell(p)).empty();}
void Simulation::queue_event(Json event){if(!event.is_object())return;events_.push_back(std::move(event));while(events_.size()>256)events_.erase(events_.begin());}
void Simulation::emit_event(Gameplay& gameplay,Json event){if(!event.is_object())return;gameplay.record_event(event);queue_event(std::move(event));}
void Simulation::apply_player_hit(Gameplay& gameplay,Json event){
    if(!event.is_object())return;const double amount=number(event,"amount");
    gameplay.record_event(Json{{"type","player_damage"},{"amount",amount},{"source",event.value("sourceId",event.value("source",Json(nullptr)))}});
    queue_event(std::move(event));
}

std::vector<ForceCommand> Simulation::consume_forces(){auto out=std::move(forces_);forces_.clear();return out;}
std::vector<Json> Simulation::consume_events(){auto out=std::move(events_);events_.clear();return out;}
bool Simulation::sync_machine_body(const std::string& id,Vec3 position,Quat rotation,Vec3 velocity,Vec3 angular_velocity){
    auto it=machines_.find(id);if(it==machines_.end())return false;auto& m=it->second;
    m["position"]=vec_json(position);m["rotation"]=quat_json(rotation);m["velocity"]=vec_json(velocity);m["angularVelocity"]=vec_json(angular_velocity);
    auto body=machine_bodies_.find(id);if(body!=machine_bodies_.end()){body->second.position=position;body->second.rotation=rotation;body->second.velocity=velocity;body->second.angular_velocity=angular_velocity;}
    return true;
}
bool Simulation::sync_entity_pose(const std::string& id,Vec3 position,Quat rotation){
    if(auto it=creatures_.find(id);it!=creatures_.end()){
        it->second["x"]=position.x;it->second["y"]=position.y;it->second["z"]=position.z;it->second["yaw"]=yaw_of(rotation);return true;
    }
    if(auto it=bosses_.find(id);it!=bosses_.end()){
        it->second["position"]=vec_json(position);Vec3 forward=rotate(rotation,{0,0,1});it->second["facing"]=Json::array({forward.x,forward.y,forward.z});return true;
    }
    if(auto it=dungeons_.find(id);it!=dungeons_.end()){
        it->second["origin"]=vec_json(position);it->second["yaw"]=yaw_of(rotation);return true;
    }
    return false;
}

void Simulation::tick(double dt,Vec3 player,World& world,Gameplay& gameplay){
    if(!std::isfinite(dt)||dt<0||dt>1.0)throw std::invalid_argument("simulation dt must be in [0,1]");
    player_=player;time_+=dt;forces_.clear();
    const int harvest_x=int(std::floor(player.x/16.0)),harvest_z=int(std::floor(player.z/16.0));
    if(harvest_x!=harvest_bucket_x_||harvest_z!=harvest_bucket_z_){harvest_nodes_=world.harvest_nodes_around(player,112.0);harvest_bucket_x_=harvest_x;harvest_bucket_z_=harvest_z;}
    if(!harvest_nodes_.is_array())harvest_nodes_=Json::array();
    // World samples provide the actual preset ecology owner and safe-spawn rules.
    const auto sample=world.surface_sample(player.x,player.z);
    const int rx=int(std::floor(player.x/64.0)),rz=int(std::floor(player.z/64.0));
    const std::string region_id="ecology:"+seed_+":"+std::to_string(rx)+","+std::to_string(rz);
    if(!regions_.count(region_id)){
        Json args={{"id",region_id},{"x",(rx+.5)*64.0},{"z",(rz+.5)*64.0},{"environmentId",sample.environment_id.empty()?"grove":sample.environment_id},{"baseEnvironmentId",sample.base_environment_id},{"tier",sample.tier},{"safeBypass",!sample.hostile_spawns_allowed}};
        // Region creation is deterministic and only occurs once per ecological cell.
        Json r={{"id",region_id},{"kind","outdoor"},{"environmentId",args["environmentId"]},{"baseEnvironmentId",args["baseEnvironmentId"]},{"x",args["x"]},{"y",sample.height},{"z",args["z"]},{"tier",sample.tier},{"radius",32},{"capacity",14},{"speciesCaps",Json::object()},{"initialized",true},{"births",0},{"lastUpdatedAt",time_},{"nextBirthAt",time_+60},{"waterL",nullptr},{"closed",false},{"foodNodes",Json::array()},{"carrionCp",0},{"detritusCp",0},{"migrationCount",0},{"safeBypass",!sample.hostile_spawns_allowed}};
        const auto& env=entry(string(args,"environmentId"));const Json spawning=env.value("spawning",Json::object());
        const double cpbu=number(content_.data.value("creatures",Json::object()).value("contracts",Json::object()),"edibleBiomassCpPerUnit",100);
        int patch_count=integer(env.value("decoration",Json::object()),"producerPatchesPer4096M2",8);patch_count=std::clamp(patch_count,0,64);
        for(int i=0;i<patch_count;i++){
            const double max_cp=number(spawning,"producerBiomassUnitsPerPatch",10)*cpbu;
            append_array(r,"foodNodes",Json{{"id",region_id+":producer:"+std::to_string(i)},{"x",(rx+.5)*64+(fraction(seed_+region_id+":px:"+std::to_string(i))-.5)*40},{"z",(rz+.5)*64+(fraction(seed_+region_id+":pz:"+std::to_string(i))-.5)*40},{"cp",max_cp},{"maxCp",max_cp},{"regenCpPerS",number(spawning,"producerRegrowthUnitsPerSecond",.004)*cpbu},{"waterLPerS",0},{"enabled",true},{"requiresLight",false},{"requiresMana",false},{"sourceId",string(args,"environmentId")},{"roomId",nullptr}});
        }
        regions_[region_id]=r;
        if(has_array(spawning,"rules"))for(const auto& rule:spawning["rules"]){
            const std::string species_id=string(rule,"speciesId");if(species_id.empty())continue;
            const Json& species=entry(species_id);if(species.is_null()||species.empty())continue;
            if(boolean(r,"safeBypass")&&(string(species,"role")=="predator"||integer(species,"baselineTier",1)>sample.tier+1))continue;
            Json group=rule.value("groupSize",Json::array({1,1}));int lo=group.is_array()&&group.size()>0?group[0].get<int>():1,hi=group.is_array()&&group.size()>1?group[1].get<int>():lo;
            const int cap=integer(rule,"capPerEcologyCell",hi),count=std::min(cap,deterministic_int(seed_+region_id+":"+species_id+":group",lo,hi));
            r["speciesCaps"][species_id]=cap;regions_[region_id]=r;
            for(int i=0;i<count;i++){
                const Json node=has_array(r,"foodNodes")&&r["foodNodes"].size()?r["foodNodes"][i%r["foodNodes"].size()]:Json::object();
                Json spawn_args={{"speciesId",species_id},{"position",Json::array({number(node,"x",player.x)+(fraction(region_id+":"+species_id+":"+std::to_string(i)+":x")-.5)*8,0,number(node,"z",player.z)+(fraction(region_id+":"+species_id+":"+std::to_string(i)+":z")-.5)*8})},{"id",region_id+":initial:"+species_id+":"+std::to_string(i)},{"tier",sample.tier},{"regionId",region_id}};
                spawn_creature(spawn_args,world);
            }
        }
    }
    // Starter authored structures are preset rules, not a hard-coded map fork.
    if(boolean(config_.value("rules",Json::object()),"startStructures",false)){
        Json args={{"templateId","root_manor"},{"siteId","starter-manor"},{"origin",Json::array({160.0,surface(world,160,0)+CELL_M,0.0})},{"tier",2}};ensure_dungeon(args,world);
        if(!entry("grove_supply_camp").empty()){Json camp={{"templateId","grove_supply_camp"},{"siteId","starter-supply"},{"origin",Json::array({-32.0,surface(world,-32,70)+CELL_M,70.0})},{"tier",1}};ensure_dungeon(camp,world);}
    }
    ensure_world_structures(player,world);
    ai_remainder_+=dt;while(ai_remainder_+EPS>=AI_STEP){ai_remainder_-=AI_STEP;step_creatures(AI_STEP,player,world,gameplay);step_bosses(AI_STEP,player,world,gameplay);step_ecology(AI_STEP);}
    step_first_signal(dt,player,world,gameplay);
    machine_remainder_+=dt;while(machine_remainder_+EPS>=MACHINE_STEP){machine_remainder_-=MACHINE_STEP;step_machines(MACHINE_STEP,world,gameplay);}
    // First-signal and machine-field are opt-in modules from the preset. Field
    // example bodies are assembled from the same authored material/component data.
    if(modules_.contains("machine-field")&&!boolean(modules_["machine-field"],"equipped",false)){
        // Match the authored MachineField.equip transaction: unlock the two
        // engineering research paths, grant the exact field kit once, and
        // import its light example on the authored start pad.
        bool ready=true;std::set<std::string> research_ids;
        for(const std::string component_id:{"heat_engine","transmission","controller"}){
            const Json& component=entry(component_id);const std::string research_id=string(component,"research");
            if(research_id.empty()||!research_ids.insert(research_id).second)continue;
            const Json& research=entry(research_id);const std::string blueprint=string(research,"blueprint");
            if(blueprint.empty()){ready=false;continue;}
            const Json unlocked=gameplay.command("research.discover",Json{{"blueprintId",blueprint},{"origin","discovery"},{"claim","machine-field:research:"+research_id}});
            ready=ready&&boolean(unlocked,"ok");
        }
        static const Json field_kit={{"wood",640},{"scrap_iron",256},{"raw_timber",64},{"heat_engine",1},{"transmission",4},{"controller",1}};
        const Json granted=gameplay.grant(field_kit,"machine-field:kit");ready=ready&&boolean(granted,"ok");
        bool has_example=false;for(const auto& [id,m]:machines_)has_example=has_example||boolean(m,"fieldExample");
        Json imported=Json{{"ok",true}};
        if(!has_example){
            Json design={{"name","경량 예제"},{"gridM",.5},{"position",Json::array({.25,surface(world,0,5)+.06,5.25})},{"yaw",3.141592653589793},{"fieldExample",true}};
            Json voxels=Json::array();for(int z=-1;z<=1;z++)voxels.push_back(Json{{"cell",Json::array({0,0,z})},{"materialId","wood"}});voxels.push_back(Json{{"cell",Json::array({0,1,0})},{"materialId","wood"}});for(int x:{-1,1})for(int z:{-1,1})voxels.push_back(Json{{"cell",Json::array({x,0,z})},{"materialId","wood"}});design["voxels"]=voxels;
            Json comps=Json::array({Json{{"cell",Json::array({0,1,0})},{"componentId","heat_engine"},{"fuelItems",8}},Json{{"cell",Json::array({0,0,1})},{"componentId","controller"}}});for(int x:{-1,1})for(int z:{-1,1})comps.push_back(Json{{"cell",Json::array({x,0,z})},{"componentId","transmission"},{"legacyType","wheel"}});design["components"]=comps;
            Json links=Json::array();for(size_t i=2;i<comps.size();i++)links.push_back(Json{{"from",0},{"to",i},{"type","mechanical"}});design["links"]=links;
            imported=create_machine(design,gameplay,true);if(boolean(imported,"ok"))machines_[string(imported,"machineId")]["fieldExample"]=true;
        }
        if(ready&&boolean(imported,"ok"))modules_["machine-field"]["equipped"]=true;
    }
    rebuild_views();
}

Json Simulation::spawn_creature(const Json& args,World& world){
    const std::string species_id=string(args,"speciesId",string(args,"species"));const Json& s=entry(species_id);
    if(species_id.empty()||s.empty())return fail("unknown_species");
    Vec3 p=args.contains("position")?point(args["position"]):Vec3{number(args,"x",0),number(args,"y",surface(world,number(args,"x",0),number(args,"z",0))),number(args,"z",0)};
    if(!std::isfinite(p.x)||!std::isfinite(p.y)||!std::isfinite(p.z))return fail("invalid_position");
    std::string id=string(args,"id");if(id.empty())id="creature:"+seed_+":"+std::to_string(next_id_++);
    if(creatures_.count(id))return Json{{"ok",true},{"entityId",id},{"duplicate",true}};
    const int base=integer(s,"baselineTier",2),tier=std::clamp(integer(args,"tier",base),1,10);const Json contracts=content_.data.value("creatures",Json::object()).value("contracts",Json::object());
    const double scale=std::pow(number(contracts.value("tierScaling",Json::object()),"hpPerTierMultiplier",1.35),tier-base);
    const Json body=s.value("body",Json::object()),stats=s.value("stats",Json::object()),cal=s.value("calories",Json::object());
    const double maxhp=std::max(1.0,std::round(number(stats,"maxHp",10)*scale));
    const Json reserve=s.value("energyReserve",Json());
    Json structure={{"version",1},{"hp",Json::object()},{"revision",0}};
    auto node=[&](const std::string& n,double hp){return std::pair<std::string,double>{n,std::max(1.0,std::round(hp*scale))};};
    std::vector<std::pair<std::string,double>> nodes={node("core",number(body,"coreHp",10)),node("head",number(body,"coreHp",10)),node("spine",number(body,"coreHp",10)),node("shell",number(body,"shellPatchHp",10))};
    if(has_array(s,"attacks")&&s["attacks"].size())nodes.push_back(node("weapon",number(body,"limbNodeHp",6)));
    const Json profiles=content_.data.value("creatures",Json::object()).value("bodyProfiles",Json::object());const std::string profile=string(body,"profile","quadruped");
    const int limb_count=integer(profiles.value(profile,Json::object()),"limbCount",4);
    for(int i=0;i<std::clamp(limb_count,0,32);i++)nodes.push_back(node("limb_"+std::to_string(i),number(body,"limbNodeHp",6)));
    structure["maxHp"]=Json::object();for(const auto& n:nodes){structure["hp"][n.first]=n.second;structure["maxHp"][n.first]=n.second;}
    const bool adult=boolean(args,"adult",true);const double max_cp=number(cal,"maxCp",0);
    const double initial_cp=number(cal,"initialFraction",.7)*max_cp;
    const std::string region=string(args,"regionId");
    Json e={{"id",id},{"speciesId",species_id},{"assetId",species_id},{"bodyProfile",profile},{"bodySize",body.value("lengthWidthHeightM",Json::array({1,1,1}))},
        {"entityType",string(s,"entityType","organic")},{"civilization",boolean(s,"civilization")},{"tier",tier},{"x",p.x},{"y",p.y},{"z",p.z},
        {"yaw",fraction(id+":yaw")*6.283185307179586},{"home",{{"x",p.x},{"y",p.y},{"z",p.z}}},{"regionId",region.empty()?Json(nullptr):Json(region)},
        {"dungeonId",args.value("dungeonId",Json(nullptr))},{"roomId",args.value("roomId",Json(nullptr))},{"communityId",args.value("communityId",Json(nullptr))},
        {"maxHp",maxhp},{"hp",maxhp},{"calories",max_cp>0?Json(number(args,"calories",adult?initial_cp:number(cal,"newbornCalorieFraction",.3)*max_cp)):Json(nullptr)},
        {"reserveEu",reserve.is_object()?Json(number(reserve,"capacityEu",0)*number(reserve,"initialFraction",.5)):Json(nullptr)},
        {"age",adult?number(s.value("population",Json::object()),"maturityS",0):0},{"dead",false},{"lastUpdatedAt",time_},{"state","idle"},{"targetId",nullptr},{"targetPoint",nullptr},
        {"lastHitAt",-1e9},{"lastSeenAt",0},{"angerUntil",0},{"starvingSeconds",0},{"foodShortageSeconds",0},{"rest",false},{"cooldownUntil",0},{"attack",nullptr},
        {"warningUntil",0},{"breedAt",time_+number(s.value("population",Json::object()),"breedingCooldownS",0)},{"nextDecisionAt",time_},{"nextWanderAt",time_},
        {"wanderSerial",0},{"repairProgress",0},{"repairSerial",0},{"interactionSerial",0},{"slowUntil",0},{"verticalVelocity",0},{"locomotion","ground"},{"grounded",true},
        {"structure",structure},{"inventory",args.value("inventory",Json::object())},{"pose",{{"phase",0},{"speedFactor",1},{"limbSupport",Json::array()},{"missingParts",Json::array()},{"moving",false},{"parts",Json::object()}}},
        {"parts",Json::object()},{"massKg",number(body,"massKg",1)},{"fragmentMass",nullptr},{"fragmentCuts",Json::array()},{"fragmentSerial",0},
        {"damageReceipts",Json::object()},{"wounds",Json::object()},{"woundRevision",0}};
    if(s.contains("inventory"))e["inventory"]=s["inventory"];
    if(args.contains("dungeonId"))e["dungeonId"]=args["dungeonId"];
    if(args.contains("roomId"))e["roomId"]=args["roomId"];
    refresh_creature_structure_pose(e,s,content_);creatures_[id]=std::move(e);
    return Json{{"ok",true},{"entityId",id},{"speciesId",species_id},{"tier",tier}};
}

Json Simulation::damage_creature(const Json& args,Gameplay& gameplay){
    const std::string id=string(args,"id",string(args,"entityId"));auto it=creatures_.find(id);if(it==creatures_.end()||boolean(it->second,"dead"))return fail("no_live_target");
    Json& e=it->second;const Json& s=entry(string(e,"speciesId"));const double amount=number(args,"amount",number(args,"damage",0));if(!std::isfinite(amount)||amount<0)return fail("invalid_damage");
    const std::string attack_id=string(args,"attackId");if(!attack_id.empty()&&e.value("damageReceipts",Json::object()).contains(attack_id)){Json r=e["damageReceipts"][attack_id];r["duplicate"]=true;return r;}
    if(amount<=EPS)return fail("no_live_target");
    const std::string mode=string(args,"mode",string(args,"attackMode","strike"));if(mode!="strike"&&mode!="slash"&&mode!="pierce"&&mode!="impact")return fail("unknown_attack_mode");
    const std::string visual_part=string(args,"partId",string(args,"visualPartId","body"));
    const std::string profile=string(e,"bodyProfile","quadruped");
    const std::string target_logical=visual_part=="body"?std::string():creature_logical_part(profile,visual_part);
    if(visual_part!="body"&&target_logical.empty())return fail("unknown_part");
    const std::string shape=mode=="impact"?"impact":mode=="pierce"?"pierce":string(args,"hitShape",mode=="slash"?"slash":"point");
    if(shape!="point"&&shape!="slash"&&shape!="pierce"&&shape!="impact")return fail("unknown_hit_shape");
    const Json body=s.value("body",Json::object());const double shell_max=std::max(1.0,number(body,"shellPatchHp",1));
    const Json structure=e.value("structure",Json::object());Json hp=structure.value("hp",Json::object());
    Vec3 local{};const Vec3 world_hit=point(args.value("point",Json::object()),{number(e,"x"),number(e,"y")+.5,number(e,"z")});
    Vec3 direction=args.contains("direction")?point(args["direction"]):args.contains("rayOrigin")?(world_hit-point(args["rayOrigin"])):Vec3{0,0,1};
    if(args.contains("localPoint"))local=point(args["localPoint"]);
    else{const double yaw=number(e,"yaw",0);const Vec3 d=world_hit-Vec3{number(e,"x"),number(e,"y"),number(e,"z")};
        local={std::cos(yaw)*d.x-std::sin(yaw)*d.z,d.y,std::sin(yaw)*d.x+std::cos(yaw)*d.z};
        if(visual_part!="body")local=local-part_translation(content_.asset(string(e,"assetId")),visual_part);}
    Vec3 local_direction=args.contains("localDirection")?point(args["localDirection"]):direction;
    if(!args.contains("localDirection")){const double yaw=number(e,"yaw",0);local_direction={std::cos(yaw)*direction.x-std::sin(yaw)*direction.z,direction.y,std::sin(yaw)*direction.x+std::cos(yaw)*direction.z};}
    if(local_direction.length_squared()<EPS)local_direction={0,0,1};
    const std::array<double,3> dv={local_direction.x,local_direction.y,local_direction.z};int axis=0;for(int i=1;i<3;i++)if(std::abs(dv[i])>std::abs(dv[axis]))axis=i;
    const double sign=dv[axis]<0?-1:1,grid=1.0/32;
    auto even=[&](double v){return std::max(2*grid,std::round(v/(2*grid))*2*grid);};
    Json cuts=args.value("cuts",Json::array());if(args.contains("cut"))cuts.push_back(args["cut"]);
    if(shape!="impact"&&cuts.empty()){
        Vec3 size{2*grid,2*grid,2*grid};
        if(shape=="pierce")set_axis(size,axis,even(clampd(.3+amount*.006,.3,.6)));
        else if(shape=="slash"){
            const int across=axis==1?(std::abs(local_direction.x)>std::abs(local_direction.z)?2:0):axis==0?2:0,third=3-axis-across;
            set_axis(size,axis,even(clampd(.0625+amount*.002,.0625,.125)));
            set_axis(size,across,even(clampd(.25+amount*.006,.25,.4)));set_axis(size,third,amount>=20?4*grid:2*grid);
        }else{const double width=even(clampd(.125+amount*.006,.125,.3125)),depth=even(clampd(.0625+amount*.002,.0625,.125));size={width,width,width};set_axis(size,axis,depth);}
        Vec3 center=local;if(axis==0)center.x+=sign*size.x/2;else if(axis==1)center.y+=sign*size.y/2;else center.z+=sign*size.z/2;
        center={std::round(center.x/grid)*grid,std::round(center.y/grid)*grid,std::round(center.z/grid)*grid};cuts.push_back(Json::array({center.x,center.y,center.z,size.x,size.y,size.z}));
    }
    if(shape!="impact")for(const auto& cut:cuts){if(!cut.is_array()||cut.size()!=6)return fail("invalid_wound_cut");for(const auto& n:cut)if(!n.is_number()||!std::isfinite(n.get<double>()))return fail("invalid_wound_cut");for(int i=3;i<6;i++)if(cut[i].get<double>()<=0||cut[i].get<double>()>.5)return fail("invalid_wound_cut");}
    auto target_bones=[&]()->Json{
        if(target_logical.empty()||visual_part=="body")return Json::array();
        const std::string key=string(e,"assetId",string(e,"speciesId"))+":"+visual_part+":"+target_logical;
        auto found=bone_geometry_cache_.find(key);return found==bone_geometry_cache_.end()?Json::array():found->second;
    };
    auto cut_reaches_bone=[&](const Json& cut)->bool{
        if(!cut.is_array()||cut.size()!=6)return false;const Vec3 cc{cut[0],cut[1],cut[2]},cs{cut[3],cut[4],cut[5]};
        for(const auto& bone:target_bones()){const Vec3 bc=point(bone.value("center",Json::array({0,0,0}))),bs=point(bone.value("size",Json::array({0,0,0})));
            if(std::abs(cc.x-bc.x)<(cs.x+bs.x)/2&&std::abs(cc.y-bc.y)<(cs.y+bs.y)/2&&std::abs(cc.z-bc.z)<(cs.z+bs.z)/2)return true;}
        return false;
    };
    auto trace_target_bone=[&](double reach)->std::string{
        if(reach<=0)return{};const Vec3 d=local_direction.normalized(),end=local+d*reach;double best=std::numeric_limits<double>::infinity();std::string result;
        for(const auto& bone:target_bones()){const Vec3 c=point(bone.value("center",Json::array({0,0,0}))),s=point(bone.value("size",Json::array({0,0,0})));
            double enter=0,exit=1;bool valid=true;for(int i=0;i<3;i++){const double a=i==0?local.x:i==1?local.y:local.z,b=i==0?end.x:i==1?end.y:end.z,mid=i==0?c.x:i==1?c.y:c.z,extent=i==0?s.x:i==1?s.y:s.z,delta=b-a,lo=mid-extent/2,hi=mid+extent/2;
                if(std::abs(delta)<1e-10){if(a<lo||a>hi){valid=false;break;}continue;}const double t0=(lo-a)/delta,t1=(hi-a)/delta;enter=std::max(enter,std::min(t0,t1));exit=std::min(exit,std::max(t0,t1));if(exit<=enter+1e-9){valid=false;break;}}
            if(valid&&enter<=1&&enter*reach<best){best=enter*reach;result=visual_part;}}
        return result.empty()?std::string():target_logical;
    };
    Json structural=args.value("structuralHits",Json::array());if(!structural.is_array()||structural.size()>64)return fail("invalid_structural_hits");
    if(!args.contains("structuralHits")){
        if(string(args,"layer")=="bone"&&!target_logical.empty())structural.push_back(Json{{"partId",target_logical},{"amount",amount}});
        else if(shape=="impact"){const std::string bone=trace_target_bone(.5);if(!bone.empty())structural.push_back(Json{{"partId",bone},{"amount",amount}});}
        else if(shape=="pierce"){
            const double reach=cuts.empty()||!cuts.front().is_array()||cuts.front().size()!=6?0:std::max({cuts.front()[3].get<double>(),cuts.front()[4].get<double>(),cuts.front()[5].get<double>()});
            const std::string bone=trace_target_bone(reach);if(!bone.empty()){structural.push_back(Json{{"partId","shell"},{"amount",amount*.3}});structural.push_back(Json{{"partId",bone},{"amount",amount*.7}});}
            else structural.push_back(Json{{"partId","shell"},{"amount",amount}});
        }else if(!cuts.empty()&&cut_reaches_bone(cuts.front())){
            structural.push_back(Json{{"partId","shell"},{"amount",amount*.5}});if(!target_logical.empty())structural.push_back(Json{{"partId",target_logical},{"amount",amount*.5}});
        }else structural.push_back(Json{{"partId","shell"},{"amount",amount}});
    }
    double allocated=0;
    for(const auto& hit:structural){
        const double a=number(hit,"amount");const std::string part=string(hit,"partId",string(hit,"visualPartId"));
        if(a<0||!std::isfinite(a)||part.empty())return fail("invalid_structural_hits");
        if(!hp.contains(part)&&!hp.contains(creature_logical_part(profile,part)))return fail("unknown_structural_part");
        allocated+=a;
    }
    if(allocated>amount+1e-6)return fail("attack_budget_exceeded");
    const double shell_hp=number(hp, "shell", shell_max);const double armor=clampd(number(s.value("stats",Json::object()),"damageReduction",0),0,1)*clampd(shell_hp/shell_max,0,1);
    const double effective=amount*(1-armor);const double before=number(e,"hp",0);e["hp"]=std::max(0.0,before-effective);
    e["lastHitAt"]=time_;e["rest"]=false;e["repairProgress"]=0;e["angerUntil"]=time_+20;
    if(args.contains("sourceId")){e["targetId"]=args["sourceId"];e["lastSeenAt"]=time_;}
    Json structural_damage=Json::array();
    bool structure_changed=false;
    for(const auto& hit:structural){const std::string raw=string(hit,"partId",string(hit,"visualPartId")),part=hp.contains(raw)?raw:creature_logical_part(profile,raw);const double a=number(hit,"amount",0)*(1-armor);
        if(part.empty()||!hp.contains(part)||a<=EPS)continue;const double old=number(hp,part,0),next=std::max(0.0,old-a);if(old<=next)continue;hp[part]=next;structure_changed=true;
        const double max_node=number(structure.value("maxHp",Json::object()),part.c_str(),part=="shell"?shell_max:number(body,part=="limb_0"?"limbNodeHp":"coreHp",10)*std::pow(1.35,integer(e,"tier",2)-integer(s,"baselineTier",2)));
        const bool detached=part!="core"&&part!="spine"&&next<=EPS;e["parts"][part]={{"hp",next},{"maxHp",max_node},{"broken",next<=EPS},{"detached",detached}};
        structural_damage.push_back(Json{{"partId",part},{"damage",old-next},{"broken",next<=EPS}});
    }
    e["structure"]["hp"]=hp;if(structure_changed)e["structure"]["revision"]=integer(e["structure"],"revision",0)+1;
    // Cut geometry is authored-part-local and the exact remaining boxes are
    // produced for renderer and collision from the same saved cut ledger.
    if(shape!="impact"){
        Json& wound_list=e["wounds"][visual_part];if(!wound_list.is_array())wound_list=Json::array();
        for(const auto& raw:cuts){if(!raw.is_array()||raw.size()!=6||wound_list.size()>=96)continue;bool duplicate=false;for(const auto& old:wound_list)if(old==raw){duplicate=true;break;}if(!duplicate){wound_list.push_back(raw);e["woundRevision"]=integer(e,"woundRevision",0)+1;}}
    }
    if(number(e,"hp",0)<=EPS){
        e["hp"]=0;e["dead"]=true;e["deathAt"]=time_;e["state"]="dead";e["attack"]=nullptr;e["targetId"]=nullptr;
        const std::string corpse_id="corpse:"+id;Json drops=Json::object();
        if(boolean(e,"civilization"))drops=e.value("inventory",Json::object());
        else if(has_array(s,"drops"))for(const auto& d:s["drops"]){const std::string item=string(d,"itemId");if(item.empty())continue;const int lo=integer(d,"min",0),hi=integer(d,"max",lo);drops[item]=deterministic_int(seed_+corpse_id+":"+item,lo,hi);}
        const double edible=number(s.value("ecology",Json::object()),"carcassEdibleCp",0);
        Json corpse={{"id",corpse_id},{"entityId",id},{"speciesId",string(e,"speciesId")},{"regionId",e.value("regionId",Json(nullptr))},{"x",number(e,"x")},{"y",number(e,"y")},{"z",number(e,"z")},{"edibleCp",edible},{"initialEdibleCp",edible},{"drops",drops},{"claimed",false},{"diedAt",time_},{"reason","hp_depleted"}};
        corpses_[corpse_id]=corpse;e["corpseId"]=corpse_id;
        if(!string(e,"regionId").empty()&&regions_.count(string(e,"regionId")))append_array(regions_[string(e,"regionId")],"corpseIds",corpse_id);
        emit_event(gameplay,Json{{"type","creature_killed"},{"id",id},{"ownerId",id},{"speciesId",string(e,"speciesId")},{"regionId",e.value("regionId",Json(nullptr))},{"position",{{"x",number(e,"x")},{"y",number(e,"y")},{"z",number(e,"z")}}},{"claimId",corpse_id+":kill"}});
    }
    refresh_creature_structure_pose(e,s,content_);
    Json result={{"ok",true},{"hpLost",before-number(e,"hp",0)},{"effectiveAmount",effective},{"armorReduction",armor},{"structuralDamage",structural_damage},{"attackMode",mode},{"energyEU",args.value("energyEU",Json(nullptr))},{"dead",boolean(e,"dead")},{"partId",visual_part},{"corpseId",boolean(e,"dead")?Json("corpse:"+id):Json(nullptr)}};
    if(!attack_id.empty())e["damageReceipts"][attack_id]=result;
    return result;
}

void Simulation::step_ecology(double dt){
    for(auto& [id,r]:regions_){
        const double elapsed=std::max(dt,time_-number(r,"lastUpdatedAt",time_-dt));
        if(elapsed+EPS<60)continue;
        r["lastUpdatedAt"]=time_;
        if(has_array(r,"foodNodes"))for(auto& n:r["foodNodes"]){
            if(!boolean(n,"enabled",true)||(boolean(n,"requiresLight")&&boolean(n,"lightAvailable",true)==false)||(boolean(n,"requiresMana")&&boolean(n,"manaAvailable",true)==false))continue;
            const double cp=number(n,"cp"),cap=number(n,"maxCp"),growth=std::min(std::max(0.0,cap-cp),number(n,"regenCpPerS")*elapsed);n["cp"]=cp+growth;
        }
        for(auto& [cid,c]:corpses_){if(c.value("regionId",Json()).is_string()&&string(c,"regionId")==id&&!boolean(c,"claimed")){
            const double edible=number(c,"edibleCp"),amount=std::min(edible,number(c,"initialEdibleCp")/3600.0*elapsed);c["edibleCp"]=edible-amount;r["detritusCp"]=number(r,"detritusCp")+amount;
        }}
        // Reproduction uses persistent parents and a per-species cap; revisiting a
        // region never respawns its initial group or resets a depleted resource.
        if(time_+EPS>=number(r,"nextBirthAt",time_+60)){
            r["nextBirthAt"]=time_+60;
            std::map<std::string,std::vector<std::string>> by_species;
            for(const auto& [eid,e]:creatures_)if(!boolean(e,"dead")&&string(e,"regionId")==id)by_species[string(e,"speciesId")].push_back(eid);
            for(auto& [species,parents]:by_species){
                const auto& cap=r.value("speciesCaps",Json::object());const int limit=integer(cap,species.c_str(),0);if(limit<=0||int(parents.size())>=limit||parents.size()<2)continue;
                const Json& s=entry(species);const Json pop=s.value("population",Json::object()),cal=s.value("calories",Json::object());
                if(boolean(s,"civilization")||number(pop,"breedingCooldownS",999999)<=0)continue;
                const double threshold=number(cal,"maxCp")*number(pop,"reproductionCalorieFraction",.8);
                Json& a=creatures_[parents[0]],&b=creatures_[parents[1]];
                if(number(a,"calories")<threshold||number(b,"calories")<threshold||number(a,"breedAt")>time_||number(b,"breedAt")>time_)continue;
                a["breedAt"]=time_+number(pop,"breedingCooldownS",120);b["breedAt"]=a["breedAt"];
                Vec3 pos{(number(a,"x")+number(b,"x"))*.5,number(a,"y"),(number(a,"z")+number(b,"z"))*.5};
                // Newborns wait for the next activation; their authored population
                // contract controls calorie fraction and maturity.
                Json newborn={{"speciesId",species},{"position",Json::array({pos.x,number(a,"y"),pos.z})},{"tier",integer(a,"tier",2)},{"regionId",id},{"adult",false},{"id",id+":birth:"+std::to_string(integer(r,"births",0))}};
                append_array(r,"pendingBirths",newborn);r["births"]=integer(r,"births",0)+1;break;
            }
        }
    }
}

void Simulation::step_creatures(double dt,Vec3 player,World& world,Gameplay& gameplay){
    // Pending births are materialized against the real terrain surface only
    // after the deterministic ecology predicate has recorded them.
    for(auto& [rid,region]:regions_)if(has_array(region,"pendingBirths")){
        const Json births=region["pendingBirths"];region["pendingBirths"]=Json::array();
        for(const auto& birth:births){Json b=birth;Vec3 p=point(b.value("position",Json::array({0,0,0})));p.y=surface(world,p.x,p.z);b["position"]=Json::array({p.x,p.y,p.z});spawn_creature(b,world);}
    }
    const double player_hp=number(player_state_,"hp",100);const bool player_alive=player_hp>0;
    const Json food_contract=content_.data.value("creatures",Json::object()).value("contracts",Json::object());
    const double edible_per_unit=number(food_contract,"edibleBiomassCpPerUnit",100);
    std::vector<std::string> ids;ids.reserve(creatures_.size());for(const auto& kv:creatures_)ids.push_back(kv.first);
    for(const auto& id:ids){
        auto it=creatures_.find(id);if(it==creatures_.end())continue;Json& e=it->second;if(boolean(e,"dead"))continue;
        const std::string species_id=string(e,"speciesId"),region_id=string(e,"regionId");const Json& s=entry(species_id);if(s.empty())continue;
        const Json stats=s.value("stats",Json::object()),behavior=s.value("behavior",Json::object()),cal=s.value("calories",Json::object()),pop=s.value("population",Json::object());
        Vec3 pos{number(e,"x"),number(e,"y"),number(e,"z")};const double dplayer=distance_xz(pos,player);const bool active=dplayer<=96;
        double last=number(e,"lastUpdatedAt",time_-dt),elapsed=std::max(dt,time_-last);
        if(!active){if(elapsed<60-EPS)continue;}
        else {int every=dplayer<32?1:dplayer<64?2:4;if(elapsed+EPS<AI_STEP*every)continue;elapsed=std::min(elapsed,AI_STEP*every);}
        e["lastUpdatedAt"]=time_;e["age"]=number(e,"age")+elapsed;
        const double max_cp=number(cal,"maxCp"),old_cp=number(e,"calories",max_cp);
        if(max_cp>0){
            const std::string state=string(e,"state");const double drain=(number(cal,"basalCpPerS")+((state=="chase"||state=="flee")?number(cal,"sprintExtraCpPerS"):0))*elapsed;
        const double cp=std::max(0.0,old_cp-drain);e["calories"]=cp;
            const double starve=cp<=0?number(e,"starvingSeconds")+elapsed:0;e["starvingSeconds"]=starve;
            if(starve>=number(cal,"starvationDelayS",120)){e["hp"]=std::max(0.0,number(e,"hp")-number(cal,"starvationDamageHpPerS")*elapsed);if(number(e,"hp")<=EPS){e["hp"]=0;damage_creature(Json{{"id",id},{"amount",1e-6},{"mode","impact"}},gameplay);continue;}}
            const bool rest=boolean(e,"rest")&&!e.contains("targetId")&&e.value("attack",Json()).is_null()&&time_-number(e,"lastHitAt")>=AI_STEP;
            if(number(e,"hp")<number(e,"maxHp")&&(time_-number(e,"lastHitAt")>=number(cal,"regenDelayS",10)||rest)){
                const double heal=std::max(0.0,std::min({number(e,"maxHp")-number(e,"hp"),number(cal,"regenHpPerS")*elapsed*(rest?number(cal,"restMultiplier",1):1),(cp-number(cal,"maxCp")*number(cal,"minimumReserveFraction",.1))/std::max(EPS,number(cal,"regenCpPerHp",1))}));
                e["hp"]=number(e,"hp")+heal;e["calories"]=std::max(0.0,number(e,"calories")-heal*number(cal,"regenCpPerHp",1));
            }
        }
        Json target=e.value("targetId",Json());const bool target_player=target.is_string()&&target.get<std::string>()=="player";
        std::string target_id=target.is_string()?target.get<std::string>():std::string();
        auto target_creature=creatures_.find(target_id);Vec3 target_pos=player;
        bool has_target=target_player&&player_alive;
        if(!target_player&&!target_id.empty()&&target_creature!=creatures_.end()&&!boolean(target_creature->second,"dead")){target_pos={number(target_creature->second,"x"),number(target_creature->second,"y"),number(target_creature->second,"z")};has_target=true;}
        if(!active){
            e["state"]="idle";e["targetId"]=nullptr;e["targetPoint"]=nullptr;e["attack"]=nullptr;e["pose"]["moving"]=false;continue;
        }
        bool can_attack=has_array(s,"attacks")&&s["attacks"].size()>0&&number(e,"age")>=number(pop,"maturityS",0);
        const double detect=number(stats,"detectionM",10),home_dist=distance_xz(pos,point(e.value("home",Json::object())));
        if(!has_target||distance_xz(pos,target_pos)>std::max(detect,number(stats,"chaseFromHomeM",24))||time_-number(e,"lastSeenAt")>number(stats,"loseSightS",6)){
            e["targetId"]=nullptr;has_target=false;
        }
        if(has_target&&target_player&&time_>number(e,"angerUntil")&&string(behavior,"disposition")=="avoidant")has_target=false;
        if(!has_target&&can_attack&&player_alive&&dplayer<detect){
            const std::string disp=string(behavior,"disposition","avoidant");const bool hostile=number(e,"angerUntil")>time_||disp=="territorial"||disp=="aggressive"||(string(e,"entityType")=="inorganic"&&!boolean(e,"civilization")&&dplayer<8);
            if(hostile){e["targetId"]="player";e["lastSeenAt"]=time_;has_target=true;target_id="player";target_pos=player;}
        }
        if(!has_target&&!boolean(e,"rest")&&string(behavior,"disposition")=="avoidant"&&number(e,"angerUntil")>time_&&dplayer<detect){
            const double dx=pos.x-player.x,dz=pos.z-player.z,l=std::max(.001,std::hypot(dx,dz));e["state"]="flee";e["targetPoint"]={{"x",pos.x+dx/l*6},{"z",pos.z+dz/l*6}};
        }
        // Predators choose existing prey from their authored diet; no creature is
        // created or killed by proximity alone.
        if(!has_target&&!boolean(s,"civilization")&&string(s,"role")=="predator"&&max_cp>0&&number(e,"calories")<max_cp*number(behavior,"huntBelowCalorieFraction",.55)&&has_array(s.value("ecology",Json::object()),"diet")){
            std::set<std::string> prey_ids;for(const auto& diet:s["ecology"]["diet"])if(string(diet,"kind")=="species")prey_ids.insert(string(diet,"id"));
            double best=detect+1;for(const auto& [other_id,o]:creatures_)if(other_id!=id&&!boolean(o,"dead")&&prey_ids.count(string(o,"speciesId"))){Vec3 op{number(o,"x"),number(o,"y"),number(o,"z")};double d=distance_xz(pos,op);if(d<best){best=d;target_id=other_id;target_pos=op;has_target=true;}}
            if(has_target){e["targetId"]=target_id;e["state"]="chase";}
        }
        Json target_point=e.value("targetPoint",Json());
        if(!has_target&&home_dist>number(stats,"chaseFromHomeM",24)){target_point=e.value("home",Json::object());e["state"]="return";}
        if(!has_target&&target_point.is_null()&&number(e,"nextWanderAt")<=time_){
            const int serial=integer(e,"wanderSerial");const double angle=fraction(id+":wander:"+std::to_string(serial))*6.283185307179586;e["wanderSerial"]=serial+1;
            Vec3 home=point(e.value("home",Json::object()));target_point={{"x",home.x+std::sin(angle)*4},{"z",home.z+std::cos(angle)*4}};e["nextWanderAt"]=time_+8;e["state"]="wander";
        }
        if(!has_target&&!target_point.is_null()&&string(e,"state")!="flee"&&string(e,"state")!="return")e["state"]="wander";
        if(has_target){
            e["lastSeenAt"]=time_;e["state"]="chase";const Json attacks=s.value("attacks",Json::array());
            if(e.contains("attack")&&!e["attack"].is_null()){
                Json& a=e["attack"];const std::string attack_id=string(a,"attackId");const Json* attack=nullptr;for(const auto& x:attacks)if(string(x,"id")==attack_id){attack=&x;break;}
                if(!boolean(a,"hitDone")&&time_+EPS>=number(a,"hitAt")){
                    a["hitDone"]=true;const double range=attack?number(*attack,"rangeM",1):1;const bool hit=distance_xz(pos,target_pos)<=range+.4;
                    if(hit&&target_player&&survival_){Json event={{"type","player_hit"},{"sourceId",id},{"amount",number(attack?*attack:Json::object(),"damageHp",0)*std::pow(1.2,integer(e,"tier",2)-integer(s,"baselineTier",2))},{"energyType",string(attack?*attack:Json::object(),"energyType","mechanical")},{"position",vec_json(pos)},{"status",species_id=="root_weaver"?Json{{"type","slow"},{"seconds",2},{"multiplier",.7}}:Json(nullptr)}};apply_player_hit(gameplay,std::move(event));}
                    else if(hit&&!target_player)damage_creature(Json{{"id",target_id},{"amount",number(attack?*attack:Json::object(),"damageHp",0)},{"sourceId",id},{"partId","body"}},gameplay);
                }
                if(time_+EPS>=number(a,"endAt")){e["attack"]=nullptr;e["nextDecisionAt"]=time_;}
            }else if(attacks.is_array()&&!attacks.empty()){
                const Json& a=attacks[0];const double distance=distance_xz(pos,target_pos);
                if(distance<=number(a,"rangeM",1)&&time_>=number(e,"warningUntil")&&time_>=number(e,"cooldownUntil")){
                    e["yaw"]=std::atan2(target_pos.x-pos.x,target_pos.z-pos.z);const double wind=number(a,"windupS",.5),tier_scale=std::pow(1.2,integer(e,"tier",2)-integer(s,"baselineTier",2));
                    e["attack"]={{"attackId",string(a,"id")},{"targetId",target_id},{"hitAt",time_+wind},{"endAt",time_+wind+number(a,"recoveryS",.5)},{"hitDone",false},{"aim",vec_json(target_pos)},{"origin",vec_json(pos)}};
                    e["cooldownUntil"]=time_+number(a,"cooldownS",2);e["pose"]["moving"]=false;
                    queue_event(Json{{"type","attack_telegraph"},{"entityId",id},{"attackId",string(a,"id")},{"text",string(a,"telegraph")},{"duration",wind},{"aim",vec_json(target_pos)},{"damage",number(a,"damageHp")*tier_scale}});
                }else if(distance>std::min(number(a,"rangeM")*.75,1.5))target_point=vec_json(target_pos);
            }
        }
        if(!has_target&&string(e,"state")=="forage"&&distance_xz(pos,point(target_point))<2&&regions_.count(region_id)){
            Json& r=regions_[region_id];double need=std::min(max_cp-number(e,"calories"),max_cp/20*elapsed);if(need>0&&has_array(r,"foodNodes")){
                double got=0;for(auto& n:r["foodNodes"]){if(distance_xz(pos,{number(n,"x"),0,number(n,"z")})<3&&number(n,"cp")>0){got=std::min(need,number(n,"cp"));n["cp"]=number(n,"cp")-got;break;}}
                e["calories"]=number(e,"calories")+got;
            }
        }
        if(!target_point.is_null()&&(!has_target||e.value("attack",Json()).is_null())){
            Vec3 dest=point(target_point);const double dx=dest.x-pos.x,dz=dest.z-pos.z,d=std::hypot(dx,dz);const double speed=string(e,"state")=="flee"?number(stats,"sprintMps",2):number(stats,"cruiseMps",1);
            const double move=std::min(d,speed*number(e.value("pose",Json::object()),"speedFactor",1)*elapsed);if(move>EPS){Vec3 next{pos.x+dx/d*move,pos.y,pos.z+dz/d*move};next.y=surface(world,next.x,next.z);const auto size=e.value("bodySize",Json::array({1,1,1}));const double h=size.is_array()&&size.size()>2?size[2].get<double>():1;
                if(!solid(world,{next.x,next.y+h*.5,next.z})&&std::abs(next.y-pos.y)<1.25){e["x"]=next.x;e["y"]=next.y;e["z"]=next.z;e["yaw"]=std::atan2(dx,dz);e["pose"]["moving"]=true;
                    e["pose"]["phase"]=number(e["pose"],"phase")+elapsed*speed*2.2;target_point=Json{{"x",dest.x},{"z",dest.z}};
                }else e["pose"]["moving"]=false;
            }else e["pose"]["moving"]=false;
            e["targetPoint"]=target_point;
        }else if(!has_target){e["pose"]["moving"]=false;}
    }
}

Json Simulation::spawn_boss(const Json& args){
    const std::string boss_id=string(args,"bossId",string(args,"definitionId"));const Json& def=entry(boss_id);if(def.empty())return fail("unknown_boss");
    const int tier=integer(args,"tier",integer(def,"baselineTier",1));const int base=integer(def,"baselineTier",tier);std::string variant=string(args,"contentVariantId");
    bool valid_tier=tier==base;
    const Json& catalog=content_.data.value("bosses",Json::object());if(has_array(catalog,"variants"))for(const auto& v:catalog["variants"])if(string(v,"id")==variant&&string(v,"baseBossId")==boss_id&&integer(v,"tier")==tier)valid_tier=true;
    if(tier<1||tier>10||!valid_tier)return fail("boss_tier_not_authored");
    Vec3 pos=args.contains("position")?point(args["position"]):Vec3{};const std::string instance_id=string(args,"instanceId");std::string id=string(args,"id",instance_id.empty()?make_id("boss"):"boss:"+instance_id+":"+boss_id);
    if(bosses_.count(id))return Json{{"ok",true},{"bossId",id},{"duplicate",true}};
    const Json stats=def.value("stats",Json::object()),parts=def.value("parts",Json::array()),phases=def.value("phases",Json::array()),arena=def.value("arena",Json::object());
    const double maxhp=number(stats,"maxHp",100);Vec3 origin=args.contains("arenaOrigin")?point(args["arenaOrigin"]):pos;
    Json part_state=Json::object();for(const auto& p:parts){const std::string pid=string(p,"id");if(!pid.empty())part_state[pid]=Json{{"damage",0},{"broken",false}};}
    Json energy=Json::object();if(has_array(def,"energyReserves"))for(const auto& reserve:def["energyReserves"])energy[string(reserve,"energyType")]=Json{{"amount",number(reserve,"initialEU")},{"charges",number(reserve,"sourceCharges")}};
    Json gimmicks=Json::object();if(has_array(arena,"gimmicks"))for(const auto& g:arena["gimmicks"])gimmicks[string(g,"id")]=Json{{"hp",number(arena,"gimmickBreakHp",100)},{"uses",integer(arena,"gimmickUsesEach",1)},{"broken",false}};
    Json shell={{"body",maxhp*.35},{"core",maxhp*.06},{"locomotion",maxhp*.09}};
    Json e={{"id",id},{"bossId",boss_id},{"tier",tier},{"encounterTier",tier},{"contentVariantId",variant.empty()?Json(nullptr):Json(variant)},{"instanceId",instance_id.empty()?id:instance_id},
        {"position",vec_json(pos)},{"home",vec_json(pos)},{"arenaOrigin",vec_json(origin)},{"hp",maxhp},{"maxHp",maxhp},{"phaseIndex",0},{"phaseId",phases.is_array()&&!phases.empty()?string(phases[0],"id"):"phase_0"},{"phaseTimer",0},{"age",0},
        {"sequenceIndex",0},{"completedAttacks",0},{"cooldowns",Json::object()},{"gap",1},{"facing",Json::array({0,0,1})},{"engaged",false},{"disengageS",0},{"lastHitAge",-1000},
        {"parts",part_state},{"shell",shell},{"calories",string(def,"entityType")=="organic"?Json(number(def.value("lifeRecovery",Json::object()),"initialCalories")):Json(nullptr)},
        {"energy",energy},{"regenActions",0},{"regenRestored",0},{"repairActions",0},{"repairSupplies",number(def.value("lifeRecovery",Json::object()),"repairSupplies",0)},
        {"lastRepairAge",-1000},{"action",nullptr},{"cast",nullptr},{"castCounter",0},{"lastSkill",nullptr},{"repeatCount",0},{"exposedUntil",0},{"staggerS",0},{"threat",Json::array()},
        {"forcedSkill",nullptr},{"cancelNext",Json::array()},{"gimmicks",gimmicks},{"waterDrained",false},{"airborneS",0},{"groundedS",0},{"flightState","grounded"},{"orbitAngle",0},{"defeated",false},{"reward",nullptr}};
    if(!variant.empty()){e["variantSchemaVersion"]=1;e["variantState"]={{"sideSign",1},{"orbitSign",1},{"repairCursor",0},{"selectedRepairGimmickId",nullptr},{"pendingReposition",nullptr},{"lastRepositionCastId",nullptr},{"lastCompletedCast",nullptr}};}
    bosses_[id]=e;return Json{{"ok",true},{"bossId",id},{"definitionId",boss_id},{"tier",tier}};
}

Json Simulation::damage_boss(const Json& args,Gameplay& gameplay){
    const std::string id=string(args,"id",string(args,"bossId"));auto it=bosses_.find(id);if(it==bosses_.end()||boolean(it->second,"defeated"))return fail("no_live_boss");
    Json& e=it->second;const Json& def=entry(string(e,"bossId"));const double amount=number(args,"amount",number(args,"damage",0));if(!std::isfinite(amount)||amount<0)return fail("invalid_damage");
    const std::string attack_id=string(args,"attackId");if(!attack_id.empty()&&e.value("damageReceipts",Json::object()).contains(attack_id)){Json r=e["damageReceipts"][attack_id];r["duplicate"]=true;return r;}
    if(amount<=EPS)return fail("invalid_damage");
    const std::string energy_type=string(args,"energyType","mechanical");const Json multipliers=def.value("stats",Json::object()).value("energyDamageMultipliers",Json::object());if(!multipliers.contains(energy_type))return fail("unknown_energy_type");
    std::string part=string(args,"partId","body");if(part!="body"&&part!="core"&&part!="locomotion")part=part.find("core")!=std::string::npos?"core":part.find("locomotion")!=std::string::npos?"locomotion":"body";
    const Json phases=def.value("phases",Json::array());int phase_idx=std::clamp(integer(e,"phaseIndex",0),0,std::max(0,int(phases.size())-1));const Json phase_state=phases.is_array()&&!phases.empty()?phases[phase_idx].value("state",Json::object()):Json::object();
    const bool exposed=part=="core"&&(number(e,"exposedUntil")>number(e,"age")||string(phase_state.value("coreExposure",Json::object()),"mode")=="always");
    Json attacker=args.value("attackerPosition",Json::object());
    if(part=="core"&&!exposed&&string(phase_state.value("coreExposure",Json::object()),"mode")=="rear_arc"&&attacker.is_object()){
        Vec3 p=point(e.value("position",Json::object())),ap=point(attacker);Vec3 facing=point(e.value("facing",Json::array({0,0,1})));const double dot=((ap.x-p.x)*facing.x+(ap.z-p.z)*facing.z)/std::max(EPS,distance_xz(ap,p));
        if(dot<-std::cos(number(phase_state.value("coreExposure",Json::object()),"angleDeg",90)*3.141592653589793/360)){}
    }
    const double incoming=number(args,"energyEU",amount),shell=number(e.value("shell",Json::object()),part,0);double absorption=exposed||boolean(e.value("parts",Json::object()).value(part,Json::object()),"broken")?0:std::min(incoming,shell);
    if(string(e,"bossId")=="sanctuary_warden"&&part=="body"&&!attacker.is_null()&&phase_state.contains("shieldFrontCoverageDeg")){
        Vec3 p=point(e.value("position",Json::object())),ap=point(attacker),f=point(e.value("facing",Json::array({0,0,1})));double d=((ap.x-p.x)*f.x+(ap.z-p.z)*f.z)/std::max(EPS,distance_xz(ap,p));if(d<std::cos(number(phase_state,"shieldFrontCoverageDeg")*3.141592653589793/360))absorption=0;
    }
    e["shell"][part]=std::max(0.0,shell-absorption);
    const double response=number(multipliers,energy_type,1),part_mult=exposed?([&](){for(const auto& p:def.value("parts",Json::array()))if(string(p,"id")==part)return number(p,"damageMultiplier",1);return 1.0;})():1.0;
    const double before=number(e,"hp"),damage=std::min(before,amount*response*part_mult);e["hp"]=before-damage;e["lastHitAge"]=number(e,"age");if(e.contains("cast")&&!e["cast"].is_null())e["cast"]=nullptr;
    if(has_array(def,"parts"))for(const auto& p:def["parts"]){const std::string pid=string(p,"id");if(pid!=part)continue;Json& ps=e["parts"][pid];ps["damage"]=number(ps,"damage")+damage;const double threshold=number(p,"breakThresholdHp");if(!boolean(ps,"broken")&&number(ps,"damage")>=threshold){ps["broken"]=true;e["staggerS"]=std::max(number(e,"staggerS"),number(p,"staggerS",0));}}
    if(e["hp"].get<double>()<=EPS){
        e["hp"]=0;e["defeated"]=true;e["cast"]=nullptr;e["action"]=nullptr;e["engaged"]=false;
        const std::string pool=string(def.value("persistence",Json::object()),"rewardRef");e["reward"]={{"key",string(e,"instanceId")+":"+string(e,"bossId")+":first_defeat"},{"poolId",pool},{"claimed",false}};
        emit_event(gameplay,Json{{"type","boss_defeated"},{"id",id},{"ownerId",id},{"bossId",string(e,"bossId")},{"tier",integer(e,"tier")},{"position",e["position"]},{"claimId",string(e["reward"],"key")}});
    }else if(phases.is_array()&&!phases.empty()){
        int idx=integer(e,"phaseIndex");while(idx+1<int(phases.size())&&number(e,"hp")/number(e,"maxHp")<=number(phases[idx],"hpFractionLowerExclusive",0))idx++;
        if(idx!=integer(e,"phaseIndex")){e["phaseIndex"]=idx;e["phaseId"]=string(phases[idx],"id");e["phaseTimer"]=number(phases[idx].value("onEnter",Json::object()),"durationS");e["cast"]=nullptr;e["action"]=nullptr;e["sequenceIndex"]=0;}
    }
    Json result={{"ok",true},{"damage",damage},{"absorbedEU",absorption},{"partId",part},{"energyType",energy_type},{"hp",number(e,"hp")},{"defeated",boolean(e,"defeated")}};if(!attack_id.empty())e["damageReceipts"][attack_id]=result;return result;
}

Json Simulation::ensure_dungeon(const Json& args,World& world){
    const std::string template_id=string(args,"templateId",string(args,"structureId"));const Json& def=entry(template_id);if(def.empty()||string(def,"kind")!="dungeon")return fail("unknown_structure");
    const std::string site=string(args,"siteId",template_id);const std::string id="structure:"+seed_+":"+site+":"+template_id;if(dungeons_.count(id))return Json{{"ok",true},{"instanceId",id},{"duplicate",true}};
    Vec3 origin=args.contains("origin")?point(args["origin"]):Vec3{0,surface(world,0,0)+CELL_M,0};const int tier=std::clamp(integer(args,"tier",integer(def,"prototypeTier",2)),1,10);
    Json producers=Json::object();for(const auto& p:def.value("ecology",Json::object()).value("producers",Json::array()))producers[string(p,"id")]=Json{{"destroyed",false}};
    Json puzzle=nullptr;if(def.contains("puzzle")){puzzle={{"phase","locked"},{"elapsedS",0},{"durationS",0},{"paid",false}};}
    Json boss=nullptr;if(def.contains("bossArena"))boss={{"instanceId",id+":boss"},{"definitionId",string(def["bossArena"],"bossId")},{"tier",tier},{"defeated",false}};
    Json instance={{"id",id},{"templateId",template_id},{"variant",args.value("variant",Json(nullptr))},{"siteId",site},{"generatorVersion",1},{"origin",Json::array({origin.x,origin.y,origin.z})},{"tier",integer(def,"prototypeTier",tier)},{"regionTier",tier},
        {"visitedRooms",Json::array()},{"discovered",false},{"damage",Json::object()},{"claims",Json::object()},{"waterBreached",false},{"producerStates",producers},{"puzzle",puzzle},{"boss",boss},{"revision",0}};
    if(puzzle.is_object())instance["deviceState"]={{"version",1},{"phase","locked"},{"components",Json::object()},{"timers",Json::object()},{"claims",Json::object()}};
    dungeons_[id]=instance;
    if(boss.is_object()&&!string(boss,"definitionId").empty()){
        Vec3 boss_pos=origin;if(def["bossArena"].contains("bossSpawnM"))boss_pos+=point(def["bossArena"]["bossSpawnM"]);
        spawn_boss(Json{{"id",boss["instanceId"]},{"bossId",boss["definitionId"]},{"instanceId",id},{"position",vec_json(boss_pos)},{"arenaOrigin",vec_json(origin)},{"tier",integer(boss,"tier")}});
    }
    return Json{{"ok",true},{"instanceId",id},{"templateId",template_id},{"origin",vec_json(origin)},{"tier",tier}};
}

void Simulation::step_bosses(double dt,Vec3 player,World& world,Gameplay& gameplay){
    const Vec3 player_feet=player_state_.contains("position")?point(player_state_["position"],player):player;
    const double player_height=number(player_state_,"height",1.8),player_radius=number(player_state_,"radius",.35);
    const bool player_alive=number(player_state_,"hp",100)>0;
    for(auto& [id,e]:bosses_){
        if(boolean(e,"defeated"))continue;const Json& def=entry(string(e,"bossId"));if(def.empty())continue;
        Vec3 p=point(e.value("position",Json::object())),home=point(e.value("home",Json::object()));const double distance=distance_xz(p,player_feet);e["age"]=number(e,"age")+dt;
        if(distance>36){e["disengageS"]=number(e,"disengageS")+dt;if(number(e,"disengageS")>10){e["engaged"]=false;e["cast"]=nullptr;e["position"]=vec_json(home);}continue;}
        e["disengageS"]=0;e["engaged"]=player_alive;
        if(!player_alive)continue;
        const Json phases=def.value("phases",Json::array());if(phases.empty())continue;
        int phase_index=std::clamp(integer(e,"phaseIndex",0),0,int(phases.size())-1);const Json& phase=phases[phase_index];const Json phase_state=phase.value("state",Json::object());
        if(number(e,"phaseTimer")>0){e["phaseTimer"]=std::max(0.0,number(e,"phaseTimer")-dt);continue;}
        double stagger=number(e,"staggerS");if(stagger>0){e["staggerS"]=std::max(0.0,stagger-dt);continue;}
        if(e.contains("cast")&&!e["cast"].is_null()){
            Json& cast=e["cast"];const std::string stage=string(cast,"stage");double remaining=std::max(0.0,number(cast,"remaining")-dt);cast["remaining"]=remaining;
            if(stage=="windup"&&remaining<=EPS){cast["stage"]="active";const Json skill=cast.value("skill",Json::object());cast["remaining"]=number(skill,"activeS",.2);}
            else if(stage=="active"){
                if(!boolean(cast,"hitPlayer")&&shape_hits_player(cast.value("shape",Json::object()),player_feet,player_radius,player_height)){
                    cast["hitPlayer"]=true;const Json skill=cast.value("skill",Json::object());const Json damage=skill.value("damage",Json::object());Json event={{"type","player_hit"},{"sourceId",id},{"amount",number(damage,"baselinePlayerHpLost",number(damage,"neutralTargetHp",0))},{"energyType",string(skill,"energyType","mechanical")},{"position",vec_json(p)},{"skillId",string(skill,"id")},{"shape",cast["shape"]}};apply_player_hit(gameplay,std::move(event));
                }
                if(remaining<=EPS){cast["stage"]="recovery";const Json skill=cast.value("skill",Json::object());cast["remaining"]=number(skill,"recoveryS",1);}
            }else if(stage=="recovery"&&remaining<=EPS){e["cast"]=nullptr;e["gap"]=number(phase,"interCastGapS",1);}
            continue;
        }
        if(number(e,"gap")>0){e["gap"]=std::max(0.0,number(e,"gap")-dt);continue;}
        // Deterministic authored boss movement. Phase state controls speed and
        // authored instance motion stays bound to the same model hierarchy.
        const double move_speed=number(def.value("stats",Json::object()),"moveSpeedMps",1)*number(phase_state,"moveSpeedMultiplier",1);
        if(distance>number(def.value("skills",Json::array()).empty()?Json::object():def["skills"][0],"rangeM",6)){
            Vec3 d=player_feet-p;double len=std::max(.001,std::hypot(d.x,d.z)),step=std::min(len,move_speed*dt);Vec3 next{p.x+d.x/len*step,p.y,p.z+d.z/len*step};next.y=surface(world,next.x,next.z);if(!solid(world,next))e["position"]=vec_json(next);p=point(e["position"]);
        }
        // Pick the next available authored skill by the phase's ordered cycle,
        // energy reserve and cooldown. No attack is made while geometry cannot
        // see the target through terrain.
        const Json schedule=phase.value("schedule",Json::array());if(!schedule.is_array()||schedule.empty())continue;
        Json cooldowns=e.value("cooldowns",Json::object());for(auto it=cooldowns.begin();it!=cooldowns.end();++it)if(it.value().is_number())it.value()=std::max(0.0,it.value().get<double>()-dt);e["cooldowns"]=cooldowns;
        const Json defs=def.value("skills",Json::array());const int seq=integer(e,"sequenceIndex",0);const Json parts=e.value("parts",Json::object());const bool core_broken=boolean(parts.value("core",Json::object()),"broken");
        const Json reserve_state=e.value("energy",Json::object());
        for(size_t offset=0;offset<schedule.size();offset++){
            const int at=(seq+int(offset))%int(schedule.size());const std::string skill_id=schedule[at].is_string()?schedule[at].get<std::string>():std::string();const Json* skill=nullptr;for(const auto& sd:defs)if(string(sd,"id")==skill_id){skill=&sd;break;}if(!skill)continue;
            if(number(cooldowns,skill_id.c_str())>EPS)continue;const std::string energy_type=string(*skill,"energyType","mechanical");const double cost=number(skill->value("energyCost",Json::object()),"amount",0);if(number(reserve_state.value(energy_type,Json::object()),"amount")+EPS<cost)continue;
            if(distance>number(*skill,"rangeM",6))continue;
            Vec3 origin=p+Vec3{0,1,0},aim=player_feet+Vec3{0,player_height/2,0};const Vec3 ray=aim-origin;const double ray_len=ray.length();if(ray_len>EPS){Contact obstruction=world.raycast(origin,ray/ray_len,ray_len);if(obstruction.hit&&obstruction.distance<ray_len-.1)continue;}
            Json geometry=skill->value("geometry",Json::object());const std::string kind=string(geometry,"kind");Json shape=geometry;
            if(kind=="sphere"){shape["center"]=vec_json(aim);}
            else if(kind=="cylinder"){const double r=number(geometry,"radiusM",2),h=number(geometry,"heightM",1);Vec3 c{player_feet.x,surface(world,player_feet.x,player_feet.z)+h/2,player_feet.z};shape["center"]=vec_json(c);shape["bottomY"]=c.y-h/2;shape["radiusM"]=r;}
            else if(kind=="annular_cylinder"){const double h=number(geometry,"heightM",1);Vec3 c{p.x,number(e.value("arenaOrigin",Json::object()),"y")+h/2,p.z};shape["center"]=vec_json(c);shape["bottomY"]=c.y-h/2;}
            else if(geometry.contains("lengthM")){Vec3 forward{player_feet.x-p.x,0,player_feet.z-p.z};forward=forward.normalized();if(forward.length_squared()<EPS)forward={0,0,1};Vec3 right{forward.z,0,-forward.x},up{0,1,0};const double len=number(geometry,"lengthM",4),width=number(geometry,"widthM",1),height=number(geometry,"heightM",1);shape["center"]=vec_json(origin+forward*(len/2));shape["axes"]=Json::array({vec_json(right),vec_json(up),vec_json(forward)});shape["halfSize"]=Json::array({width/2,height/2,len/2});shape["direction"]=vec_json(forward);}
            if(kind=="cylinder"&&number(skill->value("geometry",Json::object()),"activeS",0)>1&&std::abs(number(shape.value("center",Json::object()),"z")-number(e.value("arenaOrigin",Json::object()),"z"))<3+number(shape,"radiusM"))continue;
            Vec3 forward{player_feet.x-p.x,0,player_feet.z-p.z};forward=forward.normalized();if(forward.length_squared()<EPS)forward={0,0,1};
            Json& mutable_energy=e["energy"][energy_type];mutable_energy["amount"]=std::max(0.0,number(mutable_energy,"amount")-cost);if(cooldowns.is_object())e["cooldowns"][skill_id]=number(*skill,"cooldownS",2);
            Json cast={{"id",id+":cast:"+std::to_string(integer(e,"castCounter")+1)},{"skillId",skill_id},{"skill",*skill},{"stage","windup"},{"remaining",number(*skill,"windupS",.5)+(core_broken?number(def.value("parts",Json::array()).empty()?Json::object():def["parts"][0],"extraWindupS",0):0)},
                {"origin",vec_json(origin)},{"aim",vec_json(aim)},{"targetOwnerId","player"},{"shape",shape},{"hitPlayer",false},{"spentEU",cost}};
            e["castCounter"]=integer(e,"castCounter")+1;e["cast"]=cast;e["sequenceIndex"]=(at+1)%int(schedule.size());e["lastSkill"]=skill_id;e["gap"]=0;e["facing"]=Json::array({forward.x,forward.y,forward.z});
            queue_event(Json{{"type","boss_telegraph"},{"bossId",id},{"definitionId",string(e,"bossId")},{"skillId",skill_id},{"stage","windup"},{"shape",shape},{"duration",number(*skill,"windupS",.5)}});break;
        }
    }
}

void Simulation::rebuild_machine(const std::string& id){
    auto it=machines_.find(id);if(it==machines_.end())return;const Json& m=it->second;
    const auto previous=machine_bodies_.find(id);MachineBody body;body.id=id;body.mass_revision=previous==machine_bodies_.end()?1:previous->second.mass_revision;body.position=point(m.value("position",Json::array({0,0,0})));body.velocity=point(m.value("velocity",Json::array({0,0,0})));body.angular_velocity=point(m.value("angularVelocity",Json::array({0,0,0})));body.rotation=Quat{};
    const Json q=m.value("rotation",Json::object());if(q.is_object())body.rotation={number(q,"x"),number(q,"y"),number(q,"z"),number(q,"w",1)};else body.rotation=yaw_quat(number(m,"yaw"));
    body.anchored=boolean(m,"anchored");body.revision=uint64_t(std::max(0,integer(m,"revision")));const double grid=number(m,"gridM",.5);
    double mass_total=0;Vec3 weighted{};
    if(has_array(m,"voxels"))for(const auto& v:m["voxels"]){
        const Json cell=v.value("cell",Json::array({0,0,0}));if(!cell.is_array()||cell.size()<3)continue;const int x=cell[0],y=cell[1],z=cell[2];const std::string material=string(v,"materialId");
        Vec3 local{(x+.5)*grid,(y+.5)*grid,(z+.5)*grid};const double density=number(entry(material).value("properties",Json::object()),"densityKgM3",number(entry(material),"densityKgM3",0));
        const double mass=number(v,"massKg",density*grid*grid*grid);MachineShape shape;shape.part_id=string(v,"id");shape.material_id=material;shape.local_box={local,{grid,grid,grid},material,mass,true};shape.hp=number(v,"hp",1);shape.max_hp=number(v,"maxHp",std::max(1.0,shape.hp));shape.mass_kg=mass;
        body.shapes.push_back(shape);mass_total+=mass;weighted+=local*mass;
    }
    if(has_array(m,"components"))for(const auto& c:m["components"]){
        const std::string voxel_id=string(c,"voxelId");const Json* voxel=nullptr;for(const auto& v:m["voxels"])if(string(v,"id")==voxel_id){voxel=&v;break;}if(!voxel)continue;
        Vec3 cell=point(voxel->value("cell",Json::array({0,0,0})));Vec3 local{(cell.x+.5)*grid,(cell.y+.5)*grid,(cell.z+.5)*grid};const std::string component=string(c,"componentId");
        double component_mass=number(c,"massKg");if(component_mass<=0){const Json& def=entry(component);const std::string recipe=string(def.value("origin",Json::object()),"recipe");const Json& rd=entry(recipe);const Json inputs=rd.value("inputs",Json::object());for(auto inp=inputs.begin();inp!=inputs.end();++inp)component_mass+=number(entry(inp.key()),"massKgPerUnit",number(entry(inp.key()).value("properties",Json::object()),"densityKgM3")/1000)*inp.value().get<double>();}
        double fluid_mass=0;const Json fluids=c.value("fluids",Json::object());for(auto f=fluids.begin();f!=fluids.end();++f){const Json& fluid=entry(f.key());double unit=number(fluid.value("properties",Json::object()),"densityKgM3")/1000;if(unit<=0)unit=number(fluid,"massKgPerUnit");fluid_mass+=unit*number(f.value());}
        const double loaded=component_mass+number(c,"fuelItems")*.6+number(c,"fuel")/400*.6+fluid_mass;mass_total+=loaded;weighted+=local*loaded;
    }
    const double base_mass=mass_total;const Vec3 base_center=base_mass>EPS?weighted/base_mass:Vec3{};const Json cargo=m.value("cargo",Json::object());for(auto c=cargo.begin();c!=cargo.end();++c){const Json& item=entry(c.key());double unit=number(item.value("properties",Json::object()),"densityKgM3")/1000;if(unit<=0)unit=number(item,"massKgPerUnit");const double cargo_mass=unit*number(c.value());mass_total+=cargo_mass;weighted+=base_center*cargo_mass;}
    body.mass_kg=mass_total;body.center_of_mass=mass_total>EPS?weighted/mass_total:Vec3{};
    if(previous!=machine_bodies_.end()&&(std::abs(previous->second.mass_kg-body.mass_kg)>1e-7||(previous->second.center_of_mass-body.center_of_mass).length()>1e-7))body.mass_revision++;
    machine_bodies_[id]=std::move(body);
}

void Simulation::refresh_machine_mass(const std::string& id){
    auto machine=machines_.find(id);auto body=machine_bodies_.find(id);if(machine==machines_.end()||body==machine_bodies_.end())return;
    const Json& m=machine->second;const double grid=number(m,"gridM",.5);double mass_total=0;Vec3 weighted{};
    if(has_array(m,"voxels"))for(const auto& v:m["voxels"]){
        const Json cell=v.value("cell",Json::array({0,0,0}));if(!cell.is_array()||cell.size()<3)continue;const double mass=number(v,"massKg");const Vec3 local{(cell[0].get<int>()+.5)*grid,(cell[1].get<int>()+.5)*grid,(cell[2].get<int>()+.5)*grid};mass_total+=mass;weighted+=local*mass;
    }
    if(has_array(m,"components"))for(const auto& c:m["components"]){
        const std::string voxel_id=string(c,"voxelId");const Json* voxel=nullptr;for(const auto& v:m["voxels"])if(string(v,"id")==voxel_id){voxel=&v;break;}if(!voxel)continue;
        const Json cell=voxel->value("cell",Json::array({0,0,0}));const Vec3 local{(cell[0].get<int>()+.5)*grid,(cell[1].get<int>()+.5)*grid,(cell[2].get<int>()+.5)*grid};const std::string component=string(c,"componentId");
        double component_mass=number(c,"massKg");if(component_mass<=0){const Json& def=entry(component);const std::string recipe=string(def.value("origin",Json::object()),"recipe");const Json& rd=entry(recipe);const Json inputs=rd.value("inputs",Json::object());for(auto inp=inputs.begin();inp!=inputs.end();++inp)component_mass+=number(entry(inp.key()),"massKgPerUnit",number(entry(inp.key()).value("properties",Json::object()),"densityKgM3")/1000)*number(inp.value());}
        double fluid_mass=0;const Json fluids=c.value("fluids",Json::object());for(auto f=fluids.begin();f!=fluids.end();++f){const Json& fluid=entry(f.key());double unit=number(fluid.value("properties",Json::object()),"densityKgM3")/1000;if(unit<=0)unit=number(fluid,"massKgPerUnit");fluid_mass+=unit*number(f.value());}
        const double loaded=component_mass+number(c,"fuelItems")*.6+number(c,"fuel")/400*.6+fluid_mass;mass_total+=loaded;weighted+=local*loaded;
    }
    const double base_mass=mass_total;const Vec3 base_center=base_mass>EPS?weighted/base_mass:Vec3{};const Json cargo=m.value("cargo",Json::object());for(auto c=cargo.begin();c!=cargo.end();++c){const Json& item=entry(c.key());double unit=number(item.value("properties",Json::object()),"densityKgM3")/1000;if(unit<=0)unit=number(item,"massKgPerUnit");const double cargo_mass=unit*number(c.value());mass_total+=cargo_mass;weighted+=base_center*cargo_mass;}
    const Vec3 center=mass_total>EPS?weighted/mass_total:Vec3{};
    if(std::abs(body->second.mass_kg-mass_total)>1e-7||(body->second.center_of_mass-center).length()>1e-7){body->second.mass_kg=mass_total;body->second.center_of_mass=center;++body->second.mass_revision;}
}

Json Simulation::create_machine(const Json& args,Gameplay& gameplay,bool imported){
    const double grid=number(args,"gridM",.1);if(grid!=.03125&&grid!=.1&&grid!=.5)return fail("invalid_grid");
    const std::string name=string(args,"name","조립 구조물");if(name.size()>100)return fail("invalid_name");
    Vec3 pos=args.contains("position")?point(args["position"]):Vec3{};const double yaw=number(args,"yaw",0);
    if(!std::isfinite(pos.x)||!std::isfinite(pos.y)||!std::isfinite(pos.z)||!std::isfinite(yaw))return fail("invalid_position");
    Json voxels=array_or(args.value("voxels",Json::array())),components=array_or(args.value("components",Json::array())),links=array_or(args.value("links",Json::array()));
    if(voxels.size()>2048||(!imported&&!args.contains("voxels"))){if(voxels.size()>2048)return fail("invalid_design");}
    std::map<std::string,int> voxel_cells;Json costs=Json::object();const double liters=grid*grid*grid*1000;
    for(const auto& v:voxels){
        const Json cell=v.value("cell",Json());if(!cell.is_array()||cell.size()!=3||!cell[0].is_number_integer()||!cell[1].is_number_integer()||!cell[2].is_number_integer())return fail("invalid_design_voxel");
        for(int i=0;i<3;i++)if(std::abs(cell[i].get<int>())>128)return fail("invalid_design_voxel");const std::string key=cell_key(cell[0],cell[1],cell[2]);if(voxel_cells.count(key))return fail("occupied");
        const std::string material=string(v,"materialId","wood");const Json& mat=entry(material);if(mat.empty()||string(mat,"kind")!="material")return fail("invalid_material");const double hp=number(v,"hp",number(mat.value("properties",Json::object()),"cellHp")*liters/125);if(hp<=0||hp>number(mat.value("properties",Json::object()),"cellHp")*liters/125+EPS)return fail("invalid_design_voxel");
        voxel_cells[key]=int(voxel_cells.size());costs[material]=number(costs,material)+liters;
    }
    if(!voxels.empty()){
        std::set<std::string> attached;std::vector<std::string> queue={cell_key(voxels[0]["cell"][0],voxels[0]["cell"][1],voxels[0]["cell"][2])};attached.insert(queue[0]);
        for(size_t qi=0;qi<queue.size();qi++){const auto& c=voxels[voxel_cells[queue[qi]]]["cell"];for(const auto& d:std::vector<std::array<int,3>>{{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}}){std::string key=cell_key(c[0].get<int>()+d[0],c[1].get<int>()+d[1],c[2].get<int>()+d[2]);if(voxel_cells.count(key)&&attached.insert(key).second)queue.push_back(key);}}
        if(attached.size()!=voxels.size())return fail("attachment_required");
    }
    // Validate the whole imported/assembled graph before touching inventory.
    // A malformed later mount or link must not leave the already-paid shell
    // and earlier components lost from the player's wallet.
    static const std::map<std::string,std::set<std::string>> variants={{"joint",{"hull","wing"}},{"transmission",{"wheel","propeller","rotor"}},{"motor",{"motor"}},{"controller",{"elevator","rudder"}}};
    std::set<std::string> mounted_cells;Json total_costs=costs;
    for(const auto& c:components){
        const std::string component=string(c,"componentId");const Json& def=entry(component);
        const Json cell=c.value("cell",Json());if(string(def,"kind")!="component"||!cell.is_array()||cell.size()!=3)return fail("invalid_design_component");
        for(int axis=0;axis<3;axis++)if(!cell[axis].is_number_integer()||std::abs(cell[axis].get<int>())>128)return fail("invalid_design_component");
        const std::string key=cell_key(cell[0],cell[1],cell[2]);if(!voxel_cells.count(key)||!mounted_cells.insert(key).second)return fail("invalid_design_component");
        if(c.contains("legacyType")&&!c["legacyType"].is_null()){
            if(!c["legacyType"].is_string())return fail("invalid_design_component");
            const std::string legacy=c["legacyType"].get<std::string>();auto it=variants.find(component);if(it==variants.end()||!it->second.count(legacy))return fail("invalid_design_component");
        }
        int fuel_items=0;
        if(c.contains("fuelItems")){
            if(!c["fuelItems"].is_number_integer())return fail("invalid_design_component");
            const double raw_fuel=c["fuelItems"].get<double>();if(!std::isfinite(raw_fuel)||raw_fuel<0||raw_fuel>64)return fail("invalid_design_component");
            fuel_items=int(raw_fuel);
        }
        if(fuel_items>0&&component!="heat_engine")return fail("invalid_design_component");
        if(c.contains("massKg")&&(!c["massKg"].is_number()||!std::isfinite(c["massKg"].get<double>())||c["massKg"].get<double>()<0))return fail("invalid_design_component");
        total_costs[component]=number(total_costs,component)+1;
        if(!imported&&fuel_items>0)total_costs["raw_timber"]=number(total_costs,"raw_timber")+fuel_items;
    }
    for(const auto& l:links){
        const int from=integer(l,"from",-1),to=integer(l,"to",-1);const std::string type=string(l,"type");
        if(from<0||to<0||from>=int(components.size())||to>=int(components.size())||from==to||type.empty())return fail("invalid_design_link");
        const Json& a=entry(string(components[from],"componentId"));const Json& b=entry(string(components[to],"componentId"));
        const Json outputs=a.value("outputEnergies",Json::array()),inputs=b.value("inputEnergies",Json::array());
        if(std::find(outputs.begin(),outputs.end(),Json(type))==outputs.end()||std::find(inputs.begin(),inputs.end(),Json(type))==inputs.end())return fail("invalid_design_link");
    }
    if(!imported&&!total_costs.empty()){
        const Json paid=gameplay.spend(total_costs,"machine-design:"+seed_+":"+std::to_string(next_id_));
        if(!boolean(paid,"ok"))return paid;
    }
    const std::string id=make_id("machine");Json m={{"id",id},{"name",name},{"entityType","machine"},{"gridM",grid},{"position",vec_json(pos)},{"velocity",vec_json({})},{"yaw",yaw},{"pitch",0},{"rotation",quat_json(yaw_quat(yaw))},{"angularVelocity",vec_json({})},{"damageClaims",Json::array()},{"voxels",Json::array()},{"components",Json::array()},{"links",Json::array()},{"fluidLinks",Json::array()},{"cargo",Json::object()},{"command",{{"throttle",0},{"steer",0},{"pitch",0},{"brake",false},{"push",0}}},{"revision",0},{"metrics",{{"generated",0},{"consumed",0},{"loss",0}}},{"lastPower",0},{"anchored",false},{"fieldExample",boolean(args,"fieldExample")}};
    for(const auto& v:voxels){
        const Json cell=v["cell"];const std::string material=string(v,"materialId","wood");const Json& mat=entry(material);const double volume=grid*grid*grid;const double mass=number(mat.value("properties",Json::object()),"densityKgM3",0)*volume,hp=number(mat.value("properties",Json::object()),"cellHp",1)*volume/.125;
        m["voxels"].push_back(Json{{"id","voxel:"+std::to_string(next_id_++)},{"cell",cell},{"materialId",material},{"volumeLiters",volume*1000},{"massKg",mass},{"hp",number(v,"hp",hp)},{"maxHp",hp}});
    }
    for(const auto& c:components){
        const std::string component=string(c,"componentId");const Json& def=entry(component);if(string(def,"kind")!="component")return fail("invalid_component");const Json cell=c.value("cell",Json());if(!cell.is_array()||cell.size()!=3)return fail("invalid_design_component");
        std::string voxel_id;for(const auto& v:m["voxels"])if(v["cell"]==cell){voxel_id=string(v,"id");break;}if(voxel_id.empty())return fail("invalid_design_component");
        Json energy=Json::object();for(const auto& t:{"mechanical","electrical","thermal","chemical","magic","divine"})energy[t]=0;
        const std::string legacy=string(c,"legacyType");m["components"].push_back(Json{{"id","mounted:"+std::to_string(next_id_++)},{"voxelId",voxel_id},{"componentId",component},{"legacyType",legacy.empty()?Json(nullptr):Json(legacy)},{"energy",energy},{"fuel",0},{"fuelItems",integer(c,"fuelItems",0)},{"fluids",Json::object()},{"massKg",number(c,"massKg",0)},{"active",true},{"shotsFired",0},{"nextFireAt",0},{"fireLedger",Json::array()},{"fireCache",Json::array()}});
    }
    for(const auto& l:links){int from=integer(l,"from",-1),to=integer(l,"to",-1);const std::string type=string(l,"type");if(from<0||to<0||from>=int(m["components"].size())||to>=int(m["components"].size())||from==to)return fail("invalid_design_link");
        const Json& a=entry(string(m["components"][from],"componentId"));const Json& b=entry(string(m["components"][to],"componentId"));
        const Json outputs=a.value("outputEnergies",Json::array()),inputs=b.value("inputEnergies",Json::array());
        if(std::find(outputs.begin(),outputs.end(),Json(type))==outputs.end()||std::find(inputs.begin(),inputs.end(),Json(type))==inputs.end())return fail("incompatible_ports");
        m["links"].push_back(Json{{"id","link:"+std::to_string(next_id_++)},{"from",string(m["components"][from],"id")},{"to",string(m["components"][to],"id")},{"type",type}});
    }
    for(auto it=args.begin();it!=args.end();++it)if(it.key()!="voxels"&&it.key()!="components"&&it.key()!="links"&&it.key()!="position"&&it.key()!="name"&&it.key()!="yaw"&&it.key()!="gridM")m[it.key()]=it.value();
    machines_[id]=m;rebuild_machine(id);return Json{{"ok",true},{"machineId",id},{"componentIds",[&](){Json a=Json::array();for(const auto& c:m["components"])a.push_back(c["id"]);return a;}()}};
}

Json Simulation::attach_machine_voxel(const Json& args,Gameplay& gameplay){
    const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
    const Json cell=args.value("cell",Json());if(!cell.is_array()||cell.size()!=3||!cell[0].is_number_integer()||!cell[1].is_number_integer()||!cell[2].is_number_integer())return fail("invalid_voxel");
    const int x=cell[0],y=cell[1],z=cell[2];if(std::abs(x)>128||std::abs(y)>128||std::abs(z)>128)return fail("invalid_voxel");const std::string key=cell_key(x,y,z);for(const auto& v:m["voxels"])if(cell_key(v["cell"][0],v["cell"][1],v["cell"][2])==key)return fail("occupied");
    if(!m["voxels"].empty()){bool attached=false;for(const auto& v:m["voxels"])if(std::abs(v["cell"][0].get<int>()-x)+std::abs(v["cell"][1].get<int>()-y)+std::abs(v["cell"][2].get<int>()-z)==1){attached=true;break;}if(!attached)return fail("attachment_required");}
    const std::string material=string(args,"materialId","wood");const Json& mat=entry(material);if(string(mat,"kind")!="material")return fail("invalid_material");const double grid=number(m,"gridM",.1),volume=grid*grid*grid*1000,mass=number(mat.value("properties",Json::object()),"densityKgM3")*volume/1000,hp=number(mat.value("properties",Json::object()),"cellHp")*volume/125;
    Json paid=gameplay.spend(Json{{material,volume}},"machine-place:"+id+":"+std::to_string(next_id_));if(!boolean(paid,"ok"))return paid;
    const std::string voxel_id="voxel:"+std::to_string(next_id_++);m["voxels"].push_back(Json{{"id",voxel_id},{"cell",cell},{"materialId",material},{"volumeLiters",volume},{"massKg",mass},{"hp",hp},{"maxHp",hp}});m["revision"]=integer(m,"revision")+1;rebuild_machine(id);return Json{{"ok",true},{"voxelId",voxel_id},{"costLiters",volume}};
}

Json Simulation::install_machine_component(const Json& args,Gameplay& gameplay){
    const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;const std::string component=string(args,"componentId");const Json& def=entry(component);if(string(def,"kind")!="component")return fail("unknown_component");
    const std::string voxel_id=string(args,"voxelId");Json* voxel=nullptr;for(auto& v:m["voxels"])if(string(v,"id")==voxel_id)voxel=&v;
    if(!voxel&&args.contains("cell")){for(auto& v:m["voxels"])if(v["cell"]==args["cell"])voxel=&v;}
    if(!voxel)return fail("unknown_voxel");for(const auto& c:m["components"])if(string(c,"voxelId")==string(*voxel,"id"))return fail("mount_occupied");
    const std::string legacy=string(args,"legacyType");static const std::map<std::string,std::set<std::string>> variants={{"joint",{"hull","wing"}},{"transmission",{"wheel","propeller","rotor"}},{"motor",{"motor"}},{"controller",{"elevator","rudder"}}};
    if(!legacy.empty()&&(!variants.count(component)||!variants.at(component).count(legacy)))return fail("unsupported_variant");
    Json paid=gameplay.spend(Json{{component,1}},"machine-mount:"+id+":"+std::to_string(next_id_));if(!boolean(paid,"ok"))return paid;
    Json energy=Json::object();for(const auto& t:{"mechanical","electrical","thermal","chemical","magic","divine"})energy[t]=0;
    Json c={{"id","mounted:"+std::to_string(next_id_++)},{"voxelId",string(*voxel,"id")},{"componentId",component},{"legacyType",legacy.empty()?Json(nullptr):Json(legacy)},{"energy",energy},{"fuel",0},{"fuelItems",0},{"fluids",Json::object()},{"massKg",0},{"active",true},{"shotsFired",0},{"nextFireAt",0},{"fireLedger",Json::array()},{"fireCache",Json::array()}};
    m["components"].push_back(c);m["revision"]=integer(m,"revision")+1;rebuild_machine(id);return Json{{"ok",true},{"componentInstanceId",string(c,"id")},{"voxelId",string(*voxel,"id")}};
}

Json Simulation::grant_signal(Json items,const std::string& claim,Gameplay& gameplay,Json& signal,Json energy){
    if(!items.is_object()||claim.empty())return fail("invalid_claim");
    const Json tables=content_.data.value("runtimeModules",Json::object());const Json frontier=tables.value("frontier",Json::object());const Json first=tables.value("firstSignal",Json::object());
    const Json mapping=first.value("FRONTIER_ITEMS",Json::object());const double record_work=number(first,"RECORD_WORK",5);Json catalog_items=Json::object();double work=0,cores=0;
    for(auto it=items.begin();it!=items.end();++it){if(!it.value().is_number()||it.value().get<double>()<0)return fail("invalid_reward");const double n=it.value().get<double>();if(it.key()=="knowledge")work+=n*record_work;else if(it.key()=="relic")cores+=n;else if(mapping.contains(it.key())){const std::string item=mapping[it.key()].get<std::string>();catalog_items[item]=number(catalog_items,item.c_str())+n;}
        else if(!entry(it.key()).empty())catalog_items[it.key()]=number(catalog_items,it.key().c_str())+n;else return fail("unknown_signal_item");}
    Json result=gameplay.command("simulation.reward",Json{{"items",catalog_items},{"energy",energy.is_object()?energy:Json::object()},{"workCredits",work},{"cores",cores},{"claim",claim}});
    if(!boolean(result,"ok"))return result;
    if(result.contains("cores"))signal["cores"]=result["cores"];
    if(cores>0&&!boolean(result,"duplicate"))gameplay.record_event(Json{{"type","signal_core"},{"id",claim},{"ownerId",claim},{"items",Json{{"relic",cores}}},{"claimId",claim}});
    result["coresAdded"]=cores;result["workCreditsAdded"]=work;return result;
}

Json Simulation::harvest_resource(const Json& args,World& world,Gameplay& gameplay){
    const std::string id=string(args,"id",string(args,"nodeId"));const Json* node=nullptr;for(const auto& n:harvest_nodes_)if(string(n,"id")==id){node=&n;break;}if(!node)return fail("unknown_resource");
    const Vec3 p=point(node->value("position",Json::object()),{number(*node,"x"),number(*node,"y"),number(*node,"z")});const Vec3 actor=args.contains("position")?point(args["position"]):player_;
    if(distance_xz(actor,p)>4.0)return fail("out_of_range");Json& status=harvest_states_[id];const double ready=number(status,"readyAt",0);if(boolean(status,"depleted")&&ready<=0)return fail("depleted");if(time_+EPS<ready)return Json{{"ok",false},{"reason","regrowing"},{"remainingS",ready-time_}};
    const std::string source_id=string(*node,"sourceId");const Json& source=entry(source_id);if(string(source,"kind")!="source")return fail("unknown_source");const std::string required=string(source,"requiredTool");if(!required.empty()&&gameplay.count(required)<1)return fail("required_tool_missing");
    const Json outputs=source.value("outputs",Json::object());if(!outputs.is_object()||outputs.empty())return fail("source_has_no_output");const std::string resource=string(*node,"resourceId");const std::string claim="harvest:"+id+":"+std::to_string(integer(status,"serial",0));
    const std::string environment=world.surface_sample(p.x,p.z).environment_id;
    Json result=gameplay.command("resource.harvest",Json{{"sourceId",source_id},{"environmentId",environment},{"nodeId",id},
        {"nodeType",string(*node,"nodeId")},{"elapsed",number(source,"seconds")},{"claim",claim}});
    if(!boolean(result,"ok"))return result;
    const double regrow=number(*node,"regrowS",number(source,"regrowS",0));status["serial"]=integer(status,"serial",0)+1;status["readyAt"]=regrow>0?time_+regrow:0;status["depleted"]=regrow<=0;status["sourceId"]=source_id;status["resourceId"]=resource;
    Json event={{"type","field_harvest"},{"id",id},{"ownerId",id},{"resourceId",resource},{"sourceId",source_id},{"items",outputs},{"position",vec_json(p)},{"claimId",claim}};emit_event(gameplay,event);
    result["nodeId"]=id;result["items"]=outputs;result["regrowsAt"]=status["readyAt"];return result;
}

void Simulation::ensure_world_structures(Vec3 player,World& world){
    if(time_+EPS<structure_scan_at_)return;structure_scan_at_=time_+5;
    const std::string generator=world.generator_id();if(generator=="frontier"||generator=="machine-field")return;
    const double spawn_x=number(config_.value("spawn",Json::object()),"x",0),spawn_z=number(config_.value("spawn",Json::object()),"z",0);
    const int cx=int(std::floor(player.x/512.0)),cz=int(std::floor(player.z/512.0));
    const Json environments=content_.data.value("environments",Json::object());const Json envs=environments.value("entries",Json::array());
    for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++){
        const double probe_x=(cx+dx+.5)*512,probe_z=(cz+dz+.5)*512;const SurfaceSample sample=world.surface_sample(probe_x,probe_z);if(sample.environment_id.empty()||sample.has_water||!sample.hostile_spawns_allowed&&sample.safe_bypass)continue;
        const Json* env=nullptr;for(const auto& e:envs)if(string(e,"id")==sample.environment_id){env=&e;break;}if(!env)continue;
        const Json building=env->value("building",Json::object());const std::string template_id=string(building,"dungeonId");if(template_id.empty())continue;const Json& def=entry(template_id);if(def.empty())continue;
        const std::string site="site:"+std::to_string(cx+dx)+","+std::to_string(cz+dz)+":"+template_id;const std::string instance_id="structure:"+seed_+":"+site+":"+template_id;if(dungeons_.count(instance_id))continue;
        if(std::hypot(probe_x-spawn_x,probe_z-spawn_z)<number(building,"minDistanceToSpawnM",160))continue;
        const uint32_t seed_hash=hash32(seed_+site);const double x=(cx+dx)*512+64+(seed_hash%384),z=(cz+dz)*512+64+(hash32(site+seed_)%384);const Json footprint=def.value("footprintM",Json::object());const Json mn=footprint.value("min",Json::array({-8,-8})),mx=footprint.value("max",Json::array({8,8}));
        const double tolerance=number(building,"terrainModificationMaxHeightM",2);std::vector<double> heights;bool blocked=false;
        for(int iy=0;iy<=4;iy++)for(int ix=0;ix<=4;ix++){const double px=x+mn[0].get<double>()+(mx[0].get<double>()-mn[0].get<double>())*ix/4,pz=z+mn[1].get<double>()+(mx[1].get<double>()-mn[1].get<double>())*iy/4;const auto s=world.surface_sample(px,pz);if(s.has_water||s.safe_bypass||!s.reserved_by.empty()){blocked=true;break;}heights.push_back(s.height);}
        if(blocked||heights.empty())continue;const auto [lo,hi]=std::minmax_element(heights.begin(),heights.end());if(*hi-*lo>tolerance)continue;
        const double y=std::round((heights[heights.size()/2]+CELL_M)/CELL_M)*CELL_M;ensure_dungeon(Json{{"templateId",template_id},{"siteId",site},{"origin",Json::array({x,y,z})},{"tier",sample.tier}},world);
    }
}

void Simulation::step_first_signal(double dt,Vec3 player,World& world,Gameplay& gameplay){
    if(!modules_.contains("first-signal"))return;const Json tables=content_.data.value("runtimeModules",Json::object());const Json campaign=tables.value("campaign",Json::object()),frontier=tables.value("frontier",Json::object()),first=tables.value("firstSignal",Json::object());
    Json& signal=modules_["first-signal"];
    if(!signal.is_object())signal=Json::object();
    if(!signal.contains("schema")){signal={{"schema",1},{"x",0},{"z",0},{"time",0},{"socialClock",0},{"reputation",Json::array({0,0,0})},{"diplomacy",Json::array({0,0,0})},{"allies",Json::array()},{"regions",Json::object()},{"log",Json::array({"첫 신호 · 주변에서 보급품을 채집하고 여정에서 다음 목표를 확인하세요."})},{"journey",{{"claimed",Json::array()},{"completedAt",nullptr},{"harvests",0},{"sorties",0},{"fedUntil",0},{"tonicUntil",0}}},{"cores",0},{"supplied",false}};}
    const int rx=int(std::floor(player.x/320.0)),rz=int(std::floor(player.z/320.0));const double lx=player.x-rx*320,lz=player.z-rz*320;const auto info=world.region_info(rx,rz);
    const bool on_region=info.has_value()&&lx>=0&&lx<160&&lz>=0&&lz<160;
    if(on_region&&(integer(signal,"x")!=rx||integer(signal,"z")!=rz)){signal["x"]=rx;signal["z"]=rz;}
    signal["time"]=number(signal,"time")+dt;signal["socialClock"]=number(signal,"socialClock")+dt;
    const std::string key=std::to_string(integer(signal,"x"))+","+std::to_string(integer(signal,"z"));
    if(!signal.contains("regions")||!signal["regions"].is_object())signal["regions"]=Json::object();
    if(info&&!signal["regions"].contains(key)){
        Json villages=Json::array();for(const auto& v:info->villages)villages.push_back(Json{{"id",v.id},{"name",v.name},{"x",v.x},{"z",v.z},{"faction",v.faction},{"food",24},{"wood",18},{"stone",24},{"crystal",10},{"tech",0},{"population",6},{"aid",0},{"raidAt",-999}});
        Json region={{"visited",true},{"terrainVersion",info->terrain_version},{"discovered",Json::array()},{"dungeon",0},{"cacheClaimed",false},{"boss",{{"hp",100*info->tier},{"maxHP",100*info->tier},{"defeated",false},{"phase",0},{"warning",0},{"cooldown",2},{"x",info->boss.x},{"z",info->boss.z},{"aimX",0},{"aimZ",0}}},{"villages",villages},{"relays",Json::array()},{"resources",Json::object()},{"studies",Json::array()},{"contracts",Json::array()},{"outpost",{{"projects",Json::array()},{"plots",Json::array({nullptr,nullptr})},{"signal",nullptr},{"sortie",nullptr},{"rounds",0},{"nextSortie",0}}}};
        signal["regions"][key]=region;
    }
    if(!boolean(signal,"supplied")){
        const Json supplies=first.value("START_SUPPLIES",Json::object());Json result=grant_signal(supplies,"first-signal:supplies",gameplay,signal);if(boolean(result,"ok"))signal["supplied"]=true;
    }
    if(number(signal,"socialClock")>=30){
        double clock=number(signal,"socialClock");const int ticks=int(clock/30);signal["socialClock"]=clock-ticks*30;
        for(int t=0;t<ticks;t++)for(auto r=signal["regions"].begin();r!=signal["regions"].end();++r){Json& region=r.value();if(!has_array(region,"villages")||region["villages"].size()<2)continue;for(auto& v:region["villages"]){v["food"]=clampd(number(v,"food")+3+number(v,"tech")-std::ceil(number(v,"population")/3),0,80);v["wood"]=std::min(80.0,number(v,"wood")+1+number(v,"tech"));v["stone"]=std::min(80.0,number(v,"stone")+2);v["crystal"]=std::min(40.0,number(v,"crystal")+(number(v,"tech")>=1?1:0));if(number(v,"food")==0)v["population"]=std::max(3,integer(v,"population")-1);else if(number(v,"food")>40)v["population"]=std::min(10,integer(v,"population")+1);if(number(v,"tech")<1&&number(v,"wood")>=50&&number(v,"stone")>=50){v["wood"]=number(v,"wood")-25;v["stone"]=number(v,"stone")-25;v["tech"]=1;}}
        }
    }
    // Gameplay owns mutable resident inventories, repair jobs and activity
    // receipts. Re-sync only source facts while keeping those records keyed by
    // the stable authored village/resident IDs.
    Json communities=Json::array(),residents=Json::array();
    for(auto it=signal["regions"].begin();it!=signal["regions"].end();++it){
        const std::string region_key=it.key();const auto comma=region_key.find(',');
        if(comma==std::string::npos)continue;
        int vx=0,vz=0;try{vx=std::stoi(region_key.substr(0,comma));vz=std::stoi(region_key.substr(comma+1));}catch(...){continue;}
        const Json& stored=it.value();if(!has_array(stored,"villages"))continue;
        for(const auto& v:stored["villages"]){
            const std::string village_id=string(v,"id"),community_id="signal-community:"+region_key+":"+village_id;
            const double wx=vx*320+number(v,"x"),wz=vz*320+number(v,"z"),wy=surface(world,wx,wz);
            const int faction=integer(v,"faction");const bool friendly=number(signal["reputation"][faction])>-20;
            const Json service=Json::array({
                Json{{"id",community_id+":contribution"},{"serviceId","contribution"},{"position",Json{{"x",wx},{"y",wy},{"z",wz}}}},
                Json{{"id",community_id+":repair"},{"serviceId","repair"},{"position",Json{{"x",wx+2},{"y",wy},{"z",wz}}}},
                Json{{"id",community_id+":rest"},{"serviceId","rest"},{"position",Json{{"x",wx-2},{"y",wy},{"z",wz}}}}});
            communities.push_back(Json{{"id",community_id},{"name",string(v,"name")},{"position",Json{{"x",wx},{"y",wy},{"z",wz}}},
                {"faction",faction},{"friendly",friendly},{"reputation",number(signal["reputation"][faction])},
                {"food",number(v,"food")},{"tech",integer(v,"tech")},{"serviceAnchors",service},
                {"activities",Json::array()},{"inventory",{{"wood",number(v,"wood")},{"stone",number(v,"stone")},{"crystal",number(v,"crystal")},{"food",number(v,"food")}}}});
            for(int role=0;role<3;role++){
                const double angle=role*2.1+number(v,"x")*.13,x=wx+std::cos(angle)*2.4,z=wz+std::sin(angle)*2.4,y=surface(world,x,z);
                const std::string id="first-signal/"+region_key+"/"+village_id+"/"+std::to_string(role);
                residents.push_back(Json{{"id",id},{"communityId",community_id},{"speciesId","signal_villager_"+std::to_string(faction)+"_"+std::to_string(role)},
                    {"name",string(v,"name")},{"position",{{"x",x},{"y",y},{"z",z}}},{"x",x},{"y",y},{"z",z},
                    {"hp",60},{"maxHp",60},{"calories",100},{"maxCalories",100},{"civilian",true},{"civilization",true},
                    {"organic",true},{"friendly",friendly},{"dead",false},{"services",Json::array({"trade","feed","repair","rest","contribution"})},
                    {"inventory",{{"wood",number(v,"wood")},{"stone",number(v,"stone")},{"crystal",number(v,"crystal")},{"food",number(v,"food")}}}});
            }
        }
    }
    gameplay.command("community.sync",Json{{"communities",communities},{"residents",residents}});
    signal_objects_=Json::array();if(!on_region||!info)return;
    Json& region=signal["regions"][key];Json& boss=region["boss"];Json& journey=signal["journey"];Json& outpost=region["outpost"];
    const double px=lx,pz=lz,bx=number(boss,"x"),bz=number(boss,"z"),bd=std::hypot(px-bx,pz-bz);
    if(!boolean(boss,"defeated")&&bd<26){
        if(number(boss,"warning")>0){boss["warning"]=std::max(0.0,number(boss,"warning")-dt);if(number(boss,"warning")<=EPS){const std::string pattern=string(boss,"pattern","stomp");const double ax=number(boss,"aimX"),az=number(boss,"aimZ"),ox=number(boss,"originX",bx),oz=number(boss,"originZ",bz);bool hit=false;const double dx=px-ax,dz=pz-az;
            if(pattern=="ring"){const double d=std::hypot(px-ox,pz-oz);hit=d<8&&d>=3.2;}else if(pattern=="charge"){const double vx=ax-ox,vz=az-oz,len=std::max(6.0,std::hypot(vx,vz)+3),angle=std::atan2(vx,vz),x=px-ox,z=pz-oz;hit=std::abs(std::cos(angle)*x-std::sin(angle)*z)<1.4&&std::abs(std::sin(angle)*x+std::cos(angle)*z)<len/2;boss["x"]=ax;boss["z"]=az;}else if(pattern=="cross"){for(double angle:{0.0,1.5707963267948966})if(std::abs(std::cos(angle)*dx-std::sin(angle)*dz)<1.3&&std::abs(std::sin(angle)*dx+std::cos(angle)*dz)<8)hit=true;}else if(pattern=="burst")hit=std::hypot(dx,dz)<2.5||std::hypot(px-(ax-5),pz-(az+2))<2.5||std::hypot(px-(ax+5),pz-(az-2))<2.5;else hit=std::hypot(dx,dz)<4;
            if(hit&&survival_)apply_player_hit(gameplay,Json{{"type","player_hit"},{"sourceId","first-signal/guardian"},{"amount",16+info->tier*5},{"energyType","mechanical"},{"pattern",pattern},{"position",Json{{"x",rx*320+bx},{"y",surface(world,rx*320+bx,rz*320+bz)},{"z",rz*320+bz}}}});boss["cooldown"]=number(boss,"hp")<number(boss,"maxHP")*.4?1.3:1.8;boss["phase"]=integer(boss,"phase")+1;}}
        else if((boss["cooldown"]=number(boss,"cooldown")-dt)<=0){const Json patterns=frontier.value("PATTERNS",Json::object());const Json biomes=campaign.value("BIOMES",Json::array());const Json sequence=info->biome==0?Json::array({"stomp","ring","stomp"}):info->biome==1?Json::array({"charge","cross","charge"}):Json::array({"ring","burst","ring"});const std::string pattern=sequence[integer(boss,"phase")%sequence.size()].get<std::string>();boss["pattern"]=pattern;boss["warning"]=number(patterns.value(pattern,Json::object()),"warning",1.2);boss["aimX"]=px;boss["aimZ"]=pz;boss["originX"]=bx;boss["originZ"]=bz;queue_event(Json{{"type","first_signal_telegraph"},{"pattern",pattern},{"position",Json::array({rx*320+bx,rz*320+bz})},{"warning",number(boss,"warning")}});}
        else if(bd>4){boss["x"]=bx+(px-bx)/std::max(EPS,bd)*dt*1.2;boss["z"]=bz+(pz-bz)/std::max(EPS,bd)*dt*1.2;}
    }else boss["warning"]=0;
    // Persisted field objects use their authored model IDs. The renderer resolves
    // hierarchy, boxes, materials and anchors from Content::assets.
    auto add=[&](std::string object,std::string asset,double x,double z,double extra_y=0,double yaw=0,Json animation=Json::object()){
        const std::string absolute_id="first-signal/"+object;const double wx=rx*320+x,wz=rz*320+z,wy=surface(world,wx,wz)+extra_y;
        signal_objects_.push_back(Json{{"id",absolute_id},{"asset_id",asset},{"owner_id","first-signal"},{"part_id","root"},{"position",vec_json({wx,wy,wz})},{"rotation",quat_json(yaw_quat(yaw))},{"scale",vec_json({1,1,1})},{"animation",animation},{"visible",true}});
    };
    const Json camp=campaign.value("CAMP",Json::object());const double cx=number(camp,"x",77.5),cz=number(camp,"z",84.5);
    add("camp","signal_camp_crate",cx,cz);add("mast","signal_mast",cx,cz-3);
    const Json biomes=campaign.value("BIOMES",Json::array());std::set<int> channels;for(const auto& [rk,rv]:signal["regions"].items())if(rv.contains("outpost")&&rv["outpost"].contains("signal")&&rv["outpost"]["signal"].is_object())channels.insert(integer(rv["outpost"]["signal"],"channel",-1));
    for(int i=0;i<3;i++)add("lamp:"+std::to_string(i),channels.count(i)?"signal_lamp_"+std::to_string(i):"signal_lamp_off",cx+(i-1)*.85,cz-3,4.4);
    if(!journey.value("completedAt",Json()).is_null())add("beam","signal_beam",cx,cz-3,4.5);
    const Json offsets=first.value("FACILITY_OFFSETS",Json::object());if(has_array(outpost,"projects"))for(const auto& project:outpost["projects"]){const std::string name=project.is_string()?project.get<std::string>():std::string();if(!offsets.contains(name))continue;Vec3 o=point(offsets[name],{});add("facility:"+name,"signal_facility_"+name,cx+o.x,cz+o.z);}
    const Json relay_sites=Json::array({Json{{"x",info->dungeon.x-3},{"z",info->dungeon.z}},Json{{"x",info->dungeon.x+3},{"z",info->dungeon.z}},Json{{"x",info->dungeon.x},{"z",info->dungeon.z+3}}});
    const Json relays=region.value("relays",Json::array());for(int i=0;i<3;i++){const bool lit=relays.is_array()&&std::find(relays.begin(),relays.end(),i)!=relays.end();add("relay:"+std::to_string(i),lit?"signal_relay_on":"signal_relay_off",number(relay_sites[i],"x"),number(relay_sites[i],"z"),0,0,Json{{"index",i},{"active",lit}});}
    if(!boolean(region,"cacheClaimed"))add("ruin",integer(region,"dungeon")>=3?"signal_ruin_core_open":"signal_ruin_core_sealed",info->dungeon.x,info->dungeon.z,0,0,Json{{"relays",relays}});
    // Stable per-region resource locations. Cooldown/one-time semantics live in
    // region.resources; descriptors disappear while their source is exhausted.
    Json hubs=Json::array({Json{{"x",77},{"z",84}}});for(const auto& v:region["villages"])hubs.push_back(v);
    const std::array<std::string,4> kinds={"wood","berry","herb","scrap"};
    for(size_t h=0;h<hubs.size();h++)for(const auto& kind:kinds){double x=number(hubs[h],"x"),z=number(hubs[h],"z");if(kind=="wood"){x-=4;}else if(kind=="berry"){x-=3;z+=3;}else if(kind=="herb"){x+=3;z+=3;}else{x+=4;}
        const std::string resource_id=kind+":"+std::to_string(h);const double until=number(region.value("resources",Json::object()),resource_id.c_str(),0);if(until==-1||until>number(signal,"time"))continue;add("resource:"+resource_id,"signal_resource_"+kind,x,z,0,0,Json{{"site",resource_id},{"kind",kind}});}
    for(int side:{-1,1}){const std::string rid="crystal:"+std::to_string(side);const double until=number(region.value("resources",Json::object()),rid.c_str(),0);if(until!=-1&&until<=number(signal,"time"))add("resource:"+rid,"signal_resource_crystal",info->dungeon.x+side*3,info->dungeon.z-3,0,0,Json{{"site",rid},{"kind","crystal"}});}
    for(size_t vi=0;vi<region["villages"].size();vi++){const auto& v=region["villages"][vi];const int faction=integer(v,"faction");add("village:"+string(v,"id"),"signal_village_sign_"+std::to_string(faction),number(v,"x"),number(v,"z"),0,0,Json{{"village",string(v,"id")},{"faction",faction}});for(int role=0;role<3;role++){const double a=role*2.1+number(v,"x")*.13;add("villager:"+string(v,"id")+":"+std::to_string(role),"signal_villager_"+std::to_string(faction)+"_"+std::to_string(role),number(v,"x")+std::cos(a)*2.4,number(v,"z")+std::sin(a)*2.4,0,std::atan2(std::cos(a),std::sin(a)),Json{{"village",string(v,"id")},{"role",role}});}}
    if(!boolean(boss,"defeated"))add("guardian","signal_guardian_"+std::to_string(info->biome),number(boss,"x"),number(boss,"z"),0,std::atan2(px-number(boss,"x"),pz-number(boss,"z")),Json{{"hp",number(boss,"hp")},{"maxHp",number(boss,"maxHP")},{"warning",number(boss,"warning")},{"pattern",boss.value("pattern",Json())}});
}

void Simulation::step_machines(double dt,World& world,Gameplay& gameplay){
    // Energy flows over the player's authored component links. Component
    // throughput, health, fuel and efficiency all bound the generated SI force.
    for(auto& [id,m]:machines_){
        Json& current_machine=m;
        if(!has_array(m,"components")||!has_array(m,"voxels")||m["voxels"].empty())continue;
        const double throttle=clampd(number(m.value("command",Json::object()),"throttle"),-1,1);
        std::map<std::string,Json> packets,definitions;
        std::map<std::string,double> throughput,health,sent;
        for(auto& c:m["components"]){
            const std::string cid=string(c,"id"),kind=string(c,"componentId");
            definitions[cid]=entry(kind);
            double hp=1;
            for(const auto& v:m["voxels"])if(string(v,"id")==string(c,"voxelId")){
                hp=number(v,"maxHp")>EPS?clampd(number(v,"hp")/number(v,"maxHp"),0,1):0;break;
            }
            health[cid]=boolean(c,"active",true)?hp:0;
            throughput[cid]=number(definitions[cid],"nominalPower",0)*health[cid]*dt;
            packets[cid]={{"mechanical",0},{"electrical",0},{"thermal",0},{"chemical",0},{"magic",0},{"divine",0}};
            const Json stores=definitions[cid].value("stores",Json::array());
            if(kind!="arc_thrower"&&health[cid]>0)for(const auto& type:stores)if(type.is_string()){
                const std::string energy_type=type.get<std::string>();const double current=number(c.value("energy",Json::object()),energy_type),out=std::min(current,throughput[cid]);
                c["energy"][energy_type]=std::max(0.0,current-out);packets[cid][energy_type]=out;
            }
            if(kind=="heat_engine"&&health[cid]>0){
                if(number(c,"fuel")<=EPS&&integer(c,"fuelItems")>0){c["fuelItems"]=integer(c,"fuelItems")-1;c["fuel"]=400;}
                const double fuel=std::min(number(c,"fuel"),20*health[cid]*dt);
                c["fuel"]=std::max(0.0,number(c,"fuel")-fuel);
                packets[cid]["mechanical"]=fuel*number(definitions[cid],"efficiency",.35);
                m["metrics"]["generated"]=number(m["metrics"],"generated")+fuel;m["metrics"]["loss"]=number(m["metrics"],"loss")+fuel*(1-number(definitions[cid],"efficiency",.35));
            }else if(kind=="mana_condenser"&&health[cid]>0){
                packets[cid]["magic"]=2*health[cid]*dt;
                m["metrics"]["generated"]=number(m["metrics"],"generated")+2*health[cid]*dt;
            }else if(kind=="relic"&&health[cid]>0){
                const double old=number(c.value("energy",Json::object()),"divine");
                const double cap=number(definitions[cid],"capacity",100);
                const double generated=std::min(.1*health[cid]*dt,std::max(0.0,cap-old));c["energy"]["divine"]=old+generated;m["metrics"]["generated"]=number(m["metrics"],"generated")+generated;
            }
        }
        for(int pass=0;pass<int(m["components"].size())+1;pass++){
            bool moved=false;
            for(auto& c:m["components"]){
                const std::string cid=string(c,"id"),kind=string(c,"componentId");
                if((kind!="motor"&&kind!="generator")||health[cid]<=0)continue;
                const std::string input=kind=="motor"?"electrical":"mechanical",output=kind=="motor"?"mechanical":"electrical";
                const double n=std::min(number(packets[cid],input),std::max(0.0,throughput[cid]-sent[cid]));
                if(n>EPS){const double efficiency=number(definitions[cid],"efficiency",.8);packets[cid][input]=number(packets[cid],input)-n;packets[cid][output]=number(packets[cid],output)+n*efficiency;sent[cid]+=n;m["metrics"]["loss"]=number(m["metrics"],"loss")+n*(1-efficiency);moved=true;}
            }
            for(const auto& link:m["links"]){
                const std::string from=string(link,"from"),to=string(link,"to"),type=string(link,"type");
                if(!packets.count(from)||!packets.count(to)||health[from]<=0||health[to]<=0||!packets[from].contains(type))continue;
                const double rate=std::max(0.0,throughput[from]-sent[from]);
                double n=std::min(number(packets[from],type),rate);
                if(n<=EPS)continue;
                const Json recipient=definitions[to];const Json recipient_stores=recipient.value("stores",Json::array());
                if(std::find(recipient_stores.begin(),recipient_stores.end(),Json(type))!=recipient_stores.end()){
                    const double stored=number(m["components"][std::distance(m["components"].begin(),std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& row){return string(row,"id")==to;}))].value("energy",Json::object()),type),capacity=number(recipient,"capacity"),efficiency=number(recipient,"efficiency",1);
                    n=std::min(n,std::max(0.0,capacity-stored)/std::max(EPS,efficiency));if(n<=EPS)continue;
                    auto target=std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& row){return string(row,"id")==to;});if(target==m["components"].end())continue;
                    (*target)["energy"][type]=stored+n*efficiency;m["metrics"]["loss"]=number(m["metrics"],"loss")+n*(1-efficiency);
                }else packets[to][type]=number(packets[to],type)+n;
                packets[from][type]=number(packets[from],type)-n;
                sent[from]+=n;moved=true;
            }
            if(!moved)break;
        }
        double total_wheel_health=0,ground_wheel_health=0,left_wheel=0,right_wheel=0;
        const Vec3 machine_position=point(m.value("position",Json::array({0,0,0})));
        Quat machine_rotation{};if(m.contains("rotation")&&m["rotation"].is_object())machine_rotation=m["rotation"].get<Quat>();else machine_rotation=yaw_quat(number(m,"yaw"));
        for(const auto& c:m["components"])if(string(c,"legacyType")=="wheel"&&health[string(c,"id")]>0){
            double h=0;for(const auto& v:m["voxels"])if(string(v,"id")==string(c,"voxelId")){h=number(v,"maxHp")>EPS?clampd(number(v,"hp")/number(v,"maxHp"),0,1):0;break;}
            total_wheel_health+=h;if(h<=0)continue;
            const Json* voxel=nullptr;for(const auto& v:m["voxels"])if(string(v,"id")==string(c,"voxelId")){voxel=&v;break;}if(!voxel)continue;
            const Json cell=voxel->value("cell",Json::array({0,0,0}));const double grid=number(m,"gridM",.5);
            const Vec3 local{(cell[0].get<int>()+.5)*grid,cell[1].get<int>()*grid,(cell[2].get<int>()+.5)*grid};const Vec3 at=machine_position+rotate(machine_rotation,local);
            const double gap=at.y-world.surface_sample(at.x,at.z).height;if(gap<-.05||gap>.08)continue;
            ground_wheel_health+=h;const double side=local.x-machine_bodies_[id].center_of_mass.x;if(side>=-grid/2)left_wheel+=h;if(side<=grid/2)right_wheel+=h;
        }
        const double wheel_share=total_wheel_health>EPS?clampd(ground_wheel_health/total_wheel_health,0,1):0;
        double motive=0,wheel=0,lift=0;std::vector<std::pair<Vec3,double>> rotor_mounts;
        const bool rotor_engaged=time_-number(m,"commandAt",-1e9)<=.25;
        for(auto& c:m["components"]){
            const std::string cid=string(c,"id"),component=string(c,"componentId"),variant=string(c,"legacyType");
            const Json& def=definitions[cid];if(health[cid]<=0)continue;
            if((variant=="wheel"||variant=="propeller"||variant=="rotor")&&number(packets[cid],"mechanical")>EPS){
                double n=std::min(number(packets[cid],"mechanical"),throughput[cid]);
                if(variant=="rotor")n*=rotor_engaged?1:0;else n*=std::abs(throttle);
                const double output=n*number(def,"efficiency",.9),useful=output/std::max(dt,EPS);
                if(variant=="wheel")wheel+=useful;else if(variant=="propeller")motive+=useful;else{lift+=useful;const Json* host=nullptr;for(const auto& v:m["voxels"])if(string(v,"id")==string(c,"voxelId")){host=&v;break;}if(host){const Json cell=host->value("cell",Json::array({0,0,0}));const double grid=number(m,"gridM",.5);rotor_mounts.push_back({{(cell[0].get<int>()+.5)*grid,(cell[1].get<int>()+.5)*grid,(cell[2].get<int>()+.5)*grid},useful});}}
                packets[cid]["mechanical"]=std::max(0.0,number(packets[cid],"mechanical")-n);
                m["metrics"]["consumed"]=number(m["metrics"],"consumed")+output;m["metrics"]["loss"]=number(m["metrics"],"loss")+n-output;
            }
            if(component=="pump"&&health[cid]>0&&number(packets[cid],"mechanical")>EPS){
                const Json fluid_links=m.value("fluidLinks",Json::array());const Json* route=nullptr;
                for(const auto& link:fluid_links)if(string(link,"pump")==cid){route=&link;break;}
                auto mounted=[&current_machine](const std::string& instance)->Json*{for(auto& row:current_machine["components"])if(string(row,"id")==instance)return &row;return nullptr;};
                Json* source=route?mounted(string(*route,"source")):nullptr;Json* target=route?mounted(string(*route,"target")):nullptr;
                if(source&&target){Json& fluids=(*source)["fluids"];const Json target_fluids=target->value("fluids",Json::object());const double cap=number(entry(string(*target,"componentId")),"capacityLiters");
                    for(auto f=fluids.begin();f!=fluids.end();++f)if(number(f.value())>EPS){const std::string fluid=f.key();bool mixed=false;double total=0;for(auto t=target_fluids.begin();t!=target_fluids.end();++t){total+=number(t.value());if(t.key()!=fluid&&number(t.value())>EPS)mixed=true;}
                        if(mixed)break;const double room=std::max(0.0,cap-total),flow=number(def,"flowLitersPerSecond")*health[cid]*dt,by_power=number(packets[cid],"mechanical")/std::max(EPS,number(def,"nominalPower"));
                        const double moved=std::max(0.0,std::min({number(f.value()),room,flow,by_power}));if(moved>EPS){f.value()=std::max(0.0,number(f.value())-moved);const double remaining=number(f.value());if(remaining<=EPS)fluids.erase(fluid);(*target)["fluids"][fluid]=number((*target)["fluids"],fluid)+moved;const double used=moved*number(def,"nominalPower");packets[cid]["mechanical"]=std::max(0.0,number(packets[cid],"mechanical")-used);m["metrics"]["consumed"]=number(m["metrics"],"consumed")+used;}break;
                    }
                }
            }
        }
        for(auto& c:m["components"]){
            const std::string cid=string(c,"id");const Json& def=definitions[cid];const Json stores=def.value("stores",Json::array());
            for(const std::string type:{"mechanical","electrical","thermal","chemical","magic","divine"}){
                double available=number(packets[cid],type,0);if(available<=EPS)continue;
                if(std::find(stores.begin(),stores.end(),Json(type))!=stores.end()){
                    const double capacity=number(def,"capacity"),stored=number(c.value("energy",Json::object()),type),accepted=std::min(available,std::max(0.0,capacity-stored));
                    if(accepted>EPS){c["energy"][type]=stored+accepted;available-=accepted;packets[cid][type]=available;}
                }
                if(available>EPS)m["metrics"]["loss"]=number(m["metrics"],"loss")+available;
                packets[cid][type]=0;
            }
        }
        const Vec3 velocity=point(m.value("velocity",Json::array({0,0,0})));
        Quat rotation{};if(m.contains("rotation")&&m["rotation"].is_object())rotation=m["rotation"].get<Quat>();else rotation=yaw_quat(number(m,"yaw"));
        const Vec3 forward=rotate(rotation,{0,0,1}),up=rotate(rotation,{0,1,0});
        const double mass=std::max(.1,machine_bodies_[id].mass_kg),speed=std::abs(velocity.dot(forward));
        const double sign=throttle<0?-1:1;
        const double motive_force=clampd(motive*100/std::max(1.0,speed),-mass*12,mass*12)*sign;
        const double wheel_force=std::min(wheel*340,.9*9.81*mass)*sign*wheel_share;
        const bool flying=lift>0;
        const double drag=boolean(m.value("command",Json::object()),"brake")?8:(flying?.35:1.2);
        Vec3 force=forward*(motive_force+wheel_force)-velocity*(drag*mass);
        Vec3 rotor_total{};std::vector<ForceCommand> rotor_forces;
        if(flying){
            const double capacity=lift*50,pitch=clampd(number(m.value("command",Json::object()),"pitch"),-1,1);
            const double lift_n=clampd(mass*(9.81+4*(3*pitch-velocity.y))/std::max(.5,up.y),0,capacity);
            force+=up*lift_n;
            if(!rotor_mounts.empty()){
                Vec3 hub{};double total=0;for(const auto& mount:rotor_mounts){hub+=mount.first;total+=mount.second;}hub=hub/double(rotor_mounts.size());
                for(const auto& mount:rotor_mounts){const Vec3 f=up*(lift_n*mount.second/std::max(EPS,lift));rotor_total+=f;rotor_forces.push_back({id,f,{},"machine-rotor"});rotor_forces.back().world_point=mount.first;rotor_forces.back().world_point=machine_position+rotate(machine_rotation,mount.first-hub+machine_bodies_[id].center_of_mass);}
                force=force-rotor_total;
            }
        }
        const Vec3 position=point(m.value("position",Json::array({0,0,0})));
        const Vec3 world_com=position+rotate(rotation,machine_bodies_[id].center_of_mass);
        const Json command=m.value("command",Json::object());const double push=clampd(number(command,"push"),-1,1);
        if(std::abs(push)>EPS){const int serial=integer(m,"pushSerial",0);const double input=std::abs(push)*.5*dt;Json paid=gameplay.command("energy.consume",Json{{"type","mechanical"},{"amount",input},{"claim",id+":manual-push:"+std::to_string(serial)}});
            if(boolean(paid,"ok")&&!boolean(paid,"duplicate")){m["pushSerial"]=serial+1;m["metrics"]["generated"]=number(m["metrics"],"generated")+input;m["metrics"]["consumed"]=number(m["metrics"],"consumed")+input;force+=forward*(std::copysign(std::min(input*100/std::max(dt,EPS),mass*12),push));}}
        if(!boolean(m,"anchored")){
            forces_.push_back({id,force,world_com,"machine-drive"});for(const auto& f:rotor_forces)forces_.push_back(f);
            const bool controller=std::any_of(m["components"].begin(),m["components"].end(),[&](const Json& c){return string(c,"componentId")=="controller"&&health[string(c,"id")]>0;});
            if(controller&&wheel_share>EPS&&std::abs(velocity.dot(forward))>EPS){
                const double speed_signed=velocity.dot(forward),steering=std::min(1.0,std::min(left_wheel,right_wheel)),pull=clampd(left_wheel-right_wheel,-1,1)*.22;
                const double rate=(number(command,"steer")*steering-pull)*clampd(speed_signed/3,-1,1);double inertia_y=0;
                for(const auto& shape:machine_bodies_[id].shapes){const Vec3 d=shape.local_box.center-machine_bodies_[id].center_of_mass,s=shape.local_box.size;inertia_y+=shape.mass_kg*(d.x*d.x+d.z*d.z+(s.x*s.x+s.z*s.z)/12);}
                const double torque=(rate-number(m.value("angularVelocity",Json::object()),"y"))*std::max(.01,inertia_y)*6*wheel_share;
                if(std::abs(torque)>EPS){const double arm=std::max(.25,number(m,"gridM",.5)),side_force=torque/(2*arm),s=std::copysign(side_force,torque);const Vec3 right=rotate(rotation,{1,0,0});
                    forces_.push_back({id,right*s,world_com+forward*arm,"machine-steering"});forces_.push_back({id,right*(-s),world_com-forward*arm,"machine-steering"});}
            }
        }
        m["lastPower"]=motive+wheel+lift;refresh_machine_mass(id);
    }
}

void Simulation::rebuild_views(){
    std::vector<EntityPose> previous_poses=std::move(poses_);poses_.clear();
    auto add=[&](EntityPose pose){if(content_.asset(pose.asset_id).empty())return;poses_.push_back(std::move(pose));};
    for(const auto& [id,e]:creatures_){
        const std::string pose_entity_id=id;
        const std::string species=string(e,"speciesId"),asset=string(e,"assetId",species),profile=string(e,"bodyProfile","quadruped");
        const Json& model=content_.asset(asset);if(model.empty())continue;
        EntityPose pose;pose.id=id;pose.kind="creature";pose.asset_id=asset;pose.owner_id=id;pose.part_id="root";
        pose.position={number(e,"x"),number(e,"y"),number(e,"z")};pose.rotation=yaw_quat(number(e,"yaw"));
        const bool dead=boolean(e,"dead"),rest=boolean(e,"rest")||string(e,"state")=="rest";
        const bool moving=boolean(e.value("pose",Json::object()),"moving")&&!dead&&!rest;
        const double phase=number(e.value("pose",Json::object()),"phase");
        const Json body=e.value("bodySize",Json::array({1,1,1}));
        const double height=body.is_array()&&body.size()>2?number(body[2]):1;
        const double width=body.is_array()&&body.size()>1?number(body[1]):1;
        const std::string state=string(e,"state");
        const bool windup=state=="windup"||(!e.value("attack",Json()).is_null()&&!boolean(e.value("attack",Json::object()),"hitDone"));
        const bool recovering=state=="recover"||(!e.value("attack",Json()).is_null()&&boolean(e.value("attack",Json::object()),"hitDone"));
        const bool work=boolean(e,"civilization")&&!dead&&(state=="repair"||state=="work"||state=="trade");
        const Json creature_pose=object_or(e.value("pose",Json::object())),creature_parts=object_or(e.value("parts",Json::object()));
        const Json supports=array_or(creature_pose.value("limbSupport",Json::array()));
        const bool flying=(profile=="winged"||profile=="hover")&&!dead&&std::all_of(supports.begin(),supports.end(),[](const Json& b){return b.is_boolean()&&b.get<bool>();});
        const double death=dead?(e.contains("deathAt")?clampd((time_-number(e,"deathAt"))*4,0,1):1):0;
        auto logical_part=[&](const std::string& p)->std::string{return creature_logical_part(profile,p);};
        Json tracks=Json::object();
        for(const auto& part:model.value("parts",Json::array())){
            const std::string pid=string(part,"id");const std::string logical=logical_part(pid);
            Json rotation=Json::array({0.0,0.0,0.0});Vec3 translation{};bool hidden=false;
            const Json supplied=object_or(creature_pose.value("parts",Json::object())).value(pid,Json::object());
            if(supplied.contains("rotation")&&supplied["rotation"].is_array()&&supplied["rotation"].size()>=3)rotation=supplied["rotation"];
            if(!logical.empty()){
                hidden=boolean(creature_parts.value(logical,Json::object()),"detached");
                for(const auto& missing:array_or(creature_pose.value("missingParts",Json::array())))if(missing==logical)hidden=true;
            }
            if(boolean(supplied,"hidden"))hidden=true;
            const Json fragments=object_or(e.value("fragmentMass",Json::object())).value("parts",Json::object());
            if(fragments.contains(pid)&&fragments[pid].is_object()&&fragments[pid].contains("objectId"))hidden=true;
            const double gait=phase*(string(e,"entityType")=="inorganic"?.8:1),amp=moving?.42:0;
            if(profile=="quadruped"){
                int limb=pid=="left_foreleg"?0:pid=="right_foreleg"?1:pid=="left_hindleg"?2:pid=="right_hindleg"?3:-1;
                if(limb>=0){rotation[0]=std::sin(gait+std::array<double,4>{0,3.141592653589793,3.141592653589793,0}[limb])*amp;
                    if(species=="scree_hare"||species=="candle_hare")rotation[0]=std::sin(gait+(limb<2?0:3.141592653589793))*(limb<2?.3:.6)*(moving?1:0);
                    if(rest)rotation[0]=limb<2?-.65:.7;}
                if(pid=="head"){rotation[0]=number(rotation[0])+(rest?.22:state=="forage"?.32:std::sin(time_*1.5)*.025);rotation[1]=std::sin(time_*.7)*.035;}
                if(pid=="tail"){rotation[1]=std::sin(time_*2+gait*.3)*.16;rotation[0]=rest?.2:0;}
                if(pid.find("ear")!=std::string::npos)rotation[2]=std::sin(time_*2.4)*.05*(pid.size()>2&&pid.substr(pid.size()-2)=="_l"?-1:1);
            }else if(profile=="arthropod"||profile=="arachnid"){
                std::string suffix=pid.rfind("walking_leg_",0)==0?pid.substr(12):pid.rfind("leg_",0)==0?pid.substr(4):std::string();
                if(!suffix.empty()){const auto split=suffix.find('_');const int side=parsed_int(split==std::string::npos?suffix:suffix.substr(0,split),1),row=split==std::string::npos?0:std::max(0,parsed_int(suffix.substr(split+1),0));rotation[1]=std::sin(gait+(row%2)*3.141592653589793+(side<0?0:3.141592653589793))*.25*(moving?1:0);rotation[2]=std::max(0.0,std::sin(gait+row))*side*.16*(moving?1:0);if(rest)rotation[2]=side*.22;}
                if(pid.find("raptorial_arm")==0)rotation[0]=windup?-.8:recovering?.5:-.1;
                if(pid.find("claw_")==0)rotation[1]=(pid.size()>2&&pid.substr(pid.size()-2)=="_-1"?-1:1)*(windup?.35:.12);
                if(pid.find("antenna")==0)rotation[0]=std::sin(time_*3)*.1;
            }else if(profile=="winged"){
                if(pid.rfind("wing_",0)==0){const int side=parsed_int(pid.substr(5),1)<0?-1:1;rotation[2]=flying?std::sin(time_*(species=="mana_moth"?15:6))*side*(species=="mana_moth"?.65:.38):side*.55;rotation[0]=windup?-.35:0;}
                if(pid.find("talon_")==0)rotation[0]=windup?-.6:flying?.35:0;if(pid=="head")rotation[0]=windup?.32:0;if(pid=="tail")rotation[0]=std::sin(time_*2)*.08;
            }else if(profile=="serpent"){
                if(pid.rfind("segment_",0)==0){const int i=std::max(0,parsed_int(pid.substr(8),0));const double wave=std::sin(gait-i*.5);rotation[1]=wave*.18*(moving?1:.15);translation.x+=wave*width*.14*(moving?1:.15);if(rest)rotation[1]=number(rotation[1])+(i-5.5)*.06;}
                if(pid=="head")rotation[1]=std::sin(gait-6)*.12*(moving?1:.1);
            }else if(profile=="crawler"){
                if(pid.rfind("segment_",0)==0){const int i=std::max(0,parsed_int(pid.substr(8),0));translation.y+=std::sin(gait-i*.6)*height*.035*(moving?1:.1);rotation[0]=std::sin(gait-i*.6)*.06*(moving?1:0);}
                if(pid.find("eye_stalk")==0)rotation[0]=std::sin(time_*1.7)*.1;if(pid=="foot")rotation[1]=std::sin(gait)*.025*(moving?1:0);
            }else if(profile=="biped"){
                if(pid=="leg_-1"||pid=="leg_1"){const int side=pid=="leg_-1"?-1:1;rotation[0]=std::sin(gait+(side<0?0:3.141592653589793))*amp;if(rest)rotation[0]=-.9;}
                if(pid=="arm_-1"||pid=="arm_1"){const int side=pid=="arm_-1"?-1:1;rotation[0]=-std::sin(gait+(side<0?0:3.141592653589793))*amp*.65;if(work)rotation[0]=-.6+std::sin(time_*4+(side<0?0:3.141592653589793))*.22;if(windup)rotation[0]=-.9;if(recovering)rotation[0]=.35;}
                if(pid=="guard_staff")rotation[0]=windup?-.35:recovering?.35:0;if(pid=="head"&&string(e,"state")=="work")rotation[1]=std::sin(time_)*.12;
            }else if(profile=="hover"){
                if(pid.rfind("thruster_",0)==0)rotation[0]=moving?-.1:std::sin(time_*3)*.025;if(pid=="sensor")rotation[1]=windup?0:std::sin(time_*.8)*.2;
            }
            if(windup&&pid=="head")rotation[0]=number(Json{{"v",rotation[0]}},"v")-.18;
            if(death>0){rotation[0]=clampd(number(rotation[0]),-.2,.2)*(1-death);if(pid.find("leg")!=std::string::npos||pid.find("arm")!=std::string::npos||pid.find("wing")!=std::string::npos)rotation[0]=number(rotation[0])+death*.35;}
            rotation[0]=clampd(rotation[0],-1.1,1.1);rotation[1]=clampd(rotation[1],-.8,.8);rotation[2]=clampd(rotation[2],-.9,.9);
            tracks[pid]={{"rotation",rotation},{"translation",vec_json(translation)},{"hidden",hidden}};
        }
        pose.animation={{"state",string(e,"state")},{"dead",dead},{"moving",moving},{"resting",rest},{"phase",phase},{"profile",profile},
            {"hp",number(e,"hp")},{"maxHp",number(e,"maxHp")},{"tier",integer(e,"tier")},{"parts",tracks},
            {"structureParts",creature_parts},{"wounds",object_or(e.value("wounds",Json::object()))},
            {"woundRevision",integer(e,"woundRevision")},{"missingParts",array_or(creature_pose.value("missingParts",Json::array()))},
            {"rootRotation",Json::array({!dead&&rest?(profile=="biped"?.18:.03):!dead&&profile=="hover"&&moving?.07:0,0,death*3.141592653589793*.48+(moving&&profile=="quadruped"?std::sin(phase)*.025*(1-number(creature_pose,"speedFactor",1)):0)})},
            {"rootTranslation",Json::array({0,death*width*.5+(!dead&&rest?-height*(profile=="biped"?.12:.07):0)+(moving&&profile=="quadruped"?std::abs(std::sin(phase*2))*height*.018:!dead&&profile=="hover"?std::sin(time_*2.2)*height*.025:0),0})}};
        Json part_boxes=Json::object(),bone_boxes=Json::array();const Json wounds=e.value("wounds",Json::object());
        const int wound_revision=integer(e,"woundRevision");auto wounded=wound_geometry_cache_.find(id);
        if(wounded!=wound_geometry_cache_.end()&&wounded->second.first==wound_revision)part_boxes=wounded->second.second;
        else{
            for(const auto& authored:model.value("parts",Json::array())){
                const std::string cut_part=string(authored,"id");const Json cuts=wounds.value(cut_part,Json::array());if(!cuts.is_array()||cuts.empty())continue;
                Json remaining=authored.value("boxes",Json::array());
                for(const auto& cut:cuts)if(cut.is_array()&&(cut.size()==6||cut.size()==4)){
                    const Json size=cut.size()==4?Json::array({cut[3],cut[3],cut[3]}):Json::array({cut[3],cut[4],cut[5]});
                    Json cutter={{"center",Json::array({cut[0],cut[1],cut[2]})},{"size",size}};
                    Json next=Json::array();for(const auto& box:remaining)for(auto fragment:subtract_box(box,cutter))next.push_back(std::move(fragment));remaining=std::move(next);
                }
                part_boxes[cut_part]=std::move(remaining);
            }
            wound_geometry_cache_[id]={wound_revision,part_boxes};
        }
        const int structure_revision=integer(e.value("structure",Json::object()),"revision");
        const auto previous=std::find_if(previous_poses.begin(),previous_poses.end(),[&pose_entity_id](const EntityPose& old){return old.id==pose_entity_id&&old.kind=="creature";});
        const int old_wound_revision=previous==previous_poses.end()?-1:integer(previous->animation,"woundRevision",-1);
        const int old_structure_revision=previous==previous_poses.end()?-1:integer(previous->animation,"structureRevision",-1);
        const bool wound_geometry_changed=old_wound_revision!=wound_revision;
        const bool bone_geometry_changed=wound_geometry_changed||old_structure_revision!=structure_revision;
        const bool anatomy_geometry_changed=bone_geometry_changed||!anatomy_geometry_cache_.count(id);
        if(bone_geometry_changed)for(const auto& part:model.value("parts",Json::array())){
            const std::string pid=string(part,"id"),logical=logical_part(pid),bone_key=asset+":"+pid+":"+logical;
            auto bones=bone_geometry_cache_.find(bone_key);if(bones==bone_geometry_cache_.end())bones=bone_geometry_cache_.emplace(bone_key,build_creature_bone_boxes(part,pid,logical)).first;
            const bool broken=!logical.empty()&&boolean(creature_parts.value(logical,Json::object()),"broken");
            if(!broken)for(const auto& bone:bones->second)bone_boxes.push_back(bone);
        }
        pose.animation["woundRevision"]=wound_revision;pose.animation["structureRevision"]=structure_revision;
        if(anatomy_geometry_changed)anatomy_geometry_cache_[id]=std::make_shared<const Json>(Json{{"woundRevision",wound_revision},{"structureRevision",structure_revision},{"partBoxes",std::move(part_boxes)},{"boneBoxes",std::move(bone_boxes)}});
        pose.anatomy_geometry=anatomy_geometry_cache_[id];
        add(std::move(pose));
    }
    for(const auto& [id,e]:corpses_){
        const std::string asset=string(e,"speciesId");if(content_.asset(asset).empty())continue;
        EntityPose pose;pose.id=id;pose.kind="corpse";pose.asset_id=asset;pose.owner_id=string(e,"entityId");pose.position={number(e,"x"),number(e,"y"),number(e,"z")};
        pose.animation={{"corpse",true},{"claimed",boolean(e,"claimed")},{"edibleCp",number(e,"edibleCp")}};add(std::move(pose));
    }
    for(const auto& [id,e]:bosses_){
        const std::string asset=string(e,"bossId");if(content_.asset(asset).empty())continue;
        EntityPose pose;pose.id=id;pose.kind="boss";pose.asset_id=asset;pose.owner_id=id;pose.position=point(e.value("position",Json::array({0,0,0})));
        Vec3 facing=point(e.value("facing",Json::array({0,0,1})));pose.rotation=yaw_quat(std::atan2(facing.x,facing.z));
        pose.animation={{"hp",number(e,"hp")},{"maxHp",number(e,"maxHp")},{"phaseId",e.value("phaseId",Json())},{"phaseIndex",integer(e,"phaseIndex")},
            {"cast",e.value("cast",Json())},{"parts",e.value("parts",Json::object())},{"shell",e.value("shell",Json::object())},
            {"defeated",boolean(e,"defeated")},{"contentVariantId",e.value("contentVariantId",Json())}};add(std::move(pose));
    }
    for(const auto& [id,d]:dungeons_){
        const std::string asset=string(d,"templateId");if(content_.asset(asset).empty())continue;
        EntityPose pose;pose.id=id;pose.kind="device";pose.asset_id=asset;pose.owner_id=id;pose.position=point(d.value("origin",Json::array({0,0,0})));
        pose.rotation=yaw_quat(number(d,"yaw"));pose.animation={{"damage",d.value("damage",Json::object())},{"deviceState",d.value("deviceState",Json())},
            {"puzzle",d.value("puzzle",Json())},{"revision",integer(d,"revision")}};add(std::move(pose));
    }
    for(const auto& object:signal_objects_){
        if(!object.is_object())continue;EntityPose pose;pose.id=string(object,"id");pose.kind="campaign";pose.asset_id=string(object,"asset_id");
        pose.owner_id=string(object,"owner_id");pose.part_id=string(object,"part_id","root");pose.position=point(object.value("position",Json::array({0,0,0})));
        if(object.contains("rotation"))pose.rotation=object["rotation"].get<Quat>();pose.scale=point(object.value("scale",Json::array({1,1,1})),{1,1,1});
        pose.animation=object.value("animation",Json::object());pose.visible=boolean(object,"visible",true);add(std::move(pose));
    }
    // Soil is a terrain material, not an authored prop; all other gathering
    // sources resolve to the exported canonical resource model.
    for(const auto& n:harvest_nodes_){
        const std::string source=string(n,"sourceId"),resource=string(n,"resourceId");
        const std::string asset="resource_"+(source.rfind("source_",0)==0?source.substr(7):resource);
        if(content_.asset(asset).empty())continue;
        const Vec3 at=point(n.value("position",Json::array({number(n,"x"),number(n,"y"),number(n,"z")})));
        EntityPose pose;pose.id=string(n,"id");pose.kind="resource";pose.asset_id=asset;pose.owner_id=string(n,"ownerId",pose.id);
        pose.position=at;const auto state=harvest_states_.find(pose.id);const Json status=state==harvest_states_.end()?Json::object():state->second;
        const double ready=number(status,"readyAt");pose.animation={{"sourceId",source},{"resourceId",resource},{"readyAt",ready},
            {"depleted",boolean(status,"depleted")&&(ready<=0||ready>time_)}};add(std::move(pose));
    }
    for(const auto& [id,body]:machine_bodies_){
        EntityPose pose;pose.id=id;pose.kind="machine";pose.owner_id=id;pose.position=body.position;pose.rotation=body.rotation;
        pose.animation={{"revision",body.revision},{"massKg",body.mass_kg},{"anchored",body.anchored},{"voxelCount",body.shapes.size()}};
        poses_.push_back(std::move(pose));
    }
}

Json Simulation::view()const{
    Json entities=Json::array(),pose_json=Json::array();
    for(const auto& p:poses_){
        Json row={{"id",p.id},{"kind",p.kind},{"assetId",p.asset_id},{"ownerId",p.owner_id},{"partId",p.part_id},
            {"position",vec_json(p.position)},{"rotation",quat_json(p.rotation)},{"scale",vec_json(p.scale)},
            {"animation",p.animation},{"visible",p.visible}};
        entities.push_back(row);pose_json.push_back(std::move(row));
    }
    Json body_json=Json::array();
    for(const auto& [id,b]:machine_bodies_){
        Json shapes=Json::array();
        for(const auto& s:b.shapes)shapes.push_back(Json{{"partId",s.part_id},{"materialId",s.material_id},
            {"center",vec_json(s.local_box.center)},{"size",vec_json(s.local_box.size)},
            {"hp",s.hp},{"maxHp",s.max_hp},{"massKg",s.mass_kg}});
        body_json.push_back(Json{{"id",id},{"position",vec_json(b.position)},{"rotation",quat_json(b.rotation)},
            {"velocity",vec_json(b.velocity)},{"angularVelocity",vec_json(b.angular_velocity)},
            {"centerOfMass",vec_json(b.center_of_mass)},{"massKg",b.mass_kg},{"anchored",b.anchored},
            {"revision",b.revision},{"massRevision",b.mass_revision},{"shapes",shapes}});
    }
    Json commands=Json::array();
    auto field=[](std::string key,std::string label,std::string type="text",Json options=Json(),Json value=Json()){
        Json f={{"key",key},{"label",label},{"type",type}};if(!options.is_null())f["options"]=options;if(!value.is_null())f["default"]=value;return f;
    };
    auto reg=[&](std::string id,std::string label,std::string panel,Json fields){
        commands.push_back(Json{{"id",id},{"label",label},{"panel",panel},{"fields",fields}});
    };
    reg("creature.spawn","생물 배치","creatures",Json::array({
        field("speciesId","종","content_id"),field("position","위치","vector3"),field("tier","단계","number",Json(),2)}));
    reg("creature.damage","부위 공격","creatures",Json::array({
        field("id","대상","entity_id"),field("partId","부위","part_id"),field("amount","피해","number",Json(),4),
        field("mode","타격","select",Json::array({"strike","slash","pierce","impact"}),"strike")}));
    reg("creature.claim_drops","사체 회수","creatures",Json::array({field("id","사체","entity_id")}));
    reg("creature.rest","생물 휴식","creatures",Json::array({field("id","생물","entity_id"),field("resting","휴식","boolean")}));
    reg("creature.feed","생물 먹이 주기","creatures",Json::array({field("id","생물","entity_id"),field("itemId","먹이","content_id")}));
    reg("dungeon.ensure","던전 설치","dungeons",Json::array({
        field("templateId","구조물","content_id"),field("siteId","지점 ID"),field("origin","위치","vector3"),field("tier","단계","number",Json(),2)}));
    reg("dungeon.enter","방 탐사","dungeons",Json::array({field("id","던전","entity_id"),field("roomId","방","room_id")}));
    reg("dungeon.device","장치 조작","dungeons",Json::array({
        field("id","던전","entity_id"),field("action","행동","select",Json::array({"install","replace","repair","operate","align","pump","open"})),
        field("anchorId","부품 위치","part_id"),field("position","위치","vector3")}));
    reg("dungeon.claim_reward","던전 보상","dungeons",Json::array({
        field("id","던전","entity_id"),field("anchorId","보상 위치","select",Json::array({"boss","puzzle","cache"}),"boss")}));
    reg("boss.spawn","보스 배치","bosses",Json::array({
        field("bossId","보스","content_id"),field("position","위치","vector3"),field("tier","단계","number",Json(),1)}));
    reg("boss.damage","보스 공격","bosses",Json::array({
        field("id","보스","entity_id"),field("partId","부위","part_id"),field("amount","피해","number",Json(),8),
        field("energyType","에너지","select",Json::array({"mechanical","electrical","thermal","chemical","magic","divine"}),"mechanical")}));
    reg("boss.gimmick","전장 장치 사용","bosses",Json::array({field("id","보스","entity_id"),field("gimmickId","장치","part_id")}));
    reg("boss.claim_reward","보스 보상","bosses",Json::array({field("id","보스","entity_id")}));
    reg("machine.create","기계 조립","machines",Json::array({
        field("name","이름"),field("gridM","격자","select",Json::array({.03125,.1,.5}),.1),field("position","위치","vector3")}));
    reg("machine.example","기계 예제","machines",Json::array({field("heavy","중량 예제","boolean",Json(),false),field("position","위치","vector3")}));
    reg("machine.return_to_pad","출발 패드로 복귀","machines",Json::array({field("id","기계","entity_id"),field("position","위치","vector3"),field("yaw","방향","number")}));
    reg("machine.attach","블록 부착","machines",Json::array({
        field("id","기계","entity_id"),field("cell","격자 좌표","vector3_int"),field("materialId","재료","content_id")}));
    reg("machine.install","부품 설치","machines",Json::array({
        field("id","기계","entity_id"),field("voxelId","블록","part_id"),field("componentId","부품","content_id"),
        field("legacyType","형식","select",Json::array({"hull","wing","wheel","propeller","rotor","motor","elevator","rudder"}))}));
    reg("machine.active","부품 작동","machines",Json::array({field("id","기계","entity_id"),field("componentInstanceId","장착 부품","part_id"),field("active","작동","boolean",Json(),true)}));
    reg("machine.charge","부품 충전","machines",Json::array({field("id","기계","entity_id"),field("componentInstanceId","장착 부품","part_id"),field("type","에너지","select",Json::array({"mechanical","electrical","thermal","chemical","magic","divine"})),field("amount","충전량 EU","number",Json(),10)}));
    reg("machine.drain","부품 방전","machines",Json::array({field("id","기계","entity_id"),field("componentInstanceId","장착 부품","part_id"),field("type","에너지","select",Json::array({"mechanical","electrical","thermal","chemical","magic","divine"})),field("amount","방전량 EU","number",Json(),10)}));
    reg("machine.connect","에너지 연결","machines",Json::array({
        field("id","기계","entity_id"),field("from","출력 부품","part_id"),field("to","입력 부품","part_id"),
        field("type","에너지","select",Json::array({"mechanical","electrical","thermal","chemical","magic","divine"}))}));
    reg("machine.disconnect","에너지 연결 해제","machines",Json::array({field("id","기계","entity_id"),field("linkId","연결","part_id")}));
    reg("machine.fluid.fill","용기 채우기","machines",Json::array({field("id","기계","entity_id"),field("componentInstanceId","용기","part_id"),field("fluid","유체","select",Json::array({"liquid_mana","acid_fluid"})),field("liters","리터","number",Json(),1)}));
    reg("machine.fluid.drain","용기 비우기","machines",Json::array({field("id","기계","entity_id"),field("componentInstanceId","용기","part_id"),field("fluid","유체","select",Json::array({"liquid_mana","acid_fluid"})),field("liters","리터","number",Json(),1)}));
    reg("machine.fluid.connect","펌프 배관","machines",Json::array({field("id","기계","entity_id"),field("sourceComponentInstanceId","공급 용기","part_id"),field("pumpComponentInstanceId","펌프","part_id"),field("targetComponentInstanceId","대상 용기","part_id")}));
    reg("machine.fluid.disconnect","배관 해제","machines",Json::array({field("id","기계","entity_id"),field("fluidLinkId","배관","part_id")}));
    reg("machine.cargo.load","화물 적재","machines",Json::array({field("id","기계","entity_id"),field("items","아이템 수량","item_map")}));
    reg("machine.cargo.unload","화물 내리기","machines",Json::array({field("id","기계","entity_id"),field("items","아이템 수량","item_map")}));
    reg("machine.control","기계 조종","machines",Json::array({
        field("id","기계","entity_id"),field("throttle","가속","number",Json(),0),field("steer","조향","number",Json(),0),
        field("pitch","상하","number",Json(),0),field("brake","제동","boolean",Json(),false)}));
    reg("machine.remove","부품 분리","machines",Json::array({field("id","기계","entity_id"),field("partId","부품","part_id")}));
    reg("machine.repair","기계 수리","machines",Json::array({field("id","기계","entity_id"),field("partId","부품","part_id")}));
    reg("machine.anchor","기계 고정","machines",Json::array({field("id","기계","entity_id"),field("anchored","고정","boolean",Json(),true)}));
    reg("machine.damage","기계 공격","machines",Json::array({field("id","기계","entity_id"),field("partId","부품","part_id"),field("amount","피해","number",Json(),5)}));
    reg("first_signal.relay","중계기 활성화","campaign",Json::array({field("index","중계기","number")}));
    reg("first_signal.ruin","유적 핵 회수","campaign",Json::array({}));
    reg("first_signal.harvest","현장 채집","campaign",Json::array({field("siteId","채집지","target_id")}));
    reg("first_signal.project","야영 시설","campaign",Json::array({field("id","시설","select",Json::array({"garden","kitchen","workshop"}))}));
    reg("first_signal.plant","씨앗 심기","campaign",Json::array({field("index","밭","number"),field("crop","작물","select",Json::array({"berry","herb"}))}));
    reg("first_signal.crop_harvest","작물 수확","campaign",Json::array({field("index","밭","number")}));
    reg("first_signal.travel","지역 이동","campaign",Json::array({field("dx","동서","number"),field("dz","남북","number")}));
    reg("first_signal.signal","신호 복원","campaign",Json::array({field("route","경로","select",Json::array({"explorer","guardian","community"}))}));
    reg("first_signal.sortie","원정 시작/회수","campaign",Json::array({
        field("kind","원정","select",Json::array({"survey","supply","hunt"})),field("action","행동","select",Json::array({"start","claim"}))}));
    reg("first_signal.village","마을 상호작용","campaign",Json::array({
        field("villageId","마을","target_id"),field("action","행동","select",Json::array({"trade","quarry","aid","ally","mediate","peace","raid"}))}));
    reg("resource.harvest","자원 채집","creatures",Json::array({field("id","채집 대상","target_id"),field("position","위치","vector3")}));
    Json force_json=Json::array();
    for(const auto& f:forces_)force_json.push_back(Json{{"bodyId",f.body_id},{"forceN",vec_json(f.force_newtons)},
        {"worldPoint",vec_json(f.world_point)},{"source",f.source}});
    return Json{{"time",time_},{"seed",seed_},{"entities",entities},{"poses",pose_json},
        {"creatures",Json(creatures_)},{"regions",Json(regions_)},{"corpses",Json(corpses_)},
        {"dungeons",Json(dungeons_)},{"bosses",Json(bosses_)},{"machines",Json(machines_)},
        {"machineBodies",body_json},{"forces",force_json},{"events",events_},
        {"firstSignal",modules_.value("first-signal",Json::object())},{"commands",commands}};
}

Json Simulation::command_first_signal(const std::string& name,Json args,World& world,Gameplay& gameplay){
    if(!modules_.contains("first-signal"))return fail("module_disabled");
    Json& signal=modules_["first-signal"];
    if(!signal.is_object()||!signal.contains("regions"))return fail("signal_not_initialized");
    const Json tables=content_.data.value("runtimeModules",Json::object());
    const Json campaign=tables.value("campaign",Json::object()),frontier=tables.value("frontier",Json::object());
    const int rx=integer(signal,"x"),rz=integer(signal,"z");
    const std::string key=std::to_string(rx)+","+std::to_string(rz);
    if(!signal["regions"].contains(key))return fail("region_unavailable");
    Json& region=signal["regions"][key];const auto info=world.region_info(rx,rz);
    if(!info)return fail("region_unavailable");
    const Vec3 player=player_state_.contains("position")?point(player_state_["position"],player_):player_;
    const Vec3 local{player.x-rx*320,player.y,player.z-rz*320};
    auto near=[&](double x,double z,double radius){return std::hypot(local.x-x,local.z-z)<=radius;};
    auto pay=[&](Json items,const std::string& claim,double work=0,double cores=0){
        return gameplay.command("simulation.pay",Json{{"items",items},{"workCredits",work},{"cores",cores},{"claim",claim}});
    };
    auto reward=[&](Json items,const std::string& claim){
        Json out=gameplay.command("simulation.reward",Json{{"items",items},{"claim",claim}});
        if(boolean(out,"ok")){if(out.contains("cores"))signal["cores"]=out["cores"];
            if(number(items,"relic")>0&&!boolean(out,"duplicate"))gameplay.record_event(Json{{"type","signal_core"},{"id",claim},{"ownerId",claim},{"items",Json{{"relic",number(items,"relic")}}},{"claimId",claim}});}
        return out;
    };
    std::string action=name;
    for(const std::string prefix:{"first_signal.","first-signal."})
        if(action.rfind(prefix,0)==0)action=action.substr(prefix.size());

    if(action=="relay"||action=="activate_relay"){
        int index=integer(args,"index",-1);
        if(index<0){const std::string id=string(args,"id");const auto pos=id.rfind(':');if(pos!=std::string::npos)try{index=std::stoi(id.substr(pos+1));}catch(...){}}
        if(index<0||index>2)return fail("unknown_relay");
        const double sx=info->dungeon.x+(index==0?-3:index==1?3:0),sz=info->dungeon.z+(index==2?3:0);
        if(!near(sx,sz,4))return fail("out_of_range");
        if(std::find(region["relays"].begin(),region["relays"].end(),index)!=region["relays"].end())return Json{{"ok",true},{"duplicate",true}};
        region["relays"].push_back(index);region["dungeon"]=std::max(integer(region,"dungeon"),int(region["relays"].size()));
        emit_event(gameplay,Json{{"type","relay_activated"},{"id",key+":"+std::to_string(index)},{"ownerId",key},
            {"regionId",key},{"tier",info->tier},{"position",Json::array({rx*320+sx,rz*320+sz})}});
        return Json{{"ok",true},{"relays",region["relays"]},{"opened",region["dungeon"]>=3}};
    }
    if(action=="ruin"||action=="claim_ruin"){
        if(!near(info->dungeon.x,info->dungeon.z,6))return fail("out_of_range");
        if(boolean(region,"cacheClaimed"))return Json{{"ok",true},{"duplicate",true}};
        if(integer(region,"dungeon")<3)return Json{{"ok",false},{"reason","relays_required"},{"relays",region["relays"]}};
        Json items={{"knowledge",6},{"crystal",4},{"iron",3},{"relic",1}};
        const Json ruins=frontier.value("RUINS",Json::array());
        if(info->biome>=0&&info->biome<int(ruins.size()))for(const auto& item:ruins[info->biome].value("bonus",Json::object()).items())
            items[item.key()]=number(items,item.key())+number(item.value());
        Json out=reward(items,"ruin:"+key);if(!boolean(out,"ok"))return out;
        region["cacheClaimed"]=true;
        emit_event(gameplay,Json{{"type","ruin_claimed"},{"id",key},{"ownerId",key},{"regionId",key},{"tier",info->tier},
            {"position",Json::array({rx*320+info->dungeon.x,rz*320+info->dungeon.z})},{"claimId","ruin:"+key}});
        return out;
    }
    if(action=="harvest"||action=="gather"){
        const std::string site=string(args,"siteId",string(args,"id"));
        Json sites=Json::array();auto add_hub=[&](double x,double z,int index){
            sites.push_back(Json{{"id","wood:"+std::to_string(index)},{"kind","wood"},{"x",x-4},{"z",z}});
            sites.push_back(Json{{"id","berry:"+std::to_string(index)},{"kind","berry"},{"x",x-3},{"z",z+3}});
            sites.push_back(Json{{"id","herb:"+std::to_string(index)},{"kind","herb"},{"x",x+3},{"z",z+3}});
            sites.push_back(Json{{"id","scrap:"+std::to_string(index)},{"kind","scrap"},{"x",x+4},{"z",z}});
        };
        add_hub(77,84,0);for(size_t i=0;i<info->villages.size();++i)add_hub(info->villages[i].x,info->villages[i].z,int(i+1));
        for(int side:{-1,1})sites.push_back(Json{{"id","crystal:"+std::to_string(side)},{"kind","crystal"},{"x",info->dungeon.x+side*3},{"z",info->dungeon.z-3}});
        const Json* target=nullptr;for(const auto& candidate:sites)if(string(candidate,"id")==site){target=&candidate;break;}
        if(!target)return fail("unknown_resource");if(!near(number(*target,"x"),number(*target,"z"),4))return fail("out_of_range");
        Json& resources=region["resources"];const double until=number(resources,site.c_str());
        if(until==-1)return fail("depleted");if(until>number(signal,"time"))return Json{{"ok",false},{"reason","regrowing"},{"remainingS",until-number(signal,"time")}};
        const std::string kind=string(*target,"kind");const Json defs=frontier.value("GATHERABLES",Json::object());if(!defs.contains(kind))return fail("unknown_resource");
        const Json def=defs[kind];const std::string claim="signal-gather:"+key+":"+site+":"+std::to_string(until);
        Json out=reward(def.value("reward",Json::object()),claim);if(!boolean(out,"ok"))return out;
        const double regrow=number(def,"regrow");resources[site]=regrow>0?number(signal,"time")+regrow:-1;
        region["harvestCount"]=integer(region,"harvestCount")+1;signal["journey"]["harvests"]=integer(signal["journey"],"harvests")+1;
        emit_event(gameplay,Json{{"type","harvest"},{"id",site},{"ownerId",key},{"regionId",key},{"items",def.value("reward",Json::object())},
            {"position",Json::array({rx*320+number(*target,"x"),rz*320+number(*target,"z")})},{"claimId",claim}});
        out["readyAt"]=resources[site];return out;
    }
    if(action=="project"){
        const std::string id=string(args,"id",string(args,"projectId"));const Json projects=campaign.value("PROJECTS",Json::array());
        const Json* project=nullptr;for(const auto& p:projects)if(string(p,"id")==id)project=&p;
        if(!project)return fail("unknown_project");const Json camp=campaign.value("CAMP",Json::object());
        if(!near(number(camp,"x",77.5),number(camp,"z",84.5),12))return fail("camp_required");
        Json& owned=region["outpost"]["projects"];if(std::find(owned.begin(),owned.end(),id)!=owned.end())return Json{{"ok",true},{"duplicate",true}};
        Json paid=pay(project->value("cost",Json::object()),"signal-project:"+key+":"+id);if(!boolean(paid,"ok"))return paid;
        owned.push_back(id);return Json{{"ok",true},{"projectId",id}};
    }
    if(action=="plant"){
        const int index=integer(args,"index",-1);const std::string crop=string(args,"crop");const Json crops=campaign.value("CROPS",Json::object());
        if(index<0||index>=2||!crops.contains(crop))return fail("invalid_plot");
        auto& projects=region["outpost"]["projects"];if(std::find(projects.begin(),projects.end(),"garden")==projects.end())return fail("garden_required");
        Json& plot=region["outpost"]["plots"][index];if(!plot.is_null())return fail("plot_occupied");
        Json paid=pay(Json{{"seed",1}},"signal-plant:"+key+":"+std::to_string(index)+":"+std::to_string(number(signal,"time")));
        if(!boolean(paid,"ok"))return paid;
        plot={{"crop",crop},{"plantedAt",number(signal,"time")},{"readyAt",number(signal,"time")+number(crops[crop],"seconds")}};
        return Json{{"ok",true},{"plot",plot}};
    }
    if(action=="crop_harvest"||action=="harvest_crop"){
        const int index=integer(args,"index",-1);if(index<0||index>=2)return fail("invalid_plot");
        Json& plot=region["outpost"]["plots"][index];if(plot.is_null())return fail("empty_plot");
        if(number(signal,"time")<number(plot,"readyAt"))return Json{{"ok",false},{"reason","not_ready"},{"remainingS",number(plot,"readyAt")-number(signal,"time")}};
        const std::string crop=string(plot,"crop"),claim="crop:"+key+":"+std::to_string(index)+":"+std::to_string(number(plot,"plantedAt"));
        Json out=reward(campaign["CROPS"][crop].value("reward",Json::object()),claim);if(boolean(out,"ok"))plot=nullptr;return out;
    }
    if(action=="travel"){
        const int dx=integer(args,"dx"),dz=integer(args,"dz");if(std::abs(dx)+std::abs(dz)!=1)return fail("adjacent_region_required");
        if(std::abs(rx+dx)>10000||std::abs(rz+dz)>10000)return fail("world_limit");
        if(!near(77.5,84.5,12)&&local.x>8&&local.z>8&&local.x<152&&local.z<152)return fail("edge_or_camp_required");
        if(!world.region_info(rx+dx,rz+dz))return fail("destination_unavailable");
        const Json camp=campaign.value("CAMP",Json::object());const double x=(rx+dx)*320+number(camp,"x",77.5),z=(rz+dz)*320+number(camp,"z",84.5);
        Json paid=pay(Json{{"food",1}},"signal-travel:"+key+":"+std::to_string(dx)+","+std::to_string(dz)+":"+std::to_string(number(signal,"time")));
        if(!boolean(paid,"ok"))return paid;signal["x"]=rx+dx;signal["z"]=rz+dz;
        const double y=surface(world,x,z)+.05;player_state_["position"]={{"x",x},{"y",y},{"z",z}};
        emit_event(gameplay,Json{{"type","region_travel"},{"id",std::to_string(rx+dx)+","+std::to_string(rz+dz)},
            {"regionId",std::to_string(rx+dx)+","+std::to_string(rz+dz)},{"position",player_state_["position"]}});
        return Json{{"ok",true},{"regionId",std::to_string(rx+dx)+","+std::to_string(rz+dz)},{"position",player_state_["position"]}};
    }
    if(action=="signal"){
        const std::string route=string(args,"route");const Json routes=campaign.value("SIGNAL_ROUTES",Json::object());
        if(!routes.contains(route))return fail("unknown_signal_route");Json& outpost=region["outpost"];
        if(outpost.value("signal",Json()).is_object())return fail("signal_already_restored");
        if(route=="explorer"&&!boolean(region,"cacheClaimed"))return fail("ruin_required");
        if(route=="guardian"&&!boolean(region["boss"],"defeated"))return fail("guardian_required");
        if(route=="community"&&integer(region,"completedContracts")<2)return fail("community_contracts_required");
        Json paid=pay(routes[route].value("cost",Json::object()),"signal-route:"+key+":"+route);if(!boolean(paid,"ok"))return paid;
        outpost["signal"]={{"route",route},{"channel",info->biome},{"restoredAt",number(signal,"time")}};
        return Json{{"ok",true},{"route",route}};
    }
    if(action=="village"){
        const std::string village_id=string(args,"villageId",string(args,"id")),choice=string(args,"action");
        Json* village=nullptr;for(auto& v:region["villages"])if(string(v,"id")==village_id)village=&v;
        if(!village)return fail("unknown_village");if(!near(number(*village,"x"),number(*village,"z"),12))return fail("out_of_range");
        const int faction=integer(*village,"faction");Json& reputation=signal["reputation"][faction];
        const bool hostile=number(reputation)<=-20;const std::string claim="village:"+village_id+":"+choice+":"+std::to_string(integer(*village,"serial"));
        if(hostile&&choice!="raid"&&choice!="peace")return fail("hostile");
        Json result;
        if(choice=="trade"){
            if(number(*village,"crystal")<2||number(*village,"food")<2)return fail("stock_required");
            result=pay(Json{{"wood",4}},claim);if(!boolean(result,"ok"))return result;
            (*village)["wood"]=std::min(80.0,number(*village,"wood")+4);(*village)["crystal"]=number(*village,"crystal")-2;(*village)["food"]=number(*village,"food")-2;
            result=reward(Json{{"crystal",2},{"food",2}},claim+":trade");
        }else if(choice=="aid"){
            result=pay(Json{{"food",3},{"plank",4}},claim);if(!boolean(result,"ok"))return result;
            result=reward(Json{{"knowledge",2}},claim+":aid");
            (*village)["food"]=std::min(80.0,number(*village,"food")+3);(*village)["aid"]=integer(*village,"aid")+1;
            (*village)["tech"]=std::min(2,integer(*village,"aid")/2+1);reputation=std::min(100.0,number(reputation)+12);
        }else if(choice=="ally"){
            if(number(reputation)<24)return fail("reputation_required");
            if(std::find(signal["allies"].begin(),signal["allies"].end(),faction)!=signal["allies"].end())return Json{{"ok",true},{"duplicate",true}};
            signal["allies"].push_back(faction);result=Json{{"ok",true}};
        }else if(choice=="peace"){
            result=pay(Json{{"food",6},{"iron",2}},claim);if(!boolean(result,"ok"))return result;reputation=std::max(0.0,number(reputation));
        }else if(choice=="raid"){
            if(number(signal,"time")-number(*village,"raidAt")<120)return fail("raid_cooldown");
            Json loot={{"food",std::min(4.0,number(*village,"food"))},{"crystal",std::min(3.0,number(*village,"crystal"))}};
            result=reward(loot,claim);if(!boolean(result,"ok"))return result;
            (*village)["food"]=std::max(0.0,number(*village,"food")-4);(*village)["crystal"]=std::max(0.0,number(*village,"crystal")-3);
            (*village)["raidAt"]=number(signal,"time");reputation=std::max(-100.0,number(reputation)-35);
        }else return fail("unknown_village_action");
        (*village)["serial"]=integer(*village,"serial")+1;return result;
    }
    if(action=="sortie"){
        const std::string kind=string(args,"kind"),op=string(args,"action","start");const Json sorties=campaign.value("SORTIES",Json::object());
        if(!sorties.contains(kind))return fail("unknown_sortie");Json& sortie=region["outpost"]["sortie"];
        if(op=="start"){
            if(!sortie.is_null())return fail("sortie_active");
            Json paid=pay(sorties[kind].value("cost",Json::object()),"sortie-start:"+key+":"+kind+":"+std::to_string(integer(region,"sortieSerial")));
            if(!boolean(paid,"ok"))return paid;
            sortie={{"kind",kind},{"startedAt",number(signal,"time")},{"done",false},{"delivered",false},{"visited",Json::array()},{"returnsToCamp",true}};
            region["sortieSerial"]=integer(region,"sortieSerial")+1;
            if(kind=="hunt"){
                const Json& camps=campaign.value("BIOMES",Json::array());const std::string boss=info->biome<int(camps.size())?string(camps[info->biome],"bossId"):std::string();
                Json spawn={{"id","boss:sortie:"+key},{"bossId",boss},{"instanceId","sortie:"+key},{"position",Json::array({rx*320+info->boss.x,surface(world,rx*320+info->boss.x,rz*320+info->boss.z),rz*320+info->boss.z})},
                    {"arenaOrigin",Json::array({rx*320+info->boss.x,0,rz*320+info->boss.z})},{"tier",info->tier+1}};
                if(!boss.empty())spawn_boss(spawn);
            }
            return Json{{"ok",true},{"sortie",sortie}};
        }
        if(op=="claim"){
            if(sortie.is_null()||string(sortie,"kind")!=kind)return fail("no_active_sortie");
            if(kind=="hunt"&&!boolean(sortie,"done"))return fail("sortie_incomplete");
            if(kind=="survey"&&sortie.value("visited",Json::array()).size()<3)return fail("survey_incomplete");
            if(kind=="supply"&&!boolean(sortie,"delivered"))return fail("delivery_required");
            if(!near(77.5,84.5,12))return fail("camp_required");
            Json result=reward(sorties[kind].value("reward",Json::object()),"sortie-reward:"+key+":"+std::to_string(integer(region,"sortieSerial")));
            if(boolean(result,"ok")){sortie=nullptr;signal["journey"]["sorties"]=integer(signal["journey"],"sorties")+1;}
            return result;
        }
        return fail("unknown_sortie_action");
    }
    if(action=="study"){
        const int type=integer(args,"type",-1);if(type<0||type>2)return fail("unknown_study");
        if(std::find(region["studies"].begin(),region["studies"].end(),type)!=region["studies"].end())return Json{{"ok",true},{"duplicate",true}};
        region["studies"].push_back(type);Json out=reward(Json{{"knowledge",2}},"study:"+key+":"+std::to_string(type));
        emit_event(gameplay,Json{{"type","observation"},{"id",key+":"+std::to_string(type)},{"ownerId",key},{"regionId",key},{"tier",info->tier},{"claimId","study:"+key+":"+std::to_string(type)}});
        return out;
    }
    if(action=="contract"){
        const std::string village_id=string(args,"villageId"),contract_id=string(args,"contractId");
        Json* village=nullptr;for(auto& v:region["villages"])if(string(v,"id")==village_id)village=&v;
        const Json contracts=frontier.value("CONTRACTS",Json::array());const Json* contract=nullptr;for(const auto& c:contracts)if(string(c,"id")==contract_id)contract=&c;
        if(!village||!contract)return fail("unknown_contract");if(!near(number(*village,"x"),number(*village,"z"),12))return fail("out_of_range");
        const std::string receipt=key+":"+village_id+"/"+contract_id;if(std::find(region["contracts"].begin(),region["contracts"].end(),receipt)!=region["contracts"].end())return Json{{"ok",true},{"duplicate",true}};
        Json paid=pay(contract->value("cost",Json::object()),"contract-cost:"+receipt);if(!boolean(paid,"ok"))return paid;
        Json out=reward(contract->value("reward",Json::object()),"contract-reward:"+receipt);if(!boolean(out,"ok"))return out;
        region["contracts"].push_back(receipt);region["completedContracts"]=integer(region,"completedContracts")+1;
        signal["reputation"][integer(*village,"faction")]=std::min(100.0,number(signal["reputation"][integer(*village,"faction")])+8);
        emit_event(gameplay,Json{{"type","community_contract"},{"id",contract_id},{"ownerId",village_id},{"regionId",key},{"items",contract->value("reward",Json::object())},{"claimId","contract-reward:"+receipt}});
        return out;
    }
    if(action=="guardian_damage"){
        Json& guardian=region["boss"];Json& active=region["outpost"]["sortie"];
        const bool echo=active.is_object()&&string(active,"kind")=="hunt";
        Json& target=echo?active["boss"]:guardian;
        if(target.is_null()||boolean(target,"defeated"))return fail("no_live_boss");
        const double amount=number(args,"amount",number(args,"damage"));if(!std::isfinite(amount)||amount<=0)return fail("invalid_damage");
        const std::string receipt=string(args,"attackId");if(!receipt.empty()&&has_array(target,"damageReceipts"))for(const auto& old:target["damageReceipts"])if(string(old,"id")==receipt)return Json{{"ok",true},{"duplicate",true}};
        if(!has_array(target,"damageReceipts"))target["damageReceipts"]=Json::array();
        target["damageReceipts"].push_back(Json{{"id",receipt},{"amount",amount}});
        const double before=number(target,"hp"),lost=std::min(before,amount);target["hp"]=before-lost;
        if(number(target,"hp")<=EPS){
            target["hp"]=0;target["defeated"]=true;target["warning"]=0;
            if(echo){active["done"]=true;active["completedAt"]=number(signal,"time");}
            else{
                const Json items={{"relic",info->tier},{"knowledge",6*info->tier},{"iron",5*info->tier}};
                Json out=reward(items,"guardian:"+key);if(!boolean(out,"ok"))return out;
            }
            emit_event(gameplay,Json{{"type","boss_defeated"},{"id",echo?"guardian-echo:"+key:"guardian:"+key},
                {"ownerId",key},{"bossId","first-signal-guardian"},{"tier",info->tier},
                {"position",Json::array({rx*320+number(target,"x"),surface(world,rx*320+number(target,"x"),rz*320+number(target,"z")),rz*320+number(target,"z")})},
                {"claimId",echo?"sortie-reward:"+key:"guardian:"+key}});
        }
        return Json{{"ok",true},{"damage",lost},{"hp",number(target,"hp")},{"defeated",boolean(target,"defeated")},{"echo",echo}};
    }
    return fail("unknown_first_signal_command");
}

Json Simulation::command(const std::string& name,Json args,World& world,Gameplay& gameplay){
    if(!args.is_object())return fail("invalid_arguments");
    if(name.rfind("first_signal.",0)==0||name.rfind("first-signal.",0)==0)
        return command_first_signal(name,std::move(args),world,gameplay);
    if(name=="creature.spawn")return spawn_creature(args,world);
    if(name=="creature.damage")return damage_creature(args,gameplay);
    if(name=="creature.wound"){args["mode"]="slash";return damage_creature(args,gameplay);}
    if(name=="creature.interact"){
        const std::string id=string(args,"id",string(args,"entityId")),action=string(args,"action");if(id.empty())return fail("target_id_required");
        if(action=="drops")return command("creature.claim_drops",Json{{"id",id}},world,gameplay);
        if(action=="feed")return command("creature.feed",std::move(args),world,gameplay);
        if(action=="rest")return command("creature.rest",std::move(args),world,gameplay);
        auto it=creatures_.find(id);if(it==creatures_.end())return fail("unknown_creature");
        if(distance_xz(player_,{number(it->second,"x"),number(it->second,"y"),number(it->second,"z")})>3)return fail("out_of_range");
        it->second["interactionSerial"]=integer(it->second,"interactionSerial")+1;
        return Json{{"ok",true},{"entityId",id},{"speciesId",string(it->second,"speciesId")},{"state",string(it->second,"state")},
            {"hp",number(it->second,"hp")},{"maxHp",number(it->second,"maxHp")},{"calories",it->second.value("calories",Json())}};
    }
    if(name=="creature.claim_drops"){
        const std::string target=string(args,"id",string(args,"entityId"));
        const std::string corpse_id=target.rfind("corpse:",0)==0?target:"corpse:"+target;
        auto it=corpses_.find(corpse_id);if(it==corpses_.end())return fail("unknown_corpse");
        Json& corpse=it->second;if(boolean(corpse,"claimed"))return Json{{"ok",true},{"duplicate",true}};
        const Vec3 p{number(corpse,"x"),number(corpse,"y"),number(corpse,"z")};
        if(distance_xz(player_,p)>4)return fail("out_of_range");
        Json out=gameplay.grant(corpse.value("drops",Json::object()),corpse_id+":drops");
        if(!boolean(out,"ok"))return out;corpse["claimed"]=true;corpse["edibleCp"]=0;out["corpseId"]=corpse_id;return out;
    }
    if(name=="creature.rest"||name=="creature.feed"||name=="creature.trade"){
        const std::string id=string(args,"id",string(args,"entityId"));auto it=creatures_.find(id);
        if(it==creatures_.end()||boolean(it->second,"dead"))return fail("unknown_creature");
        Json& e=it->second;const Json& species=entry(string(e,"speciesId"));
        if(distance_xz(player_,{number(e,"x"),number(e,"y"),number(e,"z")})>3)return fail("out_of_range");
        if(name=="creature.rest"){e["rest"]=boolean(args,"resting",!boolean(e,"rest"));return Json{{"ok",true},{"resting",e["rest"]}};}
        if(name=="creature.feed"){
            const Json cal=species.value("calories",Json::object());const double maximum=number(cal,"maxCp"),current=number(e,"calories");
            if(current>=maximum)return fail("not_hungry");const std::string item=string(args,"itemId","meat");
            const std::string claim=string(args,"claim",id+":feed:"+std::to_string(integer(e,"interactionSerial")));
            Json paid=gameplay.spend(Json{{item,1}},claim);if(!boolean(paid,"ok"))return paid;
            e["calories"]=std::min(maximum,current+number(args,"calories",maximum*.2));e["interactionSerial"]=integer(e,"interactionSerial")+1;
            return Json{{"ok",true},{"calories",e["calories"]}};
        }
        if(!boolean(e,"civilization"))return fail("not_tradeable");
        const std::string claim=string(args,"claim",id+":trade:"+std::to_string(integer(e,"interactionSerial")));
        Json paid=gameplay.spend(Json{{"food",1}},claim);if(!boolean(paid,"ok"))return paid;
        Json out=gameplay.grant(Json{{"wood",2}},claim+":receipt");if(boolean(out,"ok"))e["interactionSerial"]=integer(e,"interactionSerial")+1;return out;
    }
    if(name=="ecology.ensure_region"){
        const double x=number(args,"x",player_.x),z=number(args,"z",player_.z);
        const int rx=int(std::floor(x/64)),rz=int(std::floor(z/64));const std::string id="ecology:"+seed_+":"+std::to_string(rx)+","+std::to_string(rz);
        if(regions_.count(id))return Json{{"ok",true},{"regionId",id},{"duplicate",true}};
        const SurfaceSample sample=world.surface_sample(x,z);
        regions_[id]={{"id",id},{"kind","outdoor"},{"environmentId",sample.environment_id},{"x",x},{"y",sample.height},{"z",z},
            {"tier",sample.tier},{"capacity",14},{"initialized",true},{"foodNodes",Json::array()},{"speciesCaps",Json::object()},
            {"safeBypass",sample.safe_bypass},{"lastUpdatedAt",time_},{"nextBirthAt",time_+60}};
        return Json{{"ok",true},{"regionId",id}};
    }
    if(name=="dungeon.ensure")return ensure_dungeon(args,world);
    if(name=="dungeon.enter"){
        const std::string id=string(args,"id",string(args,"instanceId")),room=string(args,"roomId");
        auto it=dungeons_.find(id);if(it==dungeons_.end())return fail("unknown_dungeon");
        const Json& def=entry(string(it->second,"templateId"));bool valid=false;
        for(const auto& r:def.value("rooms",Json::array()))if(string(r,"id")==room)valid=true;
        if(!valid)return fail("unknown_room");
        append_array(it->second,"visitedRooms",room);it->second["discovered"]=true;
        it->second["revision"]=integer(it->second,"revision")+1;
        emit_event(gameplay,Json{{"type","dungeon_discovered"},{"id",id},{"ownerId",id},{"templateId",string(it->second,"templateId")},
            {"regionId",string(it->second,"siteId")},{"roomId",room},{"tier",integer(it->second,"regionTier")},
            {"position",it->second["origin"]}});
        return Json{{"ok",true},{"instanceId",id},{"roomId",room},{"visitedRooms",it->second["visitedRooms"]}};
    }
    if(name=="dungeon.device"){
        const std::string id=string(args,"id",string(args,"instanceId")),action=string(args,"action");
        auto it=dungeons_.find(id);if(it==dungeons_.end())return fail("unknown_dungeon");
        Json& d=it->second;const Json& def=entry(string(d,"templateId"));
        if(!def.contains("puzzle"))return fail("no_puzzle");
        const Vec3 origin=point(d.value("origin",Json::array({0,0,0})));
        const Vec3 actor=args.contains("position")?point(args["position"]):player_;
        if(distance_xz(origin,actor)>12)return fail("out_of_range");
        Json& state=d["deviceState"];
        if(!state.is_object()||!state.contains("parts")){
            state={{"version",1},{"parts",Json::object()},{"structureParts",Json::object()},{"energy",Json::object()},
                {"claims",Json::array()},{"solved",false},{"work",{{"progressM",0.0},{"progressEU",0.0},{"active",false}}}};
            const std::string tid=string(d,"templateId");
            if(tid=="floodworks")state["fluid"]={{"initialLiters",400},{"sourceLiters",400},{"receiverLiters",0},{"safeLiters",200},{"running",false}};
            if(tid=="sealed_arboretum")state["fluid"]={{"initialLiters",60},{"sourceLiters",60},{"receiverLiters",0},{"safeLiters",6},{"running",false}};
            if(tid=="geothermal_foundry")state["heat"]={{"pathEU",600},{"sourceEU",400},{"coolantLiters",20},{"coolantHeatEU",0},{"valveOpen",true},{"pumpRunning",false}};
            if(tid=="cliff_observatory")state["wind"]={{"angleRad",0},{"locked",false},{"vaneAttached",true}};
            if(tid=="forgotten_monastery")state["altar"]={{"angleRad",0},{"aligned",false},{"running",false},{"divineConsumedEU",0}};
            if(tid=="inertia_tower")state["motion"]={{"positionM",2.75},{"velocityMps",1},{"kineticEU",2500},{"capturedEU",0},{"braking",false},{"locked",false},{"targetM",4}};
        }
        const Json anchors=def["puzzle"].value("componentAnchors",Json::array());
        if(action=="install"||action=="replace"){
            const std::string anchor=string(args,"anchorId");const Json* spec=nullptr;
            for(const auto& a:anchors)if(string(a,"id")==anchor)spec=&a;if(!spec)return fail("unknown_component_anchor");
            Json& part=state["parts"][anchor];if(boolean(part,"installed")&&number(part,"healthHp",100)>0)return Json{{"ok",true},{"duplicate",true}};
            const std::string component=string(*spec,"componentId");
            Json paid=gameplay.spend(Json{{component,1}},id+":install:"+anchor+":"+std::to_string(integer(part,"replacements")));
            if(!boolean(paid,"ok"))return paid;
            part={{"componentId",component},{"installed",true},{"healthHp",100},{"maxHealthHp",100},
                {"ownerId",args.value("ownerId",Json())},{"replacements",integer(part,"replacements")+(action=="replace"?1:0)}};
        }else if(action=="repair"){
            const std::string anchor=string(args,"anchorId");if(!state["parts"].contains(anchor))return fail("unknown_component_anchor");
            Json& part=state["parts"][anchor];const double missing=number(part,"maxHealthHp",100)-number(part,"healthHp");
            if(missing<=EPS)return fail("already_full");
            const std::string material=string(args,"materialId","wood");const double units=number(args,"units",1);
            Json paid=gameplay.spend(Json{{material,units}},id+":repair:"+anchor+":"+std::to_string(integer(part,"repairSerial")));
            if(!boolean(paid,"ok"))return paid;part["healthHp"]=number(part,"maxHealthHp");part["repairSerial"]=integer(part,"repairSerial")+1;
        }else if(action=="operate"||action=="pump"||action=="align"||action=="open"||action=="brake"||action=="valve"){
            const std::string tid=string(d,"templateId");
            const double seconds=clampd(number(args,"seconds",1),.05,10);
            auto has_component=[&](const std::string& component){for(const auto& anchor:anchors){const std::string aid=string(anchor,"id");if(string(anchor,"componentId")==component&&boolean(state["parts"].value(aid,Json::object()),"installed")&&number(state["parts"][aid],"healthHp")>0)return true;}return false;};
            if(tid=="root_manor"||tid=="mining_fort"){
                const bool required=has_component("joint")&&(tid!="mining_fort"||has_component("transmission"));if(!required)return fail("components_required");
                const double rate=10,energy=rate*seconds;Json paid=gameplay.command("simulation.pay",Json{{"energy",{{"mechanical",energy}}},{"claim",id+":lift:"+std::to_string(int(time_/.05))}});
                if(!boolean(paid,"ok"))return paid;const double distance=std::min(tid=="root_manor"?4.5:3.0,number(state["work"],"progressM")+energy*.1);
                state["work"]["progressM"]=distance;state["work"]["progressEU"]=number(state["work"],"progressEU")+energy;state["work"]["active"]=distance<(tid=="root_manor"?4.5:3.0);
            }else if(tid=="floodworks"||tid=="sealed_arboretum"){
                if(!has_component("pump")||!has_component(tid=="floodworks"?"fluid_container":"mana_condenser"))return fail("components_required");
                const std::string type=tid=="floodworks"?"mechanical":"magic";const double rate=10,energy=rate*seconds;
                Json paid=gameplay.command("simulation.pay",Json{{"energy",{{type,energy}}},{"claim",id+":pump:"+std::to_string(int(time_/.05))}});if(!boolean(paid,"ok"))return paid;
                Json& fluid=state["fluid"];const double moved=std::min(number(fluid,"sourceLiters"),number(args,"rateLPerS",10)*seconds);
                fluid["sourceLiters"]=number(fluid,"sourceLiters")-moved;fluid["receiverLiters"]=number(fluid,"receiverLiters")+moved;fluid["running"]=true;
                if(tid=="sealed_arboretum")fluid["route"]="receiver";
            }else if(tid=="geothermal_foundry"){
                if(!has_component("pump")||!has_component("heat_engine"))return fail("components_required");
                if(action=="valve"){state["heat"]["valveOpen"]=boolean(args,"open",false);}
                else{
                    const double energy=10*seconds;Json paid=gameplay.command("simulation.pay",Json{{"energy",{{"mechanical",energy}}},{"claim",id+":cool:"+std::to_string(int(time_/.05))}});if(!boolean(paid,"ok"))return paid;
                    Json& heat=state["heat"];const double removed=std::min(number(heat,"pathEU"),std::min(number(heat,"coolantLiters")*60,energy*6));heat["pathEU"]=number(heat,"pathEU")-removed;heat["coolantHeatEU"]=number(heat,"coolantHeatEU")+removed;heat["pumpRunning"]=true;
                }
            }else if(tid=="cliff_observatory"){
                if(!has_component("joint")||!has_component("controller"))return fail("components_required");
                const double angle=number(args,"angleRad",number(args,"angle",1.5707963267948966));state["wind"]["angleRad"]=clampd(angle,-3.141592653589793,3.141592653589793);
                if(action=="open")state["wind"]["locked"]=!boolean(args,"open",false);else state["wind"]["locked"]=boolean(args,"locked",true);
            }else if(tid=="forgotten_monastery"){
                if(!has_component("relic")||!has_component("transmission"))return fail("components_required");
                if(action=="align"){state["altar"]["angleRad"]=number(args,"angleRad",1.5707963267948966);state["altar"]["aligned"]=std::abs(number(state["altar"],"angleRad")-1.5707963267948966)<.05;}
                else{if(!boolean(state["altar"],"aligned"))return fail("altar_alignment_required");const double requested=std::min(1.0,seconds);Json paid=gameplay.command("simulation.pay",Json{{"energy",{{"divine",requested}}},{"claim",id+":divine:"+std::to_string(int(time_/.05))}});if(!boolean(paid,"ok"))return paid;state["altar"]["divineConsumedEU"]=number(state["altar"],"divineConsumedEU")+requested;state["altar"]["running"]=true;}
            }else if(tid=="inertia_tower"){
                if(!has_component("inertial_cell")||!has_component("controller"))return fail("components_required");
                Json& motion=state["motion"];if(action=="brake"||action=="operate"){motion["braking"]=true;const double reduction=std::min(number(motion,"kineticEU"),.4*number(args,"seconds",1)*number(motion,"massKg",500));motion["kineticEU"]=number(motion,"kineticEU")-reduction;motion["velocityMps"]=std::sqrt(std::max(0.0,2*number(motion,"kineticEU")*100/500));motion["positionM"]=clampd(number(motion,"positionM")+number(motion,"velocityMps")*seconds,0,8);if(number(motion,"velocityMps")<=.1&&std::abs(number(motion,"positionM")-4)<=.5)motion["locked"]=true;}
            }
        }else return fail("unknown_device_action");
        bool all=true;for(const auto& anchor:anchors)all=all&&boolean(state["parts"].value(string(anchor,"id"),Json::object()),"installed");
        const std::string tid=string(d,"templateId");bool solved=all;
        if(tid=="root_manor")solved=solved&&number(state["work"],"progressM")>=4.5;
        else if(tid=="mining_fort")solved=solved&&number(state["work"],"progressM")>=3;
        else if(tid=="floodworks")solved=solved&&number(state.value("fluid",Json::object()),"sourceLiters",400)<=200;
        else if(tid=="sealed_arboretum")solved=solved&&number(state.value("fluid",Json::object()),"sourceLiters",60)<=6;
        else if(tid=="geothermal_foundry")solved=solved&&!boolean(state.value("heat",Json::object()),"valveOpen",true)&&number(state.value("heat",Json::object()),"pathEU",600)<=200;
        else if(tid=="cliff_observatory")solved=solved&&boolean(state.value("wind",Json::object()),"locked");
        else if(tid=="forgotten_monastery")solved=solved&&boolean(state.value("altar",Json::object()),"aligned")&&number(state.value("altar",Json::object()),"divineConsumedEU")>=10;
        else if(tid=="inertia_tower")solved=solved&&boolean(state.value("motion",Json::object()),"locked");
        state["solved"]=solved;d["puzzle"]["phase"]=solved?"open":boolean(state["work"],"active")?"opening":"locked";d["revision"]=integer(d,"revision")+1;
        if(solved&&!boolean(d.value("puzzle",Json::object()),"eventRecorded")){d["puzzle"]["eventRecorded"]=true;emit_event(gameplay,Json{{"type","dungeon_solved"},{"id",id},{"ownerId",id},{"templateId",tid},{"tier",integer(d,"regionTier")},{"position",d["origin"]}});}
        return Json{{"ok",true},{"solved",solved},{"deviceState",state}};
    }
    if(name=="dungeon.claim_reward"){
        const std::string id=string(args,"id"),anchor=string(args,"anchorId","boss");auto it=dungeons_.find(id);
        if(it==dungeons_.end())return fail("unknown_dungeon");Json& d=it->second;const Json& def=entry(string(d,"templateId"));
        if(anchor=="boss"){const std::string bid="boss:"+id+":"+string(def.value("bossArena",Json::object()),"bossId");auto b=bosses_.find(bid);if(b==bosses_.end()||!boolean(b->second,"defeated"))return fail("boss_not_defeated");return command("boss.claim_reward",{{"id",bid}},world,gameplay);}
        if(boolean(d.value("claims",Json::object()),anchor))return Json{{"ok",true},{"duplicate",true}};
        if(anchor=="puzzle"&&!boolean(d.value("deviceState",Json::object()),"solved"))return fail("puzzle_incomplete");
        const std::string claim=id+":reward:"+anchor;
        Json reward=gameplay.command("simulation.reward",Json{{"items",{{"knowledge",2},{"iron",2}}},{"claim",claim}});
        if(boolean(reward,"ok"))d["claims"][anchor]=true;return reward;
    }
    if(name=="dungeon.damage"){
        const std::string id=string(args,"id"),part=string(args,"partId");auto it=dungeons_.find(id);if(it==dungeons_.end())return fail("unknown_dungeon");
        const double amount=number(args,"amount");if(amount<=0)return fail("invalid_damage");Json& ledger=it->second["damage"];const double max=number(args,"maxHp",100),old=number(ledger,part,max);ledger[part]=std::max(0.0,old-amount);it->second["revision"]=integer(it->second,"revision")+1;
        return Json{{"ok",true},{"partId",part},{"damage",old-number(ledger,part)},{"hp",ledger[part]},{"broken",number(ledger,part)<=EPS}};
    }
    if(name=="boss.spawn")return spawn_boss(args);
    if(name=="boss.damage"){
        const std::string id=string(args,"id",string(args,"bossId"));
        if(id=="first-signal/guardian"||id=="guardian")return command_first_signal("guardian_damage",std::move(args),world,gameplay);
        return damage_boss(args,gameplay);
    }
    if(name=="boss.gimmick"){
        const std::string id=string(args,"id"),g=string(args,"gimmickId");auto it=bosses_.find(id);
        if(it==bosses_.end()||boolean(it->second,"defeated"))return fail("unknown_boss");
        if(!it->second.value("gimmicks",Json::object()).contains(g))return fail("unknown_gimmick");
        Json& state=it->second["gimmicks"][g];if(boolean(state,"broken"))return Json{{"ok",true},{"duplicate",true}};
        state["uses"]=integer(state,"uses")-1;if(integer(state,"uses")<=0){state["broken"]=true;it->second["exposedUntil"]=number(it->second,"age")+5;}
        return Json{{"ok",true},{"gimmick",state}};
    }
    if(name=="boss.claim_reward"){
        const std::string id=string(args,"id");auto it=bosses_.find(id);if(it==bosses_.end())return fail("unknown_boss");
        Json& boss=it->second;if(!boolean(boss,"defeated"))return fail("boss_not_defeated");Json& reward=boss["reward"];
        if(!reward.is_object())return fail("reward_missing");if(boolean(reward,"claimed"))return Json{{"ok",true},{"duplicate",true}};
        const std::string reward_id=string(reward,"poolId");Json items=Json::object();
        for(const auto& row:content_.data.value("bosses",Json::object()).value("rewards",Json::array()))if(string(row,"id")==reward_id)items=row.value("items",Json::object());
        if(items.empty())items={{"iron",4*integer(boss,"tier",1)},{"knowledge",2*integer(boss,"tier",1)}};
        Json out=gameplay.command("simulation.reward",Json{{"items",items},{"claim",string(reward,"key")}});
        if(boolean(out,"ok"))reward["claimed"]=true;return out;
    }
    if(name=="machine.create")return create_machine(args,gameplay,false);
    if(name=="machine.import_design")return create_machine(args,gameplay,true);
    if(name=="machine.example"){
        if(!modules_.contains("machine-field"))return fail("machine_field_required");
        for(auto it=machines_.begin();it!=machines_.end();)if(boolean(it->second,"fieldExample")){machine_bodies_.erase(it->first);it=machines_.erase(it);}else ++it;
        const bool heavy=boolean(args,"heavy");const double x=0,z=5,half=.25;
        Json design={{"name",heavy?"중량 예제":"경량 예제"},{"gridM",.5},
            {"position",args.value("position",Json::array({x+half,surface(world,x,z)+.06,z+half}))},
            {"yaw",number(args,"yaw",3.141592653589793)},{"fieldExample",true}};
        Json voxels=Json::array();for(int k=-1;k<=1;k++)voxels.push_back(Json{{"cell",Json::array({0,0,k})},{"materialId","wood"}});
        voxels.push_back(Json{{"cell",Json::array({0,1,0})},{"materialId","wood"}});
        for(int side:{-1,1})for(int k:{-1,1})voxels.push_back(Json{{"cell",Json::array({side,0,k})},{"materialId","wood"}});
        if(heavy)for(int k=-2;k<=2;k++)for(int side:{-1,0,1})if(side||k)voxels.push_back(Json{{"cell",Json::array({side,1,k})},{"materialId","wood"}});
        Json components=Json::array({Json{{"cell",Json::array({0,1,0})},{"componentId","heat_engine"},{"fuelItems",8}}});
        components.push_back(Json{{"cell",heavy?Json::array({0,1,2}):Json::array({0,0,1})},{"componentId","controller"}});
        for(int side:{-1,1})for(int k:{-1,1})components.push_back(Json{{"cell",Json::array({side,0,k})},{"componentId","transmission"},{"legacyType","wheel"}});
        Json links=Json::array();for(size_t i=2;i<components.size();i++)links.push_back(Json{{"from",0},{"to",int(i)},{"type","mechanical"}});
        design["voxels"]=voxels;design["components"]=components;design["links"]=links;
        Json result=create_machine(design,gameplay,true);if(boolean(result,"ok"))machines_[result["machineId"].get<std::string>()]["fieldExample"]=true;return result;
    }
    if(name=="machine.return_to_pad"){
        if(!modules_.contains("machine-field"))return fail("machine_field_required");
        const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        Json& m=it->second;const double x=0,z=5,half=number(m,"gridM",.5)/2;
        const Vec3 p=args.contains("position")?point(args["position"]):Vec3{x+half,surface(world,x,z)+.06,z+half};
        const double yaw=number(args,"yaw",3.141592653589793);
        m["position"]=vec_json(p);m["yaw"]=yaw;m["rotation"]=quat_json(yaw_quat(yaw));m["velocity"]=vec_json({});m["angularVelocity"]=vec_json({});m["command"]={{"throttle",0},{"steer",0},{"pitch",0},{"brake",true},{"push",0}};
        m["anchored"]=false;m["revision"]=integer(m,"revision")+1;rebuild_machine(id);
        queue_event(Json{{"type","machine_returned_to_pad"},{"id",id},{"ownerId",id},{"position",vec_json(p)}});
        return Json{{"ok",true},{"id",id},{"position",vec_json(p)},{"yaw",yaw},{"resetVelocity",true}};
    }
    if(name=="machine.attach")return attach_machine_voxel(args,gameplay);
    if(name=="machine.install")return install_machine_component(args,gameplay);
    if(name=="machine.active"){
        const std::string id=string(args,"id",string(args,"machineId")),instance=string(args,"componentInstanceId");auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");if(!args.contains("active")||!args["active"].is_boolean())return fail("invalid_active_state");
        Json& m=it->second;auto c=std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& row){return string(row,"id")==instance;});
        if(c==m["components"].end())return fail("unknown_component");const bool active=args["active"].get<bool>();const bool changed=boolean(*c,"active",true)!=active;
        (*c)["active"]=active;if(changed){m["revision"]=integer(m,"revision")+1;rebuild_machine(id);}return Json{{"ok",true},{"componentInstanceId",instance},{"active",active},{"changed",changed}};
    }
    if(name=="machine.charge"||name=="machine.drain"){
        const bool charging=name=="machine.charge";const std::string id=string(args,"id",string(args,"machineId")),instance=string(args,"componentInstanceId"),type=string(args,"type");
        auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
        auto c=std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& row){return string(row,"id")==instance;});if(c==m["components"].end())return fail("unknown_component");
        const Json& def=entry(string(*c,"componentId"));const Json stores=def.value("stores",Json::array());
        if(std::find(stores.begin(),stores.end(),Json(type))==stores.end())return fail("unsupported_storage_type");
        const double amount=number(args,"amount",-1),capacity=number(def,"capacity",0);if(!std::isfinite(amount)||amount<=EPS||capacity<=EPS)return fail("invalid_energy_amount");
        const double efficiency=(type=="mechanical"||type=="electrical")?.9:1.0;Json& energy=(*c)["energy"];if(!energy.is_object())energy=Json::object();
        const double current=number(energy,type,0);const std::string claim=string(args,"claim",id+":"+(charging?"charge":"drain")+":"+instance+":"+std::to_string(integer(m,"energyTransferSerial",0)));
        if(claim.empty()||claim.size()>160)return fail("invalid_claim");if(!m.contains("energyTransfers")||!m["energyTransfers"].is_object())m["energyTransfers"]=Json::object();
        if(m["energyTransfers"].contains(claim)){Json receipt=m["energyTransfers"][claim];receipt["duplicate"]=true;return receipt;}
        if(charging){
            const double stored=amount*efficiency;if(current+stored>capacity+EPS)return fail("storage_capacity");
            Json paid=gameplay.command("energy.consume",Json{{"type",type},{"amount",amount},{"claim",claim}});if(!boolean(paid,"ok"))return paid;
            if(boolean(paid,"duplicate"))return paid;energy[type]=current+stored;
            Json result={{"ok",true},{"componentInstanceId",instance},{"type",type},{"inputEU",amount},{"storedEU",stored},{"energy",energy}};
            m["energyTransfers"][claim]=result;m["energyTransferSerial"]=integer(m,"energyTransferSerial",0)+1;return result;
        }
        if(current+EPS<amount)return fail("component_storage_empty");
        Json stored=gameplay.command("energy.store",Json{{"type",type},{"amount",amount}});const double accepted=number(stored,"accepted",0),received=number(stored,"stored",accepted*efficiency);
        if(accepted<=EPS)return fail("wallet_capacity_full");energy[type]=std::max(0.0,current-accepted);
        Json result={{"ok",true},{"componentInstanceId",instance},{"type",type},{"drainedEU",accepted},{"receivedEU",received},{"energy",energy},{"remainderEU",std::max(0.0,amount-accepted)}};
        m["energyTransfers"][claim]=result;m["energyTransferSerial"]=integer(m,"energyTransferSerial",0)+1;return result;
    }
    if(name=="machine.control"){
        const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        for(const auto& key:{"throttle","steer","pitch","push"})if(args.contains(key)){if(!args[key].is_number()||std::abs(args[key].get<double>())>1)return fail("invalid_control");it->second["command"][key]=args[key];}
        if(args.contains("brake")){if(!args["brake"].is_boolean())return fail("invalid_control");it->second["command"]["brake"]=args["brake"];}
        it->second["commandAt"]=time_;return Json{{"ok",true},{"command",it->second["command"]}};
    }
    if(name=="machine.anchor"){
        const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        it->second["anchored"]=boolean(args,"anchored",!boolean(it->second,"anchored"));
        if(boolean(it->second,"anchored")){it->second["velocity"]=vec_json({});it->second["angularVelocity"]=vec_json({});}
        rebuild_machine(id);
        return Json{{"ok",true},{"anchored",it->second["anchored"]}};
    }
    if(name=="machine.damage"){
        const std::string id=string(args,"id",string(args,"machineId")),part=string(args,"partId",string(args,"voxelId"));auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
        auto voxel=std::find_if(m["voxels"].begin(),m["voxels"].end(),[&](const Json& v){return string(v,"id")==part;});
        if(voxel==m["voxels"].end())return fail("unknown_part");
        const std::string attack=string(args,"attackId");if(!attack.empty())for(const auto& receipt:m.value("damageClaims",Json::array()))if(string(receipt,"id")==attack)return Json{{"ok",true},{"duplicate",true}};
        const double amount=number(args,"amount");if(amount<=0||!std::isfinite(amount))return fail("invalid_damage");
        const double old=number(*voxel,"hp");(*voxel)["hp"]=std::max(0.0,old-amount);
        if(!attack.empty())m["damageClaims"].push_back(Json{{"id",attack},{"partId",part},{"amount",old-number(*voxel,"hp")}});
        m["revision"]=integer(m,"revision")+1;rebuild_machine(id);
        return Json{{"ok",true},{"damage",old-number(*voxel,"hp")},{"hp",number(*voxel,"hp")},{"broken",number(*voxel,"hp")<=EPS}};
    }
    if(name=="machine.repair"){
        const std::string id=string(args,"id",string(args,"machineId")),part=string(args,"partId");auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
        auto voxel=std::find_if(m["voxels"].begin(),m["voxels"].end(),[&](const Json& v){return string(v,"id")==part;});
        if(voxel==m["voxels"].end())return fail("unknown_part");
        const double missing=number(*voxel,"maxHp")-number(*voxel,"hp");if(missing<=EPS)return fail("already_full");
        const std::string material=string(args,"materialId",string(*voxel,"materialId"));
        Json paid=gameplay.spend(Json{{material,number(*voxel,"volumeLiters")*missing/std::max(EPS,number(*voxel,"maxHp"))}},
            string(args,"claim",id+":repair:"+part+":"+std::to_string(integer(m,"repairSerial"))));
        if(!boolean(paid,"ok"))return paid;(*voxel)["hp"]=number(*voxel,"maxHp");m["repairSerial"]=integer(m,"repairSerial")+1;m["revision"]=integer(m,"revision")+1;rebuild_machine(id);
        return Json{{"ok",true},{"partId",part},{"hp",number(*voxel,"hp")}};
    }
    if(name=="machine.remove"){
        const std::string id=string(args,"id",string(args,"machineId")),part=string(args,"partId");auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
        for(const auto& c:m["components"])if(string(c,"id")==part||string(c,"voxelId")==part)return fail("remove_component_first");
        auto voxel=std::find_if(m["voxels"].begin(),m["voxels"].end(),[&](const Json& v){return string(v,"id")==part;});
        if(voxel==m["voxels"].end())return fail("unknown_part");Json removed=*voxel;
        const double salvage=number(removed,"volumeLiters")*number(removed,"hp")/std::max(EPS,number(removed,"maxHp"));
        Json out=gameplay.grant(Json{{string(removed,"materialId"),salvage}},id+":salvage:"+part);
        if(!boolean(out,"ok"))return out;m["voxels"].erase(voxel);m["revision"]=integer(m,"revision")+1;rebuild_machine(id);
        return Json{{"ok",true},{"salvaged",salvage},{"removedPart",part}};
    }
    if(name=="machine.remove_component"){
        const std::string id=string(args,"id",string(args,"machineId")),component=string(args,"componentInstanceId",string(args,"partId"));auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;auto c=std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& v){return string(v,"id")==component;});
        if(c==m["components"].end())return fail("unknown_component");
        if(number(c->value("fuel",Json()))>EPS||integer(*c,"fuelItems")>0)return fail("empty_component_first");
        const Json energy=c->value("energy",Json::object()),fluids=c->value("fluids",Json::object());
        for(auto it=energy.begin();it!=energy.end();++it)if(number(it.value())>EPS)return fail("empty_component_first");
        for(auto it=fluids.begin();it!=fluids.end();++it)if(number(it.value())>EPS)return fail("empty_component_first");
        const std::string voxel_id=string(*c,"voxelId");for(const auto& v:m["voxels"])if(string(v,"id")==voxel_id&&number(v,"hp")+EPS<number(v,"maxHp"))return fail("damaged_component_requires_repair");
        Json result=gameplay.grant(Json{{string(*c,"componentId"),1}},id+":unmount:"+component);if(!boolean(result,"ok"))return result;
        m["components"].erase(c);Json links=Json::array();for(const auto& l:m["links"])if(string(l,"from")!=component&&string(l,"to")!=component)links.push_back(l);
        m["links"]=links;m["revision"]=integer(m,"revision")+1;rebuild_machine(id);return Json{{"ok",true}};
    }
    if(name=="machine.refuel"){
        const std::string id=string(args,"id",string(args,"machineId")),component=string(args,"componentInstanceId");auto it=machines_.find(id);
        if(it==machines_.end())return fail("unknown_machine");auto c=std::find_if(it->second["components"].begin(),it->second["components"].end(),[&](const Json& x){return string(x,"id")==component;});
        if(c==it->second["components"].end()||string(*c,"componentId")!="heat_engine")return fail("invalid_fuel");
        const int count=std::clamp(integer(args,"count",1),1,64);const std::string claim=string(args,"claim",id+":fuel:"+std::to_string(next_id_));
        Json paid=gameplay.spend(Json{{string(args,"itemId","raw_timber"),count}},claim);if(!boolean(paid,"ok"))return paid;
        (*c)["fuelItems"]=integer(*c,"fuelItems")+count;refresh_machine_mass(id);return Json{{"ok",true},{"fuelItems",integer(*c,"fuelItems")}};
    }
    if(name=="machine.connect"){
        const std::string id=string(args,"id",string(args,"machineId")),from=string(args,"from"),to=string(args,"to"),type=string(args,"type");
        auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        const Json* a=nullptr;const Json* b=nullptr;
        for(const auto& c:it->second["components"])if(string(c,"id")==from)a=&entry(string(c,"componentId"));else if(string(c,"id")==to)b=&entry(string(c,"componentId"));
        if(!a||!b||from==to||!has_array(*a,"outputEnergies")||!has_array(*b,"inputEnergies")||
            std::find((*a)["outputEnergies"].begin(),(*a)["outputEnergies"].end(),type)==(*a)["outputEnergies"].end()||
            std::find((*b)["inputEnergies"].begin(),(*b)["inputEnergies"].end(),type)==(*b)["inputEnergies"].end())return fail("incompatible_ports");
        for(const auto& old:it->second["links"])if(string(old,"from")==from&&string(old,"to")==to&&string(old,"type")==type)return Json{{"ok",true},{"duplicate",true}};
        it->second["links"].push_back(Json{{"id",make_id("link")},{"from",from},{"to",to},{"type",type}});it->second["revision"]=integer(it->second,"revision")+1;
        return Json{{"ok",true}};
    }
    if(name=="machine.disconnect"){
        const std::string id=string(args,"id",string(args,"machineId")),link_id=string(args,"linkId");auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        auto& links=it->second["links"];const auto before=links.size();Json kept=Json::array();for(const auto& l:links)if(string(l,"id")!=link_id)kept.push_back(l);
        if(kept.size()==before)return fail("unknown_link");links=std::move(kept);it->second["revision"]=integer(it->second,"revision")+1;return Json{{"ok",true},{"linkId",link_id}};
    }
    if(name=="machine.fluid.fill"||name=="machine.fluid.drain"){
        const bool filling=name=="machine.fluid.fill";const std::string id=string(args,"id",string(args,"machineId")),instance=string(args,"componentInstanceId"),fluid=string(args,"fluid");
        auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");Json& m=it->second;
        auto c=std::find_if(m["components"].begin(),m["components"].end(),[&](const Json& row){return string(row,"id")==instance;});if(c==m["components"].end()||string(*c,"componentId")!="fluid_container")return fail("fluid_container_required");
        const Json& def=entry("fluid_container");const Json contents=def.value("fluidContents",Json::array());if(std::find(contents.begin(),contents.end(),Json(fluid))==contents.end())return fail("invalid_fluid");
        const double liters=number(args,"liters",-1),capacity=number(def,"capacityLiters",0);if(!std::isfinite(liters)||liters<=EPS)return fail("invalid_fluid_amount");
        Json& fluids=(*c)["fluids"];if(!fluids.is_object())fluids=Json::object();double total=0;for(auto f=fluids.begin();f!=fluids.end();++f)total+=number(f.value());
        if(filling){for(auto f=fluids.begin();f!=fluids.end();++f)if(f.key()!=fluid&&number(f.value())>EPS)return fail("mixed_fluid_types");if(total+liters>capacity+EPS)return fail("container_capacity");}
        else if(number(fluids,fluid)+EPS<liters)return fail("container_fluid_empty");
        const std::string claim=string(args,"claim",id+":"+(filling?"fluid-fill":"fluid-drain")+":"+instance+":"+std::to_string(next_id_));
        Json result=filling?gameplay.spend(Json{{fluid,liters}},claim):gameplay.grant(Json{{fluid,liters}},claim);if(!boolean(result,"ok"))return result;if(boolean(result,"duplicate"))return result;
        fluids[fluid]=filling?number(fluids,fluid)+liters:std::max(0.0,number(fluids,fluid)-liters);if(number(fluids,fluid)<=EPS)fluids.erase(fluid);
        next_id_++;m["revision"]=integer(m,"revision")+1;rebuild_machine(id);return Json{{"ok",true},{"componentInstanceId",instance},{"fluid",fluid},{"liters",liters},{"fluids",fluids}};
    }
    if(name=="machine.fluid.connect"){
        const std::string id=string(args,"id",string(args,"machineId")),source=string(args,"sourceComponentInstanceId"),pump=string(args,"pumpComponentInstanceId"),target=string(args,"targetComponentInstanceId");auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        auto component=[&](const std::string& instance)->std::string{for(const auto& c:it->second["components"])if(string(c,"id")==instance)return string(c,"componentId");return{};};
        if(source==target||component(source)!="fluid_container"||component(target)!="fluid_container"||component(pump)!="pump")return fail("invalid_fluid_route");
        for(const auto& old:it->second["fluidLinks"])if(string(old,"pump")==pump)return fail("pump_route_exists");
        const std::string link=make_id("fluid-link");it->second["fluidLinks"].push_back(Json{{"id",link},{"source",source},{"pump",pump},{"target",target}});it->second["revision"]=integer(it->second,"revision")+1;
        return Json{{"ok",true},{"linkId",link},{"sourceComponentInstanceId",source},{"pumpComponentInstanceId",pump},{"targetComponentInstanceId",target}};
    }
    if(name=="machine.fluid.disconnect"){
        const std::string id=string(args,"id",string(args,"machineId")),link_id=string(args,"fluidLinkId");auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        auto& links=it->second["fluidLinks"];const auto before=links.size();Json kept=Json::array();for(const auto& l:links)if(string(l,"id")!=link_id)kept.push_back(l);
        if(kept.size()==before)return fail("unknown_fluid_link");links=std::move(kept);it->second["revision"]=integer(it->second,"revision")+1;return Json{{"ok",true},{"fluidLinkId",link_id}};
    }
    if(name=="machine.cargo.load"||name=="machine.cargo.unload"){
        const bool loading=name=="machine.cargo.load";const std::string id=string(args,"id",string(args,"machineId"));auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        const Json items=args.value("items",Json::object());if(!items.is_object()||items.empty())return fail("invalid_cargo");
        for(auto q=items.begin();q!=items.end();++q)if(!q.value().is_number()||!std::isfinite(q.value().get<double>())||q.value().get<double>()<=0)return fail("invalid_cargo");
        Json& cargo=it->second["cargo"];if(!cargo.is_object())cargo=Json::object();if(!loading)for(auto q=items.begin();q!=items.end();++q)if(number(cargo,q.key())+EPS<q.value().get<double>())return fail("invalid_cargo");
        const std::string claim=string(args,"claim",id+":"+(loading?"cargo-load":"cargo-unload")+":"+std::to_string(next_id_));
        Json result=loading?gameplay.spend(items,claim):gameplay.grant(items,claim);if(!boolean(result,"ok"))return result;if(boolean(result,"duplicate"))return result;
        for(auto q=items.begin();q!=items.end();++q){const double next=number(cargo,q.key())+(loading?1:-1)*q.value().get<double>();if(next<=EPS)cargo.erase(q.key());else cargo[q.key()]=next;}
        next_id_++;it->second["revision"]=integer(it->second,"revision")+1;rebuild_machine(id);return Json{{"ok",true},{"items",items},{"cargo",cargo}};
    }
    if(name=="resource.harvest")return harvest_resource(args,world,gameplay);
    if(name=="interact"){
        const std::string id=string(args,"id",string(args,"entityId")),kind=string(args,"kind");
        if(id.empty())return fail("target_id_required");
        if(kind=="creature"||id.rfind("creature:",0)==0)return command("creature.interact",std::move(args),world,gameplay);
        if(kind=="corpse"||id.rfind("corpse:",0)==0)return command("creature.claim_drops",Json{{"id",id}},world,gameplay);
        if(kind=="boss"||id.rfind("boss:",0)==0){const std::string action=string(args,"action");if(action=="reward")return command("boss.claim_reward",{{"id",id}},world,gameplay);if(action=="gimmick")return command("boss.gimmick",std::move(args),world,gameplay);return fail("use_boss_damage");}
        if(kind=="machine"||id.rfind("machine:",0)==0)return command("machine.open",Json{{"id",id}},world,gameplay);
        if(kind=="device"||id.rfind("structure:",0)==0){if(string(args,"action")=="enter")return command("dungeon.enter",std::move(args),world,gameplay);return command("dungeon.device",std::move(args),world,gameplay);}
        if(kind=="campaign"||id.rfind("first-signal/",0)==0){
            const std::string target=string(args,"targetId",id);
            if(target.find("guardian")!=std::string::npos)return command_first_signal("guardian_damage",std::move(args),world,gameplay);
            if(target.find("relay:")!=std::string::npos)return command_first_signal("first_signal.relay",Json{{"id",target}},world,gameplay);
            if(target.find("resource:")!=std::string::npos){const auto pos=target.find("resource:");return command_first_signal("first_signal.harvest",Json{{"siteId",target.substr(pos+9)}},world,gameplay);}
            if(target.find("ruin")!=std::string::npos)return command_first_signal("first_signal.ruin",std::move(args),world,gameplay);
            if(target.find("villager:")!=std::string::npos)return gameplay.command("community.options",Json{{"targetId",target},{"visible",true}});
            return fail("unknown_campaign_interaction");
        }
        if(kind=="resource"||id.rfind("resource:",0)==0)return command("resource.harvest",std::move(args),world,gameplay);
        for(const auto& n:harvest_nodes_)if(string(n,"id")==id)return command("resource.harvest",std::move(args),world,gameplay);
        return fail("unknown_target");
    }
    if(name=="machine.open"){
        const std::string id=string(args,"id");auto it=machines_.find(id);if(it==machines_.end())return fail("unknown_machine");
        Json shapes=Json::array();for(const auto& s:machine_bodies_[id].shapes)shapes.push_back(Json{{"partId",s.part_id},{"materialId",s.material_id},{"hp",s.hp},{"maxHp",s.max_hp},{"massKg",s.mass_kg}});
        Json components=Json::array();for(const auto& c:it->second["components"]){const Json& def=entry(string(c,"componentId"));components.push_back(Json{{"id",string(c,"id")},{"voxelId",string(c,"voxelId")},{"componentId",string(c,"componentId")},{"legacyType",c.value("legacyType",Json())},{"active",boolean(c,"active",true)},{"energy",c.value("energy",Json::object())},{"fuel",number(c,"fuel")},{"fuelItems",integer(c,"fuelItems")},{"fluids",c.value("fluids",Json::object())},{"inputEnergies",def.value("inputEnergies",Json::array())},{"outputEnergies",def.value("outputEnergies",Json::array())},{"stores",def.value("stores",Json::array())},{"capacity",number(def,"capacity")},{"nominalPower",number(def,"nominalPower")}});}
        return Json{{"ok",true},{"machineId",id},{"machine",it->second},{"components",components},{"shapes",shapes}};
    }
    return fail("unknown_simulation_command");
}

} // namespace feral
