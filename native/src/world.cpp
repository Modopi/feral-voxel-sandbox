#include "world.hpp"

#include <deque>
#include <iomanip>
#include <limits>
#include <queue>
#include <sstream>
#include <stdexcept>

namespace feral {
namespace {
constexpr int SECTION_CELLS=8;
constexpr int ISLAND_SIZE=160,ISLAND_HEIGHT=40;
constexpr int SEA=8;
constexpr double EPS=1e-9;
const Cell DIRS[]={{0,1,0},{1,0,0},{-1,0,0},{0,0,1},{0,0,-1},{0,-1,0}};

int floor_div(int a,int n){int q=a/n,r=a%n;return r<0?q-1:q;}
double clampd(double v,double a,double b){return std::max(a,std::min(b,v));}
double smooth(double t){return t*t*(3.0-2.0*t);}
double js_round(double value){return std::floor(value+0.5);}
std::string key2(int x,int z){return std::to_string(x)+","+std::to_string(z);}
Cell section_of(Cell c){return {floor_div(c.x,SECTION_CELLS),floor_div(c.y,SECTION_CELLS),floor_div(c.z,SECTION_CELLS)};}
bool valid_vec(Vec3 v){return std::isfinite(v.x)&&std::isfinite(v.y)&&std::isfinite(v.z)&&std::abs(v.x)<1e12&&std::abs(v.y)<1e12&&std::abs(v.z)<1e12;}
Vec3 inverse_rotate(Quat q,Vec3 v){return rotate({-q.x,-q.y,-q.z,q.w},v);}
std::string seed_string(const Json& j){if(j.is_string())return j.get<std::string>();if(j.is_number_integer())return std::to_string(j.get<int64_t>());if(j.is_number_unsigned())return std::to_string(j.get<uint64_t>());if(j.is_number_float()){double d=j.get<double>();if(std::floor(d)==d)return std::to_string(static_cast<int64_t>(d));return j.dump();}return j.is_null()?"63026":j.dump();}
std::string cell_string(Cell c){return cell_key(c);}
Cell parse_cell_key(const std::string& key){std::istringstream in(key);Cell c;char a=0,b=0;if(!(in>>c.x>>a>>c.y>>b>>c.z)||a!=','||b!=',')throw std::runtime_error("invalid saved cell key");return c;}
Json vec_json(Vec3 v){return Json{{"x",v.x},{"y",v.y},{"z",v.z}};}
Vec3 vec_read(const Json& j,Vec3 fallback={}){Vec3 v=fallback;if(j.is_object())from_json(j,v);else if(j.is_array())from_json(j,v);return v;}
Json quat_json(Quat q){return Json{{"x",q.x},{"y",q.y},{"z",q.z},{"w",q.w}};}
Quat quat_read(const Json& j){Quat q{};if(j.is_object())from_json(j,q);double n=std::sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w);return n>EPS?Quat{q.x/n,q.y/n,q.z/n,q.w/n}:Quat{};}
int js_imul(uint32_t a,uint32_t b){return static_cast<int32_t>(a*b);}
const Json& member_or(const Json& object,const char* key,const Json& fallback){
    const auto it=object.find(key);return it==object.end()?fallback:it.value();
}
double legacy_hash(int x,int z,int seed=0){
    uint32_t n=static_cast<uint32_t>(js_imul(static_cast<uint32_t>(x)^static_cast<uint32_t>(seed),374761393u));
    n+=static_cast<uint32_t>(js_imul(static_cast<uint32_t>(z),668265263u));
    n=static_cast<uint32_t>(js_imul(n^(n>>13),1274126177u));n^=n>>16;
    return static_cast<double>(n)/4294967296.0;
}
double legacy_noise(double x,double z,int seed){
    int ix=static_cast<int>(std::floor(x)),iz=static_cast<int>(std::floor(z));double fx=smooth(x-ix),fz=smooth(z-iz);
    return (legacy_hash(ix,iz,seed)*(1-fx)+legacy_hash(ix+1,iz,seed)*fx)*(1-fz)+
           (legacy_hash(ix,iz+1,seed)*(1-fx)+legacy_hash(ix+1,iz+1,seed)*fx)*fz;
}

// Minimal SHA-256 keeps atlas output identical on targets without crypto libraries.
uint32_t rr(uint32_t x,int n){return (x>>n)|(x<<(32-n));}
std::array<uint8_t,32> sha256(const std::string& input){
    static constexpr uint32_t K[64]={0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32_t h[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    std::vector<uint8_t> msg(input.begin(),input.end());uint64_t bitlen=uint64_t(msg.size())*8;msg.push_back(0x80);while(msg.size()%64!=56)msg.push_back(0);for(int i=7;i>=0;i--)msg.push_back(uint8_t(bitlen>>(i*8)));
    for(size_t off=0;off<msg.size();off+=64){uint32_t w[64];for(int i=0;i<16;i++)w[i]=(uint32_t(msg[off+i*4])<<24)|(uint32_t(msg[off+i*4+1])<<16)|(uint32_t(msg[off+i*4+2])<<8)|msg[off+i*4+3];for(int i=16;i<64;i++){uint32_t a=w[i-15],b=w[i-2];w[i]=(rr(a,7)^rr(a,18)^(a>>3))+w[i-16]+(rr(b,17)^rr(b,19)^(b>>10))+w[i-7];}
        uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],q=h[7];for(int i=0;i<64;i++){uint32_t t1=q+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+K[i]+w[i],t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c));q=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=q;}
    std::array<uint8_t,32> out{};for(int i=0;i<8;i++)for(int j=0;j<4;j++)out[i*4+j]=uint8_t(h[i]>>(24-j*8));return out;
}
Vec3 parse_color(const Json& block,const std::string& id){
    std::string color=block.value("color",std::string());if(color.size()!=7||color[0]!='#'){
        static const std::map<std::string,std::string> fallback={{"grass","#688b49"},{"dirt","#80644b"},{"stone","#858b87"},{"sand","#c4b483"},{"log","#725238"},{"plank","#a58a5c"},{"leaves","#54743f"},{"moss","#4c6a42"},{"basalt","#41464a"},{"ash","#7c776d"},{"clay","#9b6c52"},{"glass","#a4cad1"}};
        auto it=fallback.find(id);if(it!=fallback.end())color=it->second;else if(id.find("mana")!=std::string::npos||id.find("crystal")!=std::string::npos)color="#7b79bd";else if(id.find("ore")!=std::string::npos||id.find("iron")!=std::string::npos)color="#866f58";else if(id.find("leaf")!=std::string::npos||id.find("grass")!=std::string::npos)color="#627b45";else color="#777e79";
    }
    auto byte=[&](int i){return std::stoi(color.substr(i,2),nullptr,16)/255.0;};return {byte(1),byte(3),byte(5)};
}
bool opaque(const Json& b){return b.is_object()&&b.value("opacity",1.0)>=0.999;}

template<class Lookup>
Contact trace_grid(Vec3 origin,Vec3 direction,double reach,Lookup&& lookup,const std::string& kind,const std::string& id={}){
    Contact out;Cell cell=world_cell(origin);int step[3]={direction.x>=0?1:-1,direction.y>=0?1:-1,direction.z>=0?1:-1};
    double d[3]={direction.x,direction.y,direction.z},o[3]={origin.x,origin.y,origin.z};int c[3]={cell.x,cell.y,cell.z};
    double t_delta[3],t_max[3];Vec3 entry_normal{};bool has_boundary_normal=false;
    for(int axis=0;axis<3;axis++){
        const double coordinate=o[axis]/CELL_M,nearest=std::round(coordinate);
        const bool on_boundary=std::abs(coordinate-nearest)<1e-10;
        if(d[axis]<-EPS&&on_boundary)c[axis]=int(nearest)-1;
        if(on_boundary&&std::abs(d[axis])>EPS&&!has_boundary_normal){entry_normal[axis]=-step[axis];has_boundary_normal=true;}
        t_delta[axis]=std::abs(d[axis])>EPS?std::abs(CELL_M/d[axis]):std::numeric_limits<double>::infinity();
        const double boundary=(c[axis]+(d[axis]>=0?1:0))*CELL_M;
        t_max[axis]=std::abs(d[axis])>EPS?(boundary-o[axis])/d[axis]:std::numeric_limits<double>::infinity();
        if(t_max[axis]<0&&t_max[axis]>-EPS)t_max[axis]=0;
    }
    double entered_at=0;const size_t limit=std::min<size_t>(100000,std::max<size_t>(16,size_t(std::ceil(reach*4.0))+8));
    for(size_t i=0;i<limit;i++){
        cell={c[0],c[1],c[2]};const std::string block_id=lookup(cell);
        if(!block_id.empty()&&entered_at<=reach+EPS){out.hit=true;out.kind=kind;out.id=id;out.material=block_id;out.cell=cell;out.part=kind=="body"?cell_key(cell):"";out.point=origin+direction*entered_at;out.normal=entry_normal;out.distance=entered_at;return out;}
        int axis=t_max[0]<t_max[1]?0:1;if(t_max[2]<t_max[axis])axis=2;const double next=t_max[axis];
        if(!std::isfinite(next)||next>reach+EPS)break;
        c[axis]+=step[axis];entered_at=next;t_max[axis]+=t_delta[axis];entry_normal={};entry_normal[axis]=-step[axis];
    }
    return out;
}

bool ray_aabb(Vec3 origin,Vec3 direction,Vec3 minimum,Vec3 maximum,double reach){
    double near=0,far=reach;
    for(int axis=0;axis<3;axis++){
        const double o=origin[axis],d=direction[axis],lo=minimum[axis],hi=maximum[axis];
        if(std::abs(d)<EPS){if(o<lo-EPS||o>hi+EPS)return false;continue;}
        double a=(lo-o)/d,b=(hi-o)/d;if(a>b)std::swap(a,b);near=std::max(near,a);far=std::min(far,b);if(near>far+EPS)return false;
    }
    return far>=-EPS&&near<=reach+EPS;
}
}

struct World::Column {SurfaceSample sample;int top_cell=0,soil_cells=1;std::string surface,subsoil,bedrock;};

struct World::LegacyWorld {
    int seed=63026;
    std::vector<uint8_t> blocks=std::vector<uint8_t>(ISLAND_SIZE*ISLAND_SIZE*ISLAND_HEIGHT,0);
    std::vector<int16_t> ground=std::vector<int16_t>(ISLAND_SIZE*ISLAND_SIZE,0);
    std::unordered_map<int,std::array<uint8_t,8>> subcells;
    bool frontier=false;
    int terrain_version=3,rx=0,rz=0;
    int index(int x,int y,int z)const{return x+z*ISLAND_SIZE+y*ISLAND_SIZE*ISLAND_SIZE;}
    bool inside(int x,int y,int z)const{return x>=0&&z>=0&&y>=0&&x<ISLAND_SIZE&&z<ISLAND_SIZE&&y<ISLAND_HEIGHT;}
    uint8_t get(int x,int y,int z)const{if(y<0)return 8;if(!inside(x,y,z))return 0;return blocks[index(x,y,z)];}
    int fine_index(int hx,int hy,int hz)const{int i=index(hx>>1,hy>>1,hz>>1);return i;}
    uint8_t get_cell(int hx,int hy,int hz)const{
        if(hy<0)return 8;if(hx<0||hz<0||hx>=ISLAND_SIZE*2||hz>=ISLAND_SIZE*2||hy>=ISLAND_HEIGHT*2)return 0;
        int i=fine_index(hx,hy,hz);auto it=subcells.find(i);return it==subcells.end()?blocks[i]:it->second[(hx&1)+((hy&1)<<1)+((hz&1)<<2)];
    }
    bool set(int x,int y,int z,uint8_t v){if(!inside(x,y,z)||y==0)return false;int i=index(x,y,z);blocks[i]=v;return true;}
    bool set_cell(int hx,int hy,int hz,uint8_t v){if(hx<0||hz<0||hy<2||hx>=ISLAND_SIZE*2||hz>=ISLAND_SIZE*2||hy>=ISLAND_HEIGHT*2)return false;int x=hx>>1,y=hy>>1,z=hz>>1,i=index(x,y,z),j=(hx&1)+((hy&1)<<1)+((hz&1)<<2);auto it=subcells.find(i);if(it==subcells.end()){if(blocks[i]==v)return false;std::array<uint8_t,8>a{};a.fill(blocks[i]);it=subcells.emplace(i,a).first;}if(it->second[j]==v)return false;it->second[j]=v;if(std::all_of(it->second.begin(),it->second.end(),[&](uint8_t b){return b==it->second[0];})){blocks[i]=it->second[0];subcells.erase(it);}else{auto n=std::find_if(it->second.begin(),it->second.end(),[](uint8_t b){return b!=0;});blocks[i]=n==it->second.end()?0:*n;}return true;}
    double surface(double x,double z)const{
        int xx=std::max(0,std::min(ISLAND_SIZE-1,int(std::floor(x)))),zz=std::max(0,std::min(ISLAND_SIZE-1,int(std::floor(z)))),top=ground[xx+zz*ISLAND_SIZE];
        if(!subcells.count(index(xx,top,zz)))return top+1;
        int hx=std::max(0,std::min(ISLAND_SIZE*2-1,int(std::floor(x*2)))),hz=std::max(0,std::min(ISLAND_SIZE*2-1,int(std::floor(z*2))));
        for(int hy=top*2+1;hy>=0;hy--){uint8_t b=get_cell(hx,hy,hz);if(b&&b!=5&&b!=6)return (hy+1)*.5;}return 0;
    }
    void rescan(int x,int z){for(int y=ISLAND_HEIGHT-1;y>=0;y--){auto b=get(x,y,z);if(b&&b!=5&&b!=6){ground[x+z*ISLAND_SIZE]=y;return;}}}
};

World::World(const Content& content):content_(content){
    if(content.data.is_object()){
        if(content.data.contains("blocks")&&content.data["blocks"].is_object()&&content.data["blocks"].contains("entries"))for(const auto& b:content.data["blocks"]["entries"])if(b.is_object()&&b.contains("id"))block_data_[b["id"].get<std::string>()]=b;
        if(content.data.contains("environments")&&content.data["environments"].is_object()){
            const Json& e=content.data["environments"];
            if(e.contains("entries")&&e["entries"].is_array())for(const auto& x:e["entries"])if(x.is_object()&&x.contains("id"))environment_data_[x["id"].get<std::string>()]=x;
            default_world_rules_=e.value("world",Json::object());world_rules_=default_world_rules_;
        }
    }
    if(block_data_.empty())for(const auto& entry:content.entries)if(entry.second.value("category",std::string())=="block")block_data_[entry.first]=entry.second;
    reactions_={{"burnedCells",0},{"burnedMassKg",0.0},{"combustionEu",0.0},{"dissolvedCells",0},{"neutralizedAcidM3",0.0},{"evaporatedM3",0.0},{"evaporatedAcidM3",0.0},{"heatDissipatedEu",0.0},{"heatReactedEu",0.0},{"steamThermalEu",0.0},{"dissolvedMassKg",0.0}};
    configure(Json::object());
}

