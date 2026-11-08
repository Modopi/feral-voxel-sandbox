#include "gameplay.hpp"

#include <limits>
#include <sstream>
#include <stdexcept>

namespace feral {
namespace {
constexpr double EPS = 1e-8;
constexpr double ITEM_STACK = 64.0;
constexpr int INVENTORY_SLOTS = 36;
const std::array<std::string, 6> ENERGY_TYPES = {"mechanical", "electrical", "thermal", "chemical", "magic", "divine"};

bool finite_number(const Json& j) {
    return j.is_number() && std::isfinite(j.get<double>());
}
bool json_truthy(const Json& j) {
    if (j.is_null() || j.is_discarded()) return false;
    if (j.is_boolean()) return j.get<bool>();
    if (j.is_number()) return j.get<double>() != 0.0;
    if (j.is_string()) return !j.get<std::string>().empty();
    return true;
}
double number(const Json& j, double fallback = 0.0) {
    return finite_number(j) ? j.get<double>() : fallback;
}
bool nonnegative(double n) { return std::isfinite(n) && n >= 0.0 && n <= 1e12; }
bool positive(double n) { return std::isfinite(n) && n > 0.0 && n <= 1e12; }
bool is_energy_type(const std::string& type) {
    return std::find(ENERGY_TYPES.begin(), ENERGY_TYPES.end(), type) != ENERGY_TYPES.end();
}
Json zero_energy() {
    Json out = Json::object();
    for (const auto& t : ENERGY_TYPES) out[t] = 0.0;
    return out;
}
Json default_fixture_energy() {
    return {{"schemaVersion", 1}, {"enabled", false}, {"nextId", 1}, {"nodes", Json::array()},
            {"links", Json::array()}, {"claims", Json::array()}, {"legacyEscrow", zero_energy()},
            {"metrics", {{"generated", zero_energy()}, {"consumed", zero_energy()},
                          {"dissipated", zero_energy()}, {"imported", zero_energy()},
                          {"exported", zero_energy()}, {"conversionLoss", 0.0}}}};
}
Json default_progression() {
    return {{"schemaVersion", 1}, {"fixtureEnergy", default_fixture_energy()},
            {"personalManaVessel", nullptr},
            {"personalMana", {{"investedCapacity", 0.0}, {"focusId", nullptr}, {"reserveEU", 0.0},
                              {"investments", Json::object()}, {"cupEU", 0.0}, {"lastCapacity", 0.0}}},
            {"inventory", Json::object()}, {"overflow", Json::object()}, {"research", Json::array()},
            {"stations", Json::object()}, {"assemblies", Json::array()}, {"energy", zero_energy()},
            {"energyOverflow", zero_energy()}, {"claims", Json::array()}, {"harvestClaims", Json::object()},
            {"jobs", Json::array()}, {"researchJob", nullptr}, {"researchProgress", Json::object()},
            {"workCredits", 0.0}, {"activeSources", Json::object()}, {"sourceFuel", Json::object()},
            {"activityProgress", Json::object()}, {"activityRequests", Json::object()},
            {"worldFixtures", Json::array()}, {"fixtureAccess", nullptr}, {"communityStations", Json::array()},
            {"toolWear", Json::object()}, {"clock", 0.0}, {"nextId", 1}, {"equipped", nullptr},
            {"metrics", {{"generated", zero_energy()}, {"consumed", zero_energy()},
                          {"dissipated", zero_energy()}, {"conversionLoss", 0.0}}}};
}
Json default_placements() { return {{"schemaVersion", 1}, {"nextId", 1}, {"revision", 0}, {"geometryRevision", 0}, {"fixtures", Json::array()}}; }
Json default_community() { return {{"schemaVersion", 1}, {"communities", Json::array()}, {"residents", Json::array()}, {"receipts", Json::array()}, {"activeRepair", nullptr}}; }
Json default_faith() { return {{"schemaVersion", 1}, {"clock", 0.0}, {"membership", nullptr}, {"quests", Json::object()}, {"trials", Json::object()}, {"shrines", Json::array()}}; }
Json default_campaign() {
    return {{"schemaVersion", 1}, {"clock", 0.0}, {"events", Json::array()}, {"claims", Json::array()},
            {"records", Json::object()}, {"cores", 0}, {"journey", {{"claimed", Json::array()}, {"completedAt", nullptr},
                {"harvests", 0}, {"sorties", 0}, {"fedUntil", 0.0}, {"tonicUntil", 0.0}}}};
}
Json default_armaments() {
    return {{"schemaVersion", 1}, {"nextId", 1}, {"clock", 0.0}, {"weapons", Json::array()},
            {"equippedId", nullptr}, {"jobs", Json::array()}, {"attackClaims", Json::array()}};
}
bool array_has(const Json& arr, const std::string& value) {
    if (!arr.is_array()) return false;
    for (const auto& item : arr) if (item.is_string() && item.get<std::string>() == value) return true;
    return false;
}
void array_add(Json& arr, const std::string& value) {
    if (!arr.is_array()) arr = Json::array();
    if (!array_has(arr, value)) arr.push_back(value);
}
bool claim_exists(const Json& arr, const std::string& value) { return array_has(arr, value); }
Json copy_or(const Json& value, Json fallback) { return value.is_null() ? fallback : value; }
Json object_field(Json& object, const std::string& key) {
    if (!object.is_object()) object = Json::object();
    if (!object.contains(key) || !object[key].is_object()) object[key] = Json::object();
    return object[key];
}
Json numvec(double x, double y, double z) { return {{"x", x}, {"y", y}, {"z", z}}; }
double distance3(const Json& a, const Json& b) {
    if (!a.is_object() || !b.is_object()) return std::numeric_limits<double>::infinity();
    return std::hypot(number(a.value("x", Json()), 0) - number(b.value("x", Json()), 0), number(a.value("y", Json()), 0) - number(b.value("y", Json()), 0),
                      number(a.value("z", Json()), 0) - number(b.value("z", Json()), 0));
}
struct OrientedBox {
    Vec3 center;
    Vec3 half;
    std::array<Vec3,3> axis;
};
OrientedBox oriented_box(const Json& box, const Json& position, const Json& rotation) {
    Quat q{number(rotation.value("x", Json()),0), number(rotation.value("y", Json()),0),
           number(rotation.value("z", Json()),0), number(rotation.value("w", Json()),1)};
    const double length=std::sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w);
    if(length>EPS){q.x/=length;q.y/=length;q.z/=length;q.w/=length;}
    Vec3 c=box.at("center").get<Vec3>(),s=box.at("size").get<Vec3>();
    return {rotate(q,c)+Vec3{number(position.value("x",Json())),number(position.value("y",Json())),number(position.value("z",Json()))},
            {std::abs(s.x)*.5,std::abs(s.y)*.5,std::abs(s.z)*.5},
            {rotate(q,{1,0,0}).normalized(),rotate(q,{0,1,0}).normalized(),rotate(q,{0,0,1}).normalized()}};
}
bool obb_overlap(const OrientedBox& a,const OrientedBox& b) {
    const double ah[3]={a.half.x,a.half.y,a.half.z},bh[3]={b.half.x,b.half.y,b.half.z};
    double r[3][3],ar[3][3];
    for(int i=0;i<3;i++)for(int j=0;j<3;j++){r[i][j]=a.axis[i].dot(b.axis[j]);ar[i][j]=std::abs(r[i][j])+1e-10;}
    const Vec3 delta=b.center-a.center;double t[3]={delta.dot(a.axis[0]),delta.dot(a.axis[1]),delta.dot(a.axis[2])};
    for(int i=0;i<3;i++){double rb=0;for(int j=0;j<3;j++)rb+=bh[j]*ar[i][j];if(std::abs(t[i])>=ah[i]+rb-1e-7)return false;}
    for(int j=0;j<3;j++){double ra=0,tb=std::abs(delta.dot(b.axis[j]));for(int i=0;i<3;i++)ra+=ah[i]*ar[i][j];if(tb>=ra+bh[j]-1e-7)return false;}
    for(int i=0;i<3;i++)for(int j=0;j<3;j++){
        const int i1=(i+1)%3,i2=(i+2)%3,j1=(j+1)%3,j2=(j+2)%3;
        const double ra=ah[i1]*ar[i2][j]+ah[i2]*ar[i1][j];
        const double rb=bh[j1]*ar[i][j2]+bh[j2]*ar[i][j1];
        const double value=std::abs(t[i2]*r[i1][j]-t[i1]*r[i2][j]);
        if(value>=ra+rb-1e-7)return false;
    }
    return true;
}
bool obb_support_contact(const OrientedBox& lower,const OrientedBox& upper,double tolerance=.02) {
    const Vec3 up{0,1,0};
    auto vertical_axis=[&](const OrientedBox& box)->int{for(int i=0;i<3;i++)if(std::abs(box.axis[i].dot(up))>.999)return i;return -1;};
    const int la=vertical_axis(lower),ua=vertical_axis(upper);if(la<0||ua<0)return false;
    const Vec3 ln=lower.axis[la]*(lower.axis[la].dot(up)>=0?1.0:-1.0);
    const Vec3 un=upper.axis[ua]*(upper.axis[ua].dot(up)>=0?1.0:-1.0);
    if(ln.dot(up)<.999||un.dot(up)<.999)return false;
    const double lh[3]={lower.half.x,lower.half.y,lower.half.z},uh[3]={upper.half.x,upper.half.y,upper.half.z};
    const double lower_top=lower.center.dot(up)+lh[la],upper_bottom=upper.center.dot(up)-uh[ua];
    if(std::abs(lower_top-upper_bottom)>tolerance)return false;
    const Vec3 d=upper.center-lower.center;
    for(int i=0;i<3;i++)if(i!=la){
        double upper_radius=0;for(int j=0;j<3;j++)upper_radius+=uh[j]*std::abs(upper.axis[j].dot(lower.axis[i]));
        if(std::abs(d.dot(lower.axis[i]))>=lh[i]+upper_radius-1e-7)return false;
    }
    return true;
}
std::string json_string(const Json& j, const std::string& fallback = {}) {
    return j.is_string() ? j.get<std::string>() : fallback;
}
Json success_fields(Json fields = Json::object()) {
    if (!fields.is_object()) fields = Json::object();
    fields["ok"] = true;
    fields.erase("reason");
    return fields;
}
std::string reason_message(const std::string& reason) {
    static const std::map<std::string, std::string> messages = {
        {"missing_items", "필요한 재료가 부족합니다."}, {"ingredients_required", "필요한 재료가 부족합니다."},
        {"insufficient_resources", "필요한 재료나 에너지가 부족합니다."}, {"insufficient_energy", "에너지가 부족합니다."},
        {"research_required", "먼저 필요한 연구를 완료하세요."}, {"prerequisite_required", "선행 연구를 먼저 완료하세요."},
        {"samples_required", "연구에 필요한 시료가 부족합니다."}, {"station_required", "필요한 작업 설비를 가까이에 설치하세요."},
        {"physical_station_required", "가까운 작업 설비를 사용하세요."}, {"world_placement_required", "설비 아이템 대신 월드에 설치된 설비를 사용하세요."},
        {"out_of_range", "너무 멀리 있습니다."}, {"station_out_of_reach", "작업 설비가 너무 멀리 있습니다."},
        {"out_of_stock", "상대방의 보유 물품이 부족합니다."}, {"hostile", "상대가 적대적입니다."},
        {"not_hungry", "지금은 음식이 필요하지 않습니다."}, {"already_full", "이미 내구도가 가득 찼습니다."},
        {"dead", "쓰러진 동안에는 행동할 수 없습니다."}, {"player_not_dead", "복귀할 상태가 아닙니다."},
        {"claim_required", "요청 식별 정보가 필요합니다."}, {"invalid_items", "물품 목록이 올바르지 않습니다."},
        {"invalid_resources", "물품 또는 에너지 값이 올바르지 않습니다."}, {"fixture_occupied", "그 위치에는 다른 설비가 있습니다."},
        {"support_required", "바닥이나 지지 설비가 필요합니다."}, {"already_known", "이미 알고 있는 연구입니다."},
        {"already_claimed", "이미 보상을 받았습니다."}, {"quest_not_accepted", "먼저 의뢰를 수락하세요."},
        {"objective_incomplete", "아직 목표를 완료하지 않았습니다."}, {"trial_in_progress", "이미 진행 중인 시련이 있습니다."},
        {"trial_incomplete", "시련 목표를 모두 완료하지 않았습니다."}, {"weapon_not_equipped", "무기를 먼저 장착하세요."},
        {"weapon_broken", "무기가 파손되었습니다. 먼저 수리하세요."}, {"attack_cooldown", "공격을 다시 준비하고 있습니다."},
        {"rack_full", "무기 보관 공간이 가득 찼습니다."}, {"workbench_busy", "무기 작업대가 사용 중입니다."},
        {"invalid_dt", "시간 값이 올바르지 않습니다."}, {"unknown_command", "이 행동을 사용할 수 없습니다."}
    };
    auto it = messages.find(reason);
    return it == messages.end() ? "요청을 처리할 수 없습니다." : it->second;
}
Json error_result(const std::string& reason) { return {{"ok", false}, {"reason", reason}, {"message", reason_message(reason)}}; }
}

Gameplay::Gameplay(const Content& content) : content_(content) {
    energy_source_catalog_ = list("energy_source");
    conversion_catalog_ = list("conversion");
    recipe_catalog_ = list("recipe");
    progression_ = default_progression();
    placements_ = default_placements();
    community_ = default_community();
    faith_ = default_faith();
    campaign_ = default_campaign();
    armaments_ = default_armaments();
    player_ = {{"hp", 100.0}, {"maxHp", 100.0}, {"calories", 2400.0}, {"maxCalories", 2400.0},
               {"survival", false}, {"lastDamageAt", -100.0}, {"resting", false}};
}

void Gameplay::configure(Json config) {
    if (config.is_object()) {
        config_ = std::move(config);
        const Json rules=config_.value("rules",Json::object());
        if(rules.contains("survival"))player_["survival"]=rules["survival"];
        if(rules.contains("dropOnDeath"))player_["dropOnDeath"]=rules["dropOnDeath"];
    }
}

void Gameplay::load(Json state) {
    if (!state.is_object()) throw std::invalid_argument("Invalid gameplay save");
    state_loaded_ = true;
    // Unified legacy snapshots have no native envelope version. Preserve and
    // accept them; each native subsystem still validates its own version.
    unknown_ = state;
    progression_ = state.value("progression", default_progression());
    placements_ = state.value("placements", default_placements());
    community_ = state.value("community", default_community());
    faith_ = state.value("faith", default_faith());
    campaign_ = state.value("campaign", default_campaign());
    armaments_ = state.value("armaments", default_armaments());
    // Schema-4 unified snapshots put First Signal in modules.first-signal.
    // Keep the entire source snapshot in unknown_ and use a copy for native
    // campaign records until the simulation adapter has restored its module.
    if (!state.contains("campaign") && state.contains("modules") && state["modules"].is_object() && state["modules"].contains("first-signal"))
        campaign_["firstSignal"] = state["modules"]["first-signal"];
    player_ = state.value("player", player_);
    if(config_.contains("rules")&&config_["rules"].is_object()){
        const Json rules=config_["rules"];
        if(rules.contains("survival"))player_["survival"]=rules["survival"];
        if(rules.contains("dropOnDeath"))player_["dropOnDeath"]=rules["dropOnDeath"];
    }
    deaths_ = state.value("deaths", Json::array());
    new_world_initialized_ = state.value("worldInitializationComplete", false);
    if (!deaths_.is_array()) deaths_ = Json::array();
    if (!progression_.is_object() || !placements_.is_object() || !community_.is_object() || !faith_.is_object() || !campaign_.is_object())
        throw std::invalid_argument("Invalid gameplay subsystem state");
    // Fill absent known fields without removing any fields from a newer save.
    const Json pdefaults = default_progression();
    for (auto it = pdefaults.begin(); it != pdefaults.end(); ++it) if (!progression_.contains(it.key())) progression_[it.key()] = it.value();
    const Json fdefaults = default_fixture_energy();
    for (auto it = fdefaults.begin(); it != fdefaults.end(); ++it) if (!progression_["fixtureEnergy"].contains(it.key())) progression_["fixtureEnergy"][it.key()] = it.value();
    const Json defaults = default_placements();
    for (auto it = defaults.begin(); it != defaults.end(); ++it) if (!placements_.contains(it.key())) placements_[it.key()] = it.value();
    // The browser runtime serializes fixture positions as [x,y,z]; native
    // gameplay exposes stable named coordinates to the renderer and physics bridge.
    if (placements_["fixtures"].is_array()) for (auto& fixture : placements_["fixtures"]) {
        if (!fixture.is_object()) continue;
        Json position = fixture.value("position", Json::object());
        if (position.is_array() && position.size() >= 3)
            fixture["position"] = {{"x", position[0]}, {"y", position[1]}, {"z", position[2]}};
        if (!fixture.contains("motion") || !fixture["motion"].is_object()) fixture["motion"] = {
            {"mode", "fixed"}, {"rotation", {{"x",0.0},{"y",0.0},{"z",0.0},{"w",1.0}}},
            {"velocity", {{"x",0.0},{"y",0.0},{"z",0.0}}}, {"angularVelocity", {{"x",0.0},{"y",0.0},{"z",0.0}}}, {"settled", false}};
    }
    const Json cdefaults = default_community();
    for (auto it = cdefaults.begin(); it != cdefaults.end(); ++it) if (!community_.contains(it.key())) community_[it.key()] = it.value();
    const Json fidefaults = default_faith();
    for (auto it = fidefaults.begin(); it != fidefaults.end(); ++it) if (!faith_.contains(it.key())) faith_[it.key()] = it.value();
    const Json campdefaults = default_campaign();
    for (auto it = campdefaults.begin(); it != campdefaults.end(); ++it) if (!campaign_.contains(it.key())) campaign_[it.key()] = it.value();
    const Json adefaults = default_armaments();
    for (auto it = adefaults.begin(); it != adefaults.end(); ++it) if (!armaments_.contains(it.key())) armaments_[it.key()] = it.value();
    if (campaign_.contains("firstSignal") && campaign_["firstSignal"].is_object() && campaign_["cores"] == 0)
        campaign_["cores"] = campaign_["firstSignal"].value("cores", Json(0));
    validate_loaded_state();
}

Json Gameplay::save() const {
    Json out = unknown_.is_object() ? unknown_ : Json::object();
    out["schemaVersion"] = 1;
    out["progression"] = progression_;
    out["placements"] = placements_;
    out["community"] = community_;
    out["faith"] = faith_;
    out["campaign"] = campaign_;
    out["armaments"] = armaments_;
    out["player"] = player_;
    out["deaths"] = deaths_;
    out["worldInitializationComplete"] = new_world_initialized_;
    return out;
}

Json Gameplay::initialize_new_world() {
    if (new_world_initialized_) return success_fields({{"duplicate", true}, {"granted", false}});
    // Legacy unified snapshots are never eligible for new-world rewards, even
    // when their old format lacks a native initialization receipt.
    if (state_loaded_ || !unknown_.empty()) return error_result("world_already_initialized");
    const Json rules = config_.value("rules", Json::object());
    const bool starter_kit = rules.value("starterKit", false);
    const Json terrain = config_.value("terrain", Json::object());
    std::string generator = terrain.value("generator", std::string("infinite"));
    if (generator.empty()) generator = "infinite";
    Json result = success_fields({{"granted", false}, {"generator", generator}});
    if (starter_kit) {
        static const Json starter = {{"stone_pick", 1}, {"raw_timber", 4}, {"loose_stone", 4}, {"seed", 4}};
        result = grant(starter, "map-start:" + generator);
        if (!result.value("ok", false)) return result;
        result["granted"] = !result.value("duplicate", false);
        result["generator"] = generator;
    }
    new_world_initialized_ = true;
    return result;
}

const Json& Gameplay::entry(const std::string& id) const {
    const auto& indexed = content_.find(id);
    if (!indexed.empty()) return indexed;
    const Json& progression = content_.data.contains("progression") ? content_.data["progression"] : empty_object();
    if (progression.is_object() && progression.value("entries", Json::array()).is_array()) {
        for (const auto& row : progression["entries"]) if (row.is_object() && row.value("id", std::string()) == id) return row;
    }
    return empty_object();
}

std::vector<Json> Gameplay::list(const std::string& kind) const {
    std::vector<Json> out;
    const Json& progression = content_.data.contains("progression") ? content_.data["progression"] : empty_object();
    if (!progression.is_object() || !progression.contains("entries") || !progression["entries"].is_array()) return out;
    for (const auto& row : progression["entries"]) {
        if (!kind.empty() && row.value("kind", std::string()) != kind) continue;
        out.push_back(row);
    }
    return out;
}

bool Gameplay::valid_claim(const std::string& id) const { return !id.empty() && id.size() <= 512; }

double Gameplay::count(const std::string& id) const {
    const Json& inventory = progression_.value("inventory", Json::object());
    return inventory.is_object() ? number(inventory.value(id, Json()), 0.0) : 0.0;
}

bool Gameplay::valid_items(const Json& items) const {
    if (!items.is_object()) return false;
    static const std::set<std::string> item_kinds = {"item", "material", "tool", "station", "component", "gear_baseline"};
    for (auto it = items.begin(); it != items.end(); ++it) {
        const auto& e = entry(it.key());
        if (e.empty() || !item_kinds.count(e.value("kind", std::string())) || !finite_number(it.value()) || !nonnegative(it.value().get<double>())) return false;
    }
    return true;
}

bool Gameplay::has_items(const Json& items) const {
    if (!valid_items(items)) return false;
    for (auto it = items.begin(); it != items.end(); ++it) if (count(it.key()) + EPS < it.value().get<double>()) return false;
    return true;
}

bool Gameplay::has_energy(const Json& energy) const {
    if (!energy.is_object()) return false;
    for (auto it = energy.begin(); it != energy.end(); ++it) {
        if (!is_energy_type(it.key()) || !finite_number(it.value()) || !nonnegative(it.value().get<double>()) || energy_available(it.key()) + EPS < it.value().get<double>()) return false;
    }
    return true;
}

double Gameplay::energy_available(const std::string& type) const {
    if (!is_energy_type(type)) return 0.0;
    const Json& e = progression_.value("energy", Json::object());
    return e.is_object() ? number(e.value(type, Json()), 0.0) : 0.0;
}

Json Gameplay::grant(Json items, std::string claim) {
    if (!valid_items(items)) return error_result("invalid_items");
    if (!valid_claim(claim)) return error_result("claim_required");
    Json& claims = progression_["claims"];
    if (claim_exists(claims, claim)) return success_fields({{"duplicate", true}});
    for (auto it = items.begin(); it != items.end(); ++it) {
        if (it.value().get<double>() < 0 || !nonnegative(it.value().get<double>())) return error_result("invalid_items");
    }
    Json& inventory = progression_["inventory"];
    Json& overflow = progression_["overflow"];
    double slots = 0;
    for (auto it = inventory.begin(); it != inventory.end(); ++it) slots += std::ceil(std::max(0.0, (number(it.value()) - EPS) / ITEM_STACK));
    for (auto it = items.begin(); it != items.end(); ++it) {
        double amount = it.value().get<double>(), current = number(inventory.value(it.key(), Json()), 0.0);
        double current_slots = std::ceil(std::max(0.0, (current - EPS) / ITEM_STACK));
        double capacity = std::max(0.0, (INVENTORY_SLOTS - slots + current_slots) * ITEM_STACK - current);
        double put = std::min(capacity, amount);
        if (put > 0) inventory[it.key()] = current + put;
        if (amount - put > EPS) overflow[it.key()] = number(overflow.value(it.key(), Json()), 0.0) + amount - put;
        slots += std::ceil(std::max(0.0, (current + put - EPS) / ITEM_STACK)) - current_slots;
    }
    array_add(claims, claim);
    return success_fields({{"duplicate", false}});
}

Json Gameplay::spend(Json items, std::string claim) {
    if (!valid_items(items)) return error_result("invalid_items");
    if (!valid_claim(claim)) return error_result("claim_required");
    Json& claims = progression_["claims"];
    if (claim_exists(claims, claim)) return success_fields({{"duplicate", true}});
    if (!has_items(items)) return error_result("insufficient_or_unknown_item");
    Json& inventory = progression_["inventory"];
    for (auto it = items.begin(); it != items.end(); ++it) {
        double left = std::max(0.0, count(it.key()) - it.value().get<double>());
        if (left < EPS) inventory.erase(it.key()); else inventory[it.key()] = left;
    }
    array_add(claims, claim);
    // Capacity changes can retain mana in escrow, never silently discard it.
    if (progression_["fixtureEnergy"].value("enabled", false)) {
        const double capacity = number(progression_["personalMana"].value("investedCapacity", Json()), 0.0);
        const double excess = std::max(0.0, energy_available("magic") - std::min(1000.0, capacity));
        if (excess > 0) {
            progression_["energy"]["magic"] = std::max(0.0, energy_available("magic") - excess);
            progression_["personalMana"]["reserveEU"] = number(progression_["personalMana"].value("reserveEU", Json()), 0.0) + excess;
        }
    }
    return success_fields({{"duplicate", false}});
}

Json Gameplay::grant_resources(Json items, Json energy, double work_credits, std::string claim) {
    if (!valid_claim(claim)) return error_result("claim_required");
    if (has_claim(claim)) return success_fields({{"duplicate", true}});
    if (!valid_items(items) || !energy.is_object() || !nonnegative(work_credits)) return error_result("invalid_reward");
    for (const auto& item : items.items()) if (!finite_number(item.value()) || !nonnegative(item.value().get<double>())) return error_result("invalid_reward");
    for (const auto& e : energy.items()) if (!is_energy_type(e.key()) || !finite_number(e.value()) || !nonnegative(e.value().get<double>())) return error_result("invalid_reward");
    for (const auto& item : items.items()) put_items(item.key(), number(item.value()));
    for (const auto& e : energy.items()) progression_["energyOverflow"][e.key()] = number(progression_["energyOverflow"].value(e.key(), Json()), 0) + number(e.value());
    progression_["workCredits"] = number(progression_.value("workCredits", Json()), 0) + work_credits;
    for (const auto& type : ENERGY_TYPES) {
        const double room = std::max(0.0, energy_capacity(type) - energy_available(type));
        const double accepted = std::min(room, number(progression_["energyOverflow"].value(type, Json()), 0));
        progression_["energy"][type] = energy_available(type) + accepted;
        progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) - accepted;
    }
    add_claim(claim);
    return success_fields({{"duplicate", false}, {"items", items}, {"energy", energy}, {"workCredits", work_credits}});
}

Json Gameplay::transaction(Json items, Json energy, const std::string& claim) {
    if (!valid_claim(claim)) return error_result("claim_required");
    Json& claims = progression_["claims"];
    if (claim_exists(claims, claim)) return success_fields({{"duplicate", true}});
    if (!has_items(items) || !has_energy(energy)) return error_result("insufficient_resources");
    // Validate everything before the first mutation, then commit all debits.
    for (auto it = energy.begin(); it != energy.end(); ++it) {
        const std::string type = it.key(); const double amount = it.value().get<double>();
        progression_["energy"][type] = std::max(0.0, energy_available(type) - amount);
        progression_["metrics"]["consumed"][type] = number(progression_["metrics"]["consumed"].value(type, Json()), 0.0) + amount;
    }
    Json& inventory = progression_["inventory"];
    for (auto it = items.begin(); it != items.end(); ++it) {
        const double left = std::max(0.0, count(it.key()) - it.value().get<double>());
        if (left < EPS) inventory.erase(it.key()); else inventory[it.key()] = left;
    }
    array_add(claims, claim);
    return success_fields({{"duplicate", false}});
}

bool Gameplay::has_claim(const std::string& claim) const { return claim_exists(progression_.value("claims", Json::array()), claim); }
void Gameplay::add_claim(const std::string& claim) { array_add(progression_["claims"], claim); }

void Gameplay::take_items(const Json& items) {
    Json& inventory = progression_["inventory"];
    for (auto it = items.begin(); it != items.end(); ++it) {
        const double left = std::max(0.0, count(it.key()) - number(it.value()));
        if (left < EPS) inventory.erase(it.key()); else inventory[it.key()] = left;
    }
    if (progression_["fixtureEnergy"].value("enabled", false)) {
        Json& mana = progression_["personalMana"];
        const double cap = std::min(1000.0, number(mana.value("investedCapacity", Json()), 0.0));
        const double excess = std::max(0.0, energy_available("magic") - cap);
        if (excess > 0) {
            progression_["energy"]["magic"] = std::max(0.0, energy_available("magic") - excess);
            mana["reserveEU"] = number(mana.value("reserveEU", Json()), 0.0) + excess;
        }
    }
}

