#pragma once

#include "common.hpp"

namespace feral {

class World;
class Gameplay;
class Simulation;

/** Inventory-backed sandbox actions over the authoritative world, economy and simulation. */
class WorldTools {
public:
    using ExtraSolidQuery = std::function<bool(Vec3)>;

    WorldTools(const Content& content,World& world,Gameplay& gameplay,Simulation& simulation,
               ExtraSolidQuery extra_solid={});
    Json metadata() const;
    Json command(const std::string& name,Json args=Json::object());
    Json save() const;
    void load(Json state);

private:
    const Content& content_;
    World& world_;
    Gameplay& gameplay_;
    Simulation& simulation_;
    ExtraSolidQuery extra_solid_;
    uint64_t spawn_serial_=0;

    Json place_block(const Json& args);
    Json pour(const Json& args,bool acid);
    Json ignite(const Json& args);
    Json apply_heat(const Json& args);
    Json spawn_creature(const Json& args);
    Json observe(const Json& args);
};

} // namespace feral