void World::configure(Json config){
    config_=config.is_object()?std::move(config):Json::object();
    Json terrain=config_.value("terrain",Json::object());
    std::string preset=config_.value("preset",std::string());
    generator_id_=terrain.is_string()?terrain.get<std::string>():terrain.value("generator",config_.value("generator",std::string()));
    if(generator_id_.empty())generator_id_=preset=="machine"?"machine-field":preset=="expedition"?"infinite":preset;
    if(generator_id_.empty())generator_id_="infinite";
    if(generator_id_=="expedition"||generator_id_=="expedition-atlas-v1")generator_id_="infinite";
    if(generator_id_=="island-v1")generator_id_="island";if(generator_id_=="frontier-v1")generator_id_="frontier";if(generator_id_=="machine-field-v1")generator_id_="machine-field";
    if(generator_id_=="default")generator_id_="island";if(generator_id_=="machine_field")generator_id_="machine-field";
    if(generator_id_!="infinite"&&generator_id_!="island"&&generator_id_!="frontier"&&generator_id_!="machine-field")throw std::invalid_argument("unknown terrain generator: "+generator_id_);
    seed_=seed_string(config_.value("seed",Json(63026)));
    world_rules_=default_world_rules_;
    if(auto it=config_.find("rules");it!=config_.end()&&it->is_object()&&it->contains("world")&&(*it)["world"].is_object())world_rules_=(*it)["world"];
    reservations_.clear();region_terrain_.clear();patch_groups_.clear();
    if(config_.contains("reservations")&&config_["reservations"].is_array())for(const auto& r:config_["reservations"])reservations_.push_back(r);
    if(config_.contains("regionTerrain")&&config_["regionTerrain"].is_array())for(const auto& r:config_["regionTerrain"])if(r.is_array()&&r.size()==2&&r[0].is_string()){std::istringstream p(r[0].get<std::string>());Cell c;char comma;if(p>>c.x>>comma>>c.z&&comma==',')region_terrain_[Cell{c.x,0,c.z}]=r[1].get<int>();}
    columns_.clear();trees_.clear();random_cache_.clear();legacy_worlds_.clear();ore_maps_.clear();
    if(!loaded_sections_.empty())stream_revision_++;
    loaded_sections_.clear();dirty_sections_.clear();terrain_section_revisions_.clear();fluid_section_revisions_.clear();player_stream_sections_.clear();player_stream_cache_valid_=false;player_stream_radius_=-1;body_stream_cache_.clear();body_ray_cache_.clear();terrain_requests_.clear();terrain_request_key_.clear();cached_terrain_request_sections_.clear();
}

void World::update_rules(Json rules){
    if(!rules.is_object())throw std::invalid_argument("world rules must be an object");
    config_["rules"]=rules;Json next=default_world_rules_;
    if(rules.contains("world")&&rules["world"].is_object())next=rules["world"];
    if(next!=world_rules_)trees_.clear();world_rules_=std::move(next);
}

const Json& World::block_info(const std::string& id)const{auto it=block_data_.find(id);return it==block_data_.end()?empty_object():it->second;}
const Json& World::environment(const std::string& id)const{auto it=environment_data_.find(id);return it==environment_data_.end()?empty_object():it->second;}
bool World::solid(const std::string& id)const{return !id.empty()&&block_info(id).value("collision",true);}
double World::durability(const std::string& id)const{return block_info(id).value("durabilityHpPerCell",24.0);}
double World::mass(const std::string& id)const{return block_info(id).value("massPerCellKg",175.0);}
bool World::valid_cell(Cell c)const{return std::abs(int64_t(c.x))<1000000000&&std::abs(int64_t(c.y))<1000000000&&std::abs(int64_t(c.z))<1000000000;}

double World::deterministic(std::initializer_list<Json> parts)const{
    std::ostringstream key;key<<'['<<Json(seed_).dump()<<",\"expedition-atlas-v1\"";for(const auto& p:parts)key<<','<<p.dump();key<<']';std::string s=key.str();auto h=sha256(s);uint64_t first=0;for(int i=0;i<7;i++)first=(first<<8)|h[i];first>>=3;return double(first)/9007199254740992.0;
}
double World::noise(double x,double z,double scale,const std::string& channel)const{
    double u=x/scale,v=z/scale;int ix=int(std::floor(u)),iz=int(std::floor(v));double fx=smooth(u-ix),fz=smooth(v-iz);
    auto r=[&](int a,int b){std::string k=channel+":"+std::to_string(a)+","+std::to_string(b);auto q=random_cache_.find(k);if(q!=random_cache_.end())return q->second;double n=deterministic({channel,a,b});if(random_cache_.size()>=32768)random_cache_.clear();random_cache_[k]=n;return n;};
    double a=r(ix,iz),b=r(ix+1,iz),c=r(ix,iz+1),d=r(ix+1,iz+1);double result=(a+(b-a)*fx)*(1-fz)+(c+(d-c)*fx)*fz;
    return result;
}

int World::base_tier(double x,double z)const{
    static const Json empty_array=Json::array();double r=std::hypot(x,z);const Json& difficulty=member_or(world_rules_,"difficulty",empty_object());const Json& bands=member_or(difficulty,"radialBands",empty_array);
    for(const auto& b:bands){double lo=b.value("minM",0.0),hi=std::numeric_limits<double>::infinity();if(b.contains("maxM")&&b["maxM"].is_number())hi=b["maxM"].get<double>();if(r<lo||r>=hi)continue;if(b.contains("tier"))return b["tier"].get<int>();const Json& weights=member_or(b,"tierWeights",empty_object());double roll=deterministic({"tier",floor_div(int(std::floor(x)),256),floor_div(int(std::floor(z)),256)}),sum=0;for(auto it=weights.begin();it!=weights.end();++it){sum+=it.value().get<double>();if(roll<sum)return std::stoi(it.key());}break;}
    return 5;
}

int World::anchor_tier(int cx,int cz)const{
    static const Json empty_array=Json::array();const Json& difficulty=member_or(world_rules_,"difficulty",empty_object());const Json& tiers=member_or(difficulty,"patchTiers",empty_array);for(const auto& p:tiers){int minimum=p.value("minimumRadiusM",0),n=int(std::ceil((minimum+256)/512.0));if((cx==n&&cz==0)||(cx==-n-1&&cz==0)||(cz==n&&cx==0)||(cz==-n-1&&cx==0))return p.value("tier",0);}return 0;
}

const World::Patch* World::patch_for_region(int cx,int cz)const{
    static const Json empty_array=Json::array();const Json& difficulty=member_or(world_rules_,"difficulty",empty_object());const Json& tiers=member_or(difficulty,"patchTiers",empty_array);if(tiers.empty())return nullptr;
    int minimum=tiers.front().value("minimumRadiusM",0);double maxX=std::max(std::abs(cx*512),std::abs((cx+1)*512)),maxZ=std::max(std::abs(cz*512),std::abs((cz+1)*512));if(std::hypot(maxX,maxZ)<minimum)return nullptr;
    int gx=floor_div(cx,8),gz=floor_div(cz,8);std::string groupKey=key2(gx,gz);auto found=patch_groups_.find(groupKey);
    if(found==patch_groups_.end()){
        std::vector<Patch> candidates;
        double cap=4096.0*4096*.06;Json diff=world_rules_.value("difficulty",Json::object());double angle=diff.value("cardinalSectorHalfAngleDegrees",25.0)*3.141592653589793/180.0;double candidateProbability=diff.value("patchCandidateProbability",.2);Json coverage=diff.value("maxHighTierCoveragePer4096MRegion",.06);if(coverage.is_number())cap=4096.0*4096*coverage.get<double>();
        for(int z=gz*8;z<gz*8+8;z++)for(int x=gx*8;x<gx*8+8;x++){
            double mx=std::max(std::abs(x*512),std::abs((x+1)*512)),mz=std::max(std::abs(z*512),std::abs((z+1)*512));if(std::hypot(mx,mz)<minimum)continue;
            int forced=anchor_tier(x,z);double px=x*512+256+(deterministic({"patch-x",x,z})-.5)*128,pz=z*512+256+(deterministic({"patch-z",x,z})-.5)*128,r=std::hypot(px,pz),ratio=std::min(std::abs(px),std::abs(pz))/std::max(1.0,std::max(std::abs(px),std::abs(pz)));
            if(!forced&&(ratio>std::tan(angle)||deterministic({"patch-exists",x,z})>=candidateProbability))continue;
            std::vector<int> allowed;for(const auto& p:tiers)if(r>=p.value("minimumRadiusM",0))allowed.push_back(p.value("tier",0));if(allowed.empty())continue;
            int tier=forced?forced:allowed[std::min(int(deterministic({"patch-tier",x,z})*allowed.size()),int(allowed.size()-1))];if(std::find(allowed.begin(),allowed.end(),tier)==allowed.end())continue;
            Patch p;p.cx=x;p.cz=z;p.x=px;p.z=pz;p.radius=64+std::floor(deterministic({"patch-radius",x,z})*33);p.tier=tier;p.forced=forced!=0;p.priority=deterministic({"patch-priority",x,z});p.id="patch:"+std::to_string(x)+","+std::to_string(z);candidates.push_back(p);
        }
        std::sort(candidates.begin(),candidates.end(),[](const Patch& a,const Patch& b){return (a.forced!=b.forced)?a.forced>b.forced:a.priority<b.priority;});std::vector<Patch> accepted;double area=0;for(const auto& p:candidates){double a=3.141592653589793*p.radius*p.radius;if(area+a<=cap){accepted.push_back(p);area+=a;}}
        if(patch_groups_.size()>4096)patch_groups_.clear();found=patch_groups_.emplace(groupKey,std::move(accepted)).first;
    }
    for(const auto& p:found->second)if(p.cx==cx&&p.cz==cz)return &p;return nullptr;
}

const std::unordered_map<Cell,std::string,CellHash>& World::ore_map(int ecx,int ecz)const{
    std::string key=key2(ecx,ecz);auto it=ore_maps_.find(key);if(it!=ore_maps_.end())return it->second;
    static const Json default_veins=Json::array();static const Json default_depths=Json::array({4,28});static const Json default_counts=Json::array({8,24});
    std::unordered_map<Cell,std::string,CellHash> out;double sx=ecx*64+32,sz=ecz*64+32;std::string env_id=surface_sample(sx,sz).base_environment_id;const Json& env=environment(env_id);const Json& veins=member_or(env,"oreVeins",default_veins);
    for(const auto& vein:veins){std::string bid=vein.value("blockId",std::string());const Json& depths=member_or(vein,"depthBelowSurfaceM",default_depths);const Json& counts=member_or(vein,"veinCellCount",default_counts);int n=vein.value("veinsPer4096M2",1);
        for(int i=0;i<n;i++){std::string tag=bid+":"+std::to_string(i);int x=ecx*128+16+int(deterministic({"ore-x",ecx,ecz,tag})*96),z=ecz*128+16+int(deterministic({"ore-z",ecx,ecz,tag})*96);
            double below=depths[0].get<double>()+deterministic({"ore-depth",ecx,ecz,tag})*(depths[1].get<double>()-depths[0].get<double>());
            int y=int(js_round(column(x,z)->sample.height*2))-int(js_round(2*below));int count=counts[0].get<int>()+int(deterministic({"ore-count",ecx,ecz,tag})*(counts[1].get<int>()-counts[0].get<int>()+1));
            for(int j=0;j<count*4&&out.size()<1024;j++){const auto c=column(x,z);if(y<c->top_cell-c->soil_cells)out[Cell{x,y,z}]=bid;if(j>=count-1)break;int axis=int(deterministic({"ore-step",ecx,ecz,tag,j})*6),d=axis%2?1:-1;if(axis<2)x=std::max(ecx*128+1,std::min(ecx*128+126,x+d));else if(axis<4)y+=d;else z=std::max(ecz*128+1,std::min(ecz*128+126,z+d));}
        }
    }
    if(ore_maps_.size()>4096)ore_maps_.clear();return ore_maps_.emplace(key,std::move(out)).first->second;
}

SurfaceSample World::sample(double x,double z)const{
    if(generator_id_=="island"||generator_id_=="frontier"||generator_id_=="machine-field")return surface_sample(x,z);
    const double hx=std::floor(x*2),hz=std::floor(z*2);x=hx*.5+.25;z=hz*.5+.25;
    const double radius=std::hypot(x,z),moisture=noise(x,z,1024,"moisture"),geology=noise(x,z,512,"geology"),mana=noise(x,z,512,"mana"),elevation=noise(x,z,256,"height"),detail=noise(x,z,32,"detail"),continent=noise(x,z,4096,"continent");
    const double raw=-16+112*elevation+16*detail,coastDistance=(continent-.22)*4096;std::string base="grove";
    if(radius>=128){if(coastDistance<128||(raw>64&&moisture<.5))base="coast";else if(geology>.90)base="thermal";else if(moisture>.80&&raw<6)base="marsh";else if(mana>.75&&moisture>.50)base="mana_grove";else if(moisture<.45||raw>48)base="ridge";}
    int cx=floor_div(int(std::floor(x)),512),cz=floor_div(int(std::floor(z)),512);bool safe=false;int localX=int(std::floor(x))-cx*512,localZ=int(std::floor(z))-cz*512;const Patch* patch=patch_for_region(cx,cz);double patchDistance=std::numeric_limits<double>::infinity();
    if(radius>=64){safe=std::min({localX,512-localX,localZ,512-localZ})<=6;if(patch){patchDistance=std::hypot(x-patch->x,z-patch->z);double ring=patch->radius+48;safe=safe||std::abs(patchDistance-ring)<=6||(patchDistance>=ring&&(std::abs(x-patch->x)<=6||std::abs(z-patch->z)<=6));}}
    std::string env=base;double ox=cx*512+256,oz=cz*512+256,overlay_distance=std::hypot(x-ox,z-oz);
    if(radius>=128&&overlay_distance<48+deterministic({"overlay-radius",cx,cz})*48){double roll=deterministic({"overlay",cx,cz});if(roll<.08)env="sacred";else if(radius>=1536&&roll<.12)env="anomaly";}
    int basetier=base_tier(x,z),tier=basetier;bool insidePatch=patch&&patchDistance<=patch->radius&&!safe;if(insidePatch)tier=patch->tier;
    const Json& envrow=environment(base);Json range=envrow.value("terrain",Json::object()).value("heightAboveSeaM",Json::array({2,34}));double lo=range.size()>1?range[0].get<double>():2,hi=range.size()>1?range[1].get<double>():34;
    double fraction=.7*elevation+.2*detail+.1*noise(x,z,8,"micro");double h=lo+(hi-lo)*fraction,blended=h,weight=1;
    for(auto [dx,dz]:{std::pair<int,int>{-16,0},{16,0},{0,-16},{0,16}}){double nx=x+dx,nz=z+dz;std::string other="grove";double nr=std::hypot(nx,nz);if(nr>=128){double mm=noise(nx,nz,1024,"moisture"),gg=noise(nx,nz,512,"geology"),ma=noise(nx,nz,512,"mana"),ee=noise(nx,nz,256,"height"),dd=noise(nx,nz,32,"detail"),cc=noise(nx,nz,4096,"continent"),rrr=-16+112*ee+16*dd;if((cc-.22)*4096<128||(rrr>64&&mm<.5))other="coast";else if(gg>.90)other="thermal";else if(mm>.80&&rrr<6)other="marsh";else if(ma>.75&&mm>.5)other="mana_grove";else if(mm<.45||rrr>48)other="ridge";}
        if(other!=base){const Json& oe=environment(other);Json rg=oe.value("terrain",Json::object()).value("heightAboveSeaM",Json::array({2,34}));if(rg.size()>1)blended+=(rg[0].get<double>()+(rg[1].get<double>()-rg[0].get<double>())*fraction)*.25;weight+=.25;}}
    h=blended/weight;
    if(base=="coast"&&continent<.24)h=-4+noise(x,z,64,"seabed")*3;
    if(base=="marsh")h=moisture>.76?-1.5:std::floor(h/2)*2;
    if(base=="thermal")h=std::floor(h/4)*4;
    bool stream=std::abs(noise(x,z,256,"river")-.5)<.018;if(radius>64&&stream)h=-1.5;
    bool starter=std::hypot(x-80,z-24)<6;if(starter)h=-1;
    if(radius<64)h=4;else if(radius<96&&!starter&&!stream){double t=smooth((radius-64)/32);h=4+(h-4)*t;}
    if(safe)h=4;
    std::string reservation;auto reservations=reservations_;std::sort(reservations.begin(),reservations.end(),[](const Json&a,const Json&b){return a.value("id",std::string())<b.value("id",std::string());});for(const auto& q:reservations)if(x>=q.value("minX",0.0)&&x<q.value("maxX",0.0)&&z>=q.value("minZ",0.0)&&z<q.value("maxZ",0.0)){reservation=q.value("id",std::string());h=q.value("height",h);break;}
    h=js_round(h*2)/2;bool water=h<0&&reservation.empty()&&!safe;bool acid=water&&!starter&&base=="marsh"&&deterministic({"acid",floor_div(int(std::floor(x)),16),floor_div(int(std::floor(z)),16)})<.12;
    SurfaceSample out;out.environment_id=env;out.base_environment_id=base;out.tier=tier;out.height=h;out.has_water=water;out.water_level=water?0:0;out.hostile_spawns_allowed=radius>=64&&!safe&&reservation.empty();out.safe_bypass=safe;out.reserved_by=reservation;out.water_type=water?(acid?"acid":"water"):"";return out;
}