void Gameplay::put_items(const std::string& id, double amount) {
    if (amount <= 0) return;
    Json& inventory = progression_["inventory"], &overflow = progression_["overflow"];
    double slots = 0;
    for (auto it = inventory.begin(); it != inventory.end(); ++it) slots += std::ceil(std::max(0.0, (number(it.value()) - EPS) / ITEM_STACK));
    const double current = count(id), current_slots = std::ceil(std::max(0.0, (current - EPS) / ITEM_STACK));
    const double capacity = std::max(0.0, (INVENTORY_SLOTS - slots + current_slots) * ITEM_STACK - current);
    const double put = std::min(capacity, amount);
    if (put > 0) inventory[id] = current + put;
    if (amount - put > EPS) overflow[id] = number(overflow.value(id, Json()), 0.0) + amount - put;
}

double Gameplay::energy_capacity(const std::string& type) const {
    if (!is_energy_type(type)) return 0.0;
    if (progression_["fixtureEnergy"].value("enabled", false)) {
        if (type == "divine") return 100.0;
        if (type == "magic") {
            const Json& mana = progression_["personalMana"];
            double capacity = number(mana.value("investedCapacity", Json()), 0.0);
            const std::string focus = json_string(mana.value("focusId", Json()));
            const Json& g = entry(focus);
            if (g.value("kind", std::string()) == "gear_baseline" && number(g.value("tier", Json())) >= 5 && count(focus) > 0)
                capacity += (number(g.value("tier", Json())) - 4.0) * 50.0;
            return std::min(1000.0, capacity);
        }
        return 0.0;
    }
    double capacity = type == "divine" ? 100.0 : 0.0;
    const Json& assemblies = progression_.value("assemblies", Json::array());
    if (!assemblies.is_array()) return capacity;
    for (const auto& a : assemblies) {
        const Json& c = entry(a.value("componentId", std::string()));
        if (c.empty()) continue;
        const double factor = number(a.value("scale", Json()), 0.0) * std::min(number(a.value("health", Json()), 0.0), number(a.value("connected", Json()), 0.0));
        for (const auto& t : c.value("stores", Json::array())) if (t.is_string() && t.get<std::string>() == type) capacity += number(c.value("capacity", Json()), 0.0) * factor;
        if (a.value("componentId", std::string()) == "fluid_container") {
            const std::string fluid = a.value("fluidType", std::string("liquid_mana"));
            if ((type == "magic" && fluid == "liquid_mana") || (type == "chemical" && fluid == "acid_fluid"))
                capacity += number(c.value("capacityLiters", Json()), 0.0) * (type == "magic" ? 100.0 : 40.0) * factor;
        }
    }
    return capacity;
}

Json Gameplay::store_energy(const std::string& type, double amount) {
    if (!is_energy_type(type) || !nonnegative(amount)) return error_result("invalid_energy");
    const double efficiency = (type == "electrical" || type == "mechanical") ? .9 : 1.0;
    const double accepted = std::min(amount, std::max(0.0, energy_capacity(type) - energy_available(type)) / efficiency);
    const double stored = accepted * efficiency;
    progression_["energy"][type] = energy_available(type) + stored;
    progression_["metrics"]["dissipated"][type] = number(progression_["metrics"]["dissipated"].value(type, Json()), 0.0) + accepted * (1.0 - efficiency);
    return success_fields({{"accepted", accepted}, {"stored", stored}, {"remainder", amount - accepted}});
}

Json Gameplay::grant_reward(Json payload, const std::string& claim) {
    if (!valid_claim(claim)) return error_result("claim_required");
    if (has_claim(claim)) return success_fields({{"duplicate", true}});
    Json items = payload.value("guaranteed", Json::object());
    const double divine = number(payload.value("divineEnergy", Json()), 0.0);
    if (!valid_items(items) || !nonnegative(divine)) return error_result("invalid_reward");
    for (auto it = items.begin(); it != items.end(); ++it) if (it.key().rfind("blueprint:", 0) == 0 && std::floor(number(it.value())) != number(it.value())) return error_result("invalid_blueprint_quantity");
    Json unlocked = Json::array();
    for (auto it = items.begin(); it != items.end(); ++it) {
        if (it.key().rfind("blueprint:", 0) == 0) {
            for (int n = 0; n < int(number(it.value())); ++n) {
                const Json& research = entry(it.key());
                std::string unlocked_id;
                for (const auto& row : list("research")) if (row.value("blueprint", std::string()) == it.key()) { unlocked_id = row.value("id", std::string()); break; }
                if (unlocked_id.empty()) return error_result("unknown_blueprint");
                if (!array_has(progression_["research"], unlocked_id)) array_add(progression_["research"], unlocked_id);
                unlocked.push_back(unlocked_id);
            }
        } else put_items(it.key(), number(it.value()));
    }
    progression_["energyOverflow"]["divine"] = number(progression_["energyOverflow"].value("divine", Json()), 0.0) + divine;
    // External rewards first occupy direct capacity, then remain finite escrow.
    const double room = std::max(0.0, energy_capacity("divine") - energy_available("divine"));
    const double accepted = std::min(room, number(progression_["energyOverflow"]["divine"]));
    progression_["energy"]["divine"] = energy_available("divine") + accepted;
    progression_["energyOverflow"]["divine"] = number(progression_["energyOverflow"]["divine"]) - accepted;
    add_claim(claim);
    return success_fields({{"duplicate", false}, {"items", items}, {"unlocked", unlocked}, {"energy", divine}});
}

Json Gameplay::start_research(const std::string& id) {
    Json status = research_status(id);
    if (!status.value("ok", false)) return status;
    Json& job = progression_["researchJob"];
    if (!job.is_null() && job.value("id", std::string()) != id) return error_result("research_busy");
    Json& progress = progression_["researchProgress"];
    if (!progress.contains(id) || !progress[id].value("paid", false)) {
        take_items(entry(id).value("samples", Json::object()));
        progress[id] = {{"paid", true}, {"work", 0.0}};
    }
    job = {{"id", id}};
    return success_fields({{"id", id}});
}

Json Gameplay::discover_blueprint(const std::string& blueprint, const std::string& origin, const std::string& claim) {
    if (!valid_claim(claim)) return error_result("claim_required");
    if (has_claim(claim)) return success_fields({{"duplicate", true}});
    if (origin != "crafted" && origin != "discovery") return error_result("invalid_origin");
    std::string research_id;
    for (const auto& row : list("research")) if (row.value("blueprint", std::string()) == blueprint) { research_id = row.value("id", std::string()); break; }
    if (research_id.empty()) return error_result("unknown_blueprint");
    if (origin == "crafted" && count(blueprint) < 1) return error_result("blueprint_required");
    if (origin == "crafted") take_items({{blueprint, 1}});
    Json& known = progression_["research"];
    const bool already = array_has(known, research_id);
    if (already && origin == "discovery") {
        const double work = number(entry(research_id).value("work", Json()), 0.0) * number(entry(research_id).value("duplicateWorkFraction", Json()), 0.0);
        progression_["workCredits"] = number(progression_.value("workCredits", Json()), 0.0) + work;
    } else if (!already) {
        array_add(known, research_id);
        const Json research_job = progression_.value("researchJob", Json::object());
        if (research_job.is_object() && research_job.value("id", std::string()) == research_id) progression_["researchJob"] = nullptr;
    }
    add_claim(claim);
    return success_fields({{"id", research_id}, {"alreadyKnown", already}, {"duplicate", false}});
}

Json Gameplay::queue_craft(const std::string& recipe_id, int amount, bool auto_install, const std::string& requested_fixture) {
    const Json& r = entry(recipe_id);
    if (amount < 1 || amount > 64 || progression_["jobs"].size() >= 64) return error_result("invalid_queue_count");
    Json status = recipe_status(recipe_id);
    if (!status.value("ok", false)) return status;
    Json inputs = r.value("inputs", Json::object());
    for (auto it = inputs.begin(); it != inputs.end(); ++it) it.value() = number(it.value()) * amount;
    if (!has_items(inputs)) return error_result("ingredients_required");
    if (auto_install) {
        const Json recipe_outputs = r.value("outputs", Json::object());
        for (const auto& output : recipe_outputs.items()) if (entry(output.key()).value("kind", std::string()) != "station") return error_result("not_station_recipe");
    }
    std::string fixture_id = requested_fixture;
    if (progression_["fixtureEnergy"].value("enabled", false) && r.value("station", std::string("hand")) != "hand") {
        if (fixture_id.empty()) {
            for (const auto& fixture : progression_.value("worldFixtures", Json::array())) {
                const auto owner = fixture.value("ownerId", std::string());
                if (fixture.value("assetId", std::string()) == r.value("station", std::string()) && fixture.value("active", false) && number(fixture.value("health", Json())) > 0 && array_has(progression_.value("fixtureAccess", Json::array()), owner)) { fixture_id = owner; break; }
            }
        }
        bool suitable = false;
        for (const auto& fixture : progression_.value("worldFixtures", Json::array())) if (fixture.value("ownerId", std::string()) == fixture_id && fixture.value("assetId", std::string()) == r.value("station", std::string()) && fixture.value("active", false) && array_has(progression_.value("fixtureAccess", Json::array()), fixture_id)) suitable = true;
        if (!suitable) return error_result("physical_station_required");
    }
    if (progression_["fixtureEnergy"].value("enabled", false) && auto_install) return error_result("world_placement_required");
    take_items(inputs);
    Json job = {{"id", "craft:" + std::to_string(int(number(progression_.value("nextId", Json()), 1.0)))}, {"type", "craft"},
                {"recipeId", recipe_id}, {"count", amount}, {"progress", 0.0}, {"autoInstall", auto_install}};
    if (!fixture_id.empty()) job["fixtureId"] = fixture_id;
    progression_["jobs"].push_back(job);
    progression_["nextId"] = int(number(progression_.value("nextId", Json()), 1.0)) + 1;
    return success_fields({{"jobId", job["id"]}});
}

bool Gameplay::station_available(const std::string& id) const {
    if (id == "hand") return true;
    const Json& stations = progression_.value("stations", Json::object());
    int count = stations.is_object() ? int(number(stations.value(id, Json()), 0.0)) : 0;
    const Json& fixtures = progression_.value("worldFixtures", Json::array());
    int located = 0;
    if (fixtures.is_array()) for (const auto& f : fixtures) if (f.value("kind", std::string()) == "station" && f.value("assetId", std::string()) == id) ++located;
    const bool legacy_station = !progression_["fixtureEnergy"].value("enabled", false) && count > located;
    if (legacy_station) return true;
    const Json& community_stations = progression_.value("communityStations", Json::array());
    if (array_has(community_stations, id)) return true;
    const Json& access = progression_.value("fixtureAccess", Json::array());
    if (fixtures.is_array()) for (const auto& f : fixtures) {
        if (f.value("kind", std::string()) == "station" && f.value("assetId", std::string()) == id && f.value("active", false) && number(f.value("health", Json()), 0) > 0 && array_has(access, f.value("ownerId", std::string()))) return true;
    }
    return false;
}

Json Gameplay::recipe_status(const std::string& id) const {
    const Json& r = entry(id);
    if (r.value("kind", std::string()) != "recipe") return error_result("unknown_recipe");
    const std::string research = json_string(r.value("research", Json()));
    if (!research.empty() && !array_has(progression_.value("research", Json::array()), research)) return error_result("research_required");
    const std::string station = json_string(r.value("station", Json("hand")), "hand");
    if (!station_available(station)) return error_result("station_required");
    if (!has_items(r.value("inputs", Json::object()))) return error_result("ingredients_required");
    return success_fields();
}

Json Gameplay::research_status(const std::string& id) const {
    const Json& r = entry(id);
    if (r.value("kind", std::string()) != "research") return error_result("unknown_research");
    if (array_has(progression_.value("research", Json::array()), id)) return error_result("already_known");
    for (const auto& prereq : r.value("prerequisites", Json::array())) if (prereq.is_string() && !array_has(progression_.value("research", Json::array()), prereq.get<std::string>())) return error_result("prerequisite_required");
    if (!station_available(json_string(r.value("station", Json("hand")), "hand"))) return error_result("station_required");
    const Json& progress = progression_.value("researchProgress", Json::object());
    const bool paid = progress.is_object() && progress.contains(id) && progress[id].value("paid", false);
    if (!paid && !has_items(r.value("samples", Json::object()))) return error_result("samples_required");
    return success_fields();
}

Json Gameplay::progression_status() const { return progression_; }

Json Gameplay::harvest(const std::string& source_id, const Json& args) {
    const Json& source = entry(source_id);
    const std::string environment_id = args.value("environmentId", std::string());
    const std::string node_id = args.value("nodeId", std::string());
    const std::string node_type = args.value("nodeType", std::string());
    const std::string claim = args.value("claim", std::string());
    if (source.value("kind", std::string()) != "source" || !valid_claim(node_id) || !valid_claim(claim)) return error_result("invalid_harvest_context");
    const Json& environments = content_.data.value("environments", Json::object());
    const Json* env_ptr = nullptr;
    if (environments.contains("entries") && environments["entries"].is_array()) for (const auto& env : environments["entries"])
        if (env.value("id", std::string()) == environment_id) { env_ptr = &env; break; }
    if (!env_ptr) return error_result("invalid_harvest_context");
    if (has_claim(claim)) return success_fields({{"duplicate", true}});
    const Json elapsed_value = args.value("elapsed", Json(0.0));
    const double elapsed = number(elapsed_value, 0.0);
    if (!finite_number(elapsed_value) || elapsed + EPS < number(source.value("seconds", Json()), 0.0)) return error_result("harvest_time_required");
    const std::string tool_id = json_string(source.value("requiredTool", Json()));
    if (!tool_id.empty() && count(tool_id) < 1) return error_result("tool_required");
    const Json& env = *env_ptr;
    std::vector<Json> matching;
    const Json& world = environments.value("world", Json::object());
    for (const auto& node : world.value("harvestNodes", Json::array())) {
        if (node.value("sourceId", std::string()) != source_id) continue;
        for (const auto& id : env.value("harvestNodeIds", Json::array())) if (id.is_string() && id.get<std::string>() == node.value("id", std::string())) { matching.push_back(node); break; }
    }
    Json node;
    if (!matching.empty()) {
        auto chosen = matching.begin();
        if (!node_type.empty()) chosen = std::find_if(matching.begin(), matching.end(), [&](const Json& n) { return n.value("id", std::string()) == node_type; });
        if (chosen != matching.end()) node = *chosen;
    }
    bool minerals = false;
    const Json& blocks = content_.data.value("blocks", Json::object());
    for (const auto& vein : env.value("oreVeins", Json::array())) {
        std::string raw;
        if (blocks.contains("entries") && blocks["entries"].is_array()) for (const auto& block : blocks["entries"])
            if (block.value("id", std::string()) == vein.value("blockId", std::string())) { raw = block.value("rawResourceId", std::string()); break; }
        if (!raw.empty() && source.value("outputs", Json::object()).contains(raw)) minerals = true;
    }
    if (node.is_null() && !minerals) return error_result("source_not_in_environment");
    const Json& tool = entry(tool_id);
    const int max_wear = int(number(tool.value("durabilityActions", Json()), 0.0));
    Json& wear = progression_["toolWear"];
    const int current_wear = int(number(wear.value(tool_id, Json()), max_wear));
    if (max_wear > 0 && current_wear <= 0 && count(tool_id) < 2) return error_result("tool_broken");
    const std::string harvest_key = environment_id + ":" + node_id;
    const Json& old = progression_["harvestClaims"].value(harvest_key, Json());
    const double clock = number(progression_.value("clock", Json()), 0.0);
    if (!old.is_null()) {
        const double regrow = number(node.value("regrowS", Json()), 0.0);
        if (old.value("sourceId", std::string()) != source_id || regrow <= 0 || clock + EPS < number(old.value("at", Json()), 0.0) + regrow) return error_result("source_depleted");
    }
    if (max_wear > 0) {
        if (current_wear == 0) { take_items({{tool_id, 1}}); wear[tool_id] = max_wear; }
        wear[tool_id] = int(number(wear.value(tool_id, Json()), max_wear)) - 1;
    }
    Json granted = grant(source.value("outputs", Json::object()), claim);
    if (!granted.value("ok", false)) return granted;
    progression_["harvestClaims"][harvest_key] = {{"sourceId", source_id}, {"at", clock}};
    return success_fields({{"items", source.value("outputs", Json::object())}, {"seconds", number(source.value("seconds", Json()), 0.0)}, {"duplicate", false}});
}

Json Gameplay::component_status(const std::string& id) const {
    const Json& c = entry(id);
    if (c.value("kind", std::string()) != "component") return error_result("unknown_component");
    Json rows = Json::array();
    for (const auto& a : progression_.value("assemblies", Json::array())) if (a.value("componentId", std::string()) == id) rows.push_back(a);
    double active = 0;
    for (const auto& a : rows) if (number(a.value("health", Json()), 0) > 0 && number(a.value("connected", Json()), 0) > 0 && a.value("accessible", true)) active += 1;
    return success_fields({{"id", id}, {"count", rows.size()}, {"active", active}, {"functions", c.value("functions", Json::array())}, {"inputEnergies", c.value("inputEnergies", Json::array())}, {"outputEnergies", c.value("outputEnergies", Json::array())}});
}

Json Gameplay::place_component(const std::string& id, const Json& args) {
    if (progression_["fixtureEnergy"].value("enabled", false)) return error_result("world_placement_required");
    const Json& c = entry(id);
    if (c.value("kind", std::string()) != "component" || count(id) < 1 || !array_has(progression_.value("research", Json::array()), c.value("research", std::string()))) return error_result("component_required");
    const double scale = number(args.value("scale", Json(1.0)), 1.0);
    const Json envelope = c.value("designEnvelope", Json::object());
    if (!positive(scale) || scale < number(envelope.value("scaleMin", Json()), 0.0) || scale > number(envelope.value("scaleMax", Json()), 0.0)) return error_result("invalid_scale");
    const int core_count = std::max(1, int(std::ceil(scale)));
    Json cost = {{id, core_count}};
    const std::string material_id = args.value("materialId", std::string());
    const double material_liters = number(args.value("materialLiters", Json(1.0)), 1.0);
    if (!material_id.empty()) {
        const Json& material = entry(material_id);
        if (material.value("kind", std::string()) != "material" || !positive(material_liters)) return error_result("invalid_material");
        cost[material_id] = material_liters;
    }
    if (!has_items(cost)) return error_result("invalid_assembly_inputs");
    const std::string fluid_type = args.value("fluidType", std::string("liquid_mana"));
    if (id == "fluid_container") {
        bool fluid_ok = false;
        for (const auto& f : c.value("fluidContents", Json::array())) if (f.is_string() && f.get<std::string>() == fluid_type) fluid_ok = true;
        if (!fluid_ok) return error_result("invalid_assembly_inputs");
    }
    take_items(cost);
    const int next = int(number(progression_.value("nextId", Json()), 1.0));
    Json instance = {{"id", "component:" + std::to_string(next)}, {"componentId", id}, {"scale", scale}, {"health", 1.0},
                     {"connected", 1.0}, {"materialId", material_id.empty() ? Json(nullptr) : Json(material_id)},
                     {"materialLiters", material_id.empty() ? 0.0 : material_liters}, {"fluidType", fluid_type}};
    progression_["assemblies"].push_back(instance);
    progression_["nextId"] = next + 1;
    return success_fields({{"instanceId", instance["id"]}, {"entityType", "machine"}});
}

Json Gameplay::component_condition(const std::string& instance_id, const Json& args) {
    Json& assemblies = progression_["assemblies"];
    auto it = std::find_if(assemblies.begin(), assemblies.end(), [&](const Json& a) { return a.value("id", std::string()) == instance_id; });
    if (it == assemblies.end()) return error_result("unknown_component");
    for (const char* field : {"health", "connected"}) if (args.contains(field)) {
        double value = number(args[field], -1.0);
        if (!nonnegative(value) || value > 1) return error_result("invalid_condition");
    }
    for (const char* field : {"health", "connected"}) if (args.contains(field)) (*it)[field] = args[field];
    for (const auto& type : ENERGY_TYPES) {
        double excess = std::max(0.0, energy_available(type) - energy_capacity(type));
        if (excess > 0) {
            progression_["energy"][type] = energy_available(type) - excess;
            progression_["metrics"]["dissipated"][type] = number(progression_["metrics"]["dissipated"].value(type, Json()), 0.0) + excess;
        }
    }
    return success_fields();
}

Json Gameplay::material_status(const std::string& id, const Json& args) const {
    const Json& m = entry(id);
    const double liters = number(args.value("volumeLiters", Json(1.0)), 1.0);
    const double area = number(args.value("connectedAreaM2", Json(.25)), .25);
    const double health = number(args.value("health", Json(1.0)), 1.0);
    if (m.value("kind", std::string()) != "material" || !positive(liters) || !positive(area) || !nonnegative(health) || health > 1) return error_result("invalid_material_geometry");
    const Json& p = m.value("properties", Json::object());
    return success_fields({{"materialId", id}, {"tier", m.value("tier", 0)}, {"field", m.value("field", Json(nullptr))},
        {"massKg", number(p.value("densityKgM3", Json()), 0) * liters / 1000.0},
        {"maxHp", number(p.value("cellHp", Json()), 0) * liters / 125.0},
        {"hp", number(p.value("cellHp", Json()), 0) * liters / 125.0 * health},
        {"loadKn", number(p.value("strengthIndex", Json()), 0) * .05 * area / .25 * health},
        {"heatLimitC", p.value("heatLimitC", Json(nullptr))}, {"acidResistance", p.value("acidResistance", Json(nullptr))},
        {"manaCoupling", p.value("manaCoupling", Json(nullptr))}, {"functionsGranted", Json::array()}});
}

Json Gameplay::synchronize_fixtures(const Json& records, const Json& access, const Json& community_stations) {
    if (!records.is_array() || !access.is_array() || !community_stations.is_array()) return error_result("invalid_world_fixtures");
    std::set<std::string> owners;
    for (const auto& r : records) {
        const std::string owner = r.value("ownerId", std::string());
        const std::string kind = r.value("kind", std::string());
        const std::string id = r.value("assetId", std::string());
        const Json& e = entry(id);
        const double health = number(r.value("health", Json()), -1), max_health = number(r.value("maxHealth", Json()), -1);
        if (!valid_claim(owner) || !owners.insert(owner).second || (kind != "station" && kind != "component") || e.value("kind", std::string()) != kind || !nonnegative(health) || !positive(max_health) || health > max_health || !r.contains("active") || !r["active"].is_boolean()) return error_result("invalid_world_fixtures");
        const Json pos = r.value("position", Json::object());
        for (const char* axis : {"x", "y", "z"}) if (!finite_number(pos.value(axis, Json()))) return error_result("invalid_world_fixtures");
    }
    for (const auto& owner : access) if (!owner.is_string() || !owners.count(owner.get<std::string>())) return error_result("invalid_world_fixtures");
    std::set<std::string> stations_seen;
    for (const auto& station : community_stations) if (!station.is_string() || entry(station.get<std::string>()).value("kind", std::string()) != "station" || !stations_seen.insert(station.get<std::string>()).second) return error_result("invalid_world_fixtures");

    Json& p = progression_;
    for (const auto& old : p.value("worldFixtures", Json::array())) if (old.value("kind", std::string()) == "station") {
        auto id = old.value("assetId", std::string());
        p["stations"][id] = std::max(0.0, number(p["stations"].value(id, Json()), 0.0) - 1.0);
        if (number(p["stations"][id]) <= 0) p["stations"].erase(id);
    }
    p["worldFixtures"] = records;
    p["fixtureAccess"] = access;
    p["communityStations"] = community_stations;
    Json kept = Json::array();
    for (const auto& a : p.value("assemblies", Json::array())) if (!a.contains("worldOwnerId")) kept.push_back(a);
    p["assemblies"] = kept;
    for (const auto& r : records) {
        const auto id = r.value("assetId", std::string());
        if (r.value("kind", std::string()) == "station") p["stations"][id] = number(p["stations"].value(id, Json()), 0.0) + 1.0;
        else p["assemblies"].push_back({{"id", r.value("ownerId", std::string())}, {"worldOwnerId", r.value("ownerId", std::string())}, {"componentId", id},
            {"scale", 1.0}, {"health", number(r.value("health", Json()), 0.0) / number(r.value("maxHealth", Json()), 1.0)},
            {"connected", r.value("active", false) ? 1.0 : 0.0}, {"accessible", array_has(access, r.value("ownerId", std::string()))},
            {"materialId", nullptr}, {"materialLiters", 0.0}, {"fluidType", r.value("fluidType", std::string("liquid_mana"))}});
    }

    Json& fe = p["fixtureEnergy"];
    if (!fe.value("enabled", false) && !records.empty()) {
        fe["enabled"] = true;
        for (const auto& type : ENERGY_TYPES) {
            const double before = energy_available(type);
            const double retained = type == "divine" ? std::min(100.0, before) : 0.0;
            fe["legacyEscrow"][type] = number(fe["legacyEscrow"].value(type, Json()), 0.0) + before - retained;
            p["energy"][type] = retained;
            if (type != "divine") {
                fe["legacyEscrow"][type] = number(fe["legacyEscrow"].value(type, Json()), 0.0) + number(p["energyOverflow"].value(type, Json()), 0.0);
                p["energyOverflow"][type] = 0.0;
            }
        }
    }
    Json old_nodes = Json::array(), old_links = fe.value("links", Json::array());
    std::set<std::string> keep_owners;
    for (const auto& r : records) keep_owners.insert(r.value("ownerId", std::string()));
    for (const auto& n : fe.value("nodes", Json::array())) {
        const std::string id = n.value("ownerId", std::string());
        if (keep_owners.count(id)) old_nodes.push_back(n);
        else for (const auto& type : ENERGY_TYPES) fe["metrics"]["dissipated"][type] = number(fe["metrics"]["dissipated"].value(type, Json()), 0.0) + number(n.value("energy", Json::object()).value(type, Json()), 0.0);
    }
    Json nodes = Json::array();
    for (const auto& r : records) {
        const auto id = r.value("ownerId", std::string());
        auto old = std::find_if(old_nodes.begin(), old_nodes.end(), [&](const Json& n) { return n.value("ownerId", std::string()) == id; });
        Json n = old == old_nodes.end() ? Json{{"ownerId", id}, {"assetId", r.value("assetId", std::string())}, {"position", r.value("position", Json::object())},
             {"energy", zero_energy()}, {"fuel", Json::object()}, {"sources", Json::object()}, {"fluidType", r.value("fluidType", std::string("liquid_mana"))}} : *old;
        const Json old_position = n.value("position", Json::object());
        if (distance3(old_position, r.value("position", Json::object())) > 1e-5 || !r.value("active", false)) {
            Json filtered = Json::array(); for (const auto& l : old_links) if (l.value("from", std::string()) != id && l.value("to", std::string()) != id) filtered.push_back(l); old_links = filtered;
        }
        n["assetId"] = r.value("assetId", std::string()); n["position"] = r.value("position", Json::object()); n["health"] = r.value("health", Json(0));
        n["maxHealth"] = r.value("maxHealth", Json(1)); n["active"] = r.value("active", false);
        if (r.contains("fluidType")) n["fluidType"] = r["fluidType"];
        nodes.push_back(n);
    }
    // Keep only links whose endpoints still exist and remain within the authored maximum length.
    Json valid_links = Json::array();
    for (const auto& l : old_links) {
        auto a = std::find_if(nodes.begin(), nodes.end(), [&](const Json& n) { return n.value("ownerId", std::string()) == l.value("from", std::string()); });
        auto b = std::find_if(nodes.begin(), nodes.end(), [&](const Json& n) { return n.value("ownerId", std::string()) == l.value("to", std::string()); });
        if (a != nodes.end() && b != nodes.end() && distance3(a->value("position", Json::object()), b->value("position", Json::object())) <= 8.0 + EPS) valid_links.push_back(l);
    }
    fe["nodes"] = nodes; fe["links"] = valid_links;
    for (const auto& type : ENERGY_TYPES) {
        const double excess = std::max(0.0, energy_available(type) - energy_capacity(type));
        if (excess > 0) {
            p["energy"][type] = energy_available(type) - excess;
            p["metrics"]["dissipated"][type] = number(p["metrics"]["dissipated"].value(type, Json()), 0.0) + excess;
        }
    }
    return success_fields();
}

