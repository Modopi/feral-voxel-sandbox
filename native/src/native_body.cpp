#include "native_body.hpp"
#include <godot_cpp/classes/node.hpp>
namespace feral {
void NativeBody::_integrate_forces(godot::PhysicsDirectBodyState3D* state){
    using namespace godot;count_=0;
    for(int i=0;i<state->get_contact_count()&&count_<contacts_.size();i++){
        Object* other=state->get_contact_collider_object(i);if(!other)continue;
        Vector3 point=state->get_contact_local_position(i),normal=state->get_contact_local_normal(i);
        Vector3 velocity=previous_velocity_+previous_omega_.cross(point-state->get_transform().origin);
        double speed=std::abs((velocity-state->get_contact_collider_velocity_at_position(i)).dot(normal));if(speed<=4)continue;
        double mass=get_mass();if(auto rigid=Object::cast_to<RigidBody3D>(other))mass=mass*rigid->get_mass()/(mass+rigid->get_mass());else if(other->has_meta("feral_player"))mass=mass*80/(mass+80);
        double energy=.5*mass*(speed*speed-16);if(energy<=0)continue;
        auto& c=contacts_[count_++];c.target=other->has_meta("feral_id")?fs(other->get_meta("feral_id")):"terrain";c.point=fv(point);c.normal=fv(normal);c.joules=energy;c.target_shape=state->get_contact_collider_shape(i);
    }
}
}