SurfaceSample World::surface_sample(double x,double z)const{
    if(!std::isfinite(x)||!std::isfinite(z))return {};
    if(generator_id_=="machine-field"){SurfaceSample s;s.environment_id=s.base_environment_id="grove";s.height=4;s.tier=1;s.hostile_spawns_allowed=false;return s;}
    double hx=std::floor(x*2),hz=std::floor(z*2);x=hx*.5+.25;z=hz*.5+.25;
    if(generator_id_=="island"||generator_id_=="frontier"){
        SurfaceSample s;double rx=std::floor(x/320),rz=std::floor(z/320),lx=x-rx*320,lz=z-rz*320;
        bool on=generator_id_=="island"?(x>=0&&z>=0&&x<160&&z<160):(lx>=0&&lz>=0&&lx<160&&lz<160);
        int wx=generator_id_=="island"?0:int(rx),wz=generator_id_=="island"?0:int(rz);
        if(on){auto world=legacy_world(wx,wz);s.height=world->surface(lx,lz);s.tier=world->frontier?std::min(3,1+(std::abs(wx)+std::abs(wz))/2):1;s.environment_id=s.base_environment_id=(lx>=132&&lx<148&&lz>=27&&lz<42)?"thermal":(lx>125&&lz<90)?"ridge":"grove";s.hostile_spawns_allowed=true;}else{s.height=4;s.environment_id=s.base_environment_id="coast";}
        s.has_water=s.height<SEA+1||!on;s.water_level=s.has_water?SEA+1:0;s.water_type=s.has_water?"water":"";s.hostile_spawns_allowed=s.hostile_spawns_allowed&&on;return s;
    }
    return sample(x,z);
}

std::shared_ptr<const World::Column> World::column(int hx,int hz)const{
    Cell key{hx,0,hz};auto it=columns_.find(key);if(it!=columns_.end())return it->second;
    Column c;c.sample=surface_sample(hx*.5,hz*.5);c.top_cell=int(js_round(c.sample.height*2))-1;
    if(generator_id_=="infinite"){
        static const Json default_thickness=Json::array({.5,2.5});const Json& env=environment(c.sample.base_environment_id);const Json& terrain=member_or(env,"terrain",empty_object());c.surface=terrain.value("surfaceBlockId",std::string("grass"));if(!solid(c.surface))c.surface=terrain.value("subsoilBlockId",std::string("dirt"));c.subsoil=terrain.value("subsoilBlockId",std::string("dirt"));c.bedrock=terrain.value("bedrockBlockId",std::string("stone"));const Json& thick=member_or(terrain,"soilThicknessM",default_thickness);double a=thick.size()>1?thick[0].get<double>():.5,b=thick.size()>1?thick[1].get<double>():2.5;double roll=deterministic({"soil-depth",floor_div(hx,16),floor_div(hz,16)});c.soil_cells=std::max(1,int(js_round(2*(a+roll*(b-a)))));
    }
    if(columns_.size()>300000)columns_.clear();auto cached=std::make_shared<Column>(std::move(c));columns_[key]=cached;return cached;
}

const World::TreeInfo& World::tree_info(int tx,int tz)const{
    const Cell key{tx,0,tz};auto found=trees_.find(key);if(found!=trees_.end())return found->second;
    TreeInfo info;info.x=tx*8+2+std::floor(deterministic({"tree-x",tx,tz})*8)*.5;
    info.z=tz*8+2+std::floor(deterministic({"tree-z",tx,tz})*8)*.5;
    const SurfaceSample sample=surface_sample(info.x,info.z);
    if(sample.reserved_by.empty()&&!sample.safe_bypass&&!sample.has_water&&std::hypot(info.x,info.z)>=12){
        const Json& host=environment(sample.base_environment_id);const Json& decoration=member_or(host,"decoration",empty_object());
        const double density=decoration.value("treesPer1024M2",0.0);
        if(deterministic({"tree-exists",tx,tz})<density/16.0){
            static const Json default_tree_height=Json::array({4,8});const Json& height=member_or(decoration,"treeHeightM",default_tree_height);
            info.height_cells=int(height[0].get<int>())+int(std::floor(deterministic({"tree-height",tx,tz})*(height[1].get<int>()-height[0].get<int>()+1)));
            info.height_m=sample.height;info.log_block=sample.base_environment_id=="mana_grove"?"mana_log":"log";info.present=true;
        }
    }
    if(trees_.size()>=65536)trees_.clear();
    return trees_.emplace(key,std::move(info)).first->second;
}

std::shared_ptr<World::LegacyWorld> World::legacy_world(int rx,int rz)const{
    Cell k{rx,0,rz};auto it=legacy_worlds_.find(k);if(it!=legacy_worlds_.end())return it->second;
    auto w=std::make_shared<LegacyWorld>();w->rx=rx;w->rz=rz;w->frontier=(generator_id_=="frontier");
    int32_t seed=0;try{seed=std::stoi(seed_);}catch(...){seed=63026;}
    if(w->frontier){double s=legacy_hash(rx+19,rz-7,seed);w->seed=int(std::floor(s*2147483647.0));w->terrain_version=3;auto version=region_terrain_.find(Cell{rx,0,rz});if(version!=region_terrain_.end())w->terrain_version=version->second;}
    else w->seed=seed;
    const int sd=w->seed;
    for(int z=0;z<ISLAND_SIZE;z++)for(int x=0;x<ISLAND_SIZE;x++){
        double river=96+std::sin(z*.042)*12,rd=std::abs(x-river),n=legacy_noise(x/43.0,z/43.0,sd),n2=legacy_noise(x/15.0,z/15.0,sd+3);
        int h=int(std::floor(8+n*10+n2*3+std::max(0.0,(x-115)/15.0)*2));if(rd<8)h=int(std::floor(5+rd*.42));else if(rd<15)h=std::min(h,int(std::floor(8+(rd-8)*.55)));bool arid=x>125&&z<90;h=std::max(3,std::min(27,h));w->ground[x+z*ISLAND_SIZE]=h;
        for(int y=0;y<=h;y++){uint8_t b=y==h?(h<SEA+1||arid?4:1):y>h-3?2:3;if(y==0)b=8;if(y<h-3&&legacy_hash(x+y*37,z,sd)>.99)b=7;w->blocks[w->index(x,y,z)]=b;}
    }
    for(int z=5;z<ISLAND_SIZE-5;z++)for(int x=5;x<ISLAND_SIZE-5;x++)if(x<125&&std::hypot(x-77,z-84)>11&&legacy_hash(x,z,sd+87)>.992&&w->ground[x+z*ISLAND_SIZE]>SEA+2){int y=int(w->surface(x,z)),h=3+int(std::floor(legacy_hash(z,x)*3));for(int j=0;j<h;j++)if(w->inside(x,y+j,z))w->blocks[w->index(x,y+j,z)]=5;for(int dz=-2;dz<=2;dz++)for(int dx=-2;dx<=2;dx++)for(int dy=-1;dy<=1;dy++)if(std::abs(dx)+std::abs(dz)+std::abs(dy)<5&&w->inside(x+dx,y+h+dy,z+dz)&&!w->get(x+dx,y+h+dy,z+dz))w->blocks[w->index(x+dx,y+h+dy,z+dz)]=6;}
    int landing=w->ground[77+84*ISLAND_SIZE];for(int z=78;z<=90;z++)for(int x=71;x<=81;x++){for(int y=1;y<ISLAND_HEIGHT;y++)w->blocks[w->index(x,y,z)]=y<landing-2?3:y<landing?2:y==landing?1:0;w->ground[x+z*ISLAND_SIZE]=landing;}
    for(int x=80;x<=86;x++)for(int z=82;z<=86;z++){double top=landing+1-(x-80)*.5;int full=int(std::floor(top));for(int y=1;y<ISLAND_HEIGHT;y++)w->blocks[w->index(x,y,z)]=y<full?(y==full-1?1:2):0;w->ground[x+z*ISLAND_SIZE]=full-1;if(top!=full)for(int dx=0;dx<2;dx++)for(int dz=0;dz<2;dz++)w->set_cell(x*2+dx,full*2,z*2+dz,1);}
    for(int z=83;z<=86;z++)for(int x=76;x<=77;x++)w->blocks[w->index(x,landing,z)]=11;
    for(int x=136;x<=143;x++)for(int z=31;z<=38;z++){int h=int(w->surface(x,z))-1;w->blocks[w->index(x,h,z)]=(x>137&&x<142&&z>32&&z<37)?9:8;}
    for(int x=44;x<53;x++)for(int z=116;z<125;z++)if(x==44||x==52||z==116||z==124)for(int d=0;d<2+int(legacy_hash(x,z)*3);d++){int y=int(w->surface(x,z))+d;if(w->inside(x,y,z))w->blocks[w->index(x,y,z)]=8;}
    if(w->frontier)build_frontier(*w,rx,rz,seed);
    if(legacy_worlds_.size()>=8)legacy_worlds_.erase(legacy_worlds_.begin());legacy_worlds_[k]=w;return w;
}

void World::build_frontier(LegacyWorld& w,int rx,int rz,int world_seed)const{
    auto roll=[&](int n){return legacy_hash(rx+n*19,rz-n*7,world_seed);};
    int tier=std::min(3,1+(std::abs(rx)+std::abs(rz))/2);
    int v0x=65+int(roll(3)*6),v0z=68,v1x=130+int(roll(4)*6),v1z=114;
    int bossx=44+int(roll(5)*9),bossz=126,dungeonx=133,dungeonz=45+int(roll(6)*7);
    (void)tier;
    auto pad=[&](int x,int z,int radius,uint8_t block){
        int y=std::max(11,std::min(25,int(w.ground[x+z*ISLAND_SIZE])));
        for(int zz=z-radius;zz<=z+radius;zz++)for(int xx=x-radius;xx<=x+radius;xx++)if(xx>=0&&zz>=0&&xx<ISLAND_SIZE&&zz<ISLAND_SIZE){
            for(int yy=1;yy<ISLAND_HEIGHT;yy++){
                if(yy<=y){if(yy>=y-3||w.get(xx,yy,zz)==0)w.set(xx,yy,zz,yy==y?block:2);}
                else w.set(xx,yy,zz,0);
            }w.rescan(xx,zz);
        }return y+1;
    };
    pad(77,84,5,1);
    for(auto v:{std::pair<int,int>{v0x,v0z},{v1x,v1z}}){int y=pad(v.first,v.second,7,1);for(int offset:{-4,3})for(int x=v.first+offset;x<v.first+offset+3;x++)for(int z=v.second-5;z<v.second-2;z++){
            w.set(x,y,z,11);if(x==v.first+offset||x==v.first+offset+2)for(int h=1;h<=2;h++)w.set(x,y+h,z,5);w.set(x,y+3,z,11);
        }for(int x=v.first-4;x<=v.first+4;x++)w.set(x,y-1,v.second+4,1);}
    int y=pad(bossx,bossz,10,8);for(int i=-8;i<=8;i+=4)for(int z:{bossz-9,bossz+9}){w.set(bossx+i,y,z,3);w.set(bossx+i,y+1,z,7);}
    int h=pad(dungeonx,dungeonz,7,3);for(int x:{dungeonx-5,dungeonx+5})for(int z:{dungeonz-5,dungeonz+5})for(int j=0;j<4;j++)w.set(x,h+j,z,j==3?7:8);
    int bio=((rx-rz*2)%3+3)%3;
    if(w.terrain_version>=2){
        for(int side:{-1,1}){int x=dungeonx+side*5;if(bio==0){for(int z=dungeonz-4;z<=dungeonz+4;z++)for(int yy=0;yy<3;yy++)if(z==dungeonz-4||z==dungeonz+4)w.set(x,h+yy,z,5);for(int z=dungeonz-5;z<=dungeonz+5;z++)w.set(x,h+4,z,6);}
            else if(bio==1){for(int yy=0;yy<6;yy++)w.set(x,h+yy,dungeonz-4,yy%2?7:8);for(int xx=dungeonx-5;xx<=dungeonx+5;xx++)w.set(xx,h+6,dungeonz-4,11);}
            else {for(int yy=0;yy<5;yy++)w.set(x,h+yy,dungeonz-4,yy>=3?7:3);for(int z=dungeonz-4;z<=dungeonz+4;z++)w.set(x,h-1,z,z%2?4:7);}}
        for(int side:{-1,1})for(int yy=0;yy<(bio==1?6:4);yy++)w.set(bossx+side*9,y+yy,bossz-7,bio==0?(yy==3?6:5):bio==1?8:7);
    }
    // Walkable half-metre supply trails connect the camp with both villages, nest and ruin.
    auto trail=[&](int tx,int tz){double ox=77,oz=84,oy=w.surface(77,84),end=w.surface(tx,tz),dx=tx-ox,dz=tz-oz,length2=dx*dx+dz*dz;
        for(int z=std::min(84,tz)-2;z<=std::max(84,tz)+2;z++)for(int x=std::min(77,tx)-2;x<=std::max(77,tx)+2;x++){
            if(x<0||z<0||x>=ISLAND_SIZE||z>=ISLAND_SIZE)continue;double t=length2>0?clampd(((x-ox)*dx+(z-oz)*dz)/length2,0,1):0;if(std::hypot(x-ox-dx*t,z-oz-dz*t)>1.5)continue;
            double top=js_round((oy+(end-oy)*t)*2)/2;int full=int(std::floor(top));for(int yy=1;yy<ISLAND_HEIGHT;yy++)w.set(x,yy,z,yy<full?(yy==full-1?11:2):0);if(top!=full)for(int ax=0;ax<2;ax++)for(int az=0;az<2;az++)w.set_cell(x*2+ax,full*2,z*2+az,11);w.rescan(x,z);
        }};
    trail(v0x,v0z);trail(v1x,v1z);trail(bossx,bossz);trail(dungeonx,dungeonz);
    if(w.terrain_version>=3){int base=pad(94,102,5,2),hy=base*2;auto fine=[&](int x,int y,int z,uint8_t b){w.set_cell(x,hy+y,z,b);};
        for(int x:{180,188})for(int yy=0;yy<4;yy++)fine(x,yy,198,5);for(int x=180;x<=188;x++)for(int z=197;z<=199;z++)fine(x,4,z,11);
        for(int yy=0;yy<4;yy++)fine(196,yy,200,5);for(int x=195;x<=197;x++)for(int z=199;z<=201;z++)for(int yy=4;yy<6;yy++)fine(x,yy,z,7);
        fine(184,0,210,5);for(int x=182;x<=186;x++)for(int z=208;z<=212;z++)for(int yy=1;yy<=4;yy++)if(yy==1||x==182||x==186||z==208||z==212)fine(x,yy,z,11);
        for(int x=192;x<=199;x++)fine(x,2,211,5);for(int yy=0;yy<2;yy++)fine(196,yy,211,5);
    }
}

std::optional<RegionInfo> World::region_info(int rx,int rz)const{
    if(generator_id_!="frontier")return std::nullopt;int world_seed=0;try{world_seed=std::stoi(seed_);}catch(...){world_seed=63026;}
    auto roll=[&](int n){return legacy_hash(rx+n*19,rz-n*7,world_seed);};RegionInfo out;out.key=key2(rx,rz);out.x=rx;out.z=rz;out.seed=int(std::floor(roll(1)*2147483647.0));out.tier=std::min(3,1+(std::abs(rx)+std::abs(rz))/2);out.biome=((rx-rz*2)%3+3)%3;out.terrain_version=3;auto vt=region_terrain_.find(Cell{rx,0,rz});if(vt!=region_terrain_.end())out.terrain_version=vt->second;
    static const char* biome_names[]={"이끼 숲","붉은 구릉","유리 해안"};static const char* boss_names[]={"이끼 수호자","구리 돌격수","유리 파수꾼"};out.name=std::string(biome_names[out.biome])+" ["+std::to_string(rx)+", "+std::to_string(rz)+"]";
    for(int i=0;i<2;i++){RegionSite v;v.id=out.key+":"+std::to_string(i);v.name=i?"고원 정착지":"강변 야영지";v.x=(i?130:65)+std::floor(roll(3+i)*6);v.z=i?114:68;v.faction=(int(std::floor(roll(7)*3))+i)%3;out.villages.push_back(v);}
    out.boss={"boss",boss_names[out.biome],44+std::floor(roll(5)*9),126,0};out.dungeon={"dungeon","옛 동력 유적",133,45+std::floor(roll(6)*7),0};return out;
}