Json Gameplay::fixture_energy_status() const {
    const Json& fe = progression_.value("fixtureEnergy", Json::object());
    Json nodes = Json::array();
    for (const auto& raw : fe.value("nodes", Json::array())) {
        Json n = raw;
        const std::string id = n.value("ownerId", std::string());
        const Json& def = entry(n.value("assetId", std::string()));
        const bool active = n.value("active", false) && number(n.value("health", Json()), 0) > 0;
        const bool accessible = active && array_has(progression_.value("fixtureAccess", Json::array()), id);
        Json ports = {{"inputs", def.value("inputEnergies", Json::array())}, {"outputs", def.value("outputEnergies", Json::array())},
                      {"stores", def.value("stores", Json::array())}, {"rate", number(def.value("nominalPower", Json()), 100.0)},
                      {"mode", def.value("stores", Json::array()).empty() ? "component" : "storage"}};
        if (def.value("kind", std::string()) == "station") {
            Json inputs = Json::array(), outputs = Json::array();
            for (const auto& r : recipe_catalog_) if (r.value("station", std::string()) == def.value("id", std::string())) {
                const Json energy = r.value("energy", Json::object());
                for (const auto& it : energy.items()) if (!array_has(inputs, it.key())) inputs.push_back(it.key());
            }
            for (const auto& s : energy_source_catalog_) {
                if (json_string(s.value("requiredComponent", Json())) == def.value("id", std::string()) || (json_string(s.value("requiredComponent", Json())).empty() && (def.value("kind", std::string()) == "station" || def.value("id", std::string()) == "heat_engine"))) {
                    if (!s.contains("activity") && !array_has(outputs, s.value("energy", std::string()))) outputs.push_back(s.value("energy", std::string()));
                }
            }
            ports = {{"inputs", inputs}, {"outputs", outputs}, {"stores", Json::array()}, {"rate", 100.0}, {"mode", "process_endpoint"}};
        } else if (def.value("id", std::string()) == "fluid_container") {
            const std::string type = n.value("fluidType", std::string("liquid_mana")) == "acid_fluid" ? "chemical" : "magic";
            ports = {{"inputs", Json::array({type})}, {"outputs", Json::array({type})}, {"stores", Json::array({type})},
                     {"rate", type == "magic" ? 100.0 : 40.0}, {"mode", "fluid_storage"}};
        }
        n["accessible"] = accessible; n["ports"] = ports;
        Json capacities = Json::object();
        for (const auto& type : ENERGY_TYPES) {
            double cap = 0;
            if (def.value("kind", std::string()) == "station") {
                for (const auto& j : progression_.value("jobs", Json::array())) if (j.value("type", std::string()) == "craft" && j.value("fixtureId", std::string()) == id) {
                    const Json& r = entry(j.value("recipeId", std::string()));
                    cap += number(r.value("energy", Json::object()).value(type, Json()), 0.0) / std::max(EPS, number(r.value("seconds", Json()), 1.0)) * std::max(0.0, number(r.value("seconds", Json()), 0.0) * number(j.value("count", Json()), 1.0) - number(j.value("progress", Json()), 0.0));
                }
            } else if (def.value("id", std::string()) == "fluid_container") {
                const std::string fluid = n.value("fluidType", std::string("liquid_mana"));
                if ((type == "magic" && fluid == "liquid_mana") || (type == "chemical" && fluid == "acid_fluid")) cap = number(def.value("capacityLiters", Json()), 0.0) * (type == "magic" ? 100.0 : 40.0) * (active ? number(n.value("health", Json()), 0.0) / std::max(EPS, number(n.value("maxHealth", Json()), 1.0)) : 0.0);
            } else if (array_has(def.value("stores", Json::array()), type)) cap = number(def.value("capacity", Json()), 0.0) * (active ? number(n.value("health", Json()), 0.0) / std::max(EPS, number(n.value("maxHealth", Json()), 1.0)) : 0.0);
            capacities[type] = cap;
        }
        n["capacities"] = capacities;
        n["sourceOptions"] = Json::array();
        for (const auto& s : energy_source_catalog_) if (!s.contains("activity") && ((json_string(s.value("requiredComponent", Json())) == def.value("id", std::string())) || (json_string(s.value("requiredComponent", Json())).empty() && (def.value("kind", std::string()) == "station" || def.value("id", std::string()) == "heat_engine")))) n["sourceOptions"].push_back(s);
        nodes.push_back(n);
    }
    Json metrics = fe.value("metrics", Json::object());
    return {{"enabled", fe.value("enabled", false)}, {"rules", {{"maxDistanceM", 8.0}, {"maximumLinks", 1024}, {"fluidFlowLitersPerSecond", 1.0}, {"status", "proposed"}}},
            {"nodes", nodes}, {"links", fe.value("links", Json::array())}, {"legacyEscrow", fe.value("legacyEscrow", zero_energy())}, {"metrics", metrics}};
}

Json Gameplay::fixture_command(const std::string& name, const Json& args) {
    Json& fe = progression_["fixtureEnergy"];
    auto node = [&](const std::string& owner) -> Json* {
        for (auto& n : fe["nodes"]) if (n.value("ownerId", std::string()) == owner) return &n;
        return nullptr;
    };
    auto has_fe_claim = [&](const std::string& id) { return claim_exists(fe.value("claims", Json::array()), id); };
    auto add_fe_claim = [&](const std::string& id) { array_add(fe["claims"], id); };
    auto accessible = [&](Json* n) { return n && n->value("active", false) && number(n->value("health", Json()), 0) > 0 && array_has(progression_.value("fixtureAccess", Json::array()), n->value("ownerId", std::string())); };
    auto ports = [&](const std::string& owner) -> Json {
        Json status = fixture_energy_status();
        for (const auto& n : status.value("nodes", Json::array())) if (n.value("ownerId", std::string()) == owner) return n.value("ports", Json::object());
        return Json::object();
    };
    auto capacity = [&](Json* n, const std::string& type) {
        if (!n) return 0.0;
        const Json& def = entry(n->value("assetId", std::string()));
        const double health = n->value("active", false) ? number(n->value("health", Json()), 0) / std::max(EPS, number(n->value("maxHealth", Json()), 1)) : 0.0;
        if (def.value("kind", std::string()) == "station") {
            double reserved = 0;
            for (const auto& j : progression_.value("jobs", Json::array())) if (j.value("type", std::string()) == "craft" && j.value("fixtureId", std::string()) == n->value("ownerId", std::string())) {
                const Json& r = entry(j.value("recipeId", std::string()));
                reserved += number(r.value("energy", Json::object()).value(type, Json()), 0.0) / std::max(EPS, number(r.value("seconds", Json()), 1.0)) * std::max(0.0, number(r.value("seconds", Json()), 0) * number(j.value("count", Json()), 1) - number(j.value("progress", Json()), 0));
            }
            return reserved;
        }
        if (def.value("id", std::string()) == "fluid_container") {
            const std::string f = n->value("fluidType", std::string("liquid_mana"));
            if ((type == "magic" && f == "liquid_mana") || (type == "chemical" && f == "acid_fluid")) return number(def.value("capacityLiters", Json()), 0) * (type == "magic" ? 100.0 : 40.0) * health;
            return 0.0;
        }
        return array_has(def.value("stores", Json::array()), type) ? number(def.value("capacity", Json()), 0) * health : 0.0;
    };
    auto source_options = [&](Json* n) {
        Json out = Json::array(); if (!n) return out;
        const Json& def = entry(n->value("assetId", std::string()));
        for (const auto& s : energy_source_catalog_) if (!s.contains("activity") &&
            (json_string(s.value("requiredComponent", Json())) == def.value("id", std::string()) || (json_string(s.value("requiredComponent", Json())).empty() && (def.value("kind", std::string()) == "station" || def.value("id", std::string()) == "heat_engine")))) out.push_back(s);
        return out;
    };

    if (name == "energy.link.quote" || name == "energy.link" || name == "energy.unlink") {
        if (name == "energy.unlink") {
            const std::string id = args.value("linkId", std::string());
            Json& links = fe["links"];
            auto it = std::find_if(links.begin(), links.end(), [&](const Json& l) { return l.value("id", std::string()) == id; });
            if (it == links.end()) return error_result("unknown_link");
            Json* a = node(it->value("from", std::string())); Json* b = node(it->value("to", std::string()));
            if (!accessible(a) && !accessible(b)) return error_result("out_of_range");
            links.erase(it);
            return success_fields({{"salvage", Json::object()}, {"reason", "Cable removal consumes the installed cut length; no automatic material refund."}});
        }
        const std::string from = args.value("from", std::string()), to = args.value("to", std::string()), type = args.value("type", std::string());
        Json* a = node(from); Json* b = node(to);
        if (!a || !b || from == to || !is_energy_type(type)) return error_result("invalid_link");
        Json pa = ports(from), pb = ports(to);
        if (!array_has(pa.value("outputs", Json::array()), type) || !array_has(pb.value("inputs", Json::array()), type)) return error_result("incompatible_ports");
        const double length = distance3(a->value("position", Json::object()), b->value("position", Json::object()));
        if (length > 8.0 + EPS) return error_result("cable_too_long");
        Json materials = {{"mechanical", {{"wood", .25}}}, {"electrical", {{"scrap_iron", .1}}}, {"thermal", {{"scrap_iron", .1}}},
                          {"chemical", {{"clay", .1}}}, {"magic", {{"clay", .1}}}, {"divine", {{"stone", .1}}}};
        Json items = Json::object();
        for (const auto& pair : materials[type].items()) items[pair.key()] = std::ceil(number(pair.value()) * std::max(.25, length) * 1000.0) / 1000.0;
        Json quote = success_fields({{"from", from}, {"to", to}, {"type", type}, {"lengthM", length}, {"maxDistanceM", 8.0}, {"items", items},
            {"rateEUPerSecond", std::min(number(pa.value("rate", Json()), 100), number(pb.value("rate", Json()), 100))}, {"status", "proposed"}});
        if (name == "energy.link.quote") return quote;
        const std::string claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_fe_claim(claim)) return success_fields({{"duplicate", true}});
        if (!accessible(a) || !accessible(b)) return error_result("out_of_range");
        if (fe["links"].size() >= 1024) return error_result("link_exists_or_limit");
        for (const auto& l : fe["links"]) if (l.value("from", std::string()) == from && l.value("to", std::string()) == to && l.value("type", std::string()) == type) return error_result("link_exists_or_limit");
        Json paid = spend(items, "fixed-link:" + claim);
        if (!paid.value("ok", false)) return paid;
        const int next = int(number(fe.value("nextId", Json()), 1));
        Json link = {{"id", "fixed-link:" + std::to_string(next)}, {"from", from}, {"to", to}, {"type", type}, {"lengthM", length}, {"items", items}};
        fe["links"].push_back(link); fe["nextId"] = next + 1; add_fe_claim(claim);
        return success_fields({{"link", link}});
    }

    if (name == "energy.source" || name == "energy.refuel") {
        const std::string owner = args.value("ownerId", std::string()), source_id = args.value("sourceId", std::string());
        Json* n = node(owner);
        bool valid = false; Json source;
        for (const auto& s : source_options(n)) if (s.value("id", std::string()) == source_id) { valid = true; source = s; break; }
        if (!accessible(n) || !valid) return error_result("invalid_source_or_range");
        if (name == "energy.source") {
            if (!args.contains("active") || !args["active"].is_boolean()) return error_result("invalid_source_or_range");
            if (source_id == "manual_crank" && args["active"].get<bool>()) for (auto& other : fe["nodes"]) other["sources"]["manual_crank"] = false;
            n->operator[]("sources")[source_id] = args["active"];
            return success_fields();
        }
        const std::string claim = args.value("claim", std::string());
        const int batches = args.value("batches", 1);
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_fe_claim(claim)) return success_fields({{"duplicate", true}});
        if (!source.contains("duration") || !finite_number(source["duration"]) || batches < 1 || batches > 64) return error_result("invalid_fuel_or_range");
        Json inputs = source.value("inputs", Json::object()); for (auto& input : inputs.items()) input.value() = number(input.value()) * batches;
        Json paid = spend(inputs, "fixed-fuel:" + claim); if (!paid.value("ok", false)) return paid;
        (*n)["fuel"][source_id] = number(n->value("fuel", Json::object()).value(source_id, Json()), 0) + number(source.value("duration", Json()), 0) * batches;
        (*n)["sources"][source_id] = true; add_fe_claim(claim);
        return success_fields({{"seconds", (*n)["fuel"][source_id]}, {"items", inputs}});
    }

    if (name == "energy.fluid.set" || name == "energy.fluid.fill" || name == "energy.charge" || name == "energy.drain") {
        const std::string owner = args.value("ownerId", std::string()); Json* n = node(owner);
        if (!accessible(n)) return error_result("out_of_range");
        if (name == "energy.fluid.set") {
            const std::string fluid = args.value("fluidType", std::string());
            if (n->value("assetId", std::string()) != "fluid_container" || (fluid != "liquid_mana" && fluid != "acid_fluid")) return error_result("empty_container_required");
            const Json node_energy = n->value("energy", zero_energy());
            for (const auto& q : node_energy.items()) if (number(q.value()) > EPS) return error_result("empty_container_required");
            (*n)["fluidType"] = fluid;
            Json links = Json::array(); for (const auto& l : fe["links"]) if (l.value("from", std::string()) != owner && l.value("to", std::string()) != owner) links.push_back(l); fe["links"] = links;
            return success_fields();
        }
        const std::string claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_fe_claim(claim)) return success_fields({{"duplicate", true}});
        if (name == "energy.fluid.fill") {
            const std::string fluid = args.value("fluid", std::string()); const double liters = number(args.value("liters", Json()), 0);
            const std::string type = fluid == "liquid_mana" ? "magic" : fluid == "acid_fluid" ? "chemical" : "";
            if (n->value("assetId", std::string()) != "fluid_container" || n->value("fluidType", std::string()) != fluid || !positive(liters) || type.empty()) return error_result("invalid_fluid");
            const double eu = liters * (type == "magic" ? 100.0 : 40.0);
            if (number(n->value("energy", zero_energy()).value(type, Json()), 0) + eu > capacity(n, type) + EPS) return error_result("storage_capacity");
            Json paid = spend({{fluid, liters}}, "fixed-fluid:" + claim); if (!paid.value("ok", false)) return paid;
            (*n)["energy"][type] = number(n->value("energy", zero_energy()).value(type, Json()), 0) + eu;
            fe["metrics"]["imported"][type] = number(fe["metrics"]["imported"].value(type, Json()), 0) + eu;
            add_fe_claim(claim); return success_fields({{"storedEU", eu}});
        }
        const std::string type = args.value("type", std::string()); const double amount = number(args.value("amount", Json()), 0);
        if (!is_energy_type(type) || !positive(amount)) return error_result("capacity_or_range");
        const double node_energy = number(n->value("energy", zero_energy()).value(type, Json()), 0);
        if (name == "energy.charge") {
            if (node_energy + amount > capacity(n, type) + EPS) return error_result("capacity_or_range");
            const bool escrow = args.value("fromLegacyEscrow", false);
            if (escrow) {
                const double available = number(fe.value("legacyEscrow", zero_energy()).value(type, Json()), 0);
                if (available + EPS < amount) return error_result("legacy_escrow_empty");
                fe["legacyEscrow"][type] = available - amount;
            } else {
                Json paid = transaction(Json::object(), {{type, amount}}, "fixed-charge:" + claim); if (!paid.value("ok", false)) return paid;
            }
            (*n)["energy"][type] = node_energy + amount; fe["metrics"]["imported"][type] = number(fe["metrics"]["imported"].value(type, Json()), 0) + amount;
            add_fe_claim(claim); return success_fields({{"transferredEU", amount}});
        }
        if (node_energy + EPS < amount || energy_available(type) + amount > energy_capacity(type) + EPS) return error_result("capacity_or_range");
        (*n)["energy"][type] = node_energy - amount; progression_["energy"][type] = energy_available(type) + amount;
        fe["metrics"]["exported"][type] = number(fe["metrics"]["exported"].value(type, Json()), 0) + amount;
        add_fe_claim(claim); return success_fields({{"transferredEU", amount}});
    }
    return error_result("unknown_energy_command");
}

Json Gameplay::asset_geometry(const std::string& id) const {
    Json out = Json::array();
    std::function<void(const std::string&, Vec3, std::set<std::string>)> visit;
    visit = [&](const std::string& asset_id, Vec3 parent_offset, std::set<std::string> stack) {
        if (stack.count(asset_id)) throw std::runtime_error("Cyclic fixture asset reference");
        stack.insert(asset_id);
        const Json& asset = content_.asset(asset_id);
        if (asset.empty()) throw std::runtime_error("Fixture asset unavailable: " + asset_id);
        std::unordered_map<std::string, Json> parts;
        for (const auto& p : asset.value("parts", Json::array())) parts[p.value("id", std::string())] = p;
        std::unordered_map<std::string, Vec3> offsets;
        std::set<std::string> visiting;
        std::function<Vec3(const std::string&)> part_offset = [&](const std::string& part_id) -> Vec3 {
            if (offsets.count(part_id)) return offsets[part_id];
            if (visiting.count(part_id) || !parts.count(part_id)) throw std::runtime_error("Invalid fixture asset hierarchy");
            visiting.insert(part_id); const Json& part = parts.at(part_id);
            Vec3 base{};
            if (!part.value("parent", Json()).is_null()) base = part_offset(part.value("parent", Json()).get<std::string>());
            const Json t = part.value("translation", Json::array({0, 0, 0}));
            Vec3 result = base + Vec3{number(t.at(0)), number(t.at(1)), number(t.at(2))};
            visiting.erase(part_id); offsets[part_id] = result; return result;
        };
        std::unordered_map<std::string, bool> collides;
        for (const auto& m : asset.value("materials", Json::array())) collides[m.value("id", std::string())] = m.value("collision", true);
        for (const auto& part : asset.value("parts", Json::array())) {
            const std::string part_id = part.value("id", std::string()); const Vec3 local = part_offset(part_id);
            for (const auto& box : part.value("boxes", Json::array())) {
                const std::string material = box.value("material", std::string());
                if (collides.count(material) && !collides[material]) continue;
                const Json c = box.value("center", Json::array({0, 0, 0})), s = box.value("size", Json::array({0, 0, 0}));
                Vec3 center{number(c.at(0)) + parent_offset.x + local.x, number(c.at(1)) + parent_offset.y + local.y, number(c.at(2)) + parent_offset.z + local.z};
                Vec3 size{number(s.at(0)), number(s.at(1)), number(s.at(2))};
                out.push_back({{"center", center}, {"size", size}, {"material", material}, {"partId", part_id}, {"assetId", asset_id}, {"solid", true}});
            }
        }
        for (const auto& instance : asset.value("instances", Json::array())) {
            const Json t = instance.value("translation", Json::array({0, 0, 0}));
            visit(instance.value("assetId", std::string()), parent_offset + Vec3{number(t.at(0)), number(t.at(1)), number(t.at(2))}, stack);
        }
    };
    visit(id, Vec3{}, {});
    return out;
}

Json Gameplay::placement_status() const {
    Json fixtures = Json::array();
    for (const auto& f : placements_.value("fixtures", Json::array())) {
        Json row = f;
        row["fixed"] = f.value("motion", Json::object()).value("mode", std::string("fixed")) == "fixed";
        row["broken"] = number(f.value("hp", Json()), 0) <= 0;
        row["ownerId"] = f.value("id", Json());
        row["entityType"] = "machine";
        fixtures.push_back(row);
    }
    return {{"schemaVersion", placements_.value("schemaVersion", 1)}, {"nextId", placements_.value("nextId", 1)},
            {"revision", placements_.value("revision", 0)}, {"geometryRevision", placements_.value("geometryRevision", 0)}, {"fixtures", fixtures},
            {"accessPosition", placements_.value("accessPosition", Json(nullptr))}, {"communityStations", placements_.value("communityStations", Json::array())}};
}

Json Gameplay::command_placement(const std::string& name, const Json& args) {
    Json& fixtures = placements_["fixtures"];
    auto find_fixture = [&](const std::string& id) -> Json* {
        for (auto& f : fixtures) if (f.value("id", std::string()) == id) return &f;
        return nullptr;
    };
    auto sync = [&]() {
        Json records = Json::array(), access = Json::array();
        const Json access_pos = placements_.value("accessPosition", Json(nullptr));
        const Json stations = placements_.value("communityStations", Json::array());
        for (const auto& f : fixtures) {
            Json p = f.value("position", Json::object());
            const double dist = distance3(access_pos, p);
            if (dist <= 4.0 + EPS && f.value("motion", Json::object()).value("mode", std::string("fixed")) == "fixed" && number(f.value("hp", Json()), 0) > 0) access.push_back(f.value("id", std::string()));
            records.push_back({{"ownerId", f.value("id", std::string())}, {"assetId", f.value("assetId", std::string())}, {"kind", f.value("kind", std::string())},
                {"health", number(f.value("hp", Json()), 0)}, {"maxHealth", number(f.value("maxHp", Json()), 1)},
                {"active", f.value("motion", Json::object()).value("mode", std::string("fixed")) == "fixed" && number(f.value("hp", Json()), 0) > 0},
                {"position", p}, {"fluidType", f.value("fluidType", std::string("liquid_mana"))}});
        }
        return synchronize_fixtures(records, access, stations);
    };
    if (name == "placement.list" || name == "placement.status") return success_fields({{"placements", placement_status()}});
    if (name == "placement.access") {
        const Json position = args.value("position", Json::object());
        for (const char* axis : {"x", "y", "z"}) if (!finite_number(position.value(axis, Json()))) return error_result("invalid_access_context");
        Json stations = args.value("communityStations", Json::array()); if (!stations.is_array()) return error_result("invalid_access_context");
        Json filtered = Json::array(); std::set<std::string> unique;
        for (const auto& id : stations) if (id.is_string() && entry(id.get<std::string>()).value("kind", std::string()) == "station" && unique.insert(id.get<std::string>()).second) filtered.push_back(id);
        placements_["accessPosition"] = position; placements_["communityStations"] = filtered;
        Json result = sync(); if (!result.value("ok", false)) return result;
        return success_fields({{"accessibleFixtures", progression_["fixtureAccess"]}});
    }
    if (name == "placement.place") {
        const std::string asset_id = args.value("assetId", std::string()); const Json& authored = entry(asset_id);
        Json position = args.value("position", Json::object());
        if (authored.empty() || (authored.value("kind", std::string()) != "station" && authored.value("kind", std::string()) != "component") || !position.is_object()) return error_result("invalid_fixture");
        for (const char* axis : {"x", "y", "z"}) if (!finite_number(position.value(axis, Json())) || std::abs(number(position.value(axis, Json()))) > 1e9) return error_result("invalid_fixture");
        if (fixtures.size() >= 256) return error_result("fixture_limit");
        if (authored.value("kind", std::string()) == "component" && !array_has(progression_.value("research", Json::array()), json_string(authored.value("research", Json())))) return error_result("research_required");
        Json geometry;
        try { geometry = asset_geometry(asset_id); } catch (...) { return error_result("asset_unavailable"); }
        if (geometry.empty() || geometry.size() > 10000) return error_result("asset_unavailable");
        auto grid = [](double v) { return std::round(v / .03125) * .03125; };
        position["x"] = grid(number(position["x"])); position["y"] = grid(number(position["y"])); position["z"] = grid(number(position["z"]));
        const Json actor = args.value("actorPosition", Json(nullptr));
        if (!actor.is_null() && distance3(actor, position) > 4.0 + EPS) return error_result("out_of_range");
        Json context = args.value("worldContext", Json::object());
        if (context.is_object() && context.value("occupied", false)) return error_result("fixture_occupied");
        const double orientation_len = 1.0;
        Json rotation = args.value("rotation", Json::object({{"x", 0.0}, {"y", 0.0}, {"z", 0.0}, {"w", 1.0}}));
        const double qnorm = std::sqrt(std::pow(number(rotation.value("x", Json()), 0), 2) + std::pow(number(rotation.value("y", Json()), 0), 2) + std::pow(number(rotation.value("z", Json()), 0), 2) + std::pow(number(rotation.value("w", Json()), 1), 2));
        if (std::abs(qnorm - orientation_len) > 1e-5) return error_result("invalid_fixture_pose");
        auto rotated = [&](Vec3 v) {
            Quat q{number(rotation.value("x", Json()), 0) / qnorm, number(rotation.value("y", Json()), 0) / qnorm, number(rotation.value("z", Json()), 0) / qnorm, number(rotation.value("w", Json()), 1) / qnorm};
            return rotate(q, v);
        };
        auto bounds_of = [&](const Json& boxes, const Json& pos, const Json& q) {
            std::array<double, 6> bounds{std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()};
            Quat quat{number(q.value("x", Json()), 0), number(q.value("y", Json()), 0), number(q.value("z", Json()), 0), number(q.value("w", Json()), 1)};
            for (const auto& b : boxes) {
                Vec3 c = b.at("center").get<Vec3>(), s = b.at("size").get<Vec3>(), wc = rotate(quat, c) + Vec3{number(pos.value("x", Json())), number(pos.value("y", Json())), number(pos.value("z", Json()))};
                Vec3 axesX = rotate(quat, {1,0,0}), axesY = rotate(quat, {0,1,0}), axesZ = rotate(quat, {0,0,1});
                Vec3 ext{(std::abs(axesX.x)*s.x + std::abs(axesY.x)*s.y + std::abs(axesZ.x)*s.z)/2, (std::abs(axesX.y)*s.x + std::abs(axesY.y)*s.y + std::abs(axesZ.y)*s.z)/2, (std::abs(axesX.z)*s.x + std::abs(axesY.z)*s.y + std::abs(axesZ.z)*s.z)/2};
                bounds[0] = std::min(bounds[0], wc.x-ext.x); bounds[1] = std::min(bounds[1], wc.y-ext.y); bounds[2] = std::min(bounds[2], wc.z-ext.z);
                bounds[3] = std::max(bounds[3], wc.x+ext.x); bounds[4] = std::max(bounds[4], wc.y+ext.y); bounds[5] = std::max(bounds[5], wc.z+ext.z);
            }
            return bounds;
        };
        auto obbs_of = [&](const Json& boxes,const Json& pos,const Json& q) {
            std::vector<OrientedBox> result;result.reserve(boxes.size());
            for(const auto& box:boxes)result.push_back(oriented_box(box,pos,q));
            return result;
        };
        auto bounds_overlap = [](const std::array<double,6>& a,const std::array<double,6>& b) {
            return a[0]<b[3]-1e-7&&a[3]>b[0]+1e-7&&a[1]<b[4]-1e-7&&a[4]>b[1]+1e-7&&a[2]<b[5]-1e-7&&a[5]>b[2]+1e-7;
        };
        const auto bounds = bounds_of(geometry, position, rotation);
        const auto placed_boxes=obbs_of(geometry,position,rotation);
        if (!actor.is_null()) {
            const double dx = std::max({bounds[0]-number(actor.value("x", Json())), 0.0, number(actor.value("x", Json()))-bounds[3]});
            const double dy = std::max({bounds[1]-number(actor.value("y", Json())), 0.0, number(actor.value("y", Json()))-bounds[4]});
            const double dz = std::max({bounds[2]-number(actor.value("z", Json())), 0.0, number(actor.value("z", Json()))-bounds[5]});
            if (std::hypot(dx,dy,dz) > 4.0 + EPS) return error_result("out_of_range");
        }
        bool fixture_support = false;
        for (const auto& f : fixtures) {
            Json other_geometry; try { other_geometry = asset_geometry(f.value("assetId", std::string())); } catch (...) { continue; }
            const Json other_position=f.value("position",Json::object()),other_rotation=f.value("motion",Json::object()).value("rotation",Json::object({{"x",0.0},{"y",0.0},{"z",0.0},{"w",1.0}}));
            auto other_bounds=bounds_of(other_geometry,other_position,other_rotation);
            if(!bounds_overlap(bounds,other_bounds))continue;
            const auto other_boxes=obbs_of(other_geometry,other_position,other_rotation);
            for(const auto& a:placed_boxes)for(const auto& b:other_boxes)if(obb_overlap(a,b))return error_result("fixture_occupied");
        }
        if (context.is_object() && context.value("occupied", false)) return error_result("external_occupied");
        if (context.is_object() && context.value("overlap", false)) return error_result("external_occupied");
        for (const auto& f : fixtures) {
            if (f.value("motion", Json::object()).value("mode", std::string("fixed")) != "fixed" || number(f.value("hp", Json()), 0) <= 0) continue;
            Json other_geometry; try { other_geometry = asset_geometry(f.value("assetId", std::string())); } catch (...) { continue; }
            const Json other_position=f.value("position",Json::object()),other_rotation=f.value("motion",Json::object()).value("rotation",Json::object({{"x",0.0},{"y",0.0},{"z",0.0},{"w",1.0}}));
            auto other_bounds=bounds_of(other_geometry,other_position,other_rotation);if(!bounds_overlap(bounds,other_bounds))continue;
            const auto other_boxes=obbs_of(other_geometry,other_position,other_rotation);
            for(const auto& a:other_boxes)for(const auto& b:placed_boxes)if(obb_support_contact(a,b))fixture_support=true;
        }
        const bool world_support = context.is_object() && context.value("supported", false);
        if (!fixture_support && !world_support) return error_result("support_required");
        const Json& recipe = entry(json_string(authored.value("origin", Json::object()).value("recipe", Json())));
        double strength = 0;
        const Json recipe_inputs = recipe.value("inputs", Json::object());
        for (const auto& input : recipe_inputs.items()) strength += number(input.value()) * number(entry(input.key()).value("properties", Json::object()).value("cellHp", Json()), 25) / 4.0;
        const double max_hp = std::max(25.0, std::min(5000.0, std::ceil(strength)));
        const int next = int(number(placements_.value("nextId", Json()), 1));
        const std::string id = "fixture:" + std::to_string(next);
        Json cost = {{asset_id, 1}}; Json paid = spend(cost, "place:" + id);
        if (!paid.value("ok", false)) return paid;
        Json record = {{"id", id}, {"assetId", asset_id}, {"kind", authored.value("kind", std::string())}, {"entityType", "machine"},
            {"position", position}, {"hp", max_hp}, {"maxHp", max_hp}, {"revision", 0},
            {"motion", {{"mode", "fixed"}, {"rotation", rotation}, {"velocity", numvec(0,0,0)}, {"angularVelocity", numvec(0,0,0)}, {"settled", false}}}};
        if (asset_id == "fluid_container") record["fluidType"] = args.value("fluidType", std::string("liquid_mana"));
        fixtures.push_back(record); placements_["nextId"] = next+1; placements_["revision"] = int(number(placements_.value("revision", Json()),0))+1;
        placements_["geometryRevision"] = int(number(placements_.value("geometryRevision", Json()),0))+1;
        Json synced = sync(); if (!synced.value("ok", false)) { fixtures.erase(fixtures.end()-1); return synced; }
        return success_fields({{"id", id}, {"ownerId", id}, {"position", position}, {"entityType", "machine"}});
    }
    if (name == "placement.damage" || name == "placement.repair" || name == "placement.remove" || name == "placement.set_pose" || name == "placement.mark_dynamic") {
        const std::string id = args.value("id", std::string()); Json* f = find_fixture(id);
        if (!f) return error_result("unknown_fixture");
        const Json actor = args.value("actorPosition", Json(nullptr));
        if (!actor.is_null() && distance3(actor, f->value("position", Json::object())) > 4.0 + EPS) return error_result("out_of_range");
        if (name == "placement.damage") {
            const double amount = number(args.value("amount", Json()), -1); if (!positive(amount)) return error_result("invalid_fixture_damage");
            (*f)["hp"] = std::max(0.0, number(f->value("hp", Json()), 0) - amount); (*f)["revision"] = int(number(f->value("revision", Json()), 0))+1;
            const bool broken = number(f->value("hp", Json()),0) == 0;
            const bool newly_destroyed = broken && f->value("motion",Json::object()).value("mode",std::string("fixed")) == "fixed";
            if (newly_destroyed) {
                Json motion = f->value("motion",Json::object()); motion["mode"]="dynamic"; motion["velocity"]=numvec(0,0,0); motion["angularVelocity"]=numvec(0,0,0); motion["settled"]=false; motion["reason"]="destroyed"; (*f)["motion"]=motion;
                placements_["geometryRevision"] = int(number(placements_.value("geometryRevision",Json()),0))+1;
            }
            placements_["revision"] = int(number(placements_.value("revision", Json()),0))+1; Json s=sync(); if(!s.value("ok",false))return s;
            return success_fields({{"hp", f->value("hp", Json())}, {"maxHp", f->value("maxHp", Json())}, {"broken", number(f->value("hp", Json()),0)==0}});
        }
        if (name == "placement.repair") {
            const double hp = number(f->value("hp", Json()), 0), max_hp = number(f->value("maxHp", Json()), 0);
            if (hp >= max_hp-EPS) return success_fields({{"duplicate", true}});
            const Json& asset = entry(f->value("assetId", std::string())); const Json& recipe = entry(json_string(asset.value("origin", Json::object()).value("recipe", Json())));
            const double fraction = 1.0 - hp/max_hp; Json cost = Json::object();
            const Json recipe_inputs = recipe.value("inputs", Json::object());
            for (const auto& input : recipe_inputs.items()) {
                const bool material = entry(input.key()).value("kind", std::string()) == "material";
                const double precision = material ? 1000.0 : 1.0;
                const double amount = std::ceil(number(input.value()) * fraction * .25 * precision) / precision;
                if (amount > 0) cost[input.key()] = amount;
            }
            const std::string claim = "repair:" + id + ":" + std::to_string(int(number(f->value("revision", Json()),0)));
            Json paid = spend(cost, claim); if (!paid.value("ok", false)) return paid;
            (*f)["hp"] = max_hp; (*f)["revision"] = int(number(f->value("revision", Json()),0))+1;
            placements_["revision"] = int(number(placements_.value("revision", Json()),0))+1; Json s=sync(); if(!s.value("ok",false))return s;
            return success_fields({{"hp", max_hp}, {"items", cost}});
        }
        if (name == "placement.remove") {
            Json items = Json::object(); const double hp = number(f->value("hp", Json()), 0), max_hp = number(f->value("maxHp", Json()), 1);
            if (hp >= max_hp-EPS) items[f->value("assetId", std::string())] = 1;
            else {
                const Json& asset = entry(f->value("assetId", std::string())); const Json& recipe = entry(json_string(asset.value("origin", Json::object()).value("recipe", Json())));
            const Json recipe_inputs = recipe.value("inputs", Json::object());
            for (const auto& input : recipe_inputs.items()) {
                    const double precision = entry(input.key()).value("kind", std::string()) == "material" ? 1000.0 : 1.0;
                    const double salvage = std::floor(number(input.value()) * (hp/max_hp) * .5 * precision) / precision;
                    if (salvage > 0) items[input.key()] = salvage;
                }
            }
            Json granted = grant(items, "dismantle:" + id); if (!granted.value("ok", false)) return granted;
            fixtures.erase(std::remove_if(fixtures.begin(), fixtures.end(), [&](const Json& row) { return row.value("id", std::string()) == id; }), fixtures.end());
            placements_["revision"] = int(number(placements_.value("revision", Json()),0))+1;
            placements_["geometryRevision"] = int(number(placements_.value("geometryRevision", Json()),0))+1; Json s=sync(); if(!s.value("ok",false))return s;
            return success_fields({{"items", items}});
        }
        if (name == "placement.mark_dynamic") {
            if (f->value("motion", Json::object()).value("mode", std::string("fixed")) == "dynamic") return success_fields({{"duplicate", true}});
            Json motion = f->value("motion", Json::object()); motion["mode"] = "dynamic"; motion["velocity"] = numvec(0,0,0); motion["angularVelocity"] = numvec(0,0,0); motion["settled"] = false; motion["reason"] = args.value("reason", std::string("support_lost"));
            (*f)["motion"] = motion; (*f)["revision"] = int(number(f->value("revision", Json()),0))+1; placements_["revision"] = int(number(placements_.value("revision", Json()),0))+1;
            placements_["geometryRevision"] = int(number(placements_.value("geometryRevision", Json()),0))+1;
            Json s=sync(); if(!s.value("ok",false))return s; return success_fields({{"id",id},{"dynamic",true}});
        }
        if (f->value("motion", Json::object()).value("mode", std::string("fixed")) != "dynamic") return error_result("not_dynamic_fixture");
        const Json pose = args.value("pose", args);
        return sync_fixture_body(id, pose);
    }
    return error_result("unknown_placement_command");
}

