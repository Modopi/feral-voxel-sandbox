#include "register_types.hpp"
#include "feral_game.hpp"
#include "physics_harness.hpp"
#include "machine_panel.hpp"
#include <godot_cpp/godot.hpp>
void initialize_feral_module(godot::ModuleInitializationLevel level){if(level==godot::MODULE_INITIALIZATION_LEVEL_SCENE){godot::ClassDB::register_class<feral::NativeBody>();godot::ClassDB::register_class<feral::ActionTimeline>();godot::ClassDB::register_class<feral::NativePhysicsHarness>();godot::ClassDB::register_class<feral::MachinePanel>();godot::ClassDB::register_class<feral::FeralGame>();}}
void uninitialize_feral_module(godot::ModuleInitializationLevel){}
extern "C" {
GDExtensionBool GDE_EXPORT feral_library_init(GDExtensionInterfaceGetProcAddress get_proc_address,GDExtensionClassLibraryPtr library,GDExtensionInitialization* initialization){
    godot::GDExtensionBinding::InitObject init(get_proc_address,library,initialization);
    init.register_initializer(initialize_feral_module);init.register_terminator(uninitialize_feral_module);init.set_minimum_library_initialization_level(godot::MODULE_INITIALIZATION_LEVEL_SCENE);return init.init();
}
}