Json World::harvest_nodes_around(Vec3 center,double radius)const{
    Json result=Json::array();if(!valid_vec(center)||!std::isfinite(radius)||generator_id_=="machine-field")return result;radius=clampd(radius,0,256);const Json& nodes=world_rules_.value("harvestNodes",Json::array());
    auto definition=[&](const std::string& id)->const Json&{for(const auto& n:nodes)if(n.value("id",std::string())==id)return n;return empty_object();};
    auto has_node=[&](const SurfaceSample& s,const std::string& id){const Json& e=environment(s.environment_id);for(const auto& n:e.value("harvestNodeIds",Json::array()))if(n.is_string()&&n.get<std::string>()==id)return true;return false;};
    auto on_land=[&](double x,double z){if(generator_id_=="island")return x>=0&&z>=0&&x<160&&z<160;if(generator_id_=="frontier"){double lx=x-std::floor(x/320)*320,lz=z-std::floor(z/320)*320;return lx>=0&&lz>=0&&lx<160&&lz<160;}return true;};
    int ex0=floor_div(int(std::floor(center.x-radius)),64),ex1=floor_div(int(std::floor(center.x+radius)),64),ez0=floor_div(int(std::floor(center.z-radius)),64),ez1=floor_div(int(std::floor(center.z+radius)),64);
    for(int ez=ez0;ez<=ez1;ez++)for(int ex=ex0;ex<=ex1;ex++){SurfaceSample region=sample(ex*64+32,ez*64+32);const Json& env=environment(region.environment_id);for(const auto& n:env.value("harvestNodeIds",Json::array())){
        if(!n.is_string())continue;std::string node_id=n.get<std::string>();const Json& def=definition(node_id);if(def.empty())continue;int candidates=def.value("candidateCountPer4096M2",0);
        for(int i=0;i<candidates;i++){double px=js_round((ex*64+deterministic({"harvest-x",ex,ez,node_id,i})*64)*2)/2,pz=js_round((ez*64+deterministic({"harvest-z",ex,ez,node_id,i})*64)*2)/2;SurfaceSample s=sample(px,pz);if(!has_node(s,node_id)||!on_land(px,pz)||std::hypot(px-center.x,pz-center.z)>radius||!s.reserved_by.empty())continue;if(node_id=="freshwater"?!s.has_water||s.water_type!="water":s.has_water)continue;
            result.push_back({{"id","harvest:"+std::to_string(ex)+","+std::to_string(ez)+":"+node_id+":"+std::to_string(i)},{"nodeId",node_id},{"sourceId",def.value("sourceId",std::string())},{"resourceId",def.value("resourceId",std::string())},{"x",px},{"y",s.has_water?s.water_level:s.height},{"z",pz},{"regrowS",def.value("regrowS",0.0)}});
        }
    }}
    static const std::pair<const char*,int> starters[]={{"fallen_branch",8},{"loose_stone",8},{"fiber_patch",4},{"berry_bush",6}};
    auto add_starter=[&](const std::string& node_id,int i,double px,double pz,const std::string& id){const Json& def=definition(node_id);if(def.empty()||std::hypot(px-center.x,pz-center.z)>radius)return;SurfaceSample s=sample(px,pz);if(!s.reserved_by.empty()||!on_land(px,pz)||(generator_id_!="infinite"&&s.has_water))return;result.push_back({{"id",id},{"nodeId",node_id},{"sourceId",def.value("sourceId",std::string())},{"resourceId",def.value("resourceId",std::string())},{"x",px},{"y",surface_height(px,pz)},{"z",pz},{"regrowS",def.value("regrowS",0.0)}});};
    if(generator_id_=="infinite"){
        for(auto [raw,count]:starters)for(int i=0;i<count;i++){std::string node_id=raw;double angle=deterministic({"starter-node-angle",node_id,i})*6.283185307179586,r=18+deterministic({"starter-node-radius",node_id,i})*22,px=js_round(std::cos(angle)*r*2)/2,pz=js_round(std::sin(angle)*r*2)/2;add_starter(node_id,i,px,pz,"starter:"+node_id+":"+std::to_string(i));}
    }else{
        struct Landing{int rx,rz;double x,z;std::string id;};std::vector<Landing> landings;
        if(generator_id_=="island")landings.push_back({0,0,77.5,84.5,""});
        else {double reach=radius+320;int rx0=int(std::floor((center.x-reach)/320)),rx1=int(std::floor((center.x+reach)/320)),rz0=int(std::floor((center.z-reach)/320)),rz1=int(std::floor((center.z+reach)/320));for(int rx=rx0;rx<=rx1;rx++)for(int rz=rz0;rz<=rz1;rz++){double x=rx*320+77.5,z=rz*320+84.5;if(std::hypot(x-center.x,z-center.z)<=radius+30)landings.push_back({rx,rz,x,z,std::to_string(rx)+","+std::to_string(rz)+":"});}}
        for(const auto& landing:landings)for(auto [raw,count]:starters)for(int i=0;i<count;i++){std::string node_id=raw;double ar=generator_id_=="island"?deterministic({"island-starter-angle",node_id,i}):deterministic({"island-starter-angle",node_id,i,landing.rx,landing.rz}),rr=generator_id_=="island"?deterministic({"island-starter-radius",node_id,i}):deterministic({"island-starter-radius",node_id,i,landing.rx,landing.rz});double angle=ar*6.283185307179586,r=8+rr*16,px=js_round((landing.x+std::cos(angle)*r)*2)/2,pz=js_round((landing.z+std::sin(angle)*r)*2)/2;std::string id="starter:"+landing.id+node_id+":"+std::to_string(i);add_starter(node_id,i,px,pz,id);}
    }
    if(generator_id_=="infinite"&&std::hypot(center.x-80,center.z-24)<=radius){const Json& def=definition("freshwater");if(!def.empty())result.push_back({{"id","starter:freshwater"},{"nodeId","freshwater"},{"sourceId",def.value("sourceId",std::string())},{"resourceId",def.value("resourceId",std::string())},{"x",80},{"y",0},{"z",24},{"regrowS",0}});}
    return result;
}

std::string World::legacy_block(Cell cell)const{
    if(generator_id_=="island"){
        if(cell.x*.5<0||cell.z*.5<0||cell.x*.5>=160||cell.z*.5>=160)return cell.y<=7?(cell.y<5?"stone":"sand"):"";
        auto w=legacy_world(0,0);int hx=cell.x,hy=cell.y,hz=cell.z;uint8_t b=w->get_cell(hx,hy,hz);
        static const char* map[]={"","grass","dirt","stone","sand","log","leaves","iron_ore","basalt","basalt","ash","plank"};return b>0&&b<12?map[b]:"";
    }
    if(generator_id_=="frontier"){
        double x=(cell.x+.5)*.5,z=(cell.z+.5)*.5;int rx=int(std::floor(x/320)),rz=int(std::floor(z/320));double lx=x-rx*320,lz=z-rz*320;
        if(lx<0||lz<0||lx>=160||lz>=160)return cell.y<=7?(cell.y<5?"stone":"sand"):"";
        auto w=legacy_world(rx,rz);uint8_t b=w->get_cell(cell.x-rx*640,cell.y,cell.z-rz*640);
        static const char* map[]={"","grass","dirt","stone","sand","log","leaves","iron_ore","basalt","basalt","ash","plank"};return b>0&&b<12?map[b]:"";
    }
    return "";
}

std::string World::base_block(Cell c)const{
    if(generator_id_=="island"||generator_id_=="frontier")return legacy_block(c);
    if(generator_id_=="machine-field"){
        int floor_cell=8;if(c.y<floor_cell)return c.y==floor_cell-1?"grass":c.y>=floor_cell-3?"dirt":"stone";
        double x=(c.x+.5)*.5,z=(c.z+.5)*.5;int up=c.y-floor_cell;
        if(up<4&&std::max(std::abs(x),std::abs(z))>=23&&std::max(std::abs(x),std::abs(z))<24)return "stone";
        for(auto p:{std::array<double,3>{0,-10,2},std::array<double,3>{10,5,2.5},std::array<double,3>{-10,-5,1.8}})if(up<6&&std::hypot(x-p[0],z-p[1])<=p[2])return "basalt";
        double scrap=std::hypot(x+6,z-9);if((up==0&&scrap<=1.5)||(up==1&&scrap<=.75))return "iron_scrap_block";return "";
    }
    const auto col=column(c.x,c.z);if(c.y>col->top_cell){if(c.y>col->top_cell+24||col->sample.safe_bypass||!col->sample.reserved_by.empty())return "";
        double x=(c.x+.5)*.5,y=(c.y+.5)*.5,z=(c.z+.5)*.5;
        for(int tz=floor_div(int(std::floor(z-2)),8);tz<=floor_div(int(std::floor(z+2)),8);tz++)for(int tx=floor_div(int(std::floor(x-2)),8);tx<=floor_div(int(std::floor(x+2)),8);tx++){
            const TreeInfo& tree=tree_info(tx,tz);if(!tree.present)continue;
            if(std::abs(x-tree.x)<=.5&&std::abs(z-tree.z)<=.5&&y>=tree.height_m&&y<tree.height_m+tree.height_cells)return tree.log_block;
            if(std::abs(x-tree.x)<=2&&std::abs(z-tree.z)<=2&&y>=tree.height_m+tree.height_cells-1&&y<tree.height_m+tree.height_cells+1&&std::abs(x-tree.x)+std::abs(z-tree.z)<3.5)return "leaves";
        }
        if(c.y==col->top_cell+1&&!col->sample.has_water&&deterministic({"plant",c.x,c.z})<.12){static const Json empty_array=Json::array();const Json& dec=member_or(environment(col->sample.environment_id),"decoration",empty_object());const Json& ids=member_or(dec,"blockIds",empty_array);for(const auto& id:ids){std::string candidate=id.get<std::string>();if(block_info(candidate).value("kind",std::string())=="vegetation")return candidate;}}
        return "";
    }
    if(c.y==col->top_cell)return col->surface;
    double x=(c.x+.5)*.5,y=(c.y+.5)*.5,z=(c.z+.5)*.5;
    // Caves are deterministic capped horizontal capsules in each 64 m region.
    int ex=floor_div(c.x,128),ez=floor_div(c.z,128);const Json& env=environment(col->sample.base_environment_id);const Json& pattern=member_or(env,"pattern",empty_object());double chance=pattern.value("caveChancePerCell",0.0);
    if(col->sample.reserved_by.empty()&&!col->sample.safe_bypass&&c.y<=col->top_cell-6&&chance>0&&deterministic({"cave-exists",ex,ez})<chance){double cx=ex*64+32,cz=ez*64+32,angle=deterministic({"cave-angle",ex,ez})*6.283185307179586,length=16+deterministic({"cave-length",ex,ez})*16;static const Json default_depth_range=Json::array({10,30});static const Json default_radius_range=Json::array({2,5});const Json& depth_range=member_or(pattern,"caveDepthM",default_depth_range);const Json& radius_range=member_or(pattern,"caveRadiusM",default_radius_range);double depth=depth_range[0].get<double>()+deterministic({"cave-depth",ex,ez})*(depth_range[1].get<double>()-depth_range[0].get<double>());double cx2=std::cos(angle)*length*.5,cz2=std::sin(angle)*length*.5,radius=radius_range[0].get<double>()+deterministic({"cave-radius",ex,ez})*(radius_range[1].get<double>()-radius_range[0].get<double>());double t=clampd(((x-cx)*cx2+(z-cz)*cz2)/(cx2*cx2+cz2*cz2),-1,1);double yy=sample(cx,cz).height-depth;double dx=x-(cx+t*cx2),dz=z-(cz+t*cz2),dy=y-yy;if(dx*dx+dy*dy+dz*dz<radius*radius)return "";}
    if(c.y>=col->top_cell-col->soil_cells)return col->subsoil;
    const auto& ores=ore_map(floor_div(c.x,128),floor_div(c.z,128));auto oi=ores.find(c);if(oi!=ores.end())return oi->second;
    return col->bedrock;
}

std::string World::block(Cell c)const{
    if(!valid_cell(c))return "";auto it=edits_.find(c);if(it!=edits_.end())return it->second;return base_block(c);
}

void World::touch_cell(Cell c,bool terrain,bool fluid){
    Cell s=section_of(c);const int lx=c.x-s.x*SECTION_CELLS,ly=c.y-s.y*SECTION_CELLS,lz=c.z-s.z*SECTION_CELLS;
    auto mark=[&](Cell section){dirty_sections_.insert(section);if(terrain)terrain_section_revisions_[section]=++terrain_revision_counter_;if(fluid)fluid_section_revisions_[section]=++fluid_revision_counter_;};
    mark(s);
    if(lx==0)mark({s.x-1,s.y,s.z});else if(lx==SECTION_CELLS-1)mark({s.x+1,s.y,s.z});
    if(ly==0)mark({s.x,s.y-1,s.z});else if(ly==SECTION_CELLS-1)mark({s.x,s.y+1,s.z});
    if(lz==0)mark({s.x,s.y,s.z-1});else if(lz==SECTION_CELLS-1)mark({s.x,s.y,s.z+1});
    revision_++;
}

bool World::set_block(Cell c,const std::string& id){
    if(!valid_cell(c)||(!id.empty()&&!block_data_.count(id)))return false;std::string old=block(c);if(old==id)return false;
    if(!id.empty()&&fluid_state(c).present())return false;
    if(!old.empty()){damage_.erase(c);environmental_damage_.erase(c);thermal_.erase(c);fuel_remaining_.erase(c);burning_.erase(c);}
    edits_[c]=id;touch_cell(c,true,false);if(id.empty()){
        for(Cell d:DIRS){Cell n=c+d;if(!solid(block(n))){FluidState f=fluid_state(n);if(f.present())store_fluid(n,f);}}
    }
    return true;
}

double World::surface_height(double x,double z)const{
    if(!std::isfinite(x)||!std::isfinite(z))return 0;int hx=int(std::floor(x*2)),hz=int(std::floor(z*2));const auto c=column(hx,hz);int top=c->top_cell;
    for(const auto& e:edits_)if(e.first.x==hx&&e.first.z==hz&&!e.second.empty()&&solid(e.second))top=std::max(top,e.first.y);
    for(int y=top;y>top-8192;y--){if(solid(block({hx,y,hz})))return (y+1)*CELL_M;}
    return 0;
}

std::vector<Cell> World::dirty_sections(){std::vector<Cell> out(dirty_sections_.begin(),dirty_sections_.end());std::sort(out.begin(),out.end());dirty_sections_.clear();return out;}
std::vector<Cell> World::loaded_sections()const{std::vector<Cell> out(loaded_sections_.begin(),loaded_sections_.end());std::sort(out.begin(),out.end());return out;}
uint64_t World::terrain_revision(Cell section)const{auto it=terrain_section_revisions_.find(section);return it==terrain_section_revisions_.end()?0:it->second;}
uint64_t World::fluid_revision(Cell section)const{auto it=fluid_section_revisions_.find(section);return it==fluid_section_revisions_.end()?0:it->second;}

void World::require_terrain(Vec3 center,Vec3 size){
    if(!valid_vec(center)||!valid_vec(size)||size.x<0||size.y<0||size.z<0)throw std::invalid_argument("invalid terrain request");terrain_requests_.push_back({center,size});
}