void Gameplay::finish_job(const Json& job) {
    const std::string claim = "complete:" + job.value("id", std::string());
    if (has_claim(claim)) return;
    if (job.value("type", std::string()) == "craft") {
        const Json& recipe = entry(job.value("recipeId", std::string()));
        const Json recipe_outputs = recipe.value("outputs", Json::object());
        for (const auto& out : recipe_outputs.items()) {
            const double amount = number(out.value()) * number(job.value("count", Json()), 1.0);
            if (job.value("autoInstall", false)) progression_["stations"][out.key()] = number(progression_["stations"].value(out.key(), Json()), 0.0) + amount;
            else put_items(out.key(), amount);
        }
    } else if (job.value("type", std::string()) == "activity") {
        const Json& activity = entry(job.value("activityId", std::string()));
        const std::string id = activity.value("id", std::string());
        const int repetitions = std::max(1, int(number(activity.value("repetitions", Json()), 1.0)));
        int progress = int(number(progression_["activityProgress"].value(id, Json()), 0.0)) + 1;
        if (progress >= repetitions) {
            progress -= repetitions;
            const Json output_energy = activity.value("outputEnergy", Json::object());
            for (const auto& output : output_energy.items())
                progression_["energyOverflow"][output.key()] = number(progression_["energyOverflow"].value(output.key(), Json()), 0.0) + number(output.value());
        }
        progression_["activityProgress"][id] = progress;
    }
    add_claim(claim);
}

Json Gameplay::step_fixture_energy(double dt, const std::string& consumer_id, const Json& rates, double seconds, bool manual) {
    Json& fe = progression_["fixtureEnergy"];
    std::map<std::string, Json> pools;
    std::map<std::string, double> used, sent, received;
    std::string manual_owner;
    for (const auto& n : fe.value("nodes", Json::array())) if (n.value("sources", Json::object()).value("manual_crank", false) && n.value("active", false) && number(n.value("health", Json()), 0) > 0 && array_has(progression_.value("fixtureAccess", Json::array()), n.value("ownerId", std::string()))) { manual_owner = n.value("ownerId", std::string()); break; }
    auto get_node = [&](const std::string& owner) -> Json* {
        for (auto& n : fe["nodes"]) if (n.value("ownerId", std::string()) == owner) return &n;
        return nullptr;
    };
    auto source_options = [&](Json* n) {
        Json out = Json::array(); if (!n) return out;
        const Json& def = entry(n->value("assetId", std::string()));
        for (const auto& s : energy_source_catalog_) if (!s.contains("activity") &&
            (json_string(s.value("requiredComponent", Json())) == def.value("id", std::string()) || (json_string(s.value("requiredComponent", Json())).empty() && (def.value("kind", std::string()) == "station" || def.value("id", std::string()) == "heat_engine")))) out.push_back(s);
        return out;
    };
    auto ports = [&](Json* n) {
        Json out = {{"inputs", Json::array()}, {"outputs", Json::array()}, {"stores", Json::array()}, {"rate", 0.0}};
        if (!n) return out;
        const Json& def = entry(n->value("assetId", std::string()));
        if (def.value("kind", std::string()) == "station") {
            for (const auto& r : recipe_catalog_) if (r.value("station", std::string()) == def.value("id", std::string())) {
                const Json energy = r.value("energy", Json::object());
                for (const auto& e : energy.items()) if (!array_has(out["inputs"], e.key())) out["inputs"].push_back(e.key());
            }
            for (const auto& s : source_options(n)) if (!array_has(out["outputs"], s.value("energy", std::string()))) out["outputs"].push_back(s.value("energy", std::string()));
            out["rate"] = 100.0;
        } else if (def.value("id", std::string()) == "fluid_container") {
            const std::string type = n->value("fluidType", std::string("liquid_mana")) == "acid_fluid" ? "chemical" : "magic";
            out["inputs"] = Json::array({type}); out["outputs"] = Json::array({type}); out["stores"] = Json::array({type}); out["rate"] = type == "magic" ? 100.0 : 40.0;
        } else {
            out["inputs"] = def.value("inputEnergies", Json::array()); out["outputs"] = def.value("outputEnergies", Json::array());
            out["stores"] = def.value("stores", Json::array()); out["rate"] = number(def.value("nominalPower", Json()), 0.0);
        }
        return out;
    };
    auto active_ratio = [](Json* n) { return n && n->value("active", false) ? number(n->value("health", Json()), 0) / std::max(EPS, number(n->value("maxHealth", Json()), 1)) : 0.0; };
    auto capacity = [&](Json* n, const std::string& type) {
        if (!n) return 0.0;
        const Json& def = entry(n->value("assetId", std::string()));
        const double health = active_ratio(n);
        if (def.value("kind", std::string()) == "station") {
            double room = 0;
            for (const auto& j : progression_.value("jobs", Json::array())) if (j.value("type", std::string()) == "craft" && j.value("fixtureId", std::string()) == n->value("ownerId", std::string())) {
                const Json& r = entry(j.value("recipeId", std::string()));
                room += number(r.value("energy", Json::object()).value(type, Json()), 0) / std::max(EPS, number(r.value("seconds", Json()), 1)) * std::max(0.0, number(r.value("seconds", Json()), 0) * number(j.value("count", Json()), 1) - number(j.value("progress", Json()), 0));
            }
            return room;
        }
        if (def.value("id", std::string()) == "fluid_container") {
            const auto fluid = n->value("fluidType", std::string("liquid_mana"));
            if ((type == "magic" && fluid == "liquid_mana") || (type == "chemical" && fluid == "acid_fluid")) return number(def.value("capacityLiters", Json()), 0) * (type == "magic" ? 100.0 : 40.0) * health;
            return 0.0;
        }
        return array_has(def.value("stores", Json::array()), type) ? number(def.value("capacity", Json()), 0) * health : 0.0;
    };
    // Withdraw only finite owner-local buffers; recipe stations reserve energy
    // for jobs bound to that exact owner.
    for (auto& n : fe["nodes"]) {
        const std::string owner = n.value("ownerId", std::string()); Json q = zero_energy(); pools[owner] = q; used[owner] = sent[owner] = received[owner] = 0;
        const double health = active_ratio(&n); if (!health) continue;
        Json port = ports(&n);
        for (const auto& t : ENERGY_TYPES) {
            const double take = std::min(number(n["energy"].value(t, Json()), 0), number(port.value("rate", Json()), 0) * health * dt);
            n["energy"][t] = number(n["energy"].value(t, Json()), 0) - take;
            pools[owner][t] = number(pools[owner].value(t, Json()), 0) + take;
        }
        for (const auto& source : source_options(&n)) {
            const std::string id = source.value("id", std::string()), type = source.value("energy", std::string());
            const bool autonomous = id == "ambient_mana" || id == "relic_divinity";
            const bool enabled = n.value("sources", Json::object()).value(id, autonomous);
            if (!enabled || (id == "manual_crank" && (!manual || owner != manual_owner))) continue;
            double amount = 0;
            if (source.contains("duration")) {
                const double fuel = number(n["fuel"].value(id, Json()), 0.0), use = std::min(dt, fuel);
                n["fuel"][id] = fuel - use; amount = use * number(source.value("power", Json()), 0.0) * health;
            } else amount = number(source.value("power", Json()), 0.0) * health * dt;
            if (json_truthy(source.value("storage", Json(false)))) amount = std::min(amount, std::max(0.0, capacity(&n, type) - number(n["energy"].value(type, Json()), 0) - number(pools[owner].value(type, Json()), 0)));
            pools[owner][type] = number(pools[owner].value(type, Json()), 0) + amount;
            fe["metrics"]["generated"][type] = number(fe["metrics"]["generated"].value(type, Json()), 0) + amount;
        }
    }
    auto find_conversion = [&](const std::string& asset) -> Json {
        for (const auto& c : conversion_catalog_) if (c.value("component", std::string()) == asset) return c;
        return Json::object();
    };
    for (std::size_t pass = 0; pass <= fe["nodes"].size(); ++pass) {
        bool changed = false;
        for (auto& n : fe["nodes"]) {
            const double health = active_ratio(&n); if (!health) continue;
            Json conversion = find_conversion(n.value("assetId", std::string())); if (conversion.empty()) continue;
            const std::string owner = n.value("ownerId", std::string());
            const std::string input = conversion.value("input", std::string()), output = conversion.value("output", std::string());
            double q = number(pools[owner].value(input, Json()), 0.0);
            const double take = std::min(q, std::max(0.0, number(ports(&n).value("rate", Json()), 0) * health * dt - used[owner]));
            if (take > EPS) {
                pools[owner][input] = q - take; pools[owner][output] = number(pools[owner].value(output, Json()), 0) + take * number(conversion.value("efficiency", Json()), 1);
                used[owner] += take; fe["metrics"]["conversionLoss"] = number(fe["metrics"].value("conversionLoss", Json()), 0) + take * (1 - number(conversion.value("efficiency", Json()), 1)); changed = true;
            }
        }
        for (const auto& link : fe.value("links", Json::array())) {
            Json* a = get_node(link.value("from", std::string())); Json* b = get_node(link.value("to", std::string()));
            if (active_ratio(a) <= 0 || active_ratio(b) <= 0) continue;
            Json pa = ports(a), pb = ports(b); const std::string type = link.value("type", std::string());
            if (!array_has(pa.value("outputs", Json::array()), type) || !array_has(pb.value("inputs", Json::array()), type)) continue;
            int branches = 0; for (const auto& other : fe["links"]) if (other.value("from", std::string()) == a->value("ownerId", std::string()) && other.value("type", std::string()) == type) branches++;
            const std::string ai = a->value("ownerId", std::string()), bi = b->value("ownerId", std::string());
            double amount = std::min(number(pools[ai].value(type, Json()), 0) / std::max(1, branches),
                std::max(0.0, number(pa.value("rate", Json()), 0) * active_ratio(a) * dt - sent[ai]));
            amount = std::min(amount, std::max(0.0, number(pb.value("rate", Json()), 0) * active_ratio(b) * dt - received[bi]));
            const Json& bdef = entry(b->value("assetId", std::string()));
            if (bdef.value("kind", std::string()) == "station") amount = std::min(amount, bi == consumer_id ? std::max(0.0, number(rates.value(type, Json()), 0) * seconds - number(pools[bi].value(type, Json()), 0)) : 0.0);
            const bool stores = array_has(pb.value("stores", Json::array()), type);
            const double efficiency = stores ? number(bdef.value("efficiency", Json()), 1) : 1;
            if (stores) amount = std::min(amount, std::max(0.0, capacity(b, type) - number(b->value("energy", zero_energy()).value(type, Json()), 0) - number(pools[bi].value(type, Json()), 0)) / std::max(EPS, efficiency));
            if (amount <= EPS) continue;
            pools[ai][type] = number(pools[ai].value(type, Json()), 0) - amount;
            pools[bi][type] = number(pools[bi].value(type, Json()), 0) + amount * efficiency;
            fe["metrics"]["dissipated"][type] = number(fe["metrics"]["dissipated"].value(type, Json()), 0) + amount * (1 - efficiency);
            sent[ai] += amount; received[bi] += amount; changed = true;
        }
        if (!changed) break;
    }
    double progressed = seconds;
    Json* consumer = get_node(consumer_id);
    if (rates.is_object() && !rates.empty()) {
        if (!consumer || !array_has(progression_.value("fixtureAccess", Json::array()), consumer_id)) progressed = 0;
        else for (const auto& pair : rates.items()) if (number(pair.value()) > 0) progressed = std::min(progressed, number(pools[consumer_id].value(pair.key(), Json()), 0) / number(pair.value()));
    }
    if (consumer) for (const auto& pair : rates.items()) {
        const double spent = number(pair.value()) * progressed;
        pools[consumer_id][pair.key()] = number(pools[consumer_id].value(pair.key(), Json()), 0) - spent;
        fe["metrics"]["consumed"][pair.key()] = number(fe["metrics"]["consumed"].value(pair.key(), Json()), 0) + spent;
    }
    for (auto& n : fe["nodes"]) {
        const std::string owner = n.value("ownerId", std::string());
        for (const auto& type : ENERGY_TYPES) {
            const double room = std::max(0.0, capacity(&n, type) - number(n["energy"].value(type, Json()), 0));
            const double keep = std::min(room, number(pools[owner].value(type, Json()), 0));
            n["energy"][type] = number(n["energy"].value(type, Json()), 0) + keep;
            fe["metrics"]["dissipated"][type] = number(fe["metrics"]["dissipated"].value(type, Json()), 0) + number(pools[owner].value(type, Json()), 0) - keep;
        }
    }
    return success_fields({{"progressed", progressed}});
}

void Gameplay::tick_progression(double dt, const Json& options) {
    if (!finite_number(dt) || dt < 0 || dt > 3600) return;
    double left = dt;
    while (left > EPS) {
        const double step = std::min(left, .1);
        progression_["clock"] = number(progression_.value("clock", Json()), 0) + step;
        for (const auto& type : ENERGY_TYPES) {
            const double room = std::max(0.0, energy_capacity(type) - energy_available(type));
            const double take = std::min(number(progression_["energyOverflow"].value(type, Json()), 0), room);
            progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) - take;
            progression_["energy"][type] = energy_available(type) + take;
        }
        Json& research_job = progression_["researchJob"];
        if (!research_job.is_null() && options.value("researching", true)) {
            const std::string id = research_job.value("id", std::string()); const Json& research = entry(id);
            if (station_available(research.value("station", std::string("hand")))) {
                Json& progress = progression_["researchProgress"][id];
                const double target = number(research.value("work", Json()), 0), work = number(progress.value("work", Json()), 0);
                const double credit = std::min(number(progression_.value("workCredits", Json()), 0), std::max(0.0, target - work));
                progression_["workCredits"] = number(progression_.value("workCredits", Json()), 0) - credit;
                progress["work"] = std::min(target, work + credit + step * number(research.value("workRate", Json()), 0));
                if (number(progress.value("work", Json()), 0) + EPS >= target) {
                    array_add(progression_["research"], id); progression_["researchJob"] = nullptr;
                }
            }
        }
        Json job = progression_["jobs"].empty() ? Json() : progression_["jobs"][0];
        Json rates = Json::object(); double remaining = 0; bool permitted = true;
        Json recipe;
        if (!job.is_null() && job.value("type", std::string()) == "craft") {
            recipe = entry(job.value("recipeId", std::string()));
            remaining = number(recipe.value("seconds", Json()), 0) * number(job.value("count", Json()), 1) - number(job.value("progress", Json()), 0);
            const std::string required_research = json_string(recipe.value("research", Json()));
            permitted = station_available(recipe.value("station", std::string("hand"))) && (required_research.empty() || array_has(progression_.value("research", Json::array()), required_research));
            const Json recipe_energy = recipe.value("energy", Json::object());
            for (const auto& e : recipe_energy.items()) rates[e.key()] = number(e.value()) / std::max(EPS, number(recipe.value("seconds", Json()), 1));
        } else if (!job.is_null()) {
            const Json& activity = entry(job.value("activityId", std::string()));
            remaining = number(activity.value("secondsPerRepetition", Json()), 0) - number(job.value("progress", Json()), 0);
        }
        const double seconds = !job.is_null() && permitted ? std::max(0.0, std::min(step, remaining)) : 0.0;
        double progressed = 0.0;
        if (progression_["fixtureEnergy"].value("enabled", false)) {
            std::string consumer = job.is_null() ? std::string() : job.value("fixtureId", std::string());
            if (!job.is_null() && job.value("type", std::string()) == "craft" && recipe.value("station", std::string("hand")) != "hand") {
                bool valid_fixture = false;
                for (const auto& f : progression_.value("worldFixtures", Json::array())) if (f.value("ownerId", std::string()) == consumer && f.value("active", false) && number(f.value("health", Json()), 0) > 0 && array_has(progression_.value("fixtureAccess", Json::array()), consumer)) valid_fixture = true;
                permitted = permitted && valid_fixture;
            }
            Json result = step_fixture_energy(step, consumer, rates, permitted ? seconds : 0, options.value("manual", false));
            progressed = result.value("progressed", 0.0);
        } else {
            Json fresh = zero_energy(), escrow_draw = zero_energy();
            for (const auto& source : energy_source_catalog_) {
                if (source.value("kind", std::string()) != "energy_source" || source.contains("activity")) continue;
                const std::string id = source.value("id", std::string()), type = source.value("energy", std::string());
                const bool autonomous = id == "ambient_mana" || id == "relic_divinity";
                bool enabled = progression_["activeSources"].value(id, autonomous);
                if (id == "manual_crank" && !options.value("manual", false)) enabled = false;
                const std::string required_component = json_string(source.value("requiredComponent", Json()));
                if (!enabled || (!required_component.empty() && number(component_status(required_component).value("active", Json()),0) <= 0) || !is_energy_type(type)) continue;
                double factor = 1;
                if (!required_component.empty()) {
                    factor = 0;
                    for (const auto& a : progression_.value("assemblies", Json::array())) if (a.value("componentId", std::string()) == required_component) factor += number(a.value("scale", Json()), 0) * std::min(number(a.value("health", Json()), 0), number(a.value("connected", Json()), 0));
                }
                double output = 0;
                if (source.contains("duration")) {
                    double fuel_left = number(progression_["sourceFuel"].value(id, Json()), 0), time_left = step;
                    while (time_left > EPS) {
                        if (fuel_left < EPS) {
                            Json inputs = source.value("inputs", Json::object());
                            if (!has_items(inputs)) break;
                            take_items(inputs); fuel_left = number(source.value("duration", Json()), 0);
                        }
                        const double used = std::min(time_left, fuel_left);
                        output += used * number(source.value("power", Json()), 0); fuel_left -= used; time_left -= used;
                    }
                    progression_["sourceFuel"][id] = fuel_left;
                } else output = number(source.value("power", Json()), 0) * factor * step;
                if (json_truthy(source.value("storage", Json(false)))) output = std::min(output, std::max(0.0, energy_capacity(type) - energy_available(type)) + number(rates.value(type, Json()), 0) * seconds);
                fresh[type] = number(fresh.value(type, Json()), 0) + output;
                progression_["metrics"]["generated"][type] = number(progression_["metrics"]["generated"].value(type, Json()), 0) + output;
            }
            for (const auto& type : ENERGY_TYPES) {
                const double demand = number(rates.value(type, Json()), 0) * seconds;
                const double draw = std::min(number(progression_["energyOverflow"].value(type, Json()), 0), std::max(0.0, demand - number(fresh.value(type, Json()), 0) - energy_available(type)));
                fresh[type] = number(fresh.value(type, Json()), 0) + draw;
                progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) - draw;
                escrow_draw[type] = draw;
            }
            auto allocate = [&](double use_seconds, Json& stored_out, Json& pool_out, double& loss_out, Json& energy_spent) -> bool {
                stored_out = progression_["energy"]; pool_out = fresh; loss_out = 0; energy_spent = zero_energy();
                Json released = zero_energy(); std::map<std::string, double> conversion_used;
                auto rated = [&](const std::string& component, const std::string& field) {
                    double sum = 0; for (const auto& a : progression_.value("assemblies", Json::array())) if (a.value("componentId", std::string()) == component) sum += number(entry(component).value(field, Json()), 0) * number(a.value("scale", Json()), 0) * std::min(number(a.value("health", Json()), 0), number(a.value("connected", Json()), 0)); return sum;
                };
                Json limits = {{"mechanical", rated("inertial_cell", "nominalPower") * step}, {"electrical", rated("battery", "nominalPower") * step},
                    {"thermal", 0.0}, {"chemical", 1e30}, {"magic", 1e30}, {"divine", (10.0 + rated("relic", "nominalPower")) * step}};
                std::function<double(const std::string&, double, std::set<std::string>)> draw_energy;
                draw_energy = [&](const std::string& type, double need, std::set<std::string> seen) -> double {
                    double got = 0;
                    const double from_pool = std::min(number(pool_out.value(type, Json()), 0), need); pool_out[type] = number(pool_out.value(type, Json()), 0) - from_pool; got += from_pool;
                    const double stored_draw = std::min(std::min(need - got, number(stored_out.value(type, Json()), 0)), std::max(0.0, number(limits.value(type, Json()), 0) - number(released.value(type, Json()), 0)));
                    stored_out[type] = number(stored_out.value(type, Json()), 0) - stored_draw; released[type] = number(released.value(type, Json()), 0) + stored_draw; got += stored_draw;
                    if (got + EPS >= need || seen.count(type)) return got;
                    seen.insert(type);
                    for (const auto& conv : conversion_catalog_) {
                        if (conv.value("output", std::string()) != type) continue;
                        const std::string component = conv.value("component", std::string()), input = conv.value("input", std::string());
                        bool has = false; for (const auto& a : progression_.value("assemblies", Json::array())) if (a.value("componentId", std::string()) == component && number(a.value("health", Json()), 0) > 0 && number(a.value("connected", Json()), 0) > 0 && a.value("accessible", true)) has = true;
                        if (!has || seen.count(input)) continue;
                        const double power = rated(component, "nominalPower") * step - conversion_used[conv.value("id", std::string())];
                        const double need_in = std::min(std::max(0.0, power), (need - got) / std::max(EPS, number(conv.value("efficiency", Json()), 1)));
                        if (need_in <= EPS) continue;
                        std::set<std::string> next_seen = seen; next_seen.insert(type);
                        const double used = draw_energy(input, need_in, next_seen);
                        conversion_used[conv.value("id", std::string())] += used;
                        const double eff = number(conv.value("efficiency", Json()), 1);
                        got += used * eff; loss_out += used * (1 - eff);
                        if (got + EPS >= need) break;
                    }
                    return got;
                };
                for (const auto& rate : rates.items()) {
                    const double need = number(rate.value()) * use_seconds;
                    const double got = draw_energy(rate.key(), need, {});
                    if (got + EPS < need) return false;
                    energy_spent[rate.key()] = need;
                }
                return true;
            };
            Json stored, pool, spent; double loss = 0;
            progressed = seconds;
            if (!allocate(seconds, stored, pool, loss, spent)) {
                double low = 0, high = seconds;
                allocate(0, stored, pool, loss, spent);
                for (int k = 0; k < 20; ++k) {
                    double mid = (low + high) / 2; Json trial_stored, trial_pool, trial_spent; double trial_loss = 0;
                    if (allocate(mid, trial_stored, trial_pool, trial_loss, trial_spent)) { low = mid; stored = trial_stored; pool = trial_pool; spent = trial_spent; loss = trial_loss; }
                    else high = mid;
                }
                progressed = low;
            }
            progression_["energy"] = stored;
            progression_["metrics"]["conversionLoss"] = number(progression_["metrics"].value("conversionLoss", Json()), 0) + loss;
            for (const auto& type : ENERGY_TYPES) {
                progression_["metrics"]["consumed"][type] = number(progression_["metrics"]["consumed"].value(type, Json()), 0) + number(spent.value(type, Json()), 0);
                const double refund = std::min(number(pool.value(type, Json()), 0), number(escrow_draw.value(type, Json()), 0));
                progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) + refund;
                pool[type] = number(pool.value(type, Json()), 0) - refund;
                Json stored_result = store_energy(type, number(pool.value(type, Json()), 0));
                progression_["metrics"]["dissipated"][type] = number(progression_["metrics"]["dissipated"].value(type, Json()), 0) + number(stored_result.value("remainder", Json()), 0);
            }
        }
        if (!job.is_null() && permitted) {
            const double new_progress = number(job.value("progress", Json()), 0) + progressed;
            const double total = job.value("type", std::string()) == "craft" ? number(recipe.value("seconds", Json()), 0) * number(job.value("count", Json()), 1) : number(entry(job.value("activityId", std::string())).value("secondsPerRepetition", Json()), 0);
            progression_["jobs"][0]["progress"] = new_progress;
            if (new_progress + EPS >= total) {
                finish_job(job);
                progression_["jobs"].erase(progression_["jobs"].begin());
            }
        }
        left -= step;
    }
}

