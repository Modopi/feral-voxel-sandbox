#pragma once
#include "native_geometry.hpp"
#include <godot_cpp/classes/rigid_body3d.hpp>
#include <godot_cpp/classes/physics_direct_body_state3d.hpp>
namespace feral {
struct BodyContact {
    std::string target;
    int target_shape=-1;
    Vec3 point,normal;
    double joules=0;
};
class NativeBody : public godot::RigidBody3D {
    GDCLASS(NativeBody,godot::RigidBody3D)
    godot::Vector3 previous_velocity_,previous_omega_;
    std::array<BodyContact,8> contacts_;
    size_t count_=0;
protected:
    static void _bind_methods(){}
public:
    void capture_velocity(){previous_velocity_=get_linear_velocity();previous_omega_=get_angular_velocity();}
    size_t contact_count()const{return count_;}
    const BodyContact& contact(size_t index)const{return contacts_.at(index);}
    void clear_contacts(){count_=0;}
    void _integrate_forces(godot::PhysicsDirectBodyState3D* state) override;
};
}