void World::stream(Vec3 player,int radius){
    if(!valid_vec(player))return;
    radius=std::max(0,std::min(32,radius));
    auto previous=std::move(loaded_sections_);
    loaded_sections_.clear();
    focus_=player;
    focus_radius_=std::max(64.0,(radius+1)*4.0);
    for(auto it=fluid_active_.begin();it!=fluid_active_.end();) {
        if(std::abs(it->x*CELL_M-focus_.x)>focus_radius_||std::abs(it->z*CELL_M-focus_.z)>focus_radius_)it=fluid_active_.erase(it);
        else ++it;
    }

    auto add=[&](Cell section){if(loaded_sections_.size()<60000)loaded_sections_.insert(section);};
    auto add_surface=[&](int sx,int sz){
        double x=sx*4.0+2,z=sz*4.0+2,h=surface_height(x,z);
        int sy=int(std::floor(h/4.0));
        for(int dy=-2;dy<=1;dy++)add({sx,sy+dy,sz});
    };

    // Keep the cached center through small physics jitter around a 4 m boundary. The
    // quarter-meter hysteresis prevents strip unload/reload when a standing body straddles it.
    auto section_axis=[&](double position,int previous){
        constexpr double hysteresis_m=.25;
        const double lower=previous*4.0-hysteresis_m,upper=(previous+1)*4.0+hysteresis_m;
        return position<lower||position>upper?int(std::floor(position/4.0)):previous;
    };
    Cell player_section=player_stream_cache_valid_
        ?Cell{section_axis(player.x,player_stream_section_.x),section_axis(player.y,player_stream_section_.y),section_axis(player.z,player_stream_section_.z)}
        :Cell{int(std::floor(player.x/4)),int(std::floor(player.y/4)),int(std::floor(player.z/4))};
    if(!player_stream_cache_valid_||!(player_stream_section_==player_section)||player_stream_radius_!=radius){
        player_stream_sections_.clear();
        const int psx=player_section.x,psy=player_section.y,psz=player_section.z;
        for(int z=psz-radius;z<=psz+radius;z++)for(int x=psx-radius;x<=psx+radius;x++){
            for(int y=psy-2;y<=psy+1;y++)player_stream_sections_.push_back({x,y,z});
            double h=surface_height(x*4.0+2,z*4.0+2);int sy=int(std::floor(h/4.0));
            for(int dy=-2;dy<=1;dy++)player_stream_sections_.push_back({x,sy+dy,z});
        }
        player_stream_section_=player_section;player_stream_radius_=radius;player_stream_cache_valid_=true;
    }
    for(Cell section:player_stream_sections_)add(section);

    // Explicit machine or structure requests are consumed on this stream and remain bounded by
    // the requested object bounds. Quantized request bounds let a repeated pose avoid rebuilding
    // the same section vector when a machine moves by less than one section.
    std::vector<Cell> request_key;request_key.reserve(terrain_requests_.size()*2);
    std::vector<std::pair<Cell,Cell>> request_bounds;request_bounds.reserve(terrain_requests_.size());
    for(const auto& req:terrain_requests_){
        Vec3 c=req.first,s=req.second;
        Cell lo{int(std::floor((c.x-s.x*.5)/4)),int(std::floor((c.y-s.y*.5)/4)),int(std::floor((c.z-s.z*.5)/4))};
        Cell hi{int(std::floor((c.x+s.x*.5)/4)),int(std::floor((c.y+s.y*.5)/4)),int(std::floor((c.z+s.z*.5)/4))};
        request_bounds.push_back({lo,hi});
    }
    std::sort(request_bounds.begin(),request_bounds.end(),[](const auto& a,const auto& b){return a.first==b.first?a.second<b.second:a.first<b.first;});
    for(const auto& bounds:request_bounds){request_key.push_back(bounds.first);request_key.push_back(bounds.second);}
    if(request_key!=terrain_request_key_){
        terrain_request_key_=request_key;cached_terrain_request_sections_.clear();
        for(const auto& bounds:request_bounds){
            const Cell lo=bounds.first,hi=bounds.second;
            const int64_t nx=int64_t(hi.x)-lo.x+1,ny=int64_t(hi.y)-lo.y+1,nz=int64_t(hi.z)-lo.z+1;
            if(nx<=0||ny<=0||nz<=0||nx>60000||ny>60000||nz>60000||nx*ny>60000||nx*ny*nz>60000)continue;
            for(int z=lo.z;z<=hi.z&&cached_terrain_request_sections_.size()<60000;z++)for(int y=lo.y;y<=hi.y&&cached_terrain_request_sections_.size()<60000;y++)for(int x=lo.x;x<=hi.x&&cached_terrain_request_sections_.size()<60000;x++)cached_terrain_request_sections_.push_back({x,y,z});
        }
        std::sort(cached_terrain_request_sections_.begin(),cached_terrain_request_sections_.end());
        cached_terrain_request_sections_.erase(std::unique(cached_terrain_request_sections_.begin(),cached_terrain_request_sections_.end()),cached_terrain_request_sections_.end());
    }
    for(Cell section:cached_terrain_request_sections_)add(section);
    terrain_requests_.clear();

    // Bodies are eligible only while their origin is within the adapter's 64 m horizontal
    // activation radius. Their terrain requests cover the actual transformed solid bounds and
    // local ground support under that footprint; sensors and remote bodies request nothing.
    std::unordered_set<std::string> current_bodies;
    for(auto& pair:bodies_){
        BodyState& body=pair.second;
        current_bodies.insert(pair.first);
        const bool origin_near=std::hypot(body.position.x-player.x,body.position.z-player.z)<=64.0;
        if(!origin_near){auto it=body_stream_cache_.find(pair.first);if(it!=body_stream_cache_.end()){it->second.valid=false;it->second.sections.clear();}continue;}
        if(body.boxes.empty()&&!body.voxels.empty())rebuild_body(body);
        Vec3 mn{1e30,1e30,1e30},mx{-1e30,-1e30,-1e30};bool any=false;
        for(const Box& box:body.boxes)if(box.solid){
            any=true;
            for(int ix:{-1,1})for(int iy:{-1,1})for(int iz:{-1,1}){
                Vec3 local=box.center+Vec3{box.size.x*.5*ix,box.size.y*.5*iy,box.size.z*.5*iz};
                Vec3 p=body.position+rotate(body.rotation,local);
                mn.x=std::min(mn.x,p.x);mn.y=std::min(mn.y,p.y);mn.z=std::min(mn.z,p.z);
                mx.x=std::max(mx.x,p.x);mx.y=std::max(mx.y,p.y);mx.z=std::max(mx.z,p.z);
            }
        }
        StreamBodyCache& cache=body_stream_cache_[pair.first];
        if(!any){cache.valid=false;cache.sections.clear();continue;}
        constexpr double margin=1.0;
        Cell lo{int(std::floor((mn.x-margin)/4)),int(std::floor((mn.y-margin)/4)),int(std::floor((mn.z-margin)/4))};
        Cell hi{int(std::floor((mx.x+margin)/4)),int(std::floor((mx.y+margin)/4)),int(std::floor((mx.z+margin)/4))};
        const bool changed=!cache.valid||cache.revision!=body.revision||!(cache.min_section==lo)||!(cache.max_section==hi);
        if(changed){
            cache.sections.clear();cache.revision=body.revision;cache.min_section=lo;cache.max_section=hi;cache.valid=true;
            const int64_t volume=int64_t(hi.x-lo.x+1)*(hi.y-lo.y+1)*(hi.z-lo.z+1);
            if(volume<=10000)for(int z=lo.z;z<=hi.z;z++)for(int y=lo.y;y<=hi.y;y++)for(int x=lo.x;x<=hi.x;x++)cache.sections.push_back({x,y,z});
            // Ground support follows only the body's horizontal footprint, never a 64 m disk.
            const int64_t area=int64_t(hi.x-lo.x+1)*(hi.z-lo.z+1);
            if(area<=10000)for(int z=lo.z;z<=hi.z;z++)for(int x=lo.x;x<=hi.x;x++){
                double h=surface_height(x*4.0+2,z*4.0+2);int sy=int(std::floor(h/4.0));
                for(int dy=-2;dy<=1;dy++)cache.sections.push_back({x,sy+dy,z});
            }
            std::sort(cache.sections.begin(),cache.sections.end());
            cache.sections.erase(std::unique(cache.sections.begin(),cache.sections.end()),cache.sections.end());
        }
        for(Cell section:cache.sections)add(section);
    }
    for(auto it=body_stream_cache_.begin();it!=body_stream_cache_.end();)if(!current_bodies.count(it->first))it=body_stream_cache_.erase(it);else ++it;
    bool loaded_changed=previous.size()!=loaded_sections_.size();
    if(!loaded_changed)for(Cell section:loaded_sections_)if(!previous.count(section)){loaded_changed=true;break;}
    if(loaded_changed)stream_revision_++;
    for(Cell section:loaded_sections_)if(!previous.count(section))dirty_sections_.insert(section);
}

std::vector<Box> World::terrain_boxes(Cell section)const{
    std::array<std::string,512> cells{};std::array<uint8_t,512> used{};auto idx=[](int x,int y,int z){return x+z*8+y*64;};Cell base{section.x*8,section.y*8,section.z*8};
    for(int y=0;y<8;y++)for(int z=0;z<8;z++)for(int x=0;x<8;x++){Cell c{base.x+x,base.y+y,base.z+z};std::string id=block(c);if(solid(id))cells[idx(x,y,z)]=id;}
    std::vector<Box> out;
    for(int y=0;y<8;y++)for(int z=0;z<8;z++)for(int x=0;x<8;x++){int i=idx(x,y,z);if(used[i]||cells[i].empty())continue;const std::string id=cells[i];int x1=x+1;while(x1<8&&!used[idx(x1,y,z)]&&cells[idx(x1,y,z)]==id)x1++;
        int y1=y+1;for(;y1<8;y1++){bool full=true;for(int xx=x;xx<x1;xx++)if(used[idx(xx,y1,z)]||cells[idx(xx,y1,z)]!=id){full=false;break;}if(!full)break;}
        int z1=z+1;for(;z1<8;z1++){bool full=true;for(int yy=y;yy<y1&&full;yy++)for(int xx=x;xx<x1;xx++)if(used[idx(xx,yy,z1)]||cells[idx(xx,yy,z1)]!=id){full=false;break;}if(!full)break;}
        for(int yy=y;yy<y1;yy++)for(int zz=z;zz<z1;zz++)for(int xx=x;xx<x1;xx++)used[idx(xx,yy,zz)]=1;
        double nx=x1-x,ny=y1-y,nz=z1-z,count=nx*ny*nz;out.push_back({{(base.x+x+nx*.5)*CELL_M,(base.y+y+ny*.5)*CELL_M,(base.z+z+nz*.5)*CELL_M},{nx*CELL_M,ny*CELL_M,nz*CELL_M},id,mass(id)*count,true});
    }
    return out;
}

MeshData World::mesh(Cell section)const{
    static const Cell dirs[]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};MeshData out;Cell base{section.x*8,section.y*8,section.z*8};
    auto emit=[&](Cell c,const std::string& id,int face){double x=c.x*CELL_M,y=c.y*CELL_M,z=c.z*CELL_M,x1=x+CELL_M,y1=y+CELL_M,z1=z+CELL_M;Vec3 normal=face==0?Vec3{1,0,0}:face==1?Vec3{-1,0,0}:face==2?Vec3{0,1,0}:face==3?Vec3{0,-1,0}:face==4?Vec3{0,0,1}:Vec3{0,0,-1};std::array<Vec3,4> v;
        switch(face){case 0:v={Vec3{x1,y,z},Vec3{x1,y1,z},Vec3{x1,y1,z1},Vec3{x1,y,z1}};break;case 1:v={Vec3{x,y,z1},Vec3{x,y1,z1},Vec3{x,y1,z},Vec3{x,y,z}};break;case 2:v={Vec3{x,y1,z},Vec3{x,y1,z1},Vec3{x1,y1,z1},Vec3{x1,y1,z}};break;case 3:v={Vec3{x,y,z1},Vec3{x,y,z},Vec3{x1,y,z},Vec3{x1,y,z1}};break;case 4:v={Vec3{x1,y,z1},Vec3{x1,y1,z1},Vec3{x,y1,z1},Vec3{x,y,z1}};break;default:v={Vec3{x,y,z},Vec3{x,y1,z},Vec3{x1,y1,z},Vec3{x1,y,z}};break;}
        uint32_t n=uint32_t(out.vertices.size());Vec3 color=parse_color(block_info(id),id);for(auto p:v){out.vertices.push_back(p);out.normals.push_back(normal);out.colors.push_back(color);}out.indices.insert(out.indices.end(),{n,n+1,n+2,n,n+2,n+3});out.face_materials.push_back(id);};
    for(int y=0;y<8;y++)for(int z=0;z<8;z++)for(int x=0;x<8;x++){Cell c{base.x+x,base.y+y,base.z+z};std::string id=block(c);if(id.empty())continue;for(int face=0;face<6;face++){Cell n=c+dirs[face];std::string other=block(n);if(other.empty()||!opaque(block_info(other)))emit(c,id,face);}}
    return out;
}