Json Gameplay::command_inventory(const std::string& name, const Json& args) {
    if (name == "inventory.grant") return grant(args.value("items", Json::object()), args.value("claim", std::string()));
    if (name == "inventory.spend") return spend(args.value("items", Json::object()), args.value("claim", std::string()));
    if (name == "inventory.reclaim") {
        Json pending = progression_["overflow"]; progression_["overflow"] = Json::object();
        for (const auto& item : pending.items()) put_items(item.key(), number(item.value()));
        return success_fields({{"remaining", progression_["overflow"]}});
    }
    return error_result("unknown_inventory_command");
}

Json Gameplay::command_survival(const std::string& name, const Json& args) {
    if (name == "survival.eat") {
        const std::string id = args.value("itemId", std::string("food")), claim = args.value("claim", std::string());
        const Json& rule = entry("calorie_baseline");
        if (id != "food") return error_result("not_food");
        Json paid = spend({{id, 1}}, claim); if (!paid.value("ok", false)) return paid;
        const double max_calories = number(player_.value("maxCalories", Json()), number(rule.value("capacity", Json()), 2400));
        player_["calories"] = std::min(max_calories, number(player_.value("calories", Json()), 0) + number(rule.value("foodCalories", Json()), 400));
        return success_fields({{"calories", player_["calories"]}});
    }
    if (name == "survival.rest") {
        const bool resting = args.value("resting", !player_.value("resting", false));
        player_["resting"] = resting;
        return success_fields({{"resting", resting}});
    }
    return error_result("unknown_survival_command");
}

Json Gameplay::command_progression(const std::string& name, const Json& args) {
    if (name == "progression.status") return success_fields({{"progression", progression_status()}});
    if (name == "progression.list") {
        const std::string kind = args.value("kind", std::string()), query = args.value("query", std::string());
        const int offset = std::max(0, args.value("offset", 0)), limit = std::clamp(args.value("limit", 100), 1, 200);
        Json rows = Json::array(); int skipped = 0;
        for (auto row : list(kind)) {
            if (!query.empty()) {
                const std::string id = row.value("id", std::string()), display = row.value("name", std::string());
                if (id.find(query) == std::string::npos && display.find(query) == std::string::npos) continue;
            }
            if (skipped++ < offset) continue;
            if (int(rows.size()) >= limit) break;
            const std::string id = row.value("id", std::string()), row_kind = row.value("kind", std::string());
            if (row_kind == "recipe") row["available"] = recipe_status(id);
            else if (row_kind == "research") { row["available"] = research_status(id); row["known"] = array_has(progression_.value("research", Json::array()), id); }
            else if (row_kind == "item" || row_kind == "material" || row_kind == "tool" || row_kind == "station" || row_kind == "component" || row_kind == "gear_baseline") row["owned"] = count(id);
            rows.push_back(std::move(row));
        }
        return success_fields({{"kind", kind}, {"query", query}, {"offset", offset}, {"limit", limit}, {"rows", rows}, {"total", list(kind).size()}});
    }
    if (name == "progression.recipe_status") return recipe_status(args.value("id", std::string()));
    if (name == "progression.research_status") return research_status(args.value("id", std::string()));
    if (name == "craft.queue") return queue_craft(args.value("recipeId", std::string()), args.value("count", 1), args.value("autoInstall", false), args.value("fixtureId", std::string()));
    if (name == "craft.cancel") {
        const std::string job_id = args.value("jobId", std::string()), claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_claim(claim)) return success_fields({{"duplicate", true}});
        Json& jobs = progression_["jobs"];
        auto it = std::find_if(jobs.begin(), jobs.end(), [&](const Json& j) { return j.value("id", std::string()) == job_id; });
        if (it == jobs.end()) return error_result("job_not_found");
        if (it->value("type", std::string()) != "craft") return error_result("job_not_cancellable");
        const Json& recipe = entry(it->value("recipeId", std::string())); Json refund = recipe.value("inputs", Json::object());
        for (auto& item : refund.items()) item.value() = number(item.value()) * number(it->value("count", Json()), 1);
        jobs.erase(it); for (const auto& item : refund.items()) put_items(item.key(), number(item.value())); add_claim(claim);
        return success_fields({{"jobId", job_id}, {"refund", refund}});
    }
    if (name == "craft.prioritize") {
        const std::string id = args.value("jobId", std::string()); Json& jobs = progression_["jobs"];
        auto it = std::find_if(jobs.begin(), jobs.end(), [&](const Json& j) { return j.value("id", std::string()) == id; });
        if (it == jobs.end()) return error_result("job_not_found");
        const auto index = std::distance(jobs.begin(), it);
        if (index > 0) { Json job = *it; jobs.erase(it); jobs.insert(jobs.begin(), job); }
        return success_fields({{"jobId", id}});
    }
    if (name == "research.start") return start_research(args.value("id", std::string()));
    if (name == "research.pause") { progression_["researchJob"] = nullptr; return success_fields(); }
    if (name == "research.discover") return discover_blueprint(args.value("blueprintId", std::string()), args.value("origin", std::string("crafted")), args.value("claim", std::string()));
    if (name == "resource.harvest") return harvest(args.value("sourceId", std::string()), args);
    if (name == "equipment.equip") {
        const std::string id = args.value("id", std::string());
        if (entry(id).value("kind", std::string()) != "gear_baseline" || count(id) < 1) return error_result("gear_required");
        progression_["equipped"] = id;
        return success_fields({{"loadout", {{"id", id}, {"tier", entry(id).value("tier", 0)}, {"maxHp", entry(id).value("hp", 100)}, {"damageReduction", entry(id).value("damageReduction", 0)}, {"incomingDamageMultiplier", entry(id).value("incomingDamageMultiplier", 1)}, {"sustainedDps", entry(id).value("sustainedDps", 4)}, {"hitDamage", entry(id).value("hitDamage", 4)}, {"attackPeriod", entry(id).value("attackPeriod", 1)}}}});
    }
    if (name == "tools.wear") {
        const std::string id = args.value("id", std::string()), claim = args.value("claim", std::string());
        const Json& tool = entry(id); const int max = int(number(tool.value("durabilityActions", Json()), 0));
        const int actions = args.value("actions", 1);
        if (tool.value("kind", std::string()) != "tool" || max <= 0 || count(id) < 1 || actions < 1 || actions > 1000 || !valid_claim(claim)) return error_result("invalid_tool_wear");
        const std::string receipt = "tool-wear:" + claim; if (has_claim(receipt)) return success_fields({{"duplicate", true}});
        Json& wear = progression_["toolWear"];
        int current = int(number(wear.value(id, Json()), max));
        for (int i = 0; i < actions; ++i) {
            if (current == 0 && count(id) >= 2) { take_items({{id, 1}}); current = max; }
            current = std::max(0, current - 1);
        }
        wear[id] = current; add_claim(receipt);
        return success_fields({{"id", id}, {"wear", current}, {"maxWear", max}});
    }
    if (name == "stations.build") {
        const std::string id = args.value("id", std::string()); const Json& s = entry(id);
        if (s.value("kind", std::string()) != "station") return error_result("unknown_station");
        if (progression_["fixtureEnergy"].value("enabled", false)) return error_result("world_placement_required");
        const std::string recipe = s.value("origin", Json::object()).value("recipe", std::string());
        return queue_craft(recipe, 1, true);
    }
    if (name == "stations.install") {
        if (progression_["fixtureEnergy"].value("enabled", false)) return error_result("world_placement_required");
        const std::string id = args.value("id", std::string());
        if (entry(id).value("kind", std::string()) != "station" || count(id) < 1) return error_result("station_item_required");
        take_items({{id, 1}}); progression_["stations"][id] = number(progression_["stations"].value(id, Json()), 0) + 1;
        return success_fields({{"id", id}});
    }
    if (name == "components.place") return place_component(args.value("id", std::string()), args);
    if (name == "components.status") return component_status(args.value("id", std::string()));
    if (name == "components.condition") return component_condition(args.value("instanceId", std::string()), args);
    if (name == "materials.evaluate") return material_status(args.value("id", std::string()), args);
    if (name == "activities.start") {
        const std::string id = args.value("id", std::string()), community_id = args.value("communityId", std::string()), request_id = args.value("requestId", std::string());
        const Json& activity = entry(id);
        if (!request_id.empty() && !valid_claim(request_id)) return error_result("invalid_request");
        if (!request_id.empty() && progression_["activityRequests"].contains(request_id)) {
            const Json& old = progression_["activityRequests"][request_id];
            if (old.value("activityId", std::string()) == id && old.value("communityId", std::string()) == community_id) return success_fields({{"jobId", old.value("jobId", Json())}, {"duplicate", true}});
            return error_result("request_conflict");
        }
        if (activity.value("kind", std::string()) != "activity" || !valid_claim(community_id)) return error_result("community_required");
        if (progression_["jobs"].size() >= 64 || !has_items(activity.value("inputs", Json::object()))) return error_result("activity_inputs_required");
        take_items(activity.value("inputs", Json::object()));
        const int next = int(number(progression_.value("nextId", Json()), 1)); const std::string job_id = "activity:" + std::to_string(next);
        Json job = {{"id", job_id}, {"type", "activity"}, {"activityId", id}, {"communityId", community_id}, {"progress", 0.0}};
        progression_["jobs"].push_back(job); progression_["nextId"] = next + 1;
        if (!request_id.empty()) progression_["activityRequests"][request_id] = {{"jobId", job_id}, {"activityId", id}, {"communityId", community_id}};
        return success_fields({{"jobId", job_id}});
    }
    if (name == "rewards.grant") return grant_reward(args.value("reward", Json::object()), args.value("claim", std::string()));
    return error_result("unknown_progression_command");
}

Json Gameplay::command_energy(const std::string& name, const Json& args) {
    if (name == "source.active") {
        if (progression_["fixtureEnergy"].value("enabled", false)) return error_result("fixed_source_owner_required");
        const std::string id = args.value("id", args.value("sourceId", std::string()));
        const Json& source = entry(id);
        if (source.value("kind", std::string()) != "energy_source" || source.contains("activity") || !args.contains("active") || !args["active"].is_boolean()) return error_result("invalid_source");
        if (args["active"].get<bool>()) {
            const std::string required = json_string(source.value("requiredComponent", Json()));
            if (!required.empty() && number(component_status(required).value("active", Json()),0) <= 0) return error_result("component_required");
        }
        progression_["activeSources"][id] = args["active"];
        return success_fields({{"id", id}, {"active", args["active"]}});
    }
    if (name == "energy.source" && !args.contains("ownerId") && !progression_["fixtureEnergy"].value("enabled", false))
        return command_energy("source.active", args);
    if (name.rfind("energy.link", 0) == 0 || name == "energy.unlink" || name == "energy.source" || name == "energy.refuel" ||
        name == "energy.fluid.set" || name == "energy.fluid.fill" || name == "energy.charge" || name == "energy.drain") return fixture_command(name, args);
    if (name == "energy.status") return success_fields({{"energy", progression_.value("energy", zero_energy())}, {"capacity", {{"mechanical", energy_capacity("mechanical")}, {"electrical", energy_capacity("electrical")}, {"thermal", energy_capacity("thermal")}, {"chemical", energy_capacity("chemical")}, {"magic", energy_capacity("magic")}, {"divine", energy_capacity("divine")}}}, {"overflow", progression_.value("energyOverflow", zero_energy())}, {"fixtures", fixture_energy_status()}});
    if (name == "energy.supply") {
        const std::string type = args.value("type", std::string()), claim = args.value("claim", std::string());
        const double amount = number(args.value("amount", Json()), -1);
        if (!is_energy_type(type) || !nonnegative(amount) || !valid_claim(claim)) return error_result("invalid_energy_supply");
        if (has_claim(claim)) return success_fields({{"duplicate", true}});
        progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) + amount;
        add_claim(claim);
        const double room = std::max(0.0, energy_capacity(type) - energy_available(type));
        const double accepted = std::min(room, number(progression_["energyOverflow"].value(type, Json()), 0));
        progression_["energy"][type] = energy_available(type) + accepted;
        progression_["energyOverflow"][type] = number(progression_["energyOverflow"].value(type, Json()), 0) - accepted;
        return success_fields({{"accepted", amount}, {"pending", progression_["energyOverflow"][type]}, {"duplicate", false}});
    }
    if (name == "energy.store") return store_energy(args.value("type", std::string()), number(args.value("amount", Json()), -1));
    if (name == "energy.consume") return transaction(Json::object(), {{args.value("type", std::string()), args.value("amount", Json())}}, args.value("claim", std::string()));
    if (name == "energy.transfer") {
        // A same-world transfer must use a physical cable. The old cross-world
        // progression transfer API has no second endpoint in a native session.
        return error_result("physical_link_required");
    }
    if (name == "mana.status") {
        Json mana = progression_.value("personalMana", Json::object());
        mana["capacityEU"] = energy_capacity("magic"); mana["activeEU"] = energy_available("magic");
        mana["cupAccessible"] = progression_.value("personalManaVessel", Json()).is_string() && progression_["personalManaVessel"] == "bark_cup" && count("bark_cup") > 0;
        mana["rules"] = {{"investedCapacityMax", 700}, {"totalCapacityMax", 1000}, {"minimumMaterialTier", 5}, {"minimumManaCoupling", .6}, {"capacityPerTierCouplingLiter", 20}, {"focusCapacityPerTierAboveFour", 50}, {"cupCapacityEU", 100}};
        return success_fields({{"mana", mana}});
    }
    if (name == "mana.invest.quote" || name == "mana.invest") {
        const std::string material_id = args.value("materialId", std::string()); const Json& m = entry(material_id); const int liters = args.value("liters", 1);
        const double coupling = number(m.value("properties", Json::object()).value("manaCoupling", Json()), 0);
        if (m.value("kind", std::string()) != "material" || number(m.value("tier", Json()), 0) < 5 || coupling < .6 || liters < 1 || liters > 10) return error_result("invalid_mana_material");
        const int each = int(std::floor(20.0 * number(m.value("tier", Json()), 0) * coupling));
        const double invested = number(progression_["personalMana"].value("investedCapacity", Json()), 0);
        const double gain = std::min(double(each * liters), 700.0 - invested);
        if (gain <= 0) return error_result("mana_capacity_cap");
        Json quote = success_fields({{"items", {{material_id, liters}}}, {"capacityGain", gain}, {"gainPerLiter", each}, {"maxInvestedCapacity", 700}});
        if (name == "mana.invest.quote") return quote;
        const std::string claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_claim("mana-invest:" + claim)) return success_fields({{"duplicate", true}});
        if (!progression_["fixtureEnergy"].value("enabled", false) || !array_has(progression_.value("research", Json::array()), "mana")) return error_result("mana_research_required");
        Json paid = spend({{material_id, liters}}, "mana-invest:" + claim); if (!paid.value("ok", false)) return paid;
        Json& mana = progression_["personalMana"]; mana["investedCapacity"] = invested + gain;
        mana["investments"][material_id] = number(mana["investments"].value(material_id, Json()), 0) + liters;
        // Reconciliation preserves any over-capacity mana in reserve.
        const double cap = energy_capacity("magic"), excess = std::max(0.0, energy_available("magic") - cap);
        if (excess > 0) { progression_["energy"]["magic"] = energy_available("magic") - excess; mana["reserveEU"] = number(mana.value("reserveEU", Json()), 0) + excess; }
        return success_fields({{"capacityGain", gain}, {"capacityEU", energy_capacity("magic")}, {"manaAddedEU", 0}});
    }
    if (name == "mana.focus") {
        const std::string id = args.value("id", std::string()); const Json& g = entry(id);
        if (!progression_["fixtureEnergy"].value("enabled", false) || !array_has(progression_.value("research", Json::array()), "mana") || g.value("kind", std::string()) != "gear_baseline" || number(g.value("tier", Json()), 0) < 5 || count(id) < 1) return error_result("mana_focus_required");
        progression_["personalMana"]["focusId"] = id; return success_fields({{"capacityEU", energy_capacity("magic")}, {"manaAddedEU", 0}});
    }
    if (name == "mana.unfocus") {
        progression_["personalMana"]["focusId"] = nullptr;
        return success_fields({{"capacityEU", energy_capacity("magic")}, {"preservedEU", number(progression_["personalMana"].value("reserveEU", Json()), 0)}});
    }
    if (name == "mana.use_cup") {
        if (!array_has(progression_.value("research", Json::array()), "mana") || count("bark_cup") < 1) return error_result("personal_mana_container_required");
        progression_["personalManaVessel"] = "bark_cup"; return success_fields({{"externalCupCapacityEU", 100}, {"bodyCapacityEU", energy_capacity("magic")}});
    }
    if (name == "mana.fill_cup" || name == "mana.absorb_cup" || name == "mana.fill_personal") {
        const std::string claim = args.value("claim", std::string()); if (!valid_claim(claim)) return error_result("claim_required");
        const double amount = number(args.value(name == "mana.absorb_cup" ? "amount" : "liters", Json()), -1);
        if (!positive(amount)) return error_result("invalid_mana_amount");
        Json& mana = progression_["personalMana"];
        if (name == "mana.fill_cup") {
            if (progression_.value("personalManaVessel", Json()) != "bark_cup" || count("bark_cup") < 1 || number(mana.value("cupEU", Json()), 0) + amount * 100 > 100 + EPS) return error_result("personal_mana_container_required");
            Json paid = spend({{"liquid_mana", amount}}, "mana-cup:" + claim); if (!paid.value("ok", false)) return paid;
            mana["cupEU"] = number(mana.value("cupEU", Json()), 0) + amount * 100; return success_fields({{"storedCupEU", amount * 100}});
        }
        if (name == "mana.absorb_cup") {
            if (progression_.value("personalManaVessel", Json()) != "bark_cup" || count("bark_cup") < 1 || number(mana.value("cupEU", Json()), 0) + EPS < amount || energy_available("magic") + amount > energy_capacity("magic") + EPS) return error_result("mana_capacity_or_cup");
            if (has_claim("mana-absorb:" + claim)) return success_fields({{"duplicate", true}});
            mana["cupEU"] = number(mana.value("cupEU", Json()), 0) - amount; progression_["energy"]["magic"] = energy_available("magic") + amount; add_claim("mana-absorb:" + claim);
            return success_fields({{"absorbedEU", amount}});
        }
        if (!progression_["fixtureEnergy"].value("enabled", false) || !array_has(progression_.value("research", Json::array()), "mana") || energy_available("magic") + amount * 100 > energy_capacity("magic") + EPS) return error_result("mana_capacity_required");
        Json paid = spend({{"liquid_mana", amount}}, "personal-mana:" + claim); if (!paid.value("ok", false)) return paid;
        progression_["energy"]["magic"] = energy_available("magic") + amount * 100;
        return success_fields({{"storedEU", amount * 100}, {"capacityEU", energy_capacity("magic")}});
    }
    return error_result("unknown_energy_command");
}

Json Gameplay::community_status() const {
    return {{"communities", community_.value("communities", Json::array())}, {"residents", community_.value("residents", Json::array())},
            {"activeRepair", community_.value("activeRepair", Json(nullptr))}, {"receipts", community_.value("receipts", Json::array())}};
}

Json Gameplay::command_community(const std::string& name, const Json& args) {
    Json& communities = community_["communities"];
    Json& residents = community_["residents"];
    auto find_community = [&](const std::string& id) -> Json* { for (auto& c : communities) if (c.value("id", std::string()) == id) return &c; return nullptr; };
    auto find_resident = [&](const std::string& id) -> Json* { for (auto& e : residents) if (e.value("id", std::string()) == id) return &e; return nullptr; };
    auto receipt = [&](const std::string& key) -> Json {
        for (const auto& row : community_.value("receipts", Json::array())) if (row.is_array() && row.size() == 2 && row[0].is_string() && row[0].get<std::string>() == key) return row[1];
        return Json();
    };
    auto save_receipt = [&](const std::string& key, const Json& result) {
        Json& rows = community_["receipts"];
        for (auto& row : rows) if (row.is_array() && row.size() == 2 && row[0].is_string() && row[0].get<std::string>() == key) { row[1] = result; return; }
        rows.push_back(Json::array({key, result}));
    };
    auto near = [&](const Json& p, double range, bool visible) {
        if (number(player_.value("hp", Json()), 0) <= 0 || !visible) return false;
        return distance3(player_, p) <= range + EPS;
    };
    if (name == "community.sync") {
        Json incoming_communities = args.value("communities", Json::array()), incoming_residents = args.value("residents", Json::array());
        if (!incoming_communities.is_array() || !incoming_residents.is_array()) return error_result("invalid_community_context");
        // Replace simulation facts while keeping Gameplay-owned contribution
        // progress, paid work IDs and receipts.
        for (const auto& raw : incoming_communities) {
            if (!raw.is_object() || !raw.contains("id") || !raw["id"].is_string()) return error_result("invalid_community_context");
            Json* old = find_community(raw.value("id", std::string()));
            Json merged = raw;
            if (old) for (const char* key : {"serial", "contributions", "activities", "serviceAnchors"}) if (old->contains(key) && !merged.contains(key)) merged[key] = (*old)[key];
            if (!old) communities.push_back(merged); else *old = merged;
        }
        Json clean = Json::array(); std::set<std::string> ids;
        for (const auto& raw : incoming_residents) {
            if (!raw.is_object() || !raw.contains("id") || !raw["id"].is_string() || !ids.insert(raw["id"].get<std::string>()).second) return error_result("invalid_community_context");
            Json merged=raw; Json* old=find_resident(raw.value("id",std::string()));
            if(old)for(const char* key:{"inventory","hp","calories","interactionSerial","repairProgress"})if(old->contains(key))merged[key]=(*old)[key];
            clean.push_back(merged);
        }
        residents = clean;
        return success_fields({{"communities", communities.size()}, {"residents", residents.size()}});
    }
    if (name == "community.status") return success_fields({{"community", community_status()}});

    const std::string target_id = args.value("targetId", std::string());
    Json* resident = find_resident(target_id); Json* community = resident ? find_community(resident->value("communityId", std::string())) : find_community(target_id);
    const bool visible = args.value("visible", true);
    if (name == "community.options") {
        Json options = Json::array();
        auto add = [&](const std::string& type, const std::string& label, const std::string& detail, Json cost, const std::string& reason, Json extra = Json::object()) {
            Json row = {{"id", type}, {"type", type}, {"targetId", target_id}, {"label", label}, {"detail", detail}, {"cost", cost}, {"disabled", !reason.empty()}, {"reason", reason.empty() ? Json(nullptr) : Json(reason)}};
            if (extra.is_object()) for (const auto& f : extra.items()) row[f.key()] = f.value();
            options.push_back(row);
        };
        if (resident) {
            if (!resident->value("civilian", resident->value("civilization", false)) || resident->value("dead", false)) return success_fields({{"options", options}});
            const bool organic = resident->value("organic", true);
            const Json offer = organic ? Json{{"food", 1}} : Json{{"scrap_iron", 1}};
            const Json receive = organic ? Json{{"wood", 2}} : Json{{"stone", 2}};
            bool stock = true; for (const auto& item : receive.items()) if (number(resident->value("inventory", Json::object()).value(item.key(), Json()), 0) + EPS < number(item.value())) stock = false;
            std::string blocked = !near(*resident, 3, visible) ? "out_of_range" : !resident->value("friendly", true) ? "hostile" : !stock ? "out_of_stock" : !has_items(offer) ? "items_required" : "";
            add("trade", organic ? "식량 1개를 목재 2개와 교환" : "잡철 1개를 돌 2개와 교환", "주민의 실제 재고에서 교환합니다.", offer, blocked, {{"receive", receive}});
            if (resident->contains("calories") && resident->contains("maxCalories")) {
                Json cost = {{"food", 1}}; std::string reason = !near(*resident, 3, visible) ? "out_of_range" : !resident->value("friendly", true) ? "hostile" : number(resident->value("calories", Json())) >= number(resident->value("maxCalories", Json())) ? "not_hungry" : !has_items(cost) ? "items_required" : "";
                add("feed", "음식 건네기", "음식 1개로 주민의 칼로리를 회복합니다.", cost, reason);
            }
            if (resident->contains("repair") && resident->value("repair", Json()).is_object()) {
                const Json spec = resident->value("repair", Json()); Json cost = {{spec.value("materialId", std::string()), number(spec.value("unitsPerAction", Json()), 0)}};
                bool repair_station = false;
                if (community) for (const auto& anchor : community->value("serviceAnchors", Json::array())) if (anchor.value("serviceId", std::string()) == "repair" && near(anchor.value("position", Json::object()), 3, visible) && distance3(*resident, anchor.value("position", Json::object())) <= 3) repair_station = true;
                std::string reason = !near(*resident, 3, visible) ? "out_of_range" : !resident->value("friendly", true) ? "hostile" : !repair_station ? "station_required" : number(resident->value("hp", Json())) >= number(resident->value("maxHp", Json())) ? "already_full" : community_.value("activeRepair", Json()).is_object() ? "repair_in_progress" : !has_items(cost) ? "items_required" : "";
                add("repair", "주민 수리", std::to_string(int(number(spec.value("durationS", Json()),0))) + "초 동안 정비소에서 수리합니다.", cost, reason, {{"progress", number(resident->value("repairProgress", Json()),0)/std::max(EPS,number(spec.value("durationS",Json()),1))}});
            }
        }
        if (community) for (const auto& anchor : community->value("serviceAnchors", Json::array())) {
            const std::string service = anchor.value("serviceId", std::string());
            const bool close = near(anchor.value("position", Json::object()), 3, visible);
            if (service == "rest") add("rest", player_.value("resting", false) ? "휴식 마치기" : "공동체에서 휴식", "보유 칼로리를 사용해 자연 회복합니다.", Json::object(), close ? "" : "out_of_range");
            else if (service == "contribution") {
                const Json& activity = entry("community_contribution"); const Json current_activities = community->value("activities", Json::array());
                const bool pending = std::any_of(current_activities.begin(), current_activities.end(), [](const Json& a) { return a.value("status", std::string()) == "pending"; });
                const Json cost = activity.value("inputs", Json::object());
                add("activity", activity.value("name", std::string("보급 계약")), "30초 계약. 반복 완료 시 신성 에너지를 얻습니다.", cost,
                    !close ? "out_of_range" : pending ? "activity_in_progress" : !has_items(cost) ? "items_required" : "", {{"activityId", "community_contribution"}});
            }
        }
        return success_fields({{"targetId", target_id}, {"options", options}});
    }
    if (name != "community.interact") return error_result("unknown_community_command");
    const std::string type = args.value("type", std::string()), request = args.value("requestId", std::string());
    if (!valid_claim(request)) return error_result("invalid_request");
    const std::string key = "request:" + request;
    Json previous = receipt(key); if (!previous.is_null()) { previous["duplicate"] = true; return previous; }
    if (!community && !resident) return error_result("unknown_target");
    Json result;
    if (type == "trade" || type == "feed") {
        if (!resident || resident->value("dead", false) || !resident->value("friendly", true) || !resident->value("civilian", resident->value("civilization", false))) return error_result("hostile");
        if (!near(*resident, 3, visible)) return error_result("out_of_range");
        Json cost, output = Json::object();
        if (type == "trade") {
            const bool organic = resident->value("organic", true); cost = organic ? Json{{"food",1}} : Json{{"scrap_iron",1}};
            output = organic ? Json{{"wood",2}} : Json{{"stone",2}};
            for (const auto& item : output.items()) if (number(resident->value("inventory",Json::object()).value(item.key(),Json()),0)+EPS<number(item.value())) return error_result("out_of_stock");
        } else {
            cost = {{"food",1}};
            if (!resident->contains("calories") || number(resident->value("calories",Json())) >= number(resident->value("maxCalories",Json()))) return error_result("not_hungry");
        }
        if (!has_items(cost)) return error_result("items_required");
        take_items(cost);
        if (type == "trade") {
            for (const auto& item : output.items()) {
                resident->operator[]("inventory")[item.key()] = number(resident->value("inventory", Json::object()).value(item.key(), Json()),0) - number(item.value());
                put_items(item.key(), number(item.value()));
            }
            (*resident)["interactionSerial"] = int(number(resident->value("interactionSerial",Json()),0))+1;
            result = success_fields({{"offer", resident->value("organic",true) ? "food_for_wood" : "iron_for_stone"}, {"receive",output}});
        } else {
            const Json& calorie = entry("calorie_baseline");
            (*resident)["calories"] = std::min(number(resident->value("maxCalories",Json()),0), number(resident->value("calories",Json()),0)+number(calorie.value("foodCalories",Json()),400));
            (*resident)["interactionSerial"] = int(number(resident->value("interactionSerial",Json()),0))+1;
            result = success_fields({{"calories",resident->value("calories",Json())}});
        }
    } else if (type == "rest") {
        if (!community) return error_result("out_of_range");
        bool close=false; for(const auto& anchor:community->value("serviceAnchors",Json::array())) if(anchor.value("serviceId",std::string())=="rest"&&(resident?(near(*resident,3,visible)&&resident->value("friendly",true)):near(anchor.value("position",Json::object()),3,visible))) close=true;
        if (!close) return error_result("out_of_range");
        player_["resting"] = !player_.value("resting",false); (*community)["serial"] = int(number(community->value("serial",Json()),0))+1;
        result = success_fields({{"resting",player_["resting"]}});
    } else if (type == "activity") {
        if (!community) return error_result("unknown_target");
        bool close=false; for (const auto& anchor : community->value("serviceAnchors",Json::array())) if (anchor.value("serviceId",std::string())=="contribution" && (resident?(near(*resident,3,visible)&&resident->value("friendly",true)):near(anchor.value("position",Json::object()),3,visible))) close=true;
        if (!close) return error_result("out_of_range");
        bool pending=false; for (const auto& a : community->value("activities",Json::array())) if (a.value("status",std::string())=="pending") pending=true;
        if (pending) return error_result("activity_in_progress");
        Json started = command_progression("activities.start", {{"id","community_contribution"},{"communityId",community->value("id",std::string())},{"requestId", "community:"+request}});
        if (!started.value("ok",false)) return started;
        if (!community->contains("activities") || !(*community)["activities"].is_array()) (*community)["activities"] = Json::array();
        (*community)["activities"].push_back({{"jobId",started.value("jobId",Json())},{"activityId","community_contribution"},{"status","pending"}});
        (*community)["serial"] = int(number(community->value("serial",Json()),0))+1;
        result = success_fields({{"jobId",started.value("jobId",Json())}});
    } else if (type == "repair") {
        if (!resident || !community || !resident->contains("repair")) return error_result("not_repairable");
        if (!near(*resident,3,visible) || !resident->value("friendly",true) || resident->value("dead",false)) return error_result("out_of_range");
        bool repair_station=false;for(const auto& anchor:community->value("serviceAnchors",Json::array()))if(anchor.value("serviceId",std::string())=="repair"&&near(anchor.value("position",Json::object()),3,visible)&&distance3(*resident,anchor.value("position",Json::object()))<=3.0+EPS)repair_station=true;
        if(!repair_station)return error_result("station_required");
        if(number(resident->value("hp",Json()),0)>=number(resident->value("maxHp",Json()),0))return error_result("already_full");
        if (community_.value("activeRepair",Json()).is_object()) return error_result("repair_in_progress");
        const Json spec = resident->value("repair",Json()); const std::string material = spec.value("materialId",std::string()); const double units = number(spec.value("unitsPerAction",Json()),0);
        if (!has_items({{material,units}})) return error_result("items_required");
        (*resident)["repairProgress"]=0.0;
        community_["activeRepair"] = {{"targetId",target_id},{"requestId",request},{"elapsed",0.0},{"durationS",number(spec.value("durationS",Json()),0)},{"cost",{{material,units}}},{"hpPerAction",number(spec.value("hpPerAction",Json()),0)}};
        result = success_fields({{"pending",true},{"targetId",target_id}});
    } else return error_result("unknown_action");
    save_receipt(key,result);
    return result;
}

