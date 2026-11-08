#include "world_tools.hpp"
#include "gameplay.hpp"
#include "simulation.hpp"
#include "world.hpp"

#include <cassert>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace feral;

namespace {
Content load_content(){
    std::ifstream file("native/data/content.json");if(!file)throw std::runtime_error("native/data/content.json is required");
    Content content;content.data=Json::parse(file);content.index();return content;
}
Json sandbox_config(bool enabled){
    return {{"configVersion",1},{"preset","island"},{"seed",63026},
        {"terrain",{{"generator","island"}}},{"rules",{{"sandbox",enabled},{"survival",false}}},{"modules",Json::array()}};
}
Json aim(Vec3 point,Vec3 normal={0,1,0},double distance=2){
    return {{"hit",{{"kind","terrain"},{"point",point},{"normal",normal},{"distance",distance}}}};
}

void world_tools_respect_sandbox_and_authoritative_inventory(){
    Content content=load_content();Json config=sandbox_config(true);
    World world(content);world.configure(config);Gameplay gameplay(content);gameplay.configure(config);Simulation simulation(content);simulation.configure(config);
    WorldTools tools(content,world,gameplay,simulation);

    assert(gameplay.grant({{"raw_timber",1}},"test:starter")["ok"]);
    Json place=aim({10,50,10});place["itemId"]="raw_timber";place["size"]=.5;place["playerPosition"]={{"x",10},{"y",5},{"z",10}};place["claim"]="sandbox-place:one";
    const Json placed=tools.command("sandbox.place_block",place);
    assert(placed["ok"]&&placed["cells"]==1&&world.block({20,100,20})=="log");
    assert(gameplay.count("raw_timber")==0);
    const Json duplicate=tools.command("sandbox.place_block",place);
    assert(duplicate["ok"]&&duplicate["duplicate"]&&world.block({20,100,20})=="log");

    Json water=aim({700,60,700});const Json water_result=tools.command("sandbox.pour_water",water);
    assert(water_result["ok"]&&water_result["type"]=="water"&&std::abs(water_result["addedM3"].get<double>()-.5)<1e-9);
    Json acid=aim({710,60,700});const Json acid_result=tools.command("sandbox.pour_acid",acid);
    assert(acid_result["ok"]&&acid_result["type"]=="acid"&&acid_result["addedM3"].get<double>()>0);
    acid["hit"]["point"]["y"]=60.3;acid["energyEu"]=1000;const Json heat=tools.command("sandbox.apply_heat",acid);
    assert(heat["ok"]&&heat["acceptedEu"]==1000);

    const Cell log_cell{3000,120,3000};assert(world.set_block(log_cell,"log"));
    Json fire=aim(cell_center(log_cell));assert(tools.command("sandbox.ignite",fire)["ok"]);

    const auto surface=world.surface_sample(77.5,84.5);Json spawn=aim({77.5,surface.height,84.5});spawn["claim"]="sandbox-spawn:one";
    const Json animal=tools.command("sandbox.spawn_creature",spawn);
    assert(animal["ok"]&&animal["entityId"]=="creature:sandbox:sandbox-spawn:one");
    assert(animal["environmentId"]=="grove");
    assert(!tools.metadata()["commands"].empty());
    Json saved=tools.save();WorldTools restored(content,world,gameplay,simulation);restored.load(saved);assert(restored.save()["spawnSerial"]==saved["spawnSerial"]);

    Json disabled_config=sandbox_config(false);World disabled(content);disabled.configure(disabled_config);Gameplay disabled_game(content);disabled_game.configure(disabled_config);Simulation disabled_sim(content);disabled_sim.configure(disabled_config);
    WorldTools disabled_tools(content,disabled,disabled_game,disabled_sim);
    const Json blocked=disabled_tools.command("sandbox.pour_water",water);
    assert(!blocked["ok"]&&blocked["reason"]=="sandbox_required");
}
}

int main(){world_tools_respect_sandbox_and_authoritative_inventory();std::cout<<"native world tools tests passed\n";}