FluidState World::fluid_state(Cell c)const{
    auto it=fluids_.find(c);if(it!=fluids_.end())return it->second;if(!valid_cell(c)||solid(block(c)))return {};
    const auto col=column(c.x,c.z);if(!col->sample.has_water)return {};double bottom=c.y*CELL_M,top=bottom+CELL_M,water=generator_id_=="infinite"?0.0:col->sample.water_level;
    if(top<=col->sample.height||bottom>=water)return {};double volume=std::max(0.0,std::min(top,water)-std::max(bottom,col->sample.height))*.25;if(volume<=EPS)return {};
    double acid=col->sample.water_type=="acid"?volume*.45:0;return {volume,acid,0};
}
FluidState World::fluid_at(Cell c)const{return fluid_state(c);}
void World::store_fluid(Cell c,FluidState f){
    f.volume_m3=clampd(f.volume_m3,0,.125);f.acid_m3=clampd(f.acid_m3,0,f.volume_m3);f.thermal_eu=std::max(0.0,f.thermal_eu);auto old=fluids_.find(c);bool changed=old==fluids_.end()||std::abs(old->second.volume_m3-f.volume_m3)>EPS||std::abs(old->second.acid_m3-f.acid_m3)>EPS||std::abs(old->second.thermal_eu-f.thermal_eu)>EPS;fluids_[c]=f;if(changed)touch_cell(c,false,true);
    if(f.present()&&std::abs(c.x*CELL_M-focus_.x)<=focus_radius_&&std::abs(c.z*CELL_M-focus_.z)<=focus_radius_&&fluid_active_.size()<2048){if(fluid_active_.insert(c).second)fluid_order_.push_back(c);}else if(!f.present())fluid_active_.erase(c);
}
Json World::fluid_at(Vec3 point)const{
    if(!valid_vec(point))return nullptr;Cell c=world_cell(point);FluidState f=fluid_state(c);if(!f.present()||solid(block(c)))return nullptr;double top=c.y*CELL_M+f.volume_m3/.25;if(point.y>=top)return nullptr;double acid=f.acid_m3/f.volume_m3;return Json{{"type",acid>.3?"acid":"water"},{"depth",top-point.y},{"volumeM3",f.volume_m3},{"acidFraction",acid},{"temperatureC",20+f.thermal_eu/(4000*f.volume_m3)}};
}
BuoyancyResult World::buoyancy_for_compound(Vec3 position,Quat rotation,Vec3 velocity,double body_mass,
                                             const std::vector<Box>& boxes,double dt)const{
    if(!valid_vec(position)||!valid_vec(velocity)||!std::isfinite(body_mass)||body_mass<0||!std::isfinite(dt)||dt<0)
        throw std::invalid_argument("invalid buoyancy sample");
    BuoyancyResult result;const Vec3 local_up=inverse_rotate(rotation,{0,1,0});
    for(const Box& box:boxes){
        if(!box.solid||!valid_vec(box.center)||!valid_vec(box.size)||box.size.x<=0||box.size.y<=0||box.size.z<=0)continue;
        const double volume=box.size.x*box.size.y*box.size.z;if(!(volume>0)||!std::isfinite(volume))continue;
        result.total_volume_m3+=volume;
        const double span=std::abs(local_up.x)*box.size.x+std::abs(local_up.y)*box.size.y+std::abs(local_up.z)*box.size.z;
        if(!(span>EPS))continue;
        Vec3 center=position+rotate(rotation,box.center);Vec3 bottom=center;bottom.y-=span*.5-1e-4;
        Json fluid=fluid_at(bottom);if(!fluid.is_object())continue;
        const double depth=fluid.value("depth",0.0);if(!(depth>0))continue;
        const double fraction=clampd(depth/span,0,1),liters_density=content_.find("progression",fluid.value("type",std::string())).value("massKgPerUnit",1.0);
        const double force=std::max(0.0,liters_density)*1000.0*volume*fraction*9.81;
        if(force>0){result.forces.push_back({{0,force,0},center});result.submerged_volume_m3+=volume*fraction;}
    }
    if(result.submerged_volume_m3>0&&result.total_volume_m3>EPS){
        const double fraction=result.submerged_volume_m3/result.total_volume_m3;
        const double rate=std::min(4.0*fraction,dt>EPS?.9/dt:std::numeric_limits<double>::infinity());
        result.drag_force_n=velocity*(-std::max(0.0,body_mass)*rate);
    }
    return result;
}
double World::pour(Vec3 point,double volume,double acid_fraction,double temperature){
    if(!valid_vec(point)||!std::isfinite(volume)||volume<0||!std::isfinite(acid_fraction)||acid_fraction<0||acid_fraction>1||!std::isfinite(temperature)||temperature<20||temperature>2000)throw std::invalid_argument("invalid fluid addition");Cell c=world_cell(point);double left=volume;static const Cell order[]={{0,0,0},{1,0,0},{-1,0,0},{0,0,1},{0,0,-1},{0,1,0},{1,1,0},{-1,1,0},{0,1,1},{0,1,-1}};
    for(Cell d:order){if(left<=EPS)break;Cell at=c+d;if(solid(block(at)))continue;FluidState f=fluid_state(at);double add=std::min(left,.125-f.volume_m3);if(add<=0)continue;store_fluid(at,{f.volume_m3+add,f.acid_m3+add*acid_fraction,f.thermal_eu+add*4000*(temperature-20)});left-=add;}return volume-left;
}
Json World::take_fluid(Vec3 point,double volume){
    if(!valid_vec(point)||!std::isfinite(volume)||volume<0)throw std::invalid_argument("invalid fluid withdrawal");Cell c=world_cell(point);FluidState f=fluid_state(c);double taken=std::min(volume,f.volume_m3);if(taken<=EPS)return Json{{"volumeM3",0.0},{"acidFraction",0.0},{"temperatureC",20.0}};double ratio=taken/f.volume_m3;Json result={{"volumeM3",taken},{"acidFraction",f.acid_m3/f.volume_m3},{"temperatureC",20+f.thermal_eu/(4000*f.volume_m3)}};store_fluid(c,{f.volume_m3-taken,f.acid_m3*(1-ratio),f.thermal_eu*(1-ratio)});for(Cell d:DIRS){Cell n=c+d;if(!solid(block(n))){FluidState adjacent=fluid_state(n);if(adjacent.present())store_fluid(n,adjacent);}}return result;
}

MeshData World::fluid_mesh(Cell section)const{
    MeshData out;Cell base{section.x*8,section.y*8,section.z*8};static const Vec3 water_color{.13,.43,.57},acid_color{.42,.76,.24};
    auto emit=[&](const std::array<Vec3,4>& v,Vec3 normal,const std::string& material){uint32_t n=uint32_t(out.vertices.size());Vec3 color=material=="acid"?acid_color:water_color;for(Vec3 p:v){out.vertices.push_back(p);out.normals.push_back(normal);out.colors.push_back(color);}out.indices.insert(out.indices.end(),{n,n+1,n+2,n,n+2,n+3});out.face_materials.push_back(material);};
    for(int y=0;y<8;y++)for(int z=0;z<8;z++)for(int x=0;x<8;x++){Cell c{base.x+x,base.y+y,base.z+z};FluidState f=fluid_state(c);if(!f.present())continue;double x0=c.x*CELL_M,x1=x0+CELL_M,y0=c.y*CELL_M,y1=y0+f.volume_m3/.25,z0=c.z*CELL_M,z1=z0+CELL_M;std::string mat=f.acid_m3/f.volume_m3>.3?"acid":"water";
        if(!fluid_state(c+Cell{0,1,0}).present())emit({Vec3{x0,y1,z0},Vec3{x0,y1,z1},Vec3{x1,y1,z1},Vec3{x1,y1,z0}},{0,1,0},mat);
        if(!fluid_state(c+Cell{0,-1,0}).present())emit({Vec3{x0,y0,z1},Vec3{x0,y0,z0},Vec3{x1,y0,z0},Vec3{x1,y0,z1}},{0,-1,0},mat);
        for(int face=0;face<4;face++){Cell d=face==0?Cell{1,0,0}:face==1?Cell{-1,0,0}:face==2?Cell{0,0,1}:Cell{0,0,-1};FluidState other=fluid_state(c+d);double oy=other.present()?(c.y*CELL_M+other.volume_m3/.25):y0;if(oy>=y1-EPS)continue;double low=std::max(y0,oy);std::array<Vec3,4> v;Vec3 n;
            if(face==0){v={Vec3{x1,low,z0},Vec3{x1,y1,z0},Vec3{x1,y1,z1},Vec3{x1,low,z1}};n={1,0,0};}
            else if(face==1){v={Vec3{x0,low,z1},Vec3{x0,y1,z1},Vec3{x0,y1,z0},Vec3{x0,low,z0}};n={-1,0,0};}
            else if(face==2){v={Vec3{x1,low,z1},Vec3{x1,y1,z1},Vec3{x0,y1,z1},Vec3{x0,low,z1}};n={0,0,1};}
            else{v={Vec3{x0,low,z0},Vec3{x0,y1,z0},Vec3{x1,y1,z0},Vec3{x1,low,z0}};n={0,0,-1};}emit(v,n,mat);
        }
    }return out;
}

Contact World::raycast_terrain(Vec3 origin,Vec3 direction,double reach)const{
    Contact none;if(!valid_vec(origin)||!valid_vec(direction)||!std::isfinite(reach)||reach<0)return none;Vec3 dir=direction.normalized();if(dir.length_squared()<EPS)return none;
    return trace_grid(origin,dir,reach,[&](Cell c){return block(c);},"terrain");
}

Contact World::raycast(Vec3 origin,Vec3 direction,double reach)const{
    if(!valid_vec(origin)||!valid_vec(direction)||!std::isfinite(reach)||reach<0)return {};Vec3 dir=direction.normalized();if(dir.length_squared()<EPS)return {};
    Contact best=raycast_terrain(origin,dir,reach);
    for(const auto& pair:bodies_){
        const BodyState& body=pair.second;Quat rotation=body.rotation;double norm=std::sqrt(rotation.x*rotation.x+rotation.y*rotation.y+rotation.z*rotation.z+rotation.w*rotation.w);if(norm<EPS)rotation={};else{rotation.x/=norm;rotation.y/=norm;rotation.z/=norm;rotation.w/=norm;}
        Vec3 local_min{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity()},local_max{-local_min.x,-local_min.y,-local_min.z};bool has_bounds=false;
        if(!body.boxes.empty()){
            for(const Box& box:body.boxes){if(!valid_vec(box.center)||!valid_vec(box.size)||box.size.x<=0||box.size.y<=0||box.size.z<=0)continue;Vec3 half=box.size*.5;Vec3 lo=box.center-half,hi=box.center+half;local_min.x=std::min(local_min.x,lo.x);local_min.y=std::min(local_min.y,lo.y);local_min.z=std::min(local_min.z,lo.z);local_max.x=std::max(local_max.x,hi.x);local_max.y=std::max(local_max.y,hi.y);local_max.z=std::max(local_max.z,hi.z);has_bounds=true;}
        }else{
            auto cached=body_ray_cache_.find(pair.first);if(cached!=body_ray_cache_.end()&&cached->second.valid&&cached->second.revision==body.revision){local_min=cached->second.min_local;local_max=cached->second.max_local;has_bounds=true;}
            else if(!body.voxels.empty()){for(const Voxel& voxel:body.voxels){if(voxel.block.empty())continue;local_min.x=std::min(local_min.x,voxel.cell.x*CELL_M);local_min.y=std::min(local_min.y,voxel.cell.y*CELL_M);local_min.z=std::min(local_min.z,voxel.cell.z*CELL_M);local_max.x=std::max(local_max.x,(voxel.cell.x+1)*CELL_M);local_max.y=std::max(local_max.y,(voxel.cell.y+1)*CELL_M);local_max.z=std::max(local_max.z,(voxel.cell.z+1)*CELL_M);has_bounds=true;}}
        }
        if(!has_bounds)continue;
        Vec3 world_min{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity()};
        Vec3 world_max{-world_min.x,-world_min.y,-world_min.z};
        for(int ix=0;ix<2;ix++)for(int iy=0;iy<2;iy++)for(int iz=0;iz<2;iz++){
            Vec3 corner{ix?local_max.x:local_min.x,iy?local_max.y:local_min.y,iz?local_max.z:local_min.z};Vec3 p=body.position+rotate(rotation,corner);
            world_min.x=std::min(world_min.x,p.x);world_min.y=std::min(world_min.y,p.y);world_min.z=std::min(world_min.z,p.z);
            world_max.x=std::max(world_max.x,p.x);world_max.y=std::max(world_max.y,p.y);world_max.z=std::max(world_max.z,p.z);
        }
        if(!ray_aabb(origin,dir,world_min,world_max,std::min(reach,best.hit?best.distance:reach)))continue;
        BodyRayCache& cache=body_ray_cache_[pair.first];
        if(!cache.valid||cache.revision!=body.revision){
            cache.voxels.clear();cache.voxels.reserve(body.voxels.size());bool first=true;int min_x=0,min_y=0,min_z=0,max_x=0,max_y=0,max_z=0;
            for(const Voxel& voxel:body.voxels){if(voxel.block.empty())continue;cache.voxels[voxel.cell]=voxel.block;if(first){min_x=max_x=voxel.cell.x;min_y=max_y=voxel.cell.y;min_z=max_z=voxel.cell.z;first=false;}else{min_x=std::min(min_x,voxel.cell.x);min_y=std::min(min_y,voxel.cell.y);min_z=std::min(min_z,voxel.cell.z);max_x=std::max(max_x,voxel.cell.x);max_y=std::max(max_y,voxel.cell.y);max_z=std::max(max_z,voxel.cell.z);}}
            cache.valid=!first;cache.revision=body.revision;if(!first){cache.min_local={min_x*CELL_M,min_y*CELL_M,min_z*CELL_M};cache.max_local={(max_x+1)*CELL_M,(max_y+1)*CELL_M,(max_z+1)*CELL_M};}
        }
        if(!cache.valid||cache.voxels.empty())continue;
        Vec3 local_origin=inverse_rotate(rotation,origin-body.position),local_direction=inverse_rotate(rotation,dir);
        Contact hit=trace_grid(local_origin,local_direction,reach,[&](Cell c){auto voxel=cache.voxels.find(c);return voxel==cache.voxels.end()?std::string():voxel->second;},"body",body.id);
        if(hit.hit&&(!best.hit||hit.distance<best.distance-EPS)){hit.point=origin+dir*hit.distance;hit.normal=rotate(rotation,hit.normal).normalized();best=std::move(hit);}
    }
    return best;
}

std::vector<Box> World::boxes_for_voxels(const std::vector<Voxel>& voxels,bool local)const{
    std::unordered_map<Cell,std::string,CellHash> occupied;for(const auto& v:voxels)if(!v.block.empty())occupied[v.cell]=v.block;std::vector<Cell> cells;cells.reserve(occupied.size());for(const auto& p:occupied)cells.push_back(p.first);std::sort(cells.begin(),cells.end());std::unordered_set<Cell,CellHash> used;std::vector<Box> out;
    for(Cell c:cells){if(used.count(c))continue;std::string id=occupied[c];int x1=c.x+1;while(occupied.count({x1,c.y,c.z})&&occupied.at({x1,c.y,c.z})==id&&!used.count({x1,c.y,c.z}))x1++;
        int y1=c.y+1;for(;occupied.count({c.x,y1,c.z})&&occupied.at({c.x,y1,c.z})==id&&!used.count({c.x,y1,c.z});y1++){bool ok=true;for(int x=c.x;x<x1;x++)if(!occupied.count({x,y1,c.z})||occupied.at({x,y1,c.z})!=id||used.count({x,y1,c.z})){ok=false;break;}if(!ok)break;}
        int z1=c.z+1;for(;occupied.count({c.x,c.y,z1})&&occupied.at({c.x,c.y,z1})==id&&!used.count({c.x,c.y,z1});z1++){bool ok=true;for(int y=c.y;y<y1&&ok;y++)for(int x=c.x;x<x1;x++)if(!occupied.count({x,y,z1})||occupied.at({x,y,z1})!=id||used.count({x,y,z1})){ok=false;break;}if(!ok)break;}
        for(int y=c.y;y<y1;y++)for(int z=c.z;z<z1;z++)for(int x=c.x;x<x1;x++)used.insert({x,y,z});double nx=x1-c.x,ny=y1-c.y,nz=z1-c.z,count=nx*ny*nz;
        Vec3 center{(c.x+nx*.5)*CELL_M,(c.y+ny*.5)*CELL_M,(c.z+nz*.5)*CELL_M};(void)local;out.push_back({center,{nx*CELL_M,ny*CELL_M,nz*CELL_M},id,mass(id)*count,solid(id)});
    }return out;
}

void World::rebuild_body(BodyState& body){body.boxes=boxes_for_voxels(body.voxels,true);body.mass=0;for(const auto& voxel:body.voxels)body.mass+=mass(voxel.block);}

bool World::set_anchor(Cell cell,bool anchored){if(anchored)return anchors_.insert(cell).second;return anchors_.erase(cell)>0;}
bool World::remove_body(const std::string& id){body_source_.erase(id);body_ray_cache_.erase(id);body_stream_cache_.erase(id);return bodies_.erase(id)>0;}

std::vector<std::string> World::detach(Cell cell){return detach_components(cell);}

std::vector<std::string> World::detach_components(Cell origin){
    std::vector<std::string> created;if(!valid_cell(origin)||!block(origin).empty())return created;std::unordered_set<Cell,CellHash> examined;
    for(Cell d:DIRS){Cell start=origin+d;if(examined.count(start)||block(start).empty())continue;std::queue<Cell> q;q.push(start);std::unordered_set<Cell,CellHash> queued{start};std::vector<Voxel> component;bool fixed=false,over_limit=false;
        while(!q.empty()){Cell c=q.front();q.pop();std::string id=block(c);if(id.empty())continue;examined.insert(c);const Json& info=block_info(id);if(!info.value("detachesWhenUnsupported",false)||anchors_.count(c)){fixed=true;break;}component.push_back({c,id,-1});if(component.size()>2048){over_limit=true;break;}
            for(Cell nd:DIRS){Cell n=c+nd;if(queued.count(n))continue;queued.insert(n);if(anchors_.count(n)){fixed=true;break;}std::string next=block(n);if(next.empty())continue;if(!block_info(next).value("detachesWhenUnsupported",false)){fixed=true;break;}q.push(n);}if(fixed)break;
        }
        if(over_limit)for(Cell c:queued)examined.insert(c);
        if(fixed||over_limit||component.empty())continue;Cell lo=component.front().cell;for(const auto& v:component){lo.x=std::min(lo.x,v.cell.x);lo.y=std::min(lo.y,v.cell.y);lo.z=std::min(lo.z,v.cell.z);}
        BodyState body;body.id="object:"+std::to_string(next_body_id_++);body.position={lo.x*CELL_M,lo.y*CELL_M,lo.z*CELL_M};body.rotation={};body.revision=1;for(auto& v:component){v.cell={v.cell.x-lo.x,v.cell.y-lo.y,v.cell.z-lo.z};body.voxels.push_back(v);}rebuild_body(body);
        bool stable=true;for(const auto& v:component)if(block({v.cell.x+lo.x,v.cell.y+lo.y,v.cell.z+lo.z})!=v.block){stable=false;break;}if(!stable)continue;
        const std::string id=body.id;Json source={{"originCell",Json::array({lo.x,lo.y,lo.z})},{"cells",Json::array()}};
        for(const auto& v:component)source["cells"].push_back({{"cell",v.cell},{"sourceCell",Json::array({v.cell.x+lo.x,v.cell.y+lo.y,v.cell.z+lo.z})},{"blockId",v.block}});
        for(const auto& v:component)set_block({v.cell.x+lo.x,v.cell.y+lo.y,v.cell.z+lo.z},"");bodies_[id]=std::move(body);body_source_[id]=std::move(source);created.push_back(id);
    }return created;
}