Json Gameplay::faith_status(const std::string& instance_id) const {
    const Json& quests = faith_.value("quests", Json::object()); const Json& trials = faith_.value("trials", Json::object());
    Json rows = Json::array();
    struct Quest { const char* id; const char* name; const char* kind; int goal; int reward; };
    const Quest definitions[] = {{"provisions","유적 보급","delivery",1,10},{"records","새로운 기록의 흔적","discovery",2,15},{"guardian","수호자의 위협","boss",1,25}};
    for (const auto& d : definitions) {
        Json q = quests.value(d.id, Json::object());
        int progress = d.kind == std::string("delivery") ? (q.value("delivered", false) ? 1 : 0) : int(q.value("evidenceIds", Json::array()).size());
        rows.push_back({{"id",d.id},{"name",d.name},{"phase",q.value("status",std::string("available"))},{"progress",progress},{"goal",d.goal},{"rewardEU",d.reward}});
    }
    Json trial = trials.value(instance_id, Json::object());
    if (trial.empty()) trial = {{"phase","available"},{"elapsed",0.0},{"attunements",0},{"durationS",12.0},{"requiredAttunements",3},{"remainingAttunements",3},{"nextWindowS",Json::array({2,4})}};
    else {
        const int count = int(number(trial.value("attunements", Json()),0));
        trial["durationS"] = 12; trial["requiredAttunements"] = 3; trial["remainingAttunements"] = std::max(0,3-count);
        if (count < 3) { const std::array<std::array<int,2>,3> windows{{{{2,4}},{{6,8}},{{10,12}}}}; trial["nextWindowS"] = Json::array({windows[count][0],windows[count][1]}); }
        else trial["nextWindowS"] = nullptr;
    }
    return {{"faithId","unnamed_forgotten_deity"},{"name","잊힌 신"},{"member",!faith_.value("membership",Json()).is_null()},
        {"quests",rows},{"trial",trial},{"shrines",faith_.value("shrines",Json::array())}};
}

void Gameplay::refresh_faith_quests() {
    Json& quests=faith_["quests"];
    const Json events=campaign_.value("events",Json::array());
    struct Rule{const char* id;const char* kind;int goal;};
    const Rule rules[]={{"provisions","delivery",1},{"records","discovery",2},{"guardian","boss",1}};
    for(const auto& rule:rules){
        Json& q=quests[rule.id];if(q.is_null()||q.empty()||q.value("status",std::string())=="claimed"||rule.kind==std::string("delivery"))continue;
        Json evidence=q.value("evidenceIds",Json::array()),baseline=q.value("baselineIds",Json::array());
        if(!evidence.is_array())evidence=Json::array();
        for(const auto& event:events){
            const std::string type=event.value("type",std::string());
            const bool matches=(rule.kind==std::string("discovery")&&type=="dungeon_entered"&&(event.value("templateId",std::string())=="communal_archive"||event.value("templateId",std::string())=="forgotten_monastery"))||(rule.kind==std::string("boss")&&type=="boss_defeated");
            if(!matches)continue;
            const std::string id=event.value("eventId",event.value("id",event.value("ownerId",std::string())));
            if(!id.empty()&&!array_has(baseline,id)&&!array_has(evidence,id)&&int(evidence.size())<rule.goal)evidence.push_back(id);
        }
        q["evidenceIds"]=evidence;
        if(int(evidence.size())>=rule.goal)q["status"]="ready";
    }
}

Json Gameplay::command_faith(const std::string& name, const Json& args) {
    if(name=="faith.status"||name=="faith.options"||name=="faith.interact")refresh_faith_quests();
    Json& shrines = faith_["shrines"];
    auto shrine = [&](const std::string& id) -> Json* { for (auto& s : shrines) if (s.value("instanceId", std::string()) == id) return &s; return nullptr; };
    if (name == "faith.sync_shrines") {
        Json rows = args.value("shrines", Json::array()); if (!rows.is_array()) return error_result("invalid_shrine_list");
        std::set<std::string> ids; for (const auto& s : rows) {
            const std::string id = s.value("instanceId", std::string()), template_id = s.value("templateId", std::string());
            if (!valid_claim(id) || !ids.insert(id).second || (template_id != "communal_archive" && template_id != "forgotten_monastery")) return error_result("invalid_shrine_list");
            for (const char* axis : {"x","y","z"}) if (!finite_number(s.value("position",Json::object()).value(axis,Json()))) return error_result("invalid_shrine_list");
        }
        shrines = rows; return success_fields({{"shrines",shrines}});
    }
    const std::string instance_id = args.value("instanceId", std::string());
    if ((name == "faith.status" || name == "faith.options" || name == "faith.interact") && !shrine(instance_id)) {
        const std::string template_id = args.value("templateId", std::string());
        if ((template_id == "communal_archive" || template_id == "forgotten_monastery") && args.contains("position")) {
            shrines.push_back({{"instanceId",instance_id},{"templateId",template_id},{"position",args["position"]},{"anchorId",args.value("anchorId",std::string())}});
        }
    }
    Json* current_shrine = shrine(instance_id);
    if (name == "faith.status") return success_fields({{"status",faith_status(instance_id)}});
    if (name == "faith.options") {
        Json rows = Json::array(); if (!current_shrine) return success_fields({{"options",rows}});
        const bool near = number(player_.value("hp",Json()),0)>0 && distance3(player_,current_shrine->value("position",Json::object()))<=3.0+EPS && args.value("visible",true);
        auto add = [&](std::string id,std::string label,std::string detail,std::string reason={}) { rows.push_back({{"id",id},{"instanceId",instance_id},{"label",label},{"detail",detail},{"disabled",!reason.empty()},{"reason",reason.empty()?Json(nullptr):Json(reason)}}); };
        const bool member = !faith_.value("membership",Json()).is_null();
        add(member?"faith:leave":"faith:join",member?"신앙에서 물러나기":"잊힌 신의 신도 되기","선택 활동입니다.",near?"":"out_of_range");
        const Json status = faith_status(instance_id); const Json quest_rows=status.value("quests",Json::array());
        for (const auto& q : quest_rows) {
            const std::string id=q.value("id",std::string()),phase=q.value("phase",std::string());
            if (phase=="available") add("faith:accept:"+id,q.value("name",std::string())+" 수락","보상 신성 "+std::to_string(int(number(q.value("rewardEU",Json()),0)))+" EU",!near?"out_of_range":!member?"membership_required":"");
            else if (phase=="claimed") add("faith:claim:"+id,q.value("name",std::string())+" · 수령 완료","한 번만 수령","already_claimed");
            else if (phase=="ready") add("faith:claim:"+id,q.value("name",std::string())+" 보상 수령","목표 완료",!near?"out_of_range":!member?"membership_required":"");
            else if (id=="provisions") add("faith:deliver:"+id,"보급품 납품","식량 4 · 목재 2",!near?"out_of_range":!member?"membership_required":!has_items({{"food",4},{"wood",2}})?"items_required":"");
            else add("faith:claim:"+id,q.value("name",std::string())+" 진행 중","목표 진행");
        }
        Json trial=status.value("trial",Json::object()); const std::string phase=trial.value("phase",std::string("available"));
        if (phase=="available"||phase=="failed") add("faith:start_trial",phase=="failed"?"시련 재시도":"제단 시련 시작","식량 1 · 목재 1 · 12초 동안 세 번 조율",!near?"out_of_range":std::any_of(faith_["trials"].begin(),faith_["trials"].end(),[](const auto& t){return t.value("phase",std::string())=="active";})?"trial_in_progress":!has_items({{"food",1},{"wood",1}})?"items_required":"");
        else if (phase=="active") {
            Json window=trial.value("nextWindowS",Json()); const double elapsed=number(trial.value("elapsed",Json()),0); const bool ready=window.is_array()&&elapsed+EPS>=number(window.at(0))&&elapsed<=number(window.at(1))+EPS;
            add("faith:attune","제단 조율","12초 동안 2~4 / 6~8 / 10~12초에 조율",!near?"out_of_range":!ready?"outside_attunement_window":"");
            add("faith:cancel_trial","시련 중단","지불한 보급품은 돌려받지 않습니다.",!near?"out_of_range":"");
        } else if (phase=="ready") add("faith:claim_trial","시련 보상 수령","신성 15 EU",!near?"out_of_range":"");
        else add("faith:claim_trial","시련 보상 수령 완료","이 제단의 시련은 완료했습니다.","already_claimed");
        return success_fields({{"options",rows}});
    }
    if (name != "faith.interact") return error_result("unknown_faith_command");
    if (!current_shrine) return error_result("shrine_missing");
    const bool near = number(player_.value("hp",Json()),0)>0 && distance3(player_,current_shrine->value("position",Json::object()))<=3.0+EPS && args.value("visible",true);
    if (number(player_.value("hp",Json()),0)<=0) return error_result("dead");
    if (!near) return error_result(args.value("visible",true)?"out_of_range":"occluded");
    const std::string action=args.value("actionId",args.value("id",std::string()));
    auto parts = std::vector<std::string>(); std::stringstream ss(action); std::string part; while(std::getline(ss,part,':'))parts.push_back(part);
    if(parts.size()<2||parts[0]!="faith"||parts.size()>3)return error_result("invalid_faith_action");
    const std::string type=parts[1],quest_id=parts.size()>2?parts[2]:std::string();
    struct Quest { const char* id; const char* kind; int goal; int reward; Json inputs; };
    const std::vector<Quest> defs={{"provisions","delivery",1,10,{{"food",4},{"wood",2}}},{"records","discovery",2,15,Json::object()},{"guardian","boss",1,25,Json::object()}};
    auto def=std::find_if(defs.begin(),defs.end(),[&](const Quest& q){return q.id==quest_id;});
    if(type=="join"&&quest_id.empty()) { if(!faith_.value("membership",Json()).is_null())return success_fields({{"duplicate",true}});faith_["membership"]={{"deityId","unnamed_forgotten_deity"},{"joinedAt",number(faith_.value("clock",Json()),0)},{"shrineId",instance_id}};return success_fields({{"joined",true}}); }
    if(type=="leave"&&quest_id.empty()){faith_["membership"]=nullptr;return success_fields({{"left",true}});}
    if(type=="accept"||type=="deliver"||type=="claim"){
        if(def==defs.end())return error_result("unknown_quest");if(faith_.value("membership",Json()).is_null())return error_result("membership_required");
        Json& q=faith_["quests"][quest_id];
        if(type=="accept"){
            if(!q.is_null()&&!q.empty())return success_fields({{"duplicate",true}});
            Json baseline=Json::array(); const Json ev=campaign_.value("events",Json::array());for(const auto&e:ev){const std::string typ=e.value("type",std::string());if((std::string(def->kind)=="discovery"&&typ=="dungeon_entered"&&(e.value("templateId",std::string())=="communal_archive"||e.value("templateId",std::string())=="forgotten_monastery"))||(std::string(def->kind)=="boss"&&typ=="boss_defeated"))array_add(baseline,e.value("id",e.value("ownerId",std::string())));}
            q={{"status","active"},{"acceptedAt",number(faith_.value("clock",Json()),0)},{"baselineIds",baseline},{"evidenceIds",Json::array()},{"delivered",false}};return success_fields({{"accepted",quest_id}});
        }
        if(q.is_null()||q.empty())return error_result("quest_not_accepted");
        if(type=="deliver"){
            if(def->kind!=std::string("delivery"))return error_result("not_delivery_quest");if(q.value("delivered",false))return success_fields({{"duplicate",true}});
            Json paid=transaction(def->inputs,Json::object(),"faith:v1:delivery:"+quest_id);if(!paid.value("ok",false))return paid;q["delivered"]=true;q["status"]="ready";return success_fields({{"delivered",quest_id}});
        }
        if(q.value("status",std::string())=="claimed")return success_fields({{"duplicate",true}});if(q.value("status",std::string())!="ready")return error_result("objective_incomplete");
        Json reward=grant_reward({{"guaranteed",Json::object()},{"divineEnergy",def->reward}},"faith:v1:quest:"+quest_id);if(!reward.value("ok",false))return reward;q["status"]="claimed";return success_fields({{"questId",quest_id},{"reward",reward}});
    }
    if(!quest_id.empty())return error_result("invalid_faith_action");
    Json& trials=faith_["trials"];Json& t=trials[instance_id];
    if(type=="start_trial"){
        if(!t.is_null()&&t.value("phase",std::string())!="failed")return t.value("phase",std::string())=="active"?success_fields({{"duplicate",true}}):error_result("trial_already_completed");
        for(const auto& active:trials.items())if(active.value().value("phase",std::string())=="active")return error_result("trial_in_progress");
        const int attempt=int(number(t.value("attempt",Json()),0))+1;Json paid=transaction({{"food",1},{"wood",1}},Json::object(),"faith:v1:trial:"+instance_id+":attempt:"+std::to_string(attempt));if(!paid.value("ok",false))return paid;
        t={{"attempt",attempt},{"phase","active"},{"elapsed",0.0},{"attunements",0},{"lastHp",number(player_.value("hp",Json()),0)},{"damageAt",player_.value("lastDamageAt",Json(-100))},{"failReason",nullptr}};
        return success_fields({{"started",true},{"attempt",attempt}});
    }
    if(type=="attune"){
        if(t.value("phase",std::string())!="active")return error_result("trial_not_active");const int count=int(number(t.value("attunements",Json()),0));const std::array<std::array<double,2>,3>w{{{{2,4}},{{6,8}},{{10,12}}}};if(count>=3||number(t.value("elapsed",Json()),0)<w[count][0]||number(t.value("elapsed",Json()),0)>w[count][1])return error_result("outside_attunement_window");t["attunements"]=count+1;return success_fields({{"attunements",count+1},{"phase",t.value("phase",Json())}});
    }
    if(type=="cancel_trial") {if(t.value("phase",std::string())!="active")return error_result("trial_not_active");t["phase"]="failed";t["failReason"]="cancelled";return success_fields({{"cancelled",true}});}
    if(type=="claim_trial"){
        if(t.value("phase",std::string())=="claimed")return success_fields({{"duplicate",true}});if(t.value("phase",std::string())!="ready")return error_result("trial_incomplete");
        Json reward=grant_reward({{"guaranteed",Json::object()},{"divineEnergy",15}},"faith:v1:trial:"+instance_id+":reward");if(!reward.value("ok",false))return reward;t["phase"]="claimed";return success_fields({{"reward",reward}});
    }
    return error_result("invalid_faith_action");
}

Json Gameplay::campaign_status() const {
    Json records=campaign_.value("records",Json::object());
    Json result={{"cores",campaign_.value("cores",0)},{"workCredits",progression_.value("workCredits",0.0)},
        {"events",campaign_.value("events",Json::array())},{"records",records},{"journey",campaign_.value("journey",Json::object())}};
    if(campaign_.contains("firstSignal"))result["firstSignal"]=campaign_["firstSignal"];
    return result;
}

Json Gameplay::armament_quote(const std::string& pattern_id, const std::string& material_id) const {
    const Json& pattern = entry(pattern_id);
    const Json& material = entry(material_id);
    const std::set<std::string> allowed = {"weapon_slash", "weapon_pierce", "weapon_blunt"};
    if (pattern.value("kind", std::string()) != "weapon_pattern" || !allowed.count(pattern_id) || material.value("kind", std::string()) != "material")
        return error_result("unknown_armament");
    const std::string recipe_id = json_string(material.value("origin", Json::object()).value("recipe", Json()));
    const Json& recipe = entry(recipe_id);
    if (recipe.value("kind", std::string()) != "recipe") return error_result("unsupported_material");
    const double volume = number(pattern.value("materialVolumeLiters", Json()), -1);
    const double density = number(material.value("properties", Json::object()).value("densityKgM3", Json()), -1);
    const std::string weapon_kind = pattern.value("weaponKind", std::string());
    const std::string baseline_id = "gear_baseline_t" + std::to_string(int(number(material.value("tier", Json()), 0)));
    const Json& baseline = entry(baseline_id);
    const double period = number(pattern.value("attackPeriodS", Json()), -1);
    const double damage_factor = number(pattern.value("damageFactor", Json()), -1);
    const double hit_damage = number(baseline.value("stationaryDps", Json()), -1) * period * damage_factor;
    const double durability = std::floor(number(material.value("properties", Json::object()).value("cellHp", Json()), -1) * volume * number(pattern.value("durabilityPerCellHpLiter", Json()), -1));
    auto mass_per_item = [&](const std::string& id) {
        const Json& item = entry(id);
        const double material_density = number(item.value("properties", Json::object()).value("densityKgM3", Json()), -1);
        if (material_density >= 0) return material_density / 1000.0;
        return number(item.value("massKgPerUnit", Json()), 0.0);
    };
    double mass = density * volume / 1000.0;
    Json inputs = {{material_id, volume}};
    Json additional = pattern.value("additionalInputs", Json::object());
    if (!additional.is_object()) return error_result("unsupported_material");
    for (const auto& pair : additional.items()) {
        if (!finite_number(pair.value()) || !nonnegative(number(pair.value())) || entry(pair.key()).empty()) return error_result("unsupported_material");
        inputs[pair.key()] = number(inputs.value(pair.key(), Json()), 0.0) + number(pair.value());
        mass += mass_per_item(pair.key()) * number(pair.value());
    }
    if (!positive(volume) || !positive(density) || !positive(hit_damage) || !positive(durability) || !positive(mass)) return error_result("unsupported_material");
    Json energy = Json::object();
    const double energy_fraction = number(pattern.value("materialRecipeEnergyFraction", Json()), 0.0);
    const Json recipe_energy = recipe.value("energy", Json::object());
    for (const auto& pair : recipe_energy.items()) energy[pair.key()] = number(pair.value()) * energy_fraction;
    const std::string research = json_string(recipe.value("research", Json()));
    const std::string station = json_string(recipe.value("station", Json()));
    const double seconds = std::max(number(pattern.value("baseCraftSeconds", Json()), 0.0), number(recipe.value("seconds", Json()), 0.0) * number(pattern.value("materialRecipeTimeFraction", Json()), 0.0));
    std::string blocked;
    if (pattern.value("materialResearchRequired", false) && !research.empty() && !array_has(progression_.value("research", Json::array()), research)) blocked = "research_required";
    else if (pattern.value("materialRecipeStationRequired", false) && !station.empty() && !station_available(station)) blocked = "station_required";
    else if (!has_items(inputs)) blocked = "ingredients_required";
    else if (!has_energy(energy)) blocked = "insufficient_resources";
    const Json weapons = armaments_.value("weapons", Json::array());
    const int capacity = armaments_.value("equippedId", Json()).is_null() ? 8 : 9;
    if (blocked.empty() && weapons.size() >= capacity) blocked = "rack_full";
    if (blocked.empty() && !armaments_.value("jobs", Json::array()).empty()) blocked = "workbench_busy";
    Json out = {{"ok", blocked.empty()}, {"id", pattern_id}, {"patternId", pattern_id}, {"kind", weapon_kind}, {"weaponKind", weapon_kind},
        {"shapeId", pattern.value("shapeId", pattern_id)}, {"name", material.value("name", material_id) + " " + (weapon_kind == "slash" ? "베기 무기" : weapon_kind == "pierce" ? "관통 무기" : "둔기")},
        {"materialId", material_id}, {"materialTier", material.value("tier", Json(0))}, {"materialVolumeLiters", volume},
        {"massKg", mass}, {"maxDurability", int(durability)}, {"hitDamage", hit_damage}, {"range", number(pattern.value("rangeM", Json()), 0)},
        {"attackPeriod", period}, {"attackMode", pattern.value("attackMode", std::string())}, {"station", station.empty() ? Json(nullptr) : Json(station)},
        {"research", research.empty() ? Json(nullptr) : Json(research)}, {"originRecipeId", recipe_id}, {"inputs", inputs}, {"energy", energy}, {"seconds", seconds}};
    if (!blocked.empty()) { out["reason"] = blocked; out["message"] = reason_message(blocked); }
    return out;
}

Json Gameplay::command_armaments(const std::string& name, const Json& args) {
    Json& weapons = armaments_["weapons"];
    Json& jobs = armaments_["jobs"];
    auto find_weapon = [&](const std::string& id) -> Json* { for (auto& w : weapons) if (w.value("id", std::string()) == id) return &w; return nullptr; };
    if (name == "weapon.status" || name == "weapon.list") {
        return success_fields({{"armaments", armaments_}, {"patterns", list("weapon_pattern")}, {"carriedLimit", 8}, {"equippedLimit", 9}});
    }
    if (name == "weapon.patterns") return success_fields({{"patterns", list("weapon_pattern")}});
    if (name == "weapon.quote") return armament_quote(args.value("patternId", std::string()), args.value("materialId", std::string()));
    if (name == "weapon.forge") {
        const Json quote = armament_quote(args.value("patternId", std::string()), args.value("materialId", std::string()));
        if (!quote.value("ok", false)) return error_result(quote.value("reason", std::string("invalid_armament")));
        const int serial = int(number(armaments_.value("nextId", Json()), 1));
        const std::string output_id = "armament:" + std::to_string(serial), job_id = "armament-job:" + std::to_string(serial);
        const std::string claim = "armament-craft:" + output_id;
        if (has_claim(claim)) {
            for (const auto& job : jobs) if (job.value("outputId", std::string()) == output_id) return success_fields({{"duplicate", true}, {"jobId", job_id}, {"outputId", output_id}});
            for (const auto& weapon : weapons) if (weapon.value("id", std::string()) == output_id) return success_fields({{"duplicate", true}, {"outputId", output_id}});
            return error_result("claim_conflict");
        }
        Json paid = transaction(quote["inputs"], quote["energy"], claim);
        if (!paid.value("ok", false)) return paid;
        armaments_["nextId"] = serial + 1;
        jobs.push_back({{"id", job_id}, {"outputId", output_id}, {"patternId", quote["patternId"]}, {"materialId", quote["materialId"]},
            {"materialTier", quote["materialTier"]}, {"station", quote["station"]}, {"research", quote["research"]}, {"originRecipeId", quote["originRecipeId"]},
            {"inputs", quote["inputs"]}, {"energy", quote["energy"]}, {"name", quote["name"]}, {"shapeId", quote["shapeId"]},
            {"weaponKind", quote["weaponKind"]}, {"materialVolumeLiters", quote["materialVolumeLiters"]}, {"massKg", quote["massKg"]},
            {"maxDurability", quote["maxDurability"]}, {"hitDamage", quote["hitDamage"]}, {"range", quote["range"]},
            {"attackPeriod", quote["attackPeriod"]}, {"attackMode", quote["attackMode"]}, {"seconds", quote["seconds"]}, {"progress", 0.0}, {"ready", false}});
        return success_fields({{"jobId", job_id}, {"outputId", output_id}, {"seconds", quote["seconds"]}, {"inputs", quote["inputs"]}, {"energy", quote["energy"]}});
    }
    if (name == "weapon.equip") {
        const Json requested = args.value("id", Json(nullptr));
        if (!requested.is_null() && !requested.is_string()) return error_result("unknown_weapon");
        const std::string id = requested.is_string() ? requested.get<std::string>() : std::string();
        const Json old = armaments_.value("equippedId", Json(nullptr));
        if ((id.empty() && old.is_null()) || (!id.empty() && old == id)) return success_fields({{"equippedId", old}, {"duplicate", true}});
        if (id.empty()) {
            if (!old.is_null() && int(weapons.size()) - 1 >= 8) return error_result("rack_full");
            armaments_["equippedId"] = nullptr;
            return success_fields({{"equippedId", nullptr}});
        }
        if (!find_weapon(id)) return error_result("unknown_weapon");
        armaments_["equippedId"] = id;
        return success_fields({{"equippedId", id}});
    }
    if (name == "weapon.attack") {
        const std::string claim = args.value("claim", std::string());
        const double distance = number(args.value("distanceM", Json()), -1.0), at = number(args.value("at", Json(armaments_.value("clock", Json(0.0)))), -1.0);
        if (!claim.empty()) {
            if (!valid_claim(claim)) return error_result("invalid_claim");
            for (const auto& receipt : armaments_.value("attackClaims", Json::array())) if (receipt.value("claimId", std::string()) == claim) {
                const std::string signature = receipt.value("weaponId", std::string()) + ":" + std::to_string(distance);
                if (receipt.value("signature", std::string()) != signature) return error_result("claim_conflict");
                Json result = receipt.value("result", Json::object()); result["ok"] = true; result["duplicate"] = true; return result;
            }
        }
        const std::string equipped_id = json_string(armaments_.value("equippedId", Json()));
        Json* weapon = find_weapon(equipped_id);
        if (!weapon) return error_result("weapon_not_equipped");
        if (!nonnegative(distance) || distance > number(weapon->value("range", Json()), 0) + EPS) return error_result("out_of_range");
        if (!nonnegative(at)) return error_result("invalid_attack_time");
        if (number(weapon->value("durability", Json()), 0) <= 0) return error_result("weapon_broken");
        if (at + EPS < number(weapon->value("nextAttackAt", Json()), 0)) return error_result("attack_cooldown");
        (*weapon)["durability"] = std::max(0, int(number(weapon->value("durability", Json()), 0)) - 1);
        (*weapon)["nextAttackAt"] = at + number(weapon->value("attackPeriod", Json()), 0);
        Json result = {{"ok", true}, {"id", equipped_id}, {"instanceId", equipped_id}, {"shapeId", weapon->value("shapeId", Json())},
            {"weaponKind", weapon->value("weaponKind", Json())}, {"hitDamage", weapon->value("hitDamage", Json())}, {"damage", weapon->value("hitDamage", Json())},
            {"range", weapon->value("range", Json())}, {"attackPeriod", weapon->value("attackPeriod", Json())}, {"attackMode", weapon->value("attackMode", Json())},
            {"durability", weapon->value("durability", Json())}, {"currentDurability", weapon->value("durability", Json())}, {"maxDurability", weapon->value("maxDurability", Json())}};
        if (!claim.empty()) {
            const std::string signature = equipped_id + ":" + std::to_string(distance);
            armaments_["attackClaims"].push_back({{"claimId", claim}, {"weaponId", equipped_id}, {"signature", signature}, {"result", result}});
            while (armaments_["attackClaims"].size() > 1024) armaments_["attackClaims"].erase(armaments_["attackClaims"].begin());
        }
        return result;
    }
    if (name == "weapon.repair") {
        const std::string claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        if (has_claim("weapon-repair:" + claim)) return success_fields({{"duplicate", true}});
        const int amount = args.value("amount", 60);
        if (amount < 1 || amount > 1000000) return error_result("invalid_repair_amount");
        std::vector<Json*> targets;
        const std::string target_id = args.value("id", std::string());
        for (auto& weapon : weapons) if ((target_id.empty() || weapon.value("id", std::string()) == target_id) && number(weapon.value("durability", Json()), 0) < number(weapon.value("maxDurability", Json()), 0)) targets.push_back(&weapon);
        if (!target_id.empty() && !find_weapon(target_id)) return error_result("unknown_weapon");
        if (targets.empty()) return error_result("nothing_to_repair");
        Json paid = transaction({{"scrap_iron", 1}, {"raw_timber", 1}}, Json::object(), "weapon-repair:" + claim);
        if (!paid.value("ok", false)) return paid;
        Json repaired = Json::array();
        for (Json* weapon : targets) { (*weapon)["durability"] = std::min(int(number(weapon->value("maxDurability", Json()), 0)), int(number(weapon->value("durability", Json()), 0)) + amount); repaired.push_back({{"id", weapon->value("id", Json())}, {"durability", weapon->value("durability", Json())}, {"maxDurability", weapon->value("maxDurability", Json())}}); }
        add_claim("weapon-repair:" + claim);
        return success_fields({{"repaired", repaired}, {"amount", amount}});
    }
    if (name == "weapon.salvage") {
        const std::string id = args.value("id", std::string()), claim = args.value("claim", std::string());
        if (!valid_claim(claim)) return error_result("claim_required");
        const std::string receipt = "weapon-salvage:" + claim;
        if (has_claim(receipt)) return success_fields({{"duplicate", true}});
        Json* weapon = find_weapon(id); if (!weapon) return error_result("unknown_weapon");
        const Json& pattern = entry(weapon->value("shapeId", std::string()));
        Json items = {{weapon->value("materialId", std::string()), 0.0}};
        items[weapon->value("materialId", std::string())] = number(weapon->value("materialVolumeLiters", Json()), 0) * .5 * number(weapon->value("durability", Json()), 0) / std::max(1.0, number(weapon->value("maxDurability", Json()), 1));
                const Json additional_inputs = pattern.value("additionalInputs", Json::object());
                for (const auto& pair : additional_inputs.items()) items[pair.key()] = number(pair.value()) * .5 * number(weapon->value("durability", Json()), 0) / std::max(1.0, number(weapon->value("maxDurability", Json()), 1));
        for (auto it = items.begin(); it != items.end();) { if (number(it.value()) <= EPS) it = items.erase(it); else { it.value() = std::floor(number(it.value()) * 1000.0 + EPS) / 1000.0; ++it; } }
        if (!valid_items(items)) return error_result("invalid_weapon_record");
        for (const auto& pair : items.items()) put_items(pair.key(), number(pair.value()));
        add_claim(receipt);
        weapons.erase(std::remove_if(weapons.begin(), weapons.end(), [&](const Json& row) { return row.value("id", std::string()) == id; }), weapons.end());
        if (armaments_.value("equippedId", Json()) == id) armaments_["equippedId"] = nullptr;
        return success_fields({{"id", id}, {"items", items}});
    }
    return error_result("unknown_weapon_command");
}

void Gameplay::tick_armaments(double dt) {
    if (!finite_number(dt) || dt < 0) return;
    armaments_["clock"] = number(armaments_.value("clock", Json()), 0) + dt;
    Json& jobs = armaments_["jobs"];
    if (jobs.empty()) return;
    Json& job = jobs[0];
    if (job.value("ready", false)) {
        const int limit = armaments_.value("equippedId", Json()).is_null() ? 8 : 9;
        if (int(armaments_["weapons"].size()) < limit) {
            Json weapon = {{"id", job.value("outputId", Json())}, {"name", job.value("name", Json())}, {"weaponKind", job.value("weaponKind", Json())},
                {"shapeId", job.value("shapeId", Json())}, {"materialId", job.value("materialId", Json())}, {"materialTier", job.value("materialTier", Json())},
                {"materialVolumeLiters", job.value("materialVolumeLiters", Json())}, {"massKg", job.value("massKg", Json())}, {"durability", job.value("maxDurability", Json())},
                {"maxDurability", job.value("maxDurability", Json())}, {"hitDamage", job.value("hitDamage", Json())}, {"range", job.value("range", Json())},
                {"attackPeriod", job.value("attackPeriod", Json())}, {"attackMode", job.value("attackMode", Json())}, {"nextAttackAt", 0.0}, {"createdAt", armaments_["clock"]}};
            armaments_["weapons"].push_back(weapon); jobs.erase(jobs.begin());
        }
        return;
    }
    const Json& recipe = entry(job.value("originRecipeId", std::string()));
    const std::string research = json_string(recipe.value("research", Json())), station = json_string(recipe.value("station", Json()));
    if (recipe.empty() || (!research.empty() && !array_has(progression_.value("research", Json::array()), research)) || (!station.empty() && !station_available(station))) return;
    const double total = number(job.value("seconds", Json()), 0);
    job["progress"] = std::min(total, number(job.value("progress", Json()), 0) + dt);
    if (number(job["progress"]) + EPS < total) return;
    job["progress"] = total;
    const int limit = armaments_.value("equippedId", Json()).is_null() ? 8 : 9;
    if (int(armaments_["weapons"].size()) >= limit) { job["ready"] = true; return; }
    Json weapon = {{"id", job.value("outputId", Json())}, {"name", job.value("name", Json())}, {"weaponKind", job.value("weaponKind", Json())},
        {"shapeId", job.value("shapeId", Json())}, {"materialId", job.value("materialId", Json())}, {"materialTier", job.value("materialTier", Json())},
        {"materialVolumeLiters", job.value("materialVolumeLiters", Json())}, {"massKg", job.value("massKg", Json())}, {"durability", job.value("maxDurability", Json())},
        {"maxDurability", job.value("maxDurability", Json())}, {"hitDamage", job.value("hitDamage", Json())}, {"range", job.value("range", Json())},
        {"attackPeriod", job.value("attackPeriod", Json())}, {"attackMode", job.value("attackMode", Json())}, {"nextAttackAt", 0.0}, {"createdAt", armaments_["clock"]}};
    armaments_["weapons"].push_back(weapon); jobs.erase(jobs.begin());
}

Json Gameplay::command_campaign(const std::string& name, const Json& args) {
    if (name == "campaign.status" || name == "campaign.records") return success_fields({{"campaign",campaign_status()}});
    if (name == "campaign.record") return record_event(args.value("event",args));
    if (name == "campaign.claim_record") {
        const std::string claim=args.value("claim",std::string());
        return grant_resources(args.value("items",Json::object()),args.value("energy",Json::object()),number(args.value("workCredits",Json()),0),claim);
    }
    if (name == "campaign.pay") return error_result("use_simulation_pay");
    return error_result("unknown_campaign_command");
}

Json Gameplay::set_player_state(Json player) {
    if(!player.is_object())return error_result("invalid_player_state");
    static const std::set<std::string> numeric={"x","y","z","yaw","pitch","hp","maxHp","calories","maxCalories","lastDamageAt","vy","time"};
    for(const auto& key:numeric)if(player.contains(key)&&!finite_number(player[key]))return error_result("invalid_player_state");
    if(!player_.is_object())player_=Json::object();
    if(player.contains("position")){
        if(!player["position"].is_object())return error_result("invalid_player_state");
        for(const char* axis:{"x","y","z"})if(!finite_number(player["position"].value(axis,Json())))return error_result("invalid_player_state");
    }
    for(auto it=player.begin();it!=player.end();++it){
        if(it.key()=="hp"&&player_.value("respawnPending",false)&&!player.value("alive",false))continue;
        player_[it.key()]=it.value();
    }
    if(player.contains("position"))for(const char* axis:{"x","y","z"})player_[axis]=player["position"][axis];
    if(player.contains("survival")&&player["survival"].is_boolean())player_["survival"]=player["survival"];
    return success_fields({{"player",player_}});
}

const Json& Gameplay::player_state() const { return player_; }
const Json& Gameplay::fixtures() const { return placements_.contains("fixtures") && placements_["fixtures"].is_array() ? placements_["fixtures"] : empty_object(); }
Json Gameplay::dynamic_fixtures() const {
    Json rows = Json::array();
    for (const auto& fixture : fixtures()) {
        const Json motion = fixture.value("motion", Json::object());
        if (motion.value("mode", std::string("fixed")) != "dynamic") continue;
        const std::string asset_id = fixture.value("assetId", std::string());
        const Json& asset = entry(asset_id);
        const Json& recipe = entry(json_string(asset.value("origin", Json::object()).value("recipe", Json())));
        const Json recipe_inputs = recipe.value("inputs", Json::object());
        double mass = 0;
        for (const auto& item : recipe_inputs.items()) {
            const Json& source = entry(item.key());
            const double density = number(source.value("properties", Json::object()).value("densityKgM3", Json()), 0);
            const double unit_mass = density > 0 ? density / 1000.0 : number(source.value("massKgPerUnit", Json()), 0);
            if (!positive(unit_mass) || !nonnegative(number(item.value(), -1))) throw std::logic_error("Dynamic fixture material mass is not authored");
            mass += number(item.value()) * unit_mass;
        }
        Json geometry = asset_geometry(asset_id);
        double volume = 0;
        for (const auto& box : geometry) {
            const Vec3 size = box.at("size").get<Vec3>();
            volume += std::abs(size.x * size.y * size.z);
        }
        if (!positive(mass) || !positive(volume)) throw std::logic_error("Dynamic fixture geometry or mass is invalid");
        Json boxes = Json::array();
        for (auto box : geometry) {
            const Vec3 size = box.at("size").get<Vec3>();
            box["massKg"] = mass * std::abs(size.x * size.y * size.z) / volume;
            boxes.push_back(std::move(box));
        }
        rows.push_back({{"id", fixture.value("id", Json())}, {"assetId", asset_id},
            {"position", fixture.value("position", Json::object())},
            {"rotation", motion.value("rotation", Json::object({{"x",0.0},{"y",0.0},{"z",0.0},{"w",1.0}}))},
            {"velocity", motion.value("velocity", Json::object({{"x",0.0},{"y",0.0},{"z",0.0}}))},
            {"angularVelocity", motion.value("angularVelocity", Json::object({{"x",0.0},{"y",0.0},{"z",0.0}}))},
            {"settled", motion.value("settled", false)}, {"massKg", mass}, {"hp", fixture.value("hp", Json())},
            {"maxHp", fixture.value("maxHp", Json())}, {"boxes", boxes}});
    }
    return rows;
}
Json Gameplay::sync_fixture_body(const std::string& id, Json pose) {
    auto& rows = placements_["fixtures"];
    auto fixture = std::find_if(rows.begin(), rows.end(), [&](const Json& row) { return row.value("id", std::string()) == id; });
    if (fixture == rows.end()) return error_result("unknown_fixture");
    Json motion = fixture->value("motion", Json::object());
    if (motion.value("mode", std::string("fixed")) != "dynamic") return error_result("not_dynamic_fixture");
    if (!pose.is_object()) return error_result("invalid_fixture_pose");
    Json position = pose.value("position", Json::object());
    if (position.is_array() && position.size() >= 3) position = {{"x", position[0]}, {"y", position[1]}, {"z", position[2]}};
    if (!position.is_object()) return error_result("invalid_fixture_pose");
    for (const char* axis : {"x", "y", "z"}) if (!finite_number(position.value(axis, Json())) || std::abs(number(position.value(axis, Json()))) > 1e9) return error_result("invalid_fixture_pose");
    Json rotation = pose.value("rotation", motion.value("rotation", Json::object({{"x",0.0},{"y",0.0},{"z",0.0},{"w",1.0}})));
    if (!rotation.is_object()) return error_result("invalid_fixture_pose");
    for (const char* axis : {"x", "y", "z", "w"}) if (!finite_number(rotation.value(axis, Json()))) return error_result("invalid_fixture_pose");
    const double qnorm = std::sqrt(std::pow(number(rotation["x"]), 2) + std::pow(number(rotation["y"]), 2) + std::pow(number(rotation["z"]), 2) + std::pow(number(rotation["w"]), 2));
    if (std::abs(qnorm - 1.0) > 1e-5) return error_result("invalid_fixture_pose");
    for (const char* field : {"velocity", "angularVelocity"}) if (pose.contains(field)) {
        Json vector = pose[field];
        if (vector.is_array() && vector.size() >= 3) vector = {{"x", vector[0]}, {"y", vector[1]}, {"z", vector[2]}};
        if (!vector.is_object()) return error_result("invalid_fixture_pose");
        for (const char* axis : {"x", "y", "z"}) if (!finite_number(vector.value(axis, Json())) || std::abs(number(vector.value(axis, Json()))) > 1e9) return error_result("invalid_fixture_pose");
        motion[field] = vector;
    }
    if (pose.contains("settled") && !pose["settled"].is_boolean()) return error_result("invalid_fixture_pose");
    motion["rotation"] = rotation;
    motion["settled"] = pose.value("settled", motion.value("settled", false));
    (*fixture)["position"] = position;
    (*fixture)["motion"] = motion;
    // Pose feedback is frequent and must not invalidate geometry or rebuild
    // render/collision meshes. The owner reads position/motion directly.
    return success_fields({{"id", id}, {"position", position}, {"motion", motion}, {"revision", fixture->value("revision", Json(0))}});
}
uint64_t Gameplay::placement_revision() const { return uint64_t(std::max(0.0, number(placements_.value("revision", Json()), 0.0))); }
uint64_t Gameplay::placement_geometry_revision() const { return uint64_t(std::max(0.0, number(placements_.value("geometryRevision", Json()), 0.0))); }
Json Gameplay::held_attack() const {
    const std::string id=json_string(armaments_.value("equippedId",Json()));
    for(const auto& weapon:armaments_.value("weapons",Json::array()))if(weapon.value("id",std::string())==id){
        const std::string kind=weapon.value("weaponKind",std::string());
        const std::string profile=kind=="slash"?"sword":kind=="pierce"?"spear":kind=="blunt"?"hammer":"pick";
        return {{"assetId",weapon.value("shapeId",Json())},{"profileId",profile},{"damage",weapon.value("hitDamage",Json())},
            {"cooldown",weapon.value("attackPeriod",Json())},{"durability",weapon.value("durability",Json())},
            {"maxDurability",weapon.value("maxDurability",Json())},{"instanceId",id},{"range",weapon.value("range",Json())},
            {"weaponKind",kind},{"attackMode",weapon.value("attackMode",Json())}};
    }
    const std::string gear_id=json_string(progression_.value("equipped",Json()));
    const Json& gear=entry(gear_id);
    return {{"assetId",gear_id.empty()?Json(nullptr):Json(gear_id)},{"profileId","pick"},
        {"damage",gear.value("hitDamage",Json(4.0))},{"cooldown",gear.value("attackPeriod",Json(1.0))},
        {"durability",nullptr},{"maxDurability",nullptr},{"instanceId",nullptr},
        {"range",4.0},{"weaponKind",nullptr},{"attackMode","strike"}};
}
Json Gameplay::drain_events() { Json out=events_;events_=Json::array();return out; }

Json Gameplay::record_event(Json event) {
    if(!event.is_object()||!event.contains("type")||!event["type"].is_string())return error_result("invalid_simulation_event");
    const std::string type=event.value("type",std::string());
    if(type=="player_damage"){
        const double amount=number(event.value("amount",Json()),-1);
        if(!positive(amount))return error_result("invalid_damage");
        if(!player_.value("survival",config_.value("rules",Json::object()).value("survival",false)))return success_fields({{"ignored",true},{"hp",player_.value("hp",Json(100))}});
        const double before=number(player_.value("hp",Json()),100);
        player_["hp"]=std::max(0.0,before-amount);player_["lastDamageAt"]=number(player_.value("clock",Json()),0);player_["resting"]=false;
        Json hit={{"type","player_hit"},{"amount",amount},{"source",event.value("source",Json(nullptr))},{"hp",player_["hp"]}};events_.push_back(hit);
        if(number(player_["hp"])<=0&&!player_.value("respawnPending",false)){
            const Json rules=config_.value("rules",Json::object());const bool drop=player_.value("dropOnDeath",rules.value("dropOnDeath",true));
            if(drop){
                Json items=progression_.value("inventory",Json::object());
                const Json overflow = progression_.value("overflow",Json::object());
                for(const auto& pair:overflow.items())items[pair.key()]=number(items.value(pair.key(),Json()),0)+number(pair.value());
                const int death_id=int(number(player_.value("deathCounter",Json()),0))+1;player_["deathCounter"]=death_id;
                Json pos={{"x",player_.value("x",Json(0.0))},{"y",player_.value("y",Json(0.0))},{"z",player_.value("z",Json(0.0))}};
                Json dropped_weapons=armaments_.value("weapons",Json::array());
                for(const auto& w:event.value("weapons",Json::array()))dropped_weapons.push_back(w);
                deaths_.push_back({{"id","death:"+std::to_string(death_id)},{"position",pos},{"items",items},{"weapons",dropped_weapons},{"recovered",false},{"recoveryAttempt",0}});
                progression_["inventory"]=Json::object();progression_["overflow"]=Json::object();progression_["equipped"]=nullptr;
                armaments_["weapons"]=Json::array();armaments_["equippedId"]=nullptr;
            }
            player_["respawnPending"]=true;events_.push_back({{"type","player_died"},{"drop",drop},{"position",{{"x",player_.value("x",Json(0.0))},{"y",player_.value("y",Json(0.0))},{"z",player_.value("z",Json(0.0))}}}});
        }
        while(events_.size()>64)events_.erase(events_.begin());
        return success_fields({{"hp",player_["hp"]},{"maxHp",player_.value("maxHp",Json(100))},{"dead",player_.value("respawnPending",false)}});
    }
    const std::string id=event.value("eventId",event.value("id",event.value("ownerId",std::string())));
    if(!valid_claim(id))return error_result("event_id_required");
    const std::string claim="simulation-event:"+type+":"+id;
    Json& claims=campaign_["claims"];
    if(array_has(claims,claim))return success_fields({{"duplicate",true},{"eventId",id}});
    array_add(claims,claim);
    Json& rows=campaign_["events"];if(!rows.is_array())rows=Json::array();
    event["eventId"]=id;rows.push_back(event);
    Json& records=campaign_["records"];if(!records.is_object())records=Json::object();
    const std::string fact_id=event.value("speciesId",event.value("bossId",event.value("templateId",event.value("regionId",id))));
    if(type=="creature_observed")array_add(records["observedCreatures"],fact_id);
    else if(type=="creature_killed")array_add(records["killedCreatures"],id);
    else if(type=="boss_defeated")array_add(records["defeatedBosses"],id);
    else if(type=="dungeon_entered")array_add(records["discoveredDungeons"],id);
    else if(type=="signal_relay"){
        const std::string region=event.value("regionId",std::string("unknown"));if(!records.contains("signalRelays")||!records["signalRelays"].is_object())records["signalRelays"]=Json::object();array_add(records["signalRelays"][region],id);
    }else if(type=="signal_core")array_add(records["signalCores"],id);
    else if(type=="field_harvest")array_add(records["fieldHarvests"],id);
    else if(type=="community_contribution_completed")array_add(records["communityContributions"],id);
    refresh_faith_quests();
    events_.push_back(event);while(events_.size()>64)events_.erase(events_.begin());
    return success_fields({{"duplicate",false},{"eventId",id},{"recorded",type}});
}

void Gameplay::tick(double dt) {
    if(!finite_number(dt)||dt<0||dt>3600)return;
    tick_progression(dt);
    tick_armaments(dt);
    const double now=number(player_.value("clock",Json()),0)+dt;player_["clock"]=now;
    campaign_["clock"]=number(campaign_.value("clock",Json()),0)+dt;
    faith_["clock"]=number(faith_.value("clock",Json()),0)+dt;
    const Json& calorie=entry("calorie_baseline");
    const Json& equipped=entry(json_string(progression_.value("equipped",Json())));
    const bool owns=equipped.value("kind",std::string())=="gear_baseline"&&count(equipped.value("id",std::string()))>=1;
    const double max_hp=owns?number(equipped.value("hp",Json()),100):100;
    const double max_calories=number(calorie.value("capacity",Json()),2400);
    player_["maxHp"]=max_hp;player_["maxCalories"]=max_calories;
    player_["hp"]=std::min(max_hp,number(player_.value("hp",Json()),max_hp));
    player_["calories"]=std::clamp(number(player_.value("calories",Json()),max_calories),0.0,max_calories);
    const bool survival=player_.value("survival",config_.value("rules",Json::object()).value("survival",false));
    if(!survival){player_["calories"]=max_calories;player_["hp"]=max_hp;}
    else {
        const double drain=number(player_.value("moving",false)?calorie.value("activeDrainPerSecond",Json()):calorie.value("idleDrainPerSecond",Json()),0);
        player_["calories"]=std::max(0.0,number(player_["calories"])-dt*drain);
        if(number(player_["hp"])<max_hp&&number(player_["calories"])>0&&(player_.value("resting",false)||now-number(player_.value("lastDamageAt",Json(-100)), -100)>=number(calorie.value("noHitDelaySeconds",Json()),10))){
            const double heal=std::min({max_hp-number(player_["hp"]),dt*number(calorie.value("hpRegenPerSecond",Json()),1.5)*(player_.value("resting",false)?number(calorie.value("restMultiplier",Json()),2):1),number(player_["calories"])/std::max(EPS,number(calorie.value("caloriesPerHp",Json()),3))});
            player_["hp"]=number(player_["hp"])+heal;player_["calories"]=number(player_["calories"])-heal*number(calorie.value("caloriesPerHp",Json()),3);
        }
    }
    // Faith trials are real timed state machines. Any damage, death, leaving
    // the shrine radius or missing a required window fails the current attempt.
    for(auto& pair:faith_["trials"].items()){
        Json& t=pair.value();if(t.value("phase",std::string())!="active")continue;
        Json* s=nullptr;for(auto& candidate:faith_["shrines"])if(candidate.value("instanceId",std::string())==pair.key())s=&candidate;
        std::string fail_reason;
        if(number(player_.value("hp",Json()),0)<=0)fail_reason="dead";
        else if(!s)fail_reason="shrine_missing";
        else if(distance3(player_,s->value("position",Json::object()))>3.0+EPS)fail_reason="out_of_range";
        if(fail_reason.empty()&&(number(player_.value("hp",Json()),0)<number(t.value("lastHp",Json()),0)||player_.value("lastDamageAt",Json())!=t.value("damageAt",Json())))fail_reason="damaged";
        t["lastHp"]=std::max(0.0,number(player_.value("hp",Json()),0));
        const double next=number(t.value("elapsed",Json()),0)+dt;const int attuned=int(number(t.value("attunements",Json()),0));
        if(fail_reason.empty()&&attuned<3){const std::array<std::array<double,2>,3>w{{{{2,4}},{{6,8}},{{10,12}}}};if(next>w[attuned][1]+EPS)fail_reason="missed_window";}
        if(!fail_reason.empty()){t["phase"]="failed";t["failReason"]=fail_reason;continue;}
        t["elapsed"]=std::min(12.0,next);if(number(t["elapsed"])+EPS>=12&&attuned==3){t["elapsed"]=12;t["phase"]="ready";}
    }
    // Paid contribution work completes through the shared progression queue.
    for(auto& community:community_["communities"])if(community.contains("activities")&&community["activities"].is_array())for(auto& activity:community["activities"])if(activity.value("status",std::string())=="pending"){
        const std::string job_id=activity.value("jobId",std::string());
        if(has_claim("complete:"+job_id)){activity["status"]="completed";community["contributions"]=int(number(community.value("contributions",Json()),0))+1;record_event({{"type","community_contribution_completed"},{"id",job_id},{"communityId",community.value("id",Json())},{"jobId",job_id},{"contributions",community["contributions"]}});}
        else {bool exists=false;for(const auto& job:progression_.value("jobs",Json::array()))if(job.value("id",std::string())==job_id)exists=true;if(!exists)activity["status"]="cancelled";}
    }
    Json& repair=community_["activeRepair"];
    if(repair.is_object()){
        Json* target=nullptr;for(auto& e:community_["residents"])if(e.value("id",std::string())==repair.value("targetId",std::string()))target=&e;
        bool at_station=false;
        if(target){for(const auto& c:community_["communities"])if(c.value("id",std::string())==target->value("communityId",std::string()))for(const auto& anchor:c.value("serviceAnchors",Json::array()))if(anchor.value("serviceId",std::string())=="repair"&&distance3(player_,anchor.value("position",Json::object()))<=3.0+EPS&&distance3(*target,anchor.value("position",Json::object()))<=3.0+EPS)at_station=true;}
        if(!target||target->value("dead",false)||!target->value("friendly",true)||distance3(player_,target->value("position",Json::object()))>3.0+EPS||!at_station){events_.push_back({{"type","community_repair_paused"},{"targetId",repair.value("targetId",Json())}});for(auto& receipt:community_["receipts"])if(receipt.is_array()&&receipt.size()==2&&receipt[0]==("request:"+repair.value("requestId",std::string())))receipt[1]=nullptr;if(target)(*target)["repairProgress"]=0.0;repair=nullptr;}
        else {
            repair["elapsed"]=number(repair.value("elapsed",Json()),0)+dt;
            (*target)["repairProgress"]=repair["elapsed"];
            if(number(repair.value("elapsed",Json()),0)+EPS>=number(repair.value("durationS",Json()),0)){
                const std::string req=repair.value("requestId",std::string());Json paid=transaction(repair.value("cost",Json::object()),Json::object(),"community-repair:"+req);
                Json result;
                if(paid.value("ok",false)){const double restored=std::min(number(target->value("maxHp",Json()),0)-number(target->value("hp",Json()),0),number(repair.value("hpPerAction",Json()),0));(*target)["hp"]=number(target->value("hp",Json()),0)+std::max(0.0,restored);result=success_fields({{"targetId",target->value("id",Json())},{"restored",restored}});events_.push_back({{"type","community_repair_finished"},{"targetId",target->value("id",Json())},{"ok",true},{"restored",restored}});}
                else{result=paid;events_.push_back({{"type","community_repair_finished"},{"targetId",target->value("id",Json())},{"ok",false},{"reason",paid.value("reason",Json("items_required"))}});}
                (*target)["repairProgress"]=0.0;for(auto& receipt:community_["receipts"])if(receipt.is_array()&&receipt.size()==2&&receipt[0]==("request:"+req))receipt[1]=result;
                repair=nullptr;
            }
        }
    }
    // Each death cache is an independent, partially recoverable record. Its
    // remaining contents stay in the world until a later visit or reload.
    for(auto& death:deaths_)if(!death.value("recovered",false)&&!player_.value("respawnPending",false)&&number(player_.value("hp",Json()),0)>0&&distance3(player_,death.value("position",Json::object()))<=10.0+EPS){
        Json pending=death.value("items",Json::object()),virtual_inventory=progression_.value("inventory",Json::object()),items=Json::object();
        double slots=0;for(const auto& q:virtual_inventory.items())slots+=std::ceil(std::max(0.0,number(q.value())/64.0));
        for(const auto& pair:pending.items()){
            const double held=number(virtual_inventory.value(pair.key(),Json()),0),held_slots=std::ceil(std::max(0.0,held/64.0));
            const double capacity=std::max(0.0,(INVENTORY_SLOTS-slots+held_slots)*ITEM_STACK-held);const double take=std::min(number(pair.value()),capacity);
            if(take>EPS){items[pair.key()]=take;virtual_inventory[pair.key()]=held+take;slots+=std::ceil((held+take)/64.0)-held_slots;}
        }
        if(!items.empty()){
            const int attempt=int(number(death.value("recoveryAttempt",Json()),0))+1;Json restored=grant(items,death.value("id",std::string())+":recover:"+std::to_string(attempt));
            if(restored.value("ok",false)){for(const auto& pair:items.items()){death["items"][pair.key()]=std::max(0.0,number(death["items"].value(pair.key(),Json()),0)-number(pair.value()));if(number(death["items"][pair.key()])<EPS)death["items"].erase(pair.key());}death["recoveryAttempt"]=attempt;}
        }
        Json remaining=Json::array();
        const int weapon_limit=armaments_.value("equippedId",Json()).is_null()?8:9;
        for(const auto& candidate:death.value("weapons",Json::array())){
            bool duplicate=false;for(const auto& current:armaments_.value("weapons",Json::array()))if(current.value("id",std::string())==candidate.value("id",std::string()))duplicate=true;
            if(duplicate)continue;
            if(int(armaments_["weapons"].size())<weapon_limit)armaments_["weapons"].push_back(candidate);
            else remaining.push_back(candidate);
        }
        death["weapons"]=remaining;
        death["recovered"]=death.value("items",Json::object()).empty()&&death.value("weapons",Json::array()).empty();
    }
    while(events_.size()>64)events_.erase(events_.begin());
}