void World::split_body(const std::string& id){
    auto found=bodies_.find(id);if(found==bodies_.end())return;BodyState old=found->second;if(old.voxels.empty()){bodies_.erase(found);body_source_.erase(id);return;}
    std::unordered_map<Cell,size_t,CellHash> by_cell;for(size_t i=0;i<old.voxels.size();i++)by_cell[old.voxels[i].cell]=i;std::unordered_set<Cell,CellHash> seen;std::vector<std::vector<Voxel>> groups;
    for(const auto& v:old.voxels){if(seen.count(v.cell))continue;std::queue<Cell> q;q.push(v.cell);seen.insert(v.cell);std::vector<Voxel> group;while(!q.empty()){Cell c=q.front();q.pop();group.push_back(old.voxels[by_cell[c]]);for(Cell d:DIRS){Cell n=c+d;if(by_cell.count(n)&&!seen.count(n)){seen.insert(n);q.push(n);}}}groups.push_back(std::move(group));}
    std::sort(groups.begin(),groups.end(),[](const auto&a,const auto&b){if(a.size()!=b.size())return a.size()>b.size();return a.front().cell<b.front().cell;});
    Vec3 old_com{};double total=0;for(const auto& v:old.voxels){double m=mass(v.block);old_com+=Vec3{(v.cell.x+.5)*CELL_M,(v.cell.y+.5)*CELL_M,(v.cell.z+.5)*CELL_M}*m;total+=m;}if(total>EPS)old_com=old_com/total;Vec3 old_com_world=old.position+rotate(old.rotation,old_com);
    Json source=body_source_.count(id)?body_source_.at(id):Json::object();std::vector<BodyState> parts;for(size_t i=0;i<groups.size();i++){BodyState part=old;part.voxels=groups[i];part.revision=old.revision+1;part.anchored=i==0&&old.anchored;
        if(i>0)part.id="object:"+std::to_string(next_body_id_++);
        // Keep each fragment in the original local frame. The authored sourceCell
        // invariant is sourceCell == originCell + cell even after the physics pose moves.
        rebuild_body(part);Vec3 cm{};for(const auto& v:part.voxels)cm+=Vec3{(v.cell.x+.5)*CELL_M,(v.cell.y+.5)*CELL_M,(v.cell.z+.5)*CELL_M}*mass(v.block);if(part.mass>EPS)cm=cm/part.mass;Vec3 world_cm=part.position+rotate(part.rotation,cm);part.velocity=old.velocity+old.angular_velocity.cross(world_cm-old_com_world);if(part.id!=id)body_source_[part.id]=source;parts.push_back(std::move(part));
    }
    bodies_.erase(id);bool original_kept=false;for(auto& p:parts){original_kept|=p.id==id;bodies_[p.id]=std::move(p);}if(!original_kept){body_source_.erase(id);body_ray_cache_.erase(id);body_stream_cache_.erase(id);}
}

bool World::damage_cell(Cell c,double amount_hp,std::vector<std::string>* detached){
    if(!(amount_hp>0)||!std::isfinite(amount_hp))return false;std::string id=block(c);if(id.empty())return false;double max=durability(id);auto it=environmental_damage_.find(c);double before=it!=environmental_damage_.end()&&it->second.block_id==id?it->second.damage_hp:0;double sum=before+amount_hp;
    if(sum+EPS<max){environmental_damage_[c]={id,sum};return false;}
    environmental_damage_.erase(c);if(!set_block(c,""))return false;auto ids=detach_components(c);if(detached)detached->insert(detached->end(),ids.begin(),ids.end());return true;
}

double World::temperature_at_cell(Cell c)const{
    std::string id=block(c);auto b=thermal_.find(c);if(id.empty()||b==thermal_.end())return 20;double energy=b->second.energy_eu*std::exp(-.04*(simulation_time_-b->second.updated_at)),capacity=std::max(.05,mass(id)*.02);return 20+energy/capacity;
}
double World::apply_thermal_energy(Cell c,double energy){
    if(!valid_cell(c)||!std::isfinite(energy)||energy<0)throw std::invalid_argument("invalid thermal energy");FluidState f=fluid_state(c);if(f.present()){store_fluid(c,{f.volume_m3,f.acid_m3,f.thermal_eu+energy});return energy;}
    std::string id=block(c);if(id.empty()){reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+energy;return 0;}
    auto it=thermal_.find(c);bool new_entry=it==thermal_.end();double old=0;if(!new_entry){old=it->second.energy_eu*std::exp(-.04*(simulation_time_-it->second.updated_at));reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+it->second.energy_eu-old;}
    thermal_[c]={old+energy,simulation_time_};if(new_entry)thermal_order_.push_back(c);if(block_info(id).value("flammable",false)&&temperature_at_cell(c)>=block_info(id).value("ignitionTemperatureC",std::numeric_limits<double>::infinity()))ignite_cell(c);return energy;
}
bool World::ignite_cell(Cell c){
    if(!valid_cell(c))return false;std::string id=block(c);const Json& b=block_info(id);if(!b.value("flammable",false)||burning_.count(c)||fluid_state(c).volume_m3>.01)return false;double full=mass(id)*50,remaining=full;auto f=fuel_remaining_.find(c);if(f!=fuel_remaining_.end())remaining=f->second;if(remaining<=EPS)return false;std::string kind=b.value("kind",std::string());double duration=kind=="wood"?8:kind=="vegetation"?3:4;fuel_remaining_[c]=remaining;burning_[c]={id,duration*remaining/full,full/duration};burning_order_.push_back(c);return true;
}

void World::flow_step(double dt){
    std::vector<Cell> keys;keys.reserve(fluid_order_.size());for(Cell c:fluid_order_)if(fluid_active_.count(c))keys.push_back(c);if(keys.empty())return;size_t count=std::min<size_t>(128,keys.size());int offset=int(std::floor(simulation_time_*10))%4;
    auto near=[&](Cell c){return std::abs(c.x*CELL_M-focus_.x)<=focus_radius_&&std::abs(c.z*CELL_M-focus_.z)<=focus_radius_;};
    auto transfer=[&](Cell from,Cell to,double requested){if(solid(block(to))||!near(to))return 0.0;FluidState a=fluid_state(from),b=fluid_state(to);double m=std::min({a.volume_m3,.125-b.volume_m3,std::max(0.0,requested)});if(m<=EPS)return 0.0;double ratio=m/a.volume_m3,acid=a.acid_m3*ratio,heat=a.thermal_eu*ratio;store_fluid(from,{a.volume_m3-m,a.acid_m3-acid,a.thermal_eu-heat});store_fluid(to,{b.volume_m3+m,b.acid_m3+acid,b.thermal_eu+heat});return m;};
    static const Cell sides[4]={{1,0,0},{0,0,1},{-1,0,0},{0,0,-1}};static const Cell react_dirs[]={{0,0,0},{0,-1,0},{1,0,0},{-1,0,0},{0,0,1},{0,0,-1}};
    for(size_t i=0;i<count;i++){Cell c=keys[(flow_cursor_+i)%keys.size()];if(!near(c)){fluid_active_.erase(c);continue;}FluidState f=fluid_state(c);if(!f.present()){fluid_active_.erase(c);continue;}
        transfer(c,c+Cell{0,-1,0},f.volume_m3);
        for(int j=0;j<4;j++){Cell d=sides[(j+offset)%4],to=c+d;f=fluid_state(c);FluidState other=fluid_state(to);transfer(c,to,(f.volume_m3-other.volume_m3)*.23);}
        f=fluid_state(c);if(!f.present())continue;
        for(Cell d:react_dirs){Cell at=c+d;std::string id=block(at);const Json& b=block_info(id);if(f.volume_m3>.01)burning_.erase(at);if(!id.empty()&&f.acid_m3/f.volume_m3>.3){double resistance=b.value("acidResistance",0.0),potential=(f.acid_m3/f.volume_m3)*(1-resistance)*8*dt*std::min(1.0,f.volume_m3/.025),damage=std::min(potential,f.acid_m3/.00001),spent=damage*.00001;if(damage_cell(at,damage)){reactions_["dissolvedCells"]=reactions_.value("dissolvedCells",0)+1;reactions_["dissolvedMassKg"]=reactions_.value("dissolvedMassKg",0.0)+mass(id);}f.acid_m3=std::max(0.0,f.acid_m3-spent);reactions_["neutralizedAcidM3"]=reactions_.value("neutralizedAcidM3",0.0)+spent;}}
        double sensible=4000*f.volume_m3*80;if(f.thermal_eu>sensible){double evaporated=std::min(f.volume_m3,(f.thermal_eu-sensible)/225000),r=evaporated/f.volume_m3;reactions_["evaporatedM3"]=reactions_.value("evaporatedM3",0.0)+evaporated;reactions_["evaporatedAcidM3"]=reactions_.value("evaporatedAcidM3",0.0)+f.acid_m3*r;reactions_["steamThermalEu"]=reactions_.value("steamThermalEu",0.0)+evaporated*225000+(f.thermal_eu-evaporated*225000)*r;f={f.volume_m3-evaporated,f.acid_m3*(1-r),std::max(0.0,(f.thermal_eu-evaporated*225000)*(1-r))};}
        store_fluid(c,f);
    }
    flow_cursor_=(flow_cursor_+count)%std::max<size_t>(1,keys.size());std::vector<Cell> compact;compact.reserve(fluid_order_.size());for(Cell c:fluid_order_)if(fluid_active_.count(c))compact.push_back(c);fluid_order_.swap(compact);
}

void World::fire_step(double dt){
    size_t count=std::min<size_t>(128,burning_order_.size());for(size_t i=0;i<count;i++){Cell c=burning_order_[i];auto it=burning_.find(c);if(it==burning_.end())continue;FireState fire=it->second;if(std::abs(c.x*CELL_M-focus_.x)>focus_radius_||std::abs(c.z*CELL_M-focus_.z)>focus_radius_)continue;
        if(block(c)!=fire.block_id){burning_.erase(c);continue;}if(fluid_state(c).volume_m3>.01){burning_.erase(c);continue;}double fuel=fuel_remaining_.count(c)?fuel_remaining_[c]:0,burned=std::min(fuel,fire.rate_eu_s*std::min(dt,fire.remaining_s));fuel_remaining_[c]=fuel-burned;fire.remaining_s=std::max(0.0,fire.remaining_s-dt);double share=burned*.65/6;for(Cell d:DIRS)apply_thermal_energy(c+d,share);reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+burned*.35;reactions_["combustionEu"]=reactions_.value("combustionEu",0.0)+burned;
        if(fire.remaining_s<=EPS||fuel-burned<=EPS){double m=mass(fire.block_id);set_block(c,"");burning_.erase(c);reactions_["burnedMassKg"]=reactions_.value("burnedMassKg",0.0)+m;reactions_["burnedCells"]=reactions_.value("burnedCells",0)+1;}else it->second=fire;
    }
    std::vector<Cell> compact;for(Cell c:burning_order_)if(burning_.count(c))compact.push_back(c);burning_order_.swap(compact);
}

void World::thermal_step(double dt){
    if(thermal_order_.empty())return;size_t count=std::min<size_t>(128,thermal_order_.size());auto near=[&](Cell c){return std::abs(c.x*CELL_M-focus_.x)<=focus_radius_&&std::abs(c.z*CELL_M-focus_.z)<=focus_radius_;};
    for(size_t i=0;i<count;i++){Cell c=thermal_order_[(thermal_cursor_+i)%thermal_order_.size()];auto it=thermal_.find(c);if(it==thermal_.end())continue;std::string id=block(c);if(id.empty()){reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+it->second.energy_eu;thermal_.erase(it);continue;}if(!near(c))continue;double energy=it->second.energy_eu*std::exp(-.04*(simulation_time_-it->second.updated_at)),capacity=std::max(.05,mass(id)*.02),temp=20+energy/capacity;reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+it->second.energy_eu-energy;double tolerance=block_info(id).value("heatToleranceC",650.0),reacted=std::min(energy,std::max(0.0,temp-tolerance)*capacity*.05*dt);reactions_["heatReactedEu"]=reactions_.value("heatReactedEu",0.0)+reacted;bool destroyed=damage_cell(c,reacted/2);if(!destroyed&&energy-reacted>1e-8)thermal_[c]={energy-reacted,simulation_time_};else{reactions_["heatDissipatedEu"]=reactions_.value("heatDissipatedEu",0.0)+energy-reacted;thermal_.erase(c);}}
    thermal_cursor_=(thermal_cursor_+count)%std::max<size_t>(1,thermal_order_.size());std::vector<Cell> compact;for(Cell c:thermal_order_)if(thermal_.count(c))compact.push_back(c);thermal_order_.swap(compact);
}

void World::tick(double dt){if(!std::isfinite(dt)||dt<0)throw std::invalid_argument("invalid world tick duration");simulation_accumulator_+=dt;int steps=0;while(simulation_accumulator_>=.1-1e-10&&steps<8){simulation_accumulator_=std::max(0.0,simulation_accumulator_-.1);simulation_time_+=.1;flow_step(.1);fire_step(.1);thermal_step(.1);steps++;}}

Json World::damage(Contact contact,double amount){
    if(!contact.hit||!std::isfinite(amount)||amount<=0)return fail("invalid_damage");
    auto loot_for=[&](const std::string& id)->Json{const Json& d=block_info(id);std::string resource;if(d.contains("rawResourceId")&&d["rawResourceId"].is_string())resource=d["rawResourceId"].get<std::string>();double count=d.value("harvestYieldPerCell",0.0);if(!resource.empty()&&count>0)return Json{{"id",resource},{"count",count}};static const std::map<std::string,std::string> fallback={{"grass","soil"},{"dirt","soil"},{"ash","soil"},{"leaves","plant_fiber"},{"moss","plant_fiber"},{"algae","plant_fiber"},{"dry_grass","plant_fiber"},{"ash_lichen","plant_fiber"},{"salt_grass","plant_fiber"},{"mana_fern","plant_fiber"},{"luminous_moss","plant_fiber"},{"mineral_lichen","plant_fiber"},{"plank","wood"},{"iron_scrap_block","scrap_iron"}};auto it=fallback.find(id);return it==fallback.end()?Json(nullptr):Json{{"id",it->second},{"count",1}};};
    std::string id=contact.material;double hp=0,max=0;bool removed=false;std::vector<std::string> detached;
    if(contact.kind=="terrain"){
        id=block(contact.cell);if(id.empty()||(!contact.material.empty()&&id!=contact.material))return fail("target_missing");max=durability(id);auto it=damage_.find(contact.cell);double d=it!=damage_.end()&&it->second.block_id==id?it->second.damage_hp:0;hp=std::max(0.0,max-d-amount);
        if(hp<=EPS){
            // Mining and environmental erosion have separate ledgers. Once the mining
            // ledger reaches full durability, remove the cell directly; applying only
            // this last hit to damage_cell() would incorrectly restart at zero HP.
            removed=set_block(contact.cell,"");
            if(removed){damage_.erase(contact.cell);auto ids=detach_components(contact.cell);detached.insert(detached.end(),ids.begin(),ids.end());}
            else damage_[contact.cell]={id,d+amount};
            hp=removed?0.0:std::max(EPS,max-d);
        }else damage_[contact.cell]={id,d+amount};
    }else if(contact.kind=="body"){
        auto b=bodies_.find(contact.id);if(b==bodies_.end())return fail("target_missing");auto v=std::find_if(b->second.voxels.begin(),b->second.voxels.end(),[&](const Voxel& x){return x.cell==contact.cell;});if(v==b->second.voxels.end()||(!contact.material.empty()&&v->block!=contact.material))return fail("target_missing");id=v->block;max=durability(id);double before=v->hp>0?v->hp:max;hp=std::max(0.0,before-amount);if(hp<=EPS){b->second.voxels.erase(v);b->second.revision++;removed=true;if(b->second.voxels.empty()){bodies_.erase(b);body_source_.erase(contact.id);body_ray_cache_.erase(contact.id);body_stream_cache_.erase(contact.id);}else{rebuild_body(b->second);split_body(contact.id);}}else v->hp=hp;
    }else return fail("unsupported_target");
    Json result={{"ok",true},{"blockId",id},{"hp",hp},{"maxHp",max},{"removed",removed},{"progress",max>0?1-hp/max:0},{"loot",removed?loot_for(id):Json(nullptr)},{"detached",detached}};return result;
}