Json Gameplay::command(const std::string& name, Json args) {
    if(!args.is_object())args=Json::object();
    if(name=="simulation_event"||name=="simulation.event")return record_event(std::move(args));
    if(name=="sync_fixtures")return synchronize_fixtures(args.value("records",Json::array()),args.value("accessibleOwnerIds",Json::array()),args.value("communityStations",Json::array()));
    if(name=="progression.list"||name.rfind("progression.",0)==0||name.rfind("craft.",0)==0||name.rfind("research.",0)==0||name.rfind("resource.",0)==0||name.rfind("equipment.",0)==0||name.rfind("tools.",0)==0||name.rfind("stations.",0)==0||name.rfind("components.",0)==0||name.rfind("materials.",0)==0||name.rfind("activities.",0)==0||name.rfind("rewards.",0)==0)return command_progression(name,args);
    if(name.rfind("inventory.",0)==0)return command_inventory(name,args);
    if(name.rfind("survival.",0)==0)return command_survival(name,args);
    if(name=="source.active"||name.rfind("energy.",0)==0||name.rfind("mana.",0)==0)return command_energy(name,args);
    if(name.rfind("placement.",0)==0)return command_placement(name,args);
    if(name.rfind("community.",0)==0)return command_community(name,args);
    if(name.rfind("faith.",0)==0)return command_faith(name,args);
    if(name.rfind("weapon.",0)==0)return command_armaments(name,args);
    if(name.rfind("campaign.",0)==0&&name!="campaign.pay"&&name!="campaign.transaction")return command_campaign(name,args);
    if(name=="player.state")return success_fields({{"player",player_},{"deaths",deaths_}});
    if(name=="player.respawn"){
        if(!player_.value("respawnPending",false))return error_result("player_not_dead");
        Json p=args.value("position",Json::object());for(const char* axis:{"x","y","z"})if(!finite_number(p.value(axis,Json())))return error_result("invalid_respawn_position");
        player_["x"]=p["x"];player_["y"]=p["y"];player_["z"]=p["z"];player_["hp"]=100.0;player_["maxHp"]=100.0;player_["calories"]=600.0;player_["lastDamageAt"]=number(player_.value("clock",Json()),0);player_["resting"]=false;player_["respawnPending"]=false;
        events_.push_back({{"type","player_respawned"},{"position",p}});return success_fields({{"player",player_}});
    }
    if(name=="campaign.pay"||name=="campaign.transaction"||name=="simulation.pay"||name=="simulation.reward"){
        const bool reward=name=="simulation.reward"||args.value("reward",false);
        const std::string claim=args.value("claim",std::string());if(!valid_claim(claim))return error_result("claim_required");
        if(has_claim(claim))return success_fields({{"duplicate",true},{"cores",campaign_.value("cores",0)},{"workCredits",progression_.value("workCredits",0.0)}});
        Json raw_items=args.value("items",Json::object()),items=Json::object();if(!raw_items.is_object())return error_result("invalid_items");
        static const std::map<std::string,std::string> frontier={{"wood","raw_timber"},{"plank","wood"},{"stone","loose_stone"},{"dirt","soil"},{"sand","sand"},{"fiber","plant_fiber"},{"berry","berry"},{"herb","herb"},{"seed","seed"},{"food","food"},{"medicine","food"},{"meat","meat"},{"iron","scrap_iron"},{"scrap","iron_ore"},{"crystal","mana_crystal_ore"},{"resin","sap"},{"bio","hide"}};
        double work=number(args.value("workCredits",Json()),0),cores=number(args.value("cores",Json()),0);
        for(const auto& pair:raw_items.items()){
            const double q=number(pair.value(),-1);if(!nonnegative(q))return error_result("invalid_items");
            if(pair.key()=="knowledge")work+=q*5.0;
            else if(pair.key()=="relic")cores+=q;
            else {auto found=frontier.find(pair.key());const std::string item=found==frontier.end()?pair.key():found->second;items[item]=number(items.value(item,Json()),0)+q;}
        }
        Json energy=args.value("energy",Json::object());
        if(!valid_items(items)||!nonnegative(work)||!nonnegative(cores)||!energy.is_object())return error_result("invalid_resources");
        for(const auto& pair:energy.items())if(!is_energy_type(pair.key())||!finite_number(pair.value())||!nonnegative(pair.value().get<double>()))return error_result("invalid_resources");
        if(!reward){
            if(!has_items(items)||!has_energy(energy)||number(progression_.value("workCredits",Json()),0)+EPS<work||number(campaign_.value("cores",Json()),0)+EPS<cores)return error_result("insufficient_resources");
            take_items(items);for(const auto& pair:energy.items()){const double amount=number(pair.value());progression_["energy"][pair.key()]=std::max(0.0,energy_available(pair.key())-amount);progression_["metrics"]["consumed"][pair.key()]=number(progression_["metrics"]["consumed"].value(pair.key(),Json()),0)+amount;}
            progression_["workCredits"]=number(progression_.value("workCredits",Json()),0)-work;campaign_["cores"]=std::max(0.0,number(campaign_.value("cores",Json()),0)-cores);
        }else{
            for(const auto& pair:items.items())put_items(pair.key(),number(pair.value()));
            for(const auto& pair:energy.items())progression_["energyOverflow"][pair.key()]=number(progression_["energyOverflow"].value(pair.key(),Json()),0)+number(pair.value());
            progression_["workCredits"]=number(progression_.value("workCredits",Json()),0)+work;campaign_["cores"]=number(campaign_.value("cores",Json()),0)+cores;
            for(const auto& type:ENERGY_TYPES){const double room=std::max(0.0,energy_capacity(type)-energy_available(type)),accepted=std::min(room,number(progression_["energyOverflow"].value(type,Json()),0));progression_["energy"][type]=energy_available(type)+accepted;progression_["energyOverflow"][type]=number(progression_["energyOverflow"].value(type,Json()),0)-accepted;}
        }
        add_claim(claim);array_add(campaign_["claims"],claim);
        if(campaign_.contains("firstSignal")&&campaign_["firstSignal"].is_object())campaign_["firstSignal"]["cores"]=campaign_["cores"];
        return success_fields({{"duplicate",false},{"items",items},{"energy",energy},{"workCredits",work},{"cores",campaign_["cores"]}});
    }
    return error_result("unknown_command");
}

Json Gameplay::view() const {
    Json catalog=Json::array(), recipes=Json::array(), research=Json::array(), sources=Json::array(), stations=Json::array(), tools=Json::array(), gear=Json::array(), components=Json::array(), materials=Json::array(), weapon_patterns=Json::array();
    for(auto row:list()){
        const std::string kind=row.value("kind",std::string()),id=row.value("id",std::string());catalog.push_back(row);
        if(kind=="recipe"){row["available"]=recipe_status(id);recipes.push_back(row);}
        else if(kind=="research"){row["available"]=research_status(id);row["known"]=array_has(progression_.value("research",Json::array()),id);research.push_back(row);}
        else if(kind=="source")sources.push_back(row);
        else if(kind=="station"){row["count"]=progression_.value("stations",Json::object()).value(id,Json(0));stations.push_back(row);}
        else if(kind=="tool"){row["count"]=count(id);row["wear"]=progression_.value("toolWear",Json::object()).value(id,row.value("durabilityActions",Json(0)));tools.push_back(row);}
        else if(kind=="gear_baseline"){row["count"]=count(id);gear.push_back(row);}
        else if(kind=="component"){row["count"]=count(id);components.push_back(row);}
        else if(kind=="material")materials.push_back(row);
        else if(kind=="weapon_pattern")weapon_patterns.push_back(row);
    }
    Json jobs=Json::array();
    for(const auto& job:progression_.value("jobs",Json::array())){
        Json row=job;
        if(job.value("type",std::string())=="craft"){
            const Json& r=entry(job.value("recipeId",std::string()));const double total=number(r.value("seconds",Json()),0)*number(job.value("count",Json()),1);
            const Json recipe_energy=r.value("energy",Json::object());
            Json rates=Json::object();for(const auto& e:recipe_energy.items())rates[e.key()]=number(e.value())/std::max(EPS,number(r.value("seconds",Json()),1));
            std::string blocked;const std::string rr=json_string(r.value("research",Json()));if(!rr.empty()&&!array_has(progression_.value("research",Json::array()),rr))blocked="research_required";else if(!station_available(r.value("station",std::string("hand"))))blocked="station_required";
            row["status"]={{"total",total},{"progress",job.value("progress",Json(0))},{"blocked",blocked.empty()?Json(nullptr):Json(blocked)},{"energy",rates},{"fixtureId",job.value("fixtureId",Json(nullptr))}};
        }else{const Json& a=entry(job.value("activityId",std::string()));row["status"]={{"total",a.value("secondsPerRepetition",Json(0))},{"progress",job.value("progress",Json(0))},{"blocked",nullptr},{"energy",Json::object()}};}
        jobs.push_back(row);
    }
    Json energy={{"amounts",progression_.value("energy",zero_energy())},{"capacity",{{"mechanical",energy_capacity("mechanical")},{"electrical",energy_capacity("electrical")},{"thermal",energy_capacity("thermal")},{"chemical",energy_capacity("chemical")},{"magic",energy_capacity("magic")},{"divine",energy_capacity("divine")}}},{"overflow",progression_.value("energyOverflow",zero_energy())},{"fixtures",fixture_energy_status()},{"metrics",progression_.value("metrics",Json::object())}};
    Json p={{"inventory",progression_.value("inventory",Json::object())},{"overflow",progression_.value("overflow",Json::object())},{"research",progression_.value("research",Json::array())},{"researchJob",progression_.value("researchJob",Json(nullptr))},{"researchProgress",progression_.value("researchProgress",Json::object())},{"workCredits",progression_.value("workCredits",Json(0.0))},{"jobs",jobs},{"stations",progression_.value("stations",Json::object())},{"assemblies",progression_.value("assemblies",Json::array())},{"equipped",progression_.value("equipped",Json(nullptr))},{"toolWear",progression_.value("toolWear",Json::object())},{"activeSources",progression_.value("activeSources",Json::object())},{"sourceFuel",progression_.value("sourceFuel",Json::object())},{"personalManaVessel",progression_.value("personalManaVessel",Json(nullptr))},{"personalMana",progression_.value("personalMana",Json::object())},{"energy",energy},{"clock",progression_.value("clock",Json(0.0))}};
    Json commands=Json::array();
    auto cmd=[&](const std::string&id,const std::string&label,const std::string&panel,Json fields,bool target=false){
        commands.push_back({{"id",id},{"label",label},{"panel",panel},{"fields",fields},{"requiresSelectedTarget",target}});
    };
    auto field=[](const std::string&key,const std::string&label,const std::string&type,bool required=true,const std::string&catalog={}){
        Json f={{"key",key},{"label",label},{"type",type},{"required",required}};
        if(!catalog.empty())f["catalogKind"]=catalog;
        return f;
    };
    auto fields=[&](std::initializer_list<Json> rows){return Json(rows);};
    cmd("progression.list","도감 검색","catalog",fields({field("kind","분류","catalog_kind",false),field("query","검색어","text",false),field("offset","시작 위치","integer",false),field("limit","표시 개수","integer",false)}));
    cmd("progression.status","진행 현황","progression",Json::array());
    cmd("progression.recipe_status","제작법 조건 확인","craft",fields({field("id","제작법","catalog",true,"recipe")}));
    cmd("progression.research_status","연구 조건 확인","research",fields({field("id","연구","catalog",true,"research")}));
    cmd("craft.queue","제작 시작","craft",fields({field("recipeId","제작법","catalog",true,"recipe"),field("count","개수","integer",false),field("autoInstall","완성 후 설치","boolean",false),field("fixtureId","작업 설비","fixture",false)}));
    cmd("craft.cancel","제작 취소","craft",fields({field("jobId","작업","job"),field("claim","요청 ID","claim",false)}));
    cmd("craft.prioritize","작업 앞으로","craft",fields({field("jobId","작업","job")}));
    cmd("research.start","연구 시작","research",fields({field("id","연구","catalog",true,"research")}));
    cmd("research.pause","연구 중단","research",Json::array());
    cmd("research.discover","설계도 분석","research",fields({field("blueprintId","설계도","catalog",true,"blueprint"),field("origin","획득 방식","select",false)}));
    cmd("resource.harvest","자원 채집","explore",fields({field("sourceId","채집 방식","catalog",true,"source"),field("environmentId","환경","catalog",true,"environment"),field("nodeId","채집 지점","text"),field("nodeType","지점 종류","text",false),field("elapsed","채집 시간","number",false),field("claim","요청 ID","claim",false)}));
    cmd("equipment.equip","보호 장비 착용","equipment",fields({field("id","장비","catalog",true,"gear_baseline")}));
    cmd("tools.wear","도구 사용 기록","equipment",fields({field("id","도구","catalog",true,"tool"),field("actions","사용 횟수","integer",false),field("claim","요청 ID","claim",false)}));
    cmd("stations.build","작업대 제작","craft",fields({field("id","작업대","catalog",true,"station")}));
    cmd("stations.install","작업대 설치","craft",fields({field("id","작업대","catalog",true,"station")}));
    cmd("components.place","부품 조립","energy",fields({field("id","부품","catalog",true,"component"),field("scale","크기","number",false),field("materialId","재료","catalog",false,"material"),field("materialLiters","재료 부피","number",false),field("fluidType","유체","select",false)}));
    cmd("components.status","부품 상태","energy",fields({field("id","부품","catalog",true,"component")}));
    cmd("components.condition","부품 상태 조정","energy",fields({field("instanceId","부품","fixture"),field("health","내구도","number",false),field("connected","연결률","number",false)}),true);
    cmd("materials.evaluate","재료 성능 확인","catalog",fields({field("id","재료","catalog",true,"material"),field("volumeLiters","부피","number",false),field("connectedAreaM2","연결 면적","number",false),field("health","내구도","number",false)}));
    cmd("activities.start","공동체 활동 시작","community",fields({field("id","활동","catalog",true,"activity"),field("communityId","공동체","target"),field("requestId","요청 ID","claim",false)}),true);
    cmd("inventory.reclaim","보관 공간 정리","inventory",Json::array());
    cmd("energy.status","에너지 현황","energy",Json::array());
    cmd("energy.store","에너지 저장","energy",fields({field("type","에너지 종류","energy"),field("amount","양","number")}));
    cmd("source.active","동력원 켜기/끄기","energy",fields({field("id","동력원","source",true,"energy_source"),field("active","켜짐","boolean")}));
    cmd("energy.link.quote","케이블 설치 비용","energy",fields({field("from","보내는 설비","fixture"),field("to","받는 설비","fixture"),field("type","에너지 종류","energy")}));
    cmd("energy.link","케이블 연결","energy",fields({field("from","보내는 설비","fixture"),field("to","받는 설비","fixture"),field("type","에너지 종류","energy"),field("claim","요청 ID","claim",false)}));
    cmd("energy.unlink","케이블 해제","energy",fields({field("from","보내는 설비","fixture"),field("to","받는 설비","fixture"),field("type","에너지 종류","energy")}));
    cmd("energy.source","동력원 켜기/끄기","energy",fields({field("ownerId","설비","fixture"),field("sourceId","동력원","source"),field("active","켜짐","boolean")}));
    cmd("energy.refuel","동력원 연료 보충","energy",fields({field("ownerId","설비","fixture"),field("sourceId","동력원","source"),field("batches","연료 묶음","integer",false),field("claim","요청 ID","claim",false)}));
    cmd("energy.fluid.set","유체 지정","energy",fields({field("ownerId","설비","fixture"),field("fluidType","유체","select")}));
    cmd("energy.fluid.fill","유체 채우기","energy",fields({field("ownerId","설비","fixture"),field("liters","부피","number")}));
    cmd("energy.charge","부품 충전","energy",fields({field("ownerId","설비","fixture"),field("type","에너지 종류","energy"),field("amount","양","number")}));
    cmd("energy.drain","부품 에너지 회수","energy",fields({field("ownerId","설비","fixture"),field("type","에너지 종류","energy"),field("amount","양","number")}));
    cmd("mana.status","개인 마나 현황","energy",Json::array());
    cmd("mana.invest.quote","마나 용량 투자 견적","energy",fields({field("materialId","재료","catalog",true,"material"),field("liters","부피","integer",false)}));
    cmd("mana.invest","마나 용량 투자","energy",fields({field("materialId","재료","catalog",true,"material"),field("liters","부피","integer",false),field("claim","요청 ID","claim",false)}));
    cmd("mana.focus","마나 집중 장비","energy",fields({field("id","장비","catalog",true,"gear_baseline")}));
    cmd("mana.unfocus","마나 집중 해제","energy",Json::array());
    cmd("mana.use_cup","마나 그릇 사용","energy",Json::array());
    cmd("mana.fill_cup","마나 그릇 채우기","energy",fields({field("liters","액체 마나","number"),field("claim","요청 ID","claim",false)}));
    cmd("mana.absorb_cup","마나 그릇 비우기","energy",fields({field("amount","흡수량","number"),field("claim","요청 ID","claim",false)}));
    cmd("mana.fill_personal","개인 마나 충전","energy",fields({field("liters","액체 마나","number"),field("claim","요청 ID","claim",false)}));
    cmd("placement.list","설치물 목록","placement",Json::array());
    cmd("placement.access","설치물 접근 권한 갱신","placement",fields({field("position","플레이어 위치","player"),field("communityStations","공동체 작업대","catalog",false,"station")}));
    cmd("placement.place","설비 배치","placement",fields({field("assetId","설비","catalog",true,"station/component"),field("position","위치","position"),field("rotation","회전","quaternion",false),field("scale","크기","number",false),field("actorPosition","플레이어 위치","player"),field("worldContext","월드 충돌·지지 결과","world_context",false)}));
    cmd("placement.remove","설비 해체","placement",fields({field("id","설비","fixture"),field("actorPosition","플레이어 위치","player",false)}));
    cmd("placement.repair","설비 수리","placement",fields({field("id","설비","fixture"),field("actorPosition","플레이어 위치","player",false)}));
    cmd("placement.damage","설비 피해","placement",fields({field("id","설비","fixture"),field("amount","피해량","number")}));
    cmd("placement.set_pose","설비 이동","placement",fields({field("id","설비","fixture"),field("position","위치","position"),field("rotation","회전","quaternion",false),field("actorPosition","플레이어 위치","player",false)}));
    cmd("placement.mark_dynamic","설비 물리 설정","placement",fields({field("id","설비","fixture"),field("dynamic","물리 이동","boolean")}));
    cmd("community.status","공동체 현황","community",Json::array());
    cmd("community.options","공동체 행동 보기","community",fields({field("targetId","주민 또는 공동체","target")} ),true);
    cmd("community.interact","공동체 행동","community",fields({field("targetId","주민 또는 공동체","target"),field("type","행동","community_action"),field("requestId","요청 ID","claim",false)}),true);
    cmd("faith.status","신앙 현황","faith",fields({field("instanceId","제단","shrine",false)}));
    cmd("faith.options","신앙 행동 보기","faith",fields({field("instanceId","제단","shrine")} ),true);
    cmd("faith.interact","신앙 행동","faith",fields({field("instanceId","제단","shrine"),field("actionId","행동","faith_action"),field("visible","시야 확인","boolean",false)}),true);
    cmd("weapon.status","무기 보관함","weapon",Json::array());
    cmd("weapon.quote","무기 제작 조건 확인","weapon",fields({field("patternId","무기 형태","catalog",true,"weapon_pattern"),field("materialId","재료","catalog",true,"material")}));
    cmd("weapon.forge","무기 제작","weapon",fields({field("patternId","무기 형태","catalog",true,"weapon_pattern"),field("materialId","재료","catalog",true,"material")}));
    cmd("weapon.equip","무기 장착","weapon",fields({field("id","무기","weapon",false)}));
    cmd("weapon.repair","무기 수리","weapon",fields({field("id","무기","weapon",false),field("amount","수리량","integer",false),field("claim","요청 ID","claim",false)}));
    cmd("weapon.salvage","무기 분해","weapon",fields({field("id","무기","weapon"),field("claim","요청 ID","claim",false)}));
    cmd("campaign.status","원정 기록","campaign",Json::array());
    cmd("survival.eat","식량 먹기","survival",fields({field("itemId","식량","catalog",false,"item"),field("claim","요청 ID","claim",false)}));
    cmd("survival.rest","휴식","survival",fields({field("resting","휴식","boolean",false)}));
    cmd("player.respawn","다시 깨어나기","survival",fields({field("position","복귀 위치","position")}));
    Json armaments=armaments_;
    const Json equipped_id=armaments.value("equippedId",Json(nullptr));
    for(auto& weapon:armaments["weapons"])weapon["equipped"]=weapon.value("id",Json())==equipped_id;
    return {{"player",player_},{"deaths",deaths_},{"progression",p},{"catalog",catalog},{"catalogCount",catalog.size()},
        {"catalogByKind",{{"recipes",recipes},{"research",research},{"sources",sources},{"stations",stations},{"tools",tools},{"gear",gear},{"components",components},{"materials",materials},{"weaponPatterns",weapon_patterns}}},
        {"placements",placement_status()},{"community",community_status()},{"faith",faith_status()},{"campaign",campaign_status()},{"armaments",armaments},{"commands",commands}};
}

void Gameplay::validate_loaded_state() {
    auto invalid=[](const std::string& why){throw std::invalid_argument(why);};
    if(!progression_.is_object()||progression_.value("schemaVersion",1)!=1)invalid("Unsupported progression save");
    if(!placements_.is_object()||placements_.value("schemaVersion",1)!=1)invalid("Unsupported placement save");
    if(!community_.is_object()||community_.value("schemaVersion",1)!=1)invalid("Unsupported community save");
    if(!faith_.is_object()||faith_.value("schemaVersion",1)!=1)invalid("Unsupported faith save");
    if(!campaign_.is_object()||campaign_.value("schemaVersion",1)!=1)invalid("Unsupported campaign save");
    for(const char* field:{"inventory","overflow","stations","harvestClaims","researchProgress","activeSources","sourceFuel","activityProgress","activityRequests","toolWear","energy","energyOverflow","metrics"})if(!progression_.contains(field)||!progression_[field].is_object())invalid(std::string("Invalid progression field: ")+field);
    for(const char* field:{"research","assemblies","claims","jobs","worldFixtures","communityStations"})if(!progression_.contains(field)||!progression_[field].is_array())invalid(std::string("Invalid progression list: ")+field);
    if(!progression_["fixtureEnergy"].is_object())invalid("Invalid fixture energy save");
    if(!placements_.contains("fixtures")||!placements_["fixtures"].is_array()||placements_["fixtures"].size()>256)invalid("Invalid fixture save");
    if(!community_.value("communities",Json::array()).is_array()||!community_.value("residents",Json::array()).is_array()||!community_.value("receipts",Json::array()).is_array())invalid("Invalid community save");
    if(!faith_.value("quests",Json::object()).is_object()||!faith_.value("trials",Json::object()).is_object()||!faith_.value("shrines",Json::array()).is_array())invalid("Invalid faith save");
    for(const auto& field:progression_["inventory"].items())if(entry(field.key()).empty()||!valid_items(Json::object({{field.key(),field.value()}})))invalid("Invalid saved item");
    for(const auto& field:progression_["overflow"].items())if(entry(field.key()).empty()||!valid_items(Json::object({{field.key(),field.value()}})))invalid("Invalid saved overflow item");
    std::set<std::string> known;
    for(const auto& id:progression_["research"])if(!id.is_string()||entry(id.get<std::string>()).value("kind",std::string())!="research"||!known.insert(id.get<std::string>()).second)invalid("Invalid saved research");
    for(const auto& row:progression_["stations"].items())if(entry(row.key()).value("kind",std::string())!="station"||!finite_number(row.value())||number(row.value())<0||std::floor(number(row.value()))!=number(row.value()))invalid("Invalid saved station");
    for(const auto& type:ENERGY_TYPES){
        const Json energy=progression_["energy"].value(type,Json(0.0)),overflow=progression_["energyOverflow"].value(type,Json(0.0));
        if(!finite_number(energy)||!nonnegative(number(energy))||!finite_number(overflow)||!nonnegative(number(overflow)))invalid("Invalid saved energy");
    }
    for(const auto& claim:progression_["claims"])if(!claim.is_string()||!valid_claim(claim.get<std::string>()))invalid("Invalid progression claim");
    if(progression_["jobs"].size()>64)invalid("Progression queue exceeds limit");
    std::set<std::string> job_ids;
    for(const auto& job:progression_["jobs"]){
        const auto type=job.value("type",std::string()),id=job.value("id",std::string());
        const Json& definition=entry(job.value(type=="craft"?"recipeId":"activityId",std::string()));
        if(!valid_claim(id)||!job_ids.insert(id).second||!nonnegative(number(job.value("progress",Json()),-1))||(type!="craft"&&type!="activity")||definition.value("kind",std::string())!=(type=="craft"?"recipe":"activity"))invalid("Invalid saved job");
        double total=number(definition.value(type=="craft"?"seconds":"secondsPerRepetition",Json()),0);
        if(type=="craft"){const double count=number(job.value("count",Json()),0);if(count<1||count>64||std::floor(count)!=count)invalid("Invalid saved craft count");total*=count;}
        if(number(job.value("progress",Json()),0)>total+EPS)invalid("Saved job progress exceeds total");
    }
    for(const auto& pair:progression_["researchProgress"].items()){
        const Json& r=entry(pair.key());if(r.value("kind",std::string())!="research"||!pair.value().value("paid",false)||!nonnegative(number(pair.value().value("work",Json()),-1))||number(pair.value().value("work",Json()),0)>number(r.value("work",Json()),0)+EPS)invalid("Invalid saved research progress");
    }
    const Json& fe=progression_["fixtureEnergy"];
    if(fe.value("schemaVersion",1)!=1||!fe.value("nodes",Json::array()).is_array()||!fe.value("links",Json::array()).is_array()||!fe.value("claims",Json::array()).is_array())invalid("Invalid fixture energy save");
    std::set<std::string> owners;
    for(const auto& row:placements_["fixtures"]){
        const std::string id=row.value("id",std::string()),asset=row.value("assetId",std::string());
        const std::string kind=entry(asset).value("kind",std::string());
        if(!valid_claim(id)||!owners.insert(id).second||(kind!="station"&&kind!="component")||row.value("kind",std::string())!=kind||!row.value("motion",Json::object()).is_object())invalid("Invalid saved fixture");
        for(const char* axis:{"x","y","z"})if(!finite_number(row.value("position",Json::object()).value(axis,Json())))invalid("Invalid saved fixture position");
        if(!nonnegative(number(row.value("hp",Json()),-1))||!positive(number(row.value("maxHp",Json()),0))||number(row.value("hp",Json()),0)>number(row.value("maxHp",Json()),0))invalid("Invalid saved fixture health");
    }
    for(const auto& record:deaths_){
        if(!record.is_object()||!valid_claim(record.value("id",std::string()))||!record.value("items",Json::object()).is_object()||!record.value("position",Json::object()).is_object())invalid("Invalid death record");
        const Json record_items=record.value("items",Json::object());
        for(const auto& item:record_items.items())if(!valid_items(Json::object({{item.key(),item.value()}})))invalid("Invalid death cache item");
    }
}

} // namespace feral