void World::load(Json state){
    if(!state.is_object())throw std::invalid_argument("world save must be an object");unknown_state_=state;
    Json input=state;Json config=input.value("config",Json::object());Json atlas=input.value("atlas",Json::object());
    unknown_atlas_=input.contains("atlas")&&atlas.is_object()?atlas:input;
    if(config.empty()){
        std::string gen=atlas.value("generator",std::string());if(gen.empty())gen=input.value("terrain",std::string("infinite"));
        if(gen=="expedition-atlas-v1")gen="infinite";else if(gen=="island-v1")gen="island";else if(gen=="frontier-v1")gen="frontier";else if(gen=="machine-field-v1")gen="machine-field";
        Json seed=input.value("seed",atlas.value("seed",Json(63026)));
        config={{"preset",gen=="infinite"?"expedition":gen=="machine-field"?"machine":gen},{"seed",seed},{"terrain",{{"generator",gen}}}};
    }
    configure(config);
    if(!input.contains("atlas"))atlas=input;
    if(!atlas.is_object())atlas=Json::object();
    edits_.clear();damage_.clear();environmental_damage_.clear();fluids_.clear();fluid_active_.clear();fluid_order_.clear();thermal_.clear();thermal_order_.clear();fuel_remaining_.clear();burning_.clear();burning_order_.clear();anchors_.clear();bodies_.clear();body_source_.clear();next_body_id_=std::max<uint64_t>(1,input.value("nextBodyId",uint64_t(1)));
    auto load_pairs=[](const Json& list,auto fn){if(!list.is_array())return;for(const auto& row:list)if(row.is_array()&&row.size()>=2)fn(row[0],row[1]);};
    load_pairs(atlas.value("edits",Json::array()),[&](const Json& key,const Json& value){if(!key.is_string())return;Cell c=parse_cell_key(key.get<std::string>());edits_[c]=value.is_null()?std::string():value.get<std::string>();});
    load_pairs(atlas.value("fluidCells",Json::array()),[&](const Json& key,const Json& value){if(!key.is_string()||!value.is_object())return;Cell c=parse_cell_key(key.get<std::string>());FluidState f{value.value("volumeM3",0.0),value.value("acidM3",0.0),value.value("thermalEu",0.0)};if(std::isfinite(f.volume_m3)&&std::isfinite(f.acid_m3)&&std::isfinite(f.thermal_eu)&&f.volume_m3>=0&&f.volume_m3<=.125&&f.acid_m3>=0&&f.acid_m3<=f.volume_m3&&f.thermal_eu>=0)fluids_[c]=f;});
    load_pairs(atlas.value("burning",Json::array()),[&](const Json& key,const Json& value){if(!key.is_string()||!value.is_object())return;Cell c=parse_cell_key(key.get<std::string>());burning_[c]={value.value("blockId",std::string()),value.value("remainingS",0.0),value.value("rateEuPerSecond",0.0)};burning_order_.push_back(c);});
    load_pairs(atlas.value("fuelRemaining",Json::array()),[&](const Json& key,const Json& value){if(key.is_string()&&value.is_number())fuel_remaining_[parse_cell_key(key.get<std::string>())]=value.get<double>();});
    load_pairs(atlas.value("thermalCells",Json::array()),[&](const Json& key,const Json& value){if(!key.is_string()||!value.is_object())return;Cell c=parse_cell_key(key.get<std::string>());ThermalState t{value.value("energyEu",0.0),value.value("updatedAt",0.0)};if(t.energy_eu>=0&&std::isfinite(t.energy_eu)&&std::isfinite(t.updated_at)){thermal_[c]=t;thermal_order_.push_back(c);}});
    load_pairs(atlas.value("cellDamage",Json::array()),[&](const Json& key,const Json& value){if(!key.is_string()||!value.is_object())return;Cell c=parse_cell_key(key.get<std::string>());double d=value.value("damageHp",value.value("damage",0.0));std::string id=value.value("blockId",std::string());if(d>0&&std::isfinite(d))environmental_damage_[c]={id,d};});
    simulation_time_=atlas.value("simulationTime",0.0);simulation_accumulator_=atlas.value("simulationAccumulator",0.0);flow_cursor_=atlas.value("flowCursor",size_t(0));thermal_cursor_=atlas.value("thermalCursor",size_t(0));reactions_=atlas.value("reactions",reactions_);
    if(atlas.contains("focus")&&atlas["focus"].is_object()){focus_.x=atlas["focus"].value("x",0.0);focus_.z=atlas["focus"].value("z",0.0);focus_radius_=atlas["focus"].value("radius",64.0);}
    if(atlas.contains("reservations")&&atlas["reservations"].is_array())reservations_=atlas["reservations"].get<std::vector<Json>>();
    Json regions=atlas.value("regionTerrain",Json::array());if(regions.is_array())for(const auto& row:regions)if(row.is_array()&&row.size()==2&&row[0].is_string()){std::istringstream p(row[0].get<std::string>());int x,z;char comma;if(p>>x>>comma>>z&&comma==',')region_terrain_[Cell{x,0,z}]=row[1].get<int>();}
    if(atlas.contains("fluidActive")&&atlas["fluidActive"].is_array()){fluid_active_.clear();fluid_order_.clear();for(const auto& row:atlas["fluidActive"])if(row.is_string()){Cell c=parse_cell_key(row.get<std::string>());if(fluids_.count(c)&&fluids_[c].present()&&fluid_active_.insert(c).second)fluid_order_.push_back(c);}}
    if(input.contains("anchors")&&input["anchors"].is_array())for(const auto& row:input["anchors"])if(row.is_array()||row.is_object()){Cell c=row.get<Cell>();anchors_.insert(c);}
    // Mining damage was fractional in old unified saves; native saves store absolute HP explicitly.
    Json terrain_damage=input.value("terrainDamage",Json::object());if(terrain_damage.is_object())for(auto it=terrain_damage.begin();it!=terrain_damage.end();++it){try{Cell c=parse_cell_key(it.key());const Json& v=it.value();std::string id=v.value("blockId",block(c));double d=v.value("damageHp",-1.0);if(d<0){if(v.contains("damage"))d=v["damage"].get<double>()*durability(id);else if(v.contains("hp"))d=durability(id)-v["hp"].get<double>();}if(d>0&&std::isfinite(d))damage_[c]={id,d};}catch(...){}}
    if(terrain_damage.is_array())load_pairs(terrain_damage,[&](const Json& key,const Json& value){if(!key.is_string()||!value.is_object())return;Cell c=parse_cell_key(key.get<std::string>());std::string id=value.value("blockId",block(c));double d=value.value("damageHp",value.value("damage",0.0));if(d>0)damage_[c]={id,d};});
    Json objects=input.value("objects",Json::object());Json object_rows=objects.is_object()?objects.value("objects",Json::array()):objects;
    if(object_rows.is_array())for(const auto& raw:object_rows){if(!raw.is_object()||!raw.contains("id")||!raw.contains("cells")||!raw["cells"].is_array()||raw["cells"].empty())continue;BodyState b;b.id=raw.value("id",std::string());if(b.id.empty()||bodies_.count(b.id))continue;b.position=vec_read(raw.value("position",Json::object()));b.velocity=vec_read(raw.value("velocity",Json::object()));b.angular_velocity=vec_read(raw.value("angularVelocity",Json::object()));b.rotation=quat_read(raw.value("rotation",Json::object()));b.anchored=raw.value("anchored",false);b.revision=raw.value("revision",uint64_t(1));
        for(const auto& cr:raw["cells"]){if(!cr.is_object()||!cr.contains("cell")||!cr.contains("blockId"))continue;Cell c=cr["cell"].get<Cell>();std::string id=cr["blockId"].get<std::string>();double hp=cr.value("hp",-1.0);b.voxels.push_back({c,id,hp});}
        if(b.voxels.empty())continue;rebuild_body(b);std::string digits=b.id.substr(b.id.find_last_of(':')==std::string::npos?0:b.id.find_last_of(':')+1);try{uint64_t n=std::stoull(digits);next_body_id_=std::max(next_body_id_,n+1);}catch(...){}bodies_[b.id]=std::move(b);body_source_[raw.value("id",std::string())]=raw;
    }
    if(objects.is_object())next_body_id_=std::max<uint64_t>(next_body_id_,objects.value("nextId",uint64_t(1)));
    loaded_sections_.clear();dirty_sections_.clear();columns_.clear();legacy_worlds_.clear();ore_maps_.clear();patch_groups_.clear();
}

Json World::save()const{
    Json out=unknown_state_.is_object()?unknown_state_:Json::object();out["schemaVersion"]=1;out["config"]=config_;out["generator"]=generator_id_;out["terrain"]=generator_id_;out["seed"]=config_.value("seed",Json(seed_));
    auto atlas_name=[&](){if(generator_id_=="infinite")return std::string("expedition-atlas-v1");if(generator_id_=="island")return std::string("island-v1");if(generator_id_=="frontier")return std::string("frontier-v1");return std::string("machine-field-v1");};
    Json atlas=unknown_atlas_.is_object()?unknown_atlas_:Json::object();atlas["schemaVersion"]=1;atlas["generator"]=atlas_name();atlas["seed"]=seed_;atlas["simulationTime"]=simulation_time_;atlas["simulationAccumulator"]=simulation_accumulator_;atlas["flowCursor"]=flow_cursor_;atlas["thermalCursor"]=thermal_cursor_;atlas["reactions"]=reactions_;
    if(std::isfinite(focus_radius_))atlas["focus"]={{"x",focus_.x},{"z",focus_.z},{"radius",focus_radius_}};else atlas["focus"]=nullptr;
    std::vector<std::pair<std::string,Cell>> ordered;ordered.reserve(edits_.size());for(const auto& e:edits_)ordered.push_back({cell_key(e.first),e.first});std::sort(ordered.begin(),ordered.end(),[](const auto&a,const auto&b){return a.first<b.first;});atlas["edits"]=Json::array();for(const auto& entry:ordered){const std::string& id=edits_.at(entry.second);atlas["edits"].push_back(Json::array({entry.first,id.empty()?Json(nullptr):Json(id)}));}
    auto sorted_cells=[](const auto& map){std::vector<Cell> cells;cells.reserve(map.size());for(const auto& p:map)cells.push_back(p.first);std::sort(cells.begin(),cells.end());return cells;};
    atlas["fluidCells"]=Json::array();for(Cell c:sorted_cells(fluids_)){const auto& f=fluids_.at(c);atlas["fluidCells"].push_back(Json::array({cell_key(c),Json{{"volumeM3",f.volume_m3},{"acidM3",f.acid_m3},{"thermalEu",f.thermal_eu}}}));}
    atlas["fluidActive"]=Json::array();std::unordered_set<Cell,CellHash> seen_fluid;for(Cell c:fluid_order_)if(fluid_active_.count(c)&&seen_fluid.insert(c).second)atlas["fluidActive"].push_back(cell_key(c));for(Cell c:sorted_cells(fluids_))if(fluid_active_.count(c)&&seen_fluid.insert(c).second)atlas["fluidActive"].push_back(cell_key(c));
    atlas["burning"]=Json::array();for(Cell c:sorted_cells(burning_)){const auto& f=burning_.at(c);atlas["burning"].push_back(Json::array({cell_key(c),Json{{"blockId",f.block_id},{"remainingS",f.remaining_s},{"rateEuPerSecond",f.rate_eu_s}}}));}
    atlas["fuelRemaining"]=Json::array();for(Cell c:sorted_cells(fuel_remaining_))atlas["fuelRemaining"].push_back(Json::array({cell_key(c),fuel_remaining_.at(c)}));
    atlas["thermalCells"]=Json::array();for(Cell c:sorted_cells(thermal_)){const auto& t=thermal_.at(c);atlas["thermalCells"].push_back(Json::array({cell_key(c),Json{{"energyEu",t.energy_eu},{"updatedAt",t.updated_at}}}));}
    atlas["cellDamage"]=Json::array();for(Cell c:sorted_cells(environmental_damage_)){const auto& d=environmental_damage_.at(c);atlas["cellDamage"].push_back(Json::array({cell_key(c),Json{{"blockId",d.block_id},{"damageHp",d.damage_hp}}}));}
    atlas["reservations"]=reservations_;atlas["regionTerrain"]=Json::array();std::vector<std::pair<Cell,int>> regions(region_terrain_.begin(),region_terrain_.end());std::sort(regions.begin(),regions.end(),[](const auto&a,const auto&b){return cell_key(a.first)<cell_key(b.first);});for(const auto& r:regions)atlas["regionTerrain"].push_back(Json::array({key2(r.first.x,r.first.z),r.second}));out["atlas"]=std::move(atlas);
    out["terrainDamage"]=Json::array();for(Cell c:sorted_cells(damage_)){const auto& d=damage_.at(c);out["terrainDamage"].push_back(Json::array({cell_key(c),Json{{"blockId",d.block_id},{"damageHp",d.damage_hp}}}));}
    Json objects={{"schemaVersion",1},{"nextId",next_body_id_},{"objects",Json::array()}};for(const auto& pair:bodies_){const BodyState& body=pair.second;Json raw=body_source_.count(body.id)?body_source_.at(body.id):Json::object();raw["id"]=body.id;raw["entityType"]="object";raw["kind"]="object";raw["name"]=raw.value("name",std::string("분리된 월드 조각"));raw["position"]=vec_json(body.position);raw["rotation"]=quat_json(body.rotation);raw["velocity"]=vec_json(body.velocity);raw["angularVelocity"]=vec_json(body.angular_velocity);raw["revision"]=body.revision;if(body.anchored)raw["anchored"]=true;else raw.erase("anchored");Cell origin{int(std::floor(body.position.x/CELL_M)),int(std::floor(body.position.y/CELL_M)),int(std::floor(body.position.z/CELL_M))};if(raw.contains("originCell")){try{origin=raw["originCell"].get<Cell>();}catch(...){}}raw["originCell"]=origin;Json cells=Json::array();
        for(const auto& v:body.voxels){Json cell=Json::object();if(raw.contains("cells")&&raw["cells"].is_array())for(const auto& prior:raw["cells"])if(prior.is_object()&&prior.contains("cell")&&prior["cell"].get<Cell>()==v.cell){cell=prior;break;}cell["cell"]=v.cell;if(!cell.contains("sourceCell"))cell["sourceCell"]=Json::array({origin.x+v.cell.x,origin.y+v.cell.y,origin.z+v.cell.z});cell["blockId"]=v.block;if(v.hp>0)cell["hp"]=v.hp;else cell.erase("hp");cells.push_back(std::move(cell));}
        raw["cells"]=std::move(cells);objects["objects"].push_back(std::move(raw));}
    out["objects"]=std::move(objects);out["nextBodyId"]=next_body_id_;out["anchors"]=Json::array();std::vector<Cell> anchors(anchors_.begin(),anchors_.end());std::sort(anchors.begin(),anchors.end());for(Cell c:anchors)out["anchors"].push_back(c);return out;
}

} // namespace feral
